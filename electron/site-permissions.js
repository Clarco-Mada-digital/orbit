// ---------------------------------------------------------------------------
// Autorisations par site (caméra, micro, position, notifications…)
//
// Un navigateur ne décide pas seul : il demande, puis il se souvient. Orbit
// faisait l'inverse — une liste blanche accordait tout en silence, et rien
// n'était mémorisé ni révisable. Ce module tient le « registre des décisions » :
//
//   mode      'ask'   → demander à l'utilisateur (défaut, comportement navigateur)
//             'allow' → tout accorder sans demander (ancien comportement)
//             'deny'  → tout refuser sans demander
//   décisions  origine → { permission: 'allow' | 'deny' }
//
// Le fichier est volontairement lisible (JSON en clair) : il ne contient que
// des noms de domaines et des choix, jamais de secret.
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';

const MODES = new Set(['ask', 'allow', 'deny']);

let file = null;
let state = { mode: 'ask', sites: {} };
// Réponses données SANS « Retenir ce choix » : elles valent jusqu'à la
// fermeture d'Orbit, comme « Autoriser cette fois » dans Chrome. Sans elles,
// un site autorisé à l'instant se voyait répondre « refusé » à la vérification
// suivante (Notification.permission…) et se croyait bloqué.
const sessionSites = new Map(); // origine → { permission: 'allow' | 'deny' }

function save() {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[orbit] écriture des autorisations impossible :', err.message);
  }
}

export function init(userDataDir) {
  file = path.join(userDataDir, 'permissions.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = {
      mode: MODES.has(raw?.mode) ? raw.mode : 'ask',
      sites: raw && typeof raw.sites === 'object' && raw.sites ? raw.sites : {},
    };
  } catch {
    // Premier lancement (ou fichier abîmé) : on repart des valeurs par défaut.
    state = { mode: 'ask', sites: {} };
  }
}

// Clé de mémorisation : l'ORIGINE (schéma + hôte), comme dans un navigateur.
// `https://meet.google.com` et `https://mail.google.com` sont deux sites
// distincts ; une autorisation donnée à l'un ne vaut pas pour l'autre.
export function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    return null;
  } catch {
    return null;
  }
}

export function getMode() {
  return state.mode;
}

export function setMode(mode) {
  if (!MODES.has(mode)) return { success: false, error: 'mode-inconnu' };
  state.mode = mode;
  save();
  return { success: true, mode };
}

// 'allow' | 'deny' | null (aucune décision mémorisée)
export function decisionFor(origin, permission) {
  if (!origin) return null;
  const entry = state.sites[origin];
  const value = entry && entry[permission];
  if (value === 'allow' || value === 'deny') return value;
  const temp = sessionSites.get(origin);
  const tempValue = temp && temp[permission];
  return tempValue === 'allow' || tempValue === 'deny' ? tempValue : null;
}

// Décision valable jusqu'à la fermeture d'Orbit (jamais écrite sur disque).
export function rememberForSession(origin, permission, allowed) {
  if (!origin || !permission) return;
  const entry = sessionSites.get(origin) || {};
  entry[permission] = allowed ? 'allow' : 'deny';
  sessionSites.set(origin, entry);
}

// Pour le bouton « Autorisations » de la barre : décisions d'UN site, avec
// leur portée (enregistrée ou seulement pour cette session).
export function forSite(origin) {
  const out = {};
  if (!origin) return out;
  for (const [permission, value] of Object.entries(sessionSites.get(origin) || {})) {
    out[permission] = { value, scope: 'session' };
  }
  for (const [permission, value] of Object.entries(state.sites[origin] || {})) {
    out[permission] = { value, scope: 'saved' };
  }
  return out;
}

// Réglage explicite depuis la barre : 'allow' | 'deny' enregistrés, ou
// null pour revenir à « Demander ».
export function set(origin, permission, value) {
  if (!origin || !permission) return { success: false, error: 'parametres' };
  const temp = sessionSites.get(origin);
  if (temp) delete temp[permission];
  if (value === 'allow' || value === 'deny') {
    remember(origin, permission, value === 'allow');
    return { success: true };
  }
  return forget(origin, permission);
}

export function remember(origin, permission, allowed) {
  if (!origin || !permission) return;
  const entry = state.sites[origin] || (state.sites[origin] = {});
  entry[permission] = allowed ? 'allow' : 'deny';
  save();
}

// Oublie une permission précise, ou tout le site quand `permission` est absent.
export function forget(origin, permission) {
  const temp = origin && sessionSites.get(origin);
  if (temp) {
    if (permission) delete temp[permission];
    else sessionSites.delete(origin);
  }
  if (!origin || !state.sites[origin]) return { success: true };
  if (permission) {
    delete state.sites[origin][permission];
    if (Object.keys(state.sites[origin]).length === 0) delete state.sites[origin];
  } else {
    delete state.sites[origin];
  }
  save();
  return { success: true };
}

export function forgetAll() {
  sessionSites.clear();
  state.sites = {};
  save();
  return { success: true };
}

// Pour l'écran Paramètres → Autorisations des sites.
export function list() {
  return Object.entries(state.sites)
    .map(([origin, permissions]) => ({ origin, permissions: { ...permissions } }))
    .filter((s) => Object.keys(s.permissions).length > 0)
    .sort((a, b) => a.origin.localeCompare(b.origin));
}
