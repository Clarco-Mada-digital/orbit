// ---------------------------------------------------------------------------
// Configuration des Boucliers (Shields) par site / origine.
//
// Gère l'état détaillé des sécurités de type Brave Shields pour chaque site :
//   • enabled: Boucliers activés (oui/non)
//   • adblock: Blocage pub/traceurs pour CE site ('off' | 'standard')
//     Pas de mode « agressif » : le moteur embarque une seule liste de filtres.
//     Une option « plus strict » qui ne retirerait rien de plus serait un
//     mensonge dans l'interface — le durcissement réel passe par les réglages
//     ci-dessous (scripts, cookies, empreinte).
//   • httpsUpgrade: Mise à niveau auto vers HTTPS
//   • blockScripts: Blocage du JavaScript (<script>)
//   • fingerprinting: Réduction d'empreinte ('off' | 'standard' | 'strict')
//   • cookies: Blocage des cookies ('allow' | 'cross-site' | 'all')
//   • forgetOnClose: Oublier ce site (cookies/données) à la fermeture d'Orbit
//
// Ce module ne fait QUE la persistance et l'arbitrage : les décisions réseau
// (redirection HTTPS, blocage de scripts, en-têtes…) sont prises par main.js,
// seul habilité à brancher les écouteurs `session.webRequest`.
//
// Deux notions d'« origine » coexistent, à ne pas confondre :
//   • l'origine du SITE (https://exemple.com) : clé des réglages — c'est ce que
//     l'utilisateur voit dans le panneau et ce qu'il règle ;
//   • l'origine de la REQUÊTE (https://cdn.exemple.com) : ce qu'on protège.
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';

let file = null;

const DEFAULT_SETTINGS = {
  enabled: true,
  adblock: 'standard',
  httpsUpgrade: true,
  blockScripts: false,
  fingerprinting: 'standard',
  cookies: 'cross-site',
  forgetOnClose: false,
};

// Listes de valeurs autorisées. Le renderer passe des objets arbitraires dans
// `updateSiteSettings` : sans filtre, une clé inconnue traînerait dans le JSON
// et une valeur non booléenne casserait les comparaisons du panel.
const ENUMS = {
  adblock: ['off', 'standard'],
  fingerprinting: ['off', 'standard', 'strict'],
  cookies: ['allow', 'cross-site', 'all'],
};
const BOOLEANS = ['enabled', 'httpsUpgrade', 'blockScripts', 'forgetOnClose'];

let state = {
  // Réglages par défaut pour un site sans configuration explicite
  defaults: { ...DEFAULT_SETTINGS },
  // Réglages par origine (ex: "https://example.com" -> { ... })
  sites: {},
};

// ---------------------------------------------------------------------------
// Origine courante de chaque <webview> (id de webContents -> origine du site)
// ---------------------------------------------------------------------------
// Les réglages sont par SITE, mais les événements réseau arrivent par requête,
// sans savoir de quelle app/page ils viennent. Chaque webview publie donc son
// origine courante ici ; les listeners la relisent à chaque requête.
// Le klasik `did-navigate` ne suffit pas : une requête partie avant la
// navigation (ou dans une sous-frame) doit garder l'origine de la page hôte.
const contentsOrigin = new Map(); // webContentsId -> 'https://exemple.com'

function contentKey(webContentsId) {
  return Number(webContentsId);
}

// Mémorise l'origine affichée par un webview. Renvoie l'origine retenue.
export function setContentsOrigin(webContentsId, url) {
  const id = contentKey(webContentsId);
  if (!Number.isInteger(id)) return null;
  const origin = originOf(url);
  if (origin) contentsOrigin.set(id, origin);
  return origin || contentsOrigin.get(id) || null;
}

// Oublie le webview (destroyé) : la Map ne doit pas grossir à chaque rechargement.
export function clearContentsOrigin(webContentsId) {
  contentsOrigin.delete(contentKey(webContentsId));
}

// Réglages effectifs du site affiché par un webview (jamais null).
export function getSettingsForContents(webContentsId) {
  return getSiteSettings(contentsOrigin.get(contentKey(webContentsId)) || null);
}

function save() {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[orbit] sauvegarde des boucliers impossible :', err.message);
  }
}

export function init(userDataDir) {
  file = path.join(userDataDir, 'shields.json');
  // Repartir de zéro AVANT de lire : un rechargement doit refléter le disque,
  // jamais laisser les réglages d'un état précédent en mémoire si le fichier
  // est devenu illisible entre-temps.
  state = { defaults: { ...DEFAULT_SETTINGS }, sites: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') {
      const defaults = sanitize(raw.defaults);
      if (defaults) state.defaults = { ...DEFAULT_SETTINGS, ...defaults };
      for (const [origin, value] of Object.entries(raw.sites || {})) {
        const clean = sanitize(value);
        if (originOf(origin) && clean && Object.keys(clean).length) {
          state.sites[origin] = clean;
        }
      }
    }
    save();
  } catch {
    // Fichier inexistant ou corrompu : on garde les valeurs par défaut
    save();
  }
}

// Extrait l'origine standard d'une URL (protocole + hôte + port)
export function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    return null;
  } catch {
    return null;
  }
}

// Ne conserve que les réglages connus, avec des valeurs du bon type.
function sanitize(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return null;
  const clean = {};
  for (const key of BOOLEANS) {
    if (typeof updates[key] === 'boolean') clean[key] = updates[key];
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (allowed.includes(updates[key])) clean[key] = updates[key];
  }
  return clean;
}

// Renvoie les réglages d'un site fusionnés avec les valeurs par défaut
export function getSiteSettings(origin) {
  if (!origin) return { ...state.defaults };
  const custom = state.sites[origin] || {};
  return { ...state.defaults, ...custom };
}

// Met à jour les réglages pour un site donné. Renvoie les réglages effectifs
// après écriture (le renderer s'en sert pour resynchroniser son état local).
export function updateSiteSettings(origin, updates) {
  if (!origin) return getSiteSettings(null);
  const clean = sanitize(updates);
  if (!clean) return getSiteSettings(origin);
  state.sites[origin] = { ...(state.sites[origin] || {}), ...clean };
  save();
  return getSiteSettings(origin);
}

// Réinitialise les réglages d'un site aux valeurs par défaut
export function resetSiteSettings(origin) {
  if (!origin || !state.sites[origin]) return getSiteSettings(origin);
  delete state.sites[origin];
  save();
  return getSiteSettings(origin);
}

// Renvoie les réglages globaux par défaut
export function getDefaults() {
  return { ...state.defaults };
}

// Met à jour les réglages globaux par défaut
export function updateDefaults(updates) {
  state.defaults = { ...state.defaults, ...(sanitize(updates) || {}) };
  save();
  return { ...state.defaults };
}

// Liste des sites ayant au moins un réglage propre, avec leurs réglages
// EFFECTIFS (défaut + surcharges). Sert à l'écran « Confidentialité » : sans
// elle, un réglage posé sur un site serait invisible et impossible à annuler.
export function listSites() {
  const origins = Object.keys(state.sites).sort();
  return origins.map((origin) => ({
    origin,
    settings: getSiteSettings(origin),
    // Clés réellement surchargées : l'UI peut distinguer « modifié » de
    // « hérité », sinon tout apparaît personnalisé en permanence.
    overrides: { ...state.sites[origin] },
  }));
}

// Origines marquées « oublier à la fermeture » : vidées par main.js au quit.
export function sitesToForget() {
  const out = [];
  for (const [origin, value] of Object.entries(state.sites)) {
    if (value.forgetOnClose === true) out.push(origin);
  }
  return out;
}