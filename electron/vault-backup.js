// ---------------------------------------------------------------------------
// Sauvegarde automatique des trousseaux
//
// Un coffre-fort sans sauvegarde est un point unique de défaillance : si
// <userData>/vaults/ disparaît (disque mort, profil recréé, dossier nettoyé),
// les mots de passe sont perdus — il n'y a aucun serveur pour les redonner.
// L'export manuel existe, mais il suppose qu'on y pense.
//
// Ce module écrit donc des ARCHIVES CHIFFRÉES (vault-archive.js : AES-256-GCM,
// clé dérivée par scrypt) dans un dossier choisi par l'utilisateur, à une
// cadence choisie, en conservant les N dernières.
//
// Deux contraintes qui expliquent la forme du code :
//   • Sauvegarder exige de DÉCHIFFRER le trousseau, donc son mot de passe
//     maître. On ne le stocke pas : la sauvegarde ne concerne QUE les
//     trousseaux actuellement déverrouillés, dont la clé est déjà en mémoire.
//     Un trousseau resté fermé n'est pas sauvegardé, et c'est dit à l'écran.
//   • La phrase de passe des archives, elle, doit survivre aux redémarrages,
//     sinon rien n'est automatique. Elle est confiée au TROUSSEAU DE L'OS
//     (safeStorage) : jamais en clair sur le disque, jamais dans les réglages
//     synchronisés. Sans trousseau système disponible, la fonction se refuse
//     plutôt que d'écrire une phrase de passe en clair.
// ---------------------------------------------------------------------------
import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import { sealArchive, MIN_PASSPHRASE_LENGTH } from './vault-archive.js';
import { isDue, nextRunDate, archiveName, archivesToPrune } from './vault-backup-rules.js';

const CONFIG_FILE = 'vault-backup.json';

const state = {
  file: null,
  // { enabled, dir, everyHours, keep, passphrase (chiffrée), lastRunAt, lastResult }
  config: null,
  timer: null,
  // Injecté par main.js : accès au coffre sans dépendance circulaire.
  vault: null,
};

const DEFAULTS = {
  enabled: false,
  dir: '',
  everyHours: 24,
  keep: 7,
  lastRunAt: 0,
  lastResult: null,
};

// --- Configuration ---------------------------------------------------------
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(state.file, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function save() {
  try {
    fs.writeFileSync(state.file, JSON.stringify(state.config), { mode: 0o600 });
  } catch (err) {
    console.error('[vault-backup] configuration non sauvegardée:', err.message);
  }
}

export function init(userDataPath, vault) {
  state.file = path.join(userDataPath, CONFIG_FILE);
  state.vault = vault;
  state.config = load();
  schedule();
}

// Vue pour l'interface. La phrase de passe n'en sort JAMAIS — seulement le
// fait qu'elle est en place.
export function getState() {
  const c = state.config || DEFAULTS;
  return {
    enabled: Boolean(c.enabled),
    dir: c.dir || '',
    everyHours: c.everyHours || 24,
    keep: c.keep || 7,
    lastRunAt: c.lastRunAt || 0,
    lastResult: c.lastResult || null,
    hasPassphrase: Boolean(c.passphrase),
    keychainAvailable: isKeychainAvailable(),
    nextRunAt: nextRunAt(),
  };
}

function isKeychainAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function nextRunAt() {
  const c = state.config;
  if (!c?.enabled || !c.dir || !c.passphrase) return 0;
  return nextRunDate(c.lastRunAt, c.everyHours);
}

export function configure({ enabled, dir, everyHours, keep, passphrase } = {}) {
  const c = state.config;
  if (typeof enabled === 'boolean') c.enabled = enabled;
  if (typeof dir === 'string' && dir) c.dir = dir;
  if (Number.isFinite(everyHours)) c.everyHours = Math.max(1, Math.min(24 * 30, everyHours));
  if (Number.isFinite(keep)) c.keep = Math.max(1, Math.min(100, keep));

  if (typeof passphrase === 'string' && passphrase) {
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return { success: false, error: 'weak-passphrase' };
    }
    if (!isKeychainAvailable()) {
      // Mieux vaut refuser que d'écrire la phrase de passe en clair à côté des
      // archives qu'elle protège.
      return { success: false, error: 'no-keychain' };
    }
    c.passphrase = safeStorage.encryptString(passphrase).toString('base64');
  }

  // Activer sans dossier ni phrase de passe ne produirait qu'un réglage qui
  // ment : on le dit tout de suite.
  if (c.enabled && !c.dir) return { success: false, error: 'dir-required' };
  if (c.enabled && !c.passphrase) return { success: false, error: 'passphrase-required' };

  save();
  schedule();
  return { success: true, ...getState() };
}

export function forgetPassphrase() {
  delete state.config.passphrase;
  state.config.enabled = false;
  save();
  schedule();
  return { success: true, ...getState() };
}

function readPassphrase() {
  const stored = state.config?.passphrase;
  if (!stored) return null;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    // Trousseau de l'OS changé (autre session, autre machine) : la phrase est
    // irrécupérable. On désarme plutôt que d'échouer en boucle.
    delete state.config.passphrase;
    state.config.enabled = false;
    save();
    return null;
  }
}

// --- Planification ---------------------------------------------------------
// Un seul minuteur, réarmé après chaque passage. On vérifie toutes les
// 15 minutes plutôt que de programmer un réveil lointain : une machine mise en
// veille ou un Orbit redémarré fausserait un délai calculé une fois pour
// toutes, et une sauvegarde manquée ne se rattraperait jamais.
const CHECK_INTERVAL = 15 * 60 * 1000;

function schedule() {
  clearInterval(state.timer);
  state.timer = null;
  if (!state.config?.enabled) return;
  state.timer = setInterval(() => {
    const c = state.config;
    if (!c?.enabled || !c.dir || !c.passphrase) return;
    if (isDue(c.lastRunAt, c.everyHours)) runNow().catch(() => {});
  }, CHECK_INTERVAL);
  state.timer.unref?.();
}

// --- Exécution -------------------------------------------------------------
export async function runNow({ manual = false } = {}) {
  const c = state.config;
  if (!c) return { success: false, error: 'not-initialized' };
  if (!manual && !c.enabled) return { success: false, error: 'disabled' };
  if (!c.dir) return { success: false, error: 'dir-required' };

  const passphrase = readPassphrase();
  if (!passphrase) return { success: false, error: 'passphrase-required' };

  // Seuls les trousseaux déverrouillés peuvent être lus (voir l'en-tête).
  const vaults = state.vault.list().filter((v) => v.unlocked);
  const locked = state.vault.list().filter((v) => !v.unlocked).map((v) => v.name);
  if (vaults.length === 0) {
    const result = { at: Date.now(), written: 0, locked, error: 'all-locked' };
    c.lastResult = result;
    // On NE met pas à jour lastRunAt : la prochaine occasion (un trousseau
    // ouvert) doit être saisie tout de suite, pas dans 24 h.
    save();
    return { success: false, error: 'all-locked', ...result };
  }

  try {
    fs.mkdirSync(c.dir, { recursive: true });
  } catch (err) {
    const result = { at: Date.now(), written: 0, locked, error: 'dir-unwritable' };
    c.lastResult = result;
    save();
    return { success: false, error: 'dir-unwritable', detail: String(err.message || err) };
  }

  const written = [];
  const failed = [];
  for (const v of vaults) {
    const payload = state.vault.exportPayload(v.id);
    if (!payload.success) {
      failed.push(v.name);
      continue;
    }
    try {
      const envelope = sealArchive({
        passphrase,
        payload: payload.payload,
        meta: { vaultName: v.name },
      });
      const file = path.join(c.dir, archiveName(v.name));
      // Écriture atomique : une coupure ne laisse pas une archive tronquée
      // qui serait prise pour une sauvegarde valide.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(envelope), { mode: 0o600 });
      fs.renameSync(tmp, file);
      written.push({ vault: v.name, file, entries: envelope.entryCount });
      prune(c.dir, v.name, c.keep || 7);
    } catch {
      failed.push(v.name);
    }
  }

  const result = {
    at: Date.now(),
    written: written.length,
    entries: written.reduce((n, w) => n + (w.entries || 0), 0),
    failed,
    locked,
  };
  c.lastRunAt = result.at;
  c.lastResult = result;
  save();
  return { success: written.length > 0, ...result, files: written.map((w) => w.file) };
}

// Rotation : on ne garde que les `keep` archives les plus récentes d'un
// trousseau. Sans ça, une sauvegarde quotidienne remplit le disque en silence.
// Le tri se fait sur le NOM, qui porte un horodatage ISO : trier sur la date
// du fichier se ferait piéger par une copie ou une synchronisation cloud, qui
// la réécrivent.
function prune(dir, vaultName, keep) {
  try {
    for (const f of archivesToPrune(fs.readdirSync(dir), vaultName, keep)) {
      fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    /* rotation impossible : la sauvegarde reste valide, c'est l'essentiel */
  }
}

// Dossier proposé par défaut : Documents/Orbit, à côté de ce que l'utilisateur
// sauvegarde déjà, plutôt qu'un recoin du profil applicatif.
export function suggestedDir() {
  try {
    return path.join(app.getPath('documents'), 'Orbit', 'sauvegardes-coffre');
  } catch {
    return '';
  }
}
