// ---------------------------------------------------------------------------
// Orchestration d'un cycle de synchronisation.
//
// Le découpage suit une règle simple : le processus principal fait les
// entrées/sorties (fichier, chiffrement), le renderer fait la fusion (il a le
// store). Ce module est la charnière — il enchaîne lire → fusionner → écrire →
// appliquer, et c'est tout. Toute la logique délicate vit dans syncMerge.js,
// qui est pur et testé.
//
// Un cycle complet, dans l'ordre :
//   1. lire l'instantané distant (absent = première machine)
//   2. le fusionner avec l'état local (arbitrage par entité)
//   3. republier le résultat, pour que les autres machines le voient
//   4. l'appliquer localement, SEULEMENT s'il apporte du nouveau
// ---------------------------------------------------------------------------
import { useStore } from '../stores/useStore.js';
import { mergeSnapshots, hasIncomingChanges, summarize } from './syncMerge.js';

// Réglages de synchronisation : conservés hors du store synchronisé, car ils
// sont propres à CHAQUE machine (le dossier n'a pas le même chemin partout, et
// la phrase secrète ne doit jamais voyager avec les données qu'elle protège).
//
// La PHRASE SECRÈTE ne passe PAS par là : elle protège toute la configuration
// déposée dans le dossier partagé, la laisser en clair dans le localStorage
// reviendrait à la poser à côté de la serrure. Elle vit dans le trousseau de
// l'OS, côté processus principal (voir `sync:savePassphrase`).
const KEY = 'orbit.sync.config';

export function loadSyncConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    const cfg = raw ? JSON.parse(raw) : null;
    const { password: _legacy, ...rest } = cfg || {};
    return { folder: '', enabled: false, auto: true, lastSync: 0, ...rest };
  } catch {
    return { folder: '', enabled: false, auto: true, lastSync: 0 };
  }
}

// Phrase secrète, lue depuis le trousseau de l'OS.
export async function loadPassphrase() {
  const res = await window.electronAPI?.sync?.loadPassphrase?.();
  return res?.passphrase || '';
}

export async function savePassphrase(passphrase) {
  return window.electronAPI?.sync?.savePassphrase?.(passphrase);
}

export function saveSyncConfig(patch) {
  // Garde-fou : si un appelant passe encore `password`, on le jette plutôt que
  // de le réécrire en clair (migration des versions précédentes).
  const { password: _drop, ...safe } = patch || {};
  const next = { ...loadSyncConfig(), ...safe };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota plein : la synchronisation marchera, mais il faudra la reconfigurer */
  }
  return next;
}

// Exécute un cycle. Ne lève jamais : renvoie toujours un compte rendu, car
// l'appelant est souvent un minuteur silencieux.
export async function runSync({ folder, password } = {}) {
  const api = window.electronAPI?.sync;
  if (!api) return { ok: false, error: 'sync.noBridge' };
  if (!folder) return { ok: false, error: 'sync.noFolder' };

  const identity = (await api.identity()) || {};

  // 1. Lire le distant
  const read = await api.read({ folder, password });
  if (!read?.success) {
    if (read?.needsPassword) return { ok: false, error: 'sync.needsPassword' };
    return { ok: false, error: read?.error || 'sync.readFailed' };
  }

  // 2. Fusionner
  const state = useStore.getState();
  const { snapshot, changes } = mergeSnapshots(
    { ...state, deviceId: identity.id, deviceName: identity.name },
    read.snapshot
  );

  // 3. Republier — même sans nouveauté entrante, nos propres modifications
  // doivent partir vers les autres machines.
  const write = await api.write({ folder, password, snapshot });
  if (!write?.success) return { ok: false, error: write?.error || 'sync.writeFailed' };

  // 4. N'écrire dans le store QUE si le distant apporte quelque chose : sinon
  // un cycle périodique ferait clignoter l'interface toutes les N minutes.
  const incoming = hasIncomingChanges(changes);
  if (incoming) useStore.getState().applySyncSnapshot(snapshot);

  return { ok: true, incoming, first: changes.first, summary: summarize(changes), at: write.at };
}
