// ---------------------------------------------------------------------------
// Verrouillage d'Orbit — code de déverrouillage global + par profil
//
// Objectif : quiconque ouvre Orbit ne doit PAS accéder d'emblée à tous les
// comptes connectés. On protège par un code (PIN/passphrase) :
//   • verrou global : demandé au lancement ;
//   • verrou par profil : un profil « perso » reste masqué tant qu'on n'a pas
//     saisi son code.
//
// Sécurité :
//   • le code n'est JAMAIS stocké : on garde une empreinte scrypt (sel aléatoire
//     + coût élevé) et on compare en temps constant ;
//   • le fichier security.json est en plus CHIFFRÉ au repos via le trousseau de
//     l'OS (safeStorage) quand c'est disponible → un code à 4 chiffres n'est pas
//     cassable hors-ligne même si le fichier fuite ;
//   • tout vit dans le process principal : le renderer ne voit jamais les
//     empreintes, seulement « déverrouillé ou non ».
// ---------------------------------------------------------------------------
import * as secureStore from './secure-store.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

let configFile = null;

// { appLock: { salt, hash } | null, profileLocks: { [profileId]: { salt, hash } } }
let data = { appLock: null, profileLocks: {} };

// État de déverrouillage de la SESSION en cours (réinitialisé à chaque
// lancement d'Orbit) — jamais persisté.
const unlocked = { app: false, profiles: new Set() };

// scrypt : dérivation lente (résiste au brute-force d'un PIN court)
function derive(pin, saltHex) {
  return crypto
    .scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 })
    .toString('hex');
}

function makeEntry(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: derive(pin, salt) };
}

function verifyEntry(entry, pin) {
  if (!entry || !entry.salt || !entry.hash) return false;
  try {
    const h = derive(pin, entry.salt);
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(entry.hash, 'hex'));
  } catch {
    return false;
  }
}

// Écritures en FILE : le chiffrement est asynchrone, deux changements
// rapprochés ne doivent jamais s'écrire dans le désordre. La mémoire (`data`)
// fait foi ; le fichier la suit.
let writeChain = Promise.resolve();
function persist() {
  if (!configFile) return writeChain;
  const json = JSON.stringify(data);
  const file = configFile;
  writeChain = writeChain
    .then(async () => {
      if (await secureStore.isAvailable()) fs.writeFileSync(file, await secureStore.encrypt(json));
      else fs.writeFileSync(file, json, 'utf8');
    })
    .catch((err) => console.error('[security] sauvegarde échouée:', err.message));
  return writeChain;
}

async function load() {
  try {
    const buf = fs.readFileSync(configFile);
    // Ancien fichier en clair (ou safeStorage indisponible) : JSON direct
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      // Sinon : blob chiffré par le trousseau du système
      if (await secureStore.isAvailable()) {
        return JSON.parse(await secureStore.decrypt(buf));
      }
    }
  } catch {
    /* pas de fichier : configuration vierge */
  }
  return { appLock: null, profileLocks: {} };
}

// À ATTENDRE avant d'ouvrir la fenêtre : sans la configuration, Orbit ne
// saurait pas qu'il doit démarrer verrouillé.
export async function init(userDataPath) {
  configFile = path.join(userDataPath, 'security.json');
  data = await load();
  if (!data || typeof data !== 'object') data = { appLock: null, profileLocks: {} };
  if (!data.profileLocks) data.profileLocks = {};
  // Au lancement : « déverrouillé » d'emblée seulement s'il n'y a pas de verrou.
  unlocked.app = !data.appLock;
}

export function getState() {
  return {
    appLockEnabled: Boolean(data.appLock),
    appUnlocked: unlocked.app,
    lockedProfileIds: Object.keys(data.profileLocks),
    unlockedProfileIds: [...unlocked.profiles],
  };
}

// --- Verrou global ---------------------------------------------------------
export function setAppLock(pin) {
  if (!pin || String(pin).length < 4) {
    return { success: false, error: 'Code trop court (4 caractères minimum)' };
  }
  data.appLock = makeEntry(pin);
  unlocked.app = true; // définir un code déverrouille la session courante
  persist();
  return { success: true };
}

export function removeAppLock(currentPin) {
  if (!verifyEntry(data.appLock, currentPin)) return { success: false, error: 'Code incorrect' };
  data.appLock = null;
  unlocked.app = true;
  persist();
  return { success: true };
}

export function unlockApp(pin) {
  if (!data.appLock) {
    unlocked.app = true;
    return { success: true };
  }
  if (verifyEntry(data.appLock, pin)) {
    unlocked.app = true;
    return { success: true };
  }
  return { success: false, error: 'Code incorrect' };
}

export function lockApp() {
  if (data.appLock) unlocked.app = false;
  return { success: true };
}

// Vérifie le code d'Orbit sans changer l'état (actions sensibles : supprimer
// un coffre dont on a oublié le mot de passe). Sans code défini : null.
export function checkAppPin(pin) {
  if (!data.appLock) return null;
  return verifyEntry(data.appLock, pin);
}

// --- Verrou par profil -----------------------------------------------------
export function setProfileLock(profileId, pin) {
  if (!profileId) return { success: false, error: 'Profil introuvable' };
  if (!pin || String(pin).length < 4) {
    return { success: false, error: 'Code trop court (4 caractères minimum)' };
  }
  data.profileLocks[profileId] = makeEntry(pin);
  unlocked.profiles.add(profileId);
  persist();
  return { success: true };
}

export function removeProfileLock(profileId, currentPin) {
  if (!verifyEntry(data.profileLocks[profileId], currentPin)) {
    return { success: false, error: 'Code incorrect' };
  }
  delete data.profileLocks[profileId];
  unlocked.profiles.add(profileId);
  persist();
  return { success: true };
}

export function unlockProfile(profileId, pin) {
  if (!data.profileLocks[profileId]) {
    unlocked.profiles.add(profileId);
    return { success: true };
  }
  if (verifyEntry(data.profileLocks[profileId], pin)) {
    unlocked.profiles.add(profileId);
    return { success: true };
  }
  return { success: false, error: 'Code incorrect' };
}

export function lockProfile(profileId) {
  unlocked.profiles.delete(profileId);
  return { success: true };
}

// Mode panique : referme d'un coup tous les profils protégés par un code.
// Renvoie le nombre de profils effectivement refermés.
export function lockAllProfiles() {
  let count = 0;
  for (const id of Object.keys(data.profileLocks)) {
    if (unlocked.profiles.delete(id)) count += 1;
  }
  return count;
}

// Un verrou (Orbit ou profil) sera-t-il demandé au retour ?
export function hasPendingLock() {
  if (data.appLock && !unlocked.app) return true;
  return Object.keys(data.profileLocks).some((id) => !unlocked.profiles.has(id));
}

// Nettoyage si un profil est supprimé
export function dropProfile(profileId) {
  delete data.profileLocks[profileId];
  unlocked.profiles.delete(profileId);
  persist();
  return { success: true };
}
