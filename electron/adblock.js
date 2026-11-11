// ---------------------------------------------------------------------------
// Bloqueur de publicités / traceurs NATIF (indépendant des extensions)
//
// Les adblockers modernes (Manifest V3, declarativeNetRequest) ne fonctionnent
// pas dans Electron. On intègre donc le blocage nous-mêmes, au niveau réseau
// (session.webRequest), via @ghostery/adblocker-electron (moteur + listes type
// EasyList). Agit sur TOUS les profils et toutes les apps, sans extension.
//
// IMPORTANT — composition avec notre contournement CSP :
// Electron n'autorise QU'UN écouteur par événement webRequest. L'adblocker
// enregistrerait le sien pour onHeadersReceived et ÉCRASERAIT notre suppression
// de `frame-ancestors` (indispensable à l'embarquement). On n'utilise donc PAS
// `enableBlockingInSession`. À la place, c'est main.js qui possède l'unique
// écouteur et appelle ici `beforeRequest` / `headersReceived` : les handlers
// publics de `BlockingContext` ne s'auto-enregistrent pas, on les invoque à la
// demande, puis main.js applique la logique CSP par-dessus.
//
// TROIS étages, et il faut les trois pour qu'un bloqueur « marche » :
//   1. RÉSEAU — les requêtes des régies sont annulées avant de partir
//      (`beforeRequest`), et un `$csp` peut être ajouté aux en-têtes ;
//   2. COSMÉTIQUE ET SCRIPTLETS — un preload de frame (fourni par Ghostery,
//      posé ici par session) demande au processus principal les filtres du
//      site AVANT l'exécution des scripts de la page : il masque les
//      emplacements construits en JavaScript et injecte les scriptlets
//      (neutralisation de `window.open`, anti-détection…). Sans lui, un site
//      qui fabrique sa pub après le chargement gardait ses cadres ;
//   3. FENÊTRES — une pop-up publicitaire n'est pas une requête : elle naît
//      d'un `window.open`. main.js demande ici si l'URL visée est filtrée
//      (`matchesFilter`) et refuse alors la fenêtre.
//
// Le moteur est mis en CACHE sur disque : téléchargé une fois, puis rechargé
// instantanément et hors-ligne aux lancements suivants.
// ---------------------------------------------------------------------------
import { BlockingContext, ElectronBlocker, Request } from '@ghostery/adblocker-electron';
import { createRequire } from 'module';
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { DEFAULT_ADBLOCK_LEVEL, engineFileFor, normalizeLevel } from './adblock-levels.js';

const require = createRequire(import.meta.url);

let blocker = null;
let enabled = false;
let level = DEFAULT_ADBLOCK_LEVEL;
// Dossier de cache des moteurs + fichier où l'on retient le niveau choisi.
let cacheDir = null;
let configPath = null;
let loadingPromise = null;

// Décision « le blocage est-il actif pour ce webContents ? », fournie par
// main.js : elle tient compte des boucliers du site et du réglage par app.
// Un défaut prudent avant le premier attachement : suivre le réglage global.
let activeFor = () => enabled;

// Compteur de requêtes bloquées par webContents (par ID) : vidé à chaque
// chargement de page, et utilisé pour afficher le panneau « Boucliers » de l'app.
// On ne garde que les infos nécessaires à l'UI, pas les URLs complètes
// (confidentialité) : le domaine, le type de ressource et la raison du blocage.
const blockedRequests = new Map(); // webContentsId -> Map<clé, { type, domain, reason }>

// Clé de dédoublonnage : un site-charge qui demande 40 fois la même pub ne
// compte qu'une fois, sinon le compteur du panneau devient illisible (et les
// statistiques « par domaine » aussi).
function blockKey(domain, type, reason) {
  return `${reason}|${type}|${domain}`;
}

// Enregistre un blocage et renvoie true s'il est nouveau pour cette page.
// `reason` ∈ 'ads' | 'trackers' | 'script' | 'https' | 'popup' : le panneau
// affiche un décompte par catégorie, pas un total indifférencié.
export function recordBlock(webContentsId, domain, type = 'other', reason = 'ads') {
  if (webContentsId == null) return false;
  const id = contentId(webContentsId);
  const blocks = blockedRequests.get(id) || new Map();
  const key = blockKey(domain, type, reason);
  if (blocks.has(key)) return false;
  blocks.set(key, { type, domain, reason });
  blockedRequests.set(id, blocks);
  return true;
}

// Un BlockingContext par session (fournit les handlers onBeforeRequest /
// onHeadersReceived publics, SANS enregistrer d'écouteur webRequest).
// Remplaçable : changer de niveau remplace le moteur, donc les contextes.
let contexts = new WeakMap();

// Sessions où le preload cosmétique a déjà été posé (une seule fois chacune).
const preloadedSessions = new WeakSet();
let ipcReady = false;

export function initAdblock(userDataPath, initialEnabled) {
  cacheDir = userDataPath;
  configPath = path.join(userDataPath, 'adblocker.json');
  level = readLevel();
  enabled = Boolean(initialEnabled);
  // Si activé au démarrage, on lance le chargement du moteur en tâche de fond.
  if (enabled) getBlocker().catch(() => {});
}

// Niveau retenu sur le disque. Un fichier absent ou corrompu n'est pas une
// erreur à signaler : c'est un premier lancement.
function readLevel() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return normalizeLevel(raw?.level);
  } catch {
    return DEFAULT_ADBLOCK_LEVEL;
  }
}

function saveLevel() {
  if (!configPath) return;
  try {
    fs.writeFileSync(configPath, JSON.stringify({ level }, null, 2));
  } catch (err) {
    console.error('[orbit] sauvegarde du niveau du bloqueur impossible :', err.message);
  }
}

function loadEngine(forLevel) {
  const caching = {
    path: path.join(cacheDir, engineFileFor(forLevel)),
    read: fs.promises.readFile,
    write: fs.promises.writeFile,
  };
  // `complet` ajoute les listes de nuisances (bandeaux de cookies, widgets
  // sociaux) à celles de publicité et de pistage.
  return forLevel === 'complet'
    ? ElectronBlocker.fromPrebuiltFull(fetch, caching)
    : ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, caching);
}

// Numéro de génération du moteur. Changer de niveau pendant qu'un moteur se
// charge laissait sinon ce moteur-là s'installer après coup : le réglage
// affiché disait « complet » et le blocage utilisait encore les listes
// standard.
let engineGeneration = 0;

async function getBlocker() {
  if (blocker) return blocker;
  if (loadingPromise) return loadingPromise;
  const generation = engineGeneration;
  loadingPromise = loadEngine(level)
    .then((b) => {
      if (generation === engineGeneration) blocker = b;
      return b;
    })
    .catch((err) => {
      loadingPromise = null;
      throw err;
    });
  return loadingPromise;
}

function contextFor(ses) {
  if (!blocker) return null;
  let ctx = contexts.get(ses);
  if (!ctx) {
    ctx = new BlockingContext(ses, blocker);
    contexts.set(ses, ctx);
  }
  return ctx;
}

// Chemin du preload fourni par Ghostery. Il n'est pas exposé par le champ
// `exports` du paquet : on le résout depuis l'emplacement du paquet lui-même
// (le paquet `-preload` est sa dépendance, où qu'il soit rangé).
function preloadPath() {
  try {
    const pkg = require.resolve('@ghostery/adblocker-electron/package.json');
    return require.resolve('@ghostery/adblocker-electron-preload', {
      paths: [path.dirname(pkg)],
    });
  } catch (err) {
    console.error('[orbit] preload du bloqueur introuvable :', err.message);
    return null;
  }
}

// Handlers IPC appelés par le preload de frame. Enregistrés une seule fois :
// `ipcMain.handle` refuse un doublon.
function registerIpc() {
  if (ipcReady) return;
  ipcReady = true;
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, msg) => {
    if (!blocker || !activeFor(event.sender.id)) return;
    // `file://` (interface Orbit), `devtools://`, `about:` : aucun filtre.
    if (!/^https?:/i.test(String(url || ''))) return;
    try {
      return await blocker.onInjectCosmeticFilters(event, url, msg);
    } catch (err) {
      // Un scriptlet qui jette ne doit jamais casser la page : Ghostery
      // journalise déjà, on garde la trace côté Orbit.
      console.error('[orbit] injection cosmétique échouée :', err.message);
    }
  });
  // Observateur de mutations : c'est lui qui reclasse la page quand JavaScript
  // ajoute un emplacement publicitaire après coup. Refusé pour l'interface
  // Orbit (`file://`) et pour les pages dont les boucliers sont coupés —
  // surveiller le DOM n'y servirait à rien et coûterait un listener permanent.
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => {
    if (!blocker || !activeFor(event.sender.id)) return false;
    if (!blocker.config?.enableMutationObserver) return false;
    try {
      return /^https?:/i.test(event.sender.getURL());
    } catch {
      return false;
    }
  });
}

// Branche une session : preload de frame (scriptlets + masquage dynamique) et
// handlers IPC. Idempotent — main.js appelle ceci pour chaque partition.
// `isActive` : décision par webContents (boucliers du site, réglage par app).
export function attachSession(ses, isActive) {
  if (!ses) return;
  if (typeof isActive === 'function') activeFor = isActive;
  registerIpc();
  if (preloadedSessions.has(ses)) return;
  const filePath = preloadPath();
  if (!filePath) return;
  try {
    if (typeof ses.registerPreloadScript === 'function') {
      ses.registerPreloadScript({ type: 'frame', filePath });
    } else {
      // Electron plus ancien : `setPreloads` s'applique aux webContents créés
      // ensuite. On ne duplique jamais une entrée déjà présente.
      const existing = ses.getPreloads?.() || [];
      if (!existing.includes(filePath)) ses.setPreloads([...existing, filePath]);
    }
    preloadedSessions.add(ses);
  } catch (err) {
    // Privée, déjà détruite, API absente : le blocage réseau reste en place,
    // seul le masquage cosmétique manquerait.
    console.error('[orbit] preload cosmétique non posé :', err.message);
  }
}

// Appelé par l'écouteur onBeforeRequest unique de main.js.
// `active` permet à main.js d'imposer sa décision requête par requête : une app
// peut bloquer alors que le réglage global est éteint, ou l'inverse (voir
// « Bloqueur de pub » dans les réglages d'une app).
export function beforeRequest(ses, details, callback, active = enabled) {
  if (active && blocker) {
    const ctx = contextFor(ses);
    if (ctx) {
      // Pour compter les requêtes bloquées : on laisse `ctx.onBeforeRequest`
      // décider, et on n'enregistre que si sa réponse annule la requête.
      return ctx.onBeforeRequest(details, (response) => {
        if (response && response.cancel) {
          try {
            const u = new URL(details.url);
            recordBlock(
              details.webContentsId,
              u.hostname.replace(/^www\./, ''),
              details.resourceType || 'other',
              guessReason(u.hostname)
            );
          } catch {
            /* URL illisible : on bloque sans compter */
          }
        }
        callback(response);
      });
    }
  }
  callback({}); // laisser passer
}

// Appelé par l'écouteur onHeadersReceived unique de main.js. On renvoie au
// callback la réponse (éventuellement modifiée) de l'adblocker ; main.js y
// applique ensuite sa suppression de frame-ancestors / X-Frame-Options.
export function headersReceived(ses, details, callback, active = enabled) {
  if (active && blocker) {
    const ctx = contextFor(ses);
    if (ctx) return ctx.onHeadersReceived(details, callback);
  }
  callback({}); // aucune modification côté adblock
}

// Une URL visée par un `window.open` est-elle filtrée par les listes ?
//
// C'est ce qui distingue une vraie fenêtre (OAuth, « ouvrir dans un nouvel
// onglet », un lien qu'on choisit) d'une pub qui s'ouvre toute seule : la
// première n'est pas dans les listes, la seconde oui. On ne peut pas savoir
// s'il y a eu un geste utilisateur côté Electron, mais on sait ce que le
// domaine trafique — et c'est un signal bien plus fiable.
export function matchesFilter(url, sourceUrl) {
  if (!blocker) return false;
  if (!/^https?:/i.test(String(url || ''))) return false;
  try {
    const request = Request.fromRawDetails({
      requestId: 'orbit-popup',
      tabId: 0,
      url,
      sourceUrl: /^https?:/i.test(String(sourceUrl || '')) ? sourceUrl : undefined,
      type: 'mainFrame',
    });
    return Boolean(blocker.match(request).match);
  } catch {
    return false;
  }
}

// Catégorise un blocage pour l'UI. L'adblocker ne dit pas POURQUOI il bloque,
// et les listes qu'on embarque sont mélangées : on approxime sur le nom
// d'hôte, en restant conservatrice (le doute va vers « publicité »).
const TRACKER_HINTS =
  /(?:^|\.)(?:google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.(?:net|com)|connect\.facebook\.net|hotjar\.com|hotjar\.io|mixpanel\.com|segment\.(?:io|com)|amplitude\.com|sentry\.io|bugsnag\.com|fullstory\.com|intercom\.io|crisp\.chat|taboola\.com|outbrain\.com|branch\.io|matomo\.cloud|criteo\.com|quantserve\.com|scorecardresearch\.com|newrelic\.com|datadoghq\.com|segment\.com)$/;

function guessReason(hostname) {
  return TRACKER_HINTS.test(String(hostname || '')) ? 'trackers' : 'ads';
}

// Charge le moteur si besoin — appelé quand une app force le blocage alors que
// le réglage global est éteint (sans ça, le moteur ne serait jamais téléchargé).
export async function ensureEngine() {
  try {
    await getBlocker();
    return true;
  } catch {
    return false;
  }
}

export async function setEnabled(on) {
  enabled = Boolean(on);
  // Précharge le moteur dès l'activation (les écouteurs de main.js consultent
  // `enabled` à chaque requête, rien d'autre à (dés)enregistrer).
  if (enabled) {
    try {
      await getBlocker();
      return { success: true, enabled, level };
    } catch (err) {
      return { success: false, error: String(err.message || err), enabled, level };
    }
  }
  return { success: true, enabled, level };
}

// Change le jeu de listes. Le moteur est remplacé (et rechargé tout de suite si
// le blocage est actif) : les pages déjà ouvertes gardent l'ancien jusqu'au
// prochain chargement, ce que l'interface dit explicitement.
export async function setLevel(next) {
  const wanted = normalizeLevel(next);
  if (wanted === level) return { success: true, level, enabled };
  level = wanted;
  saveLevel();
  engineGeneration += 1;
  blocker = null;
  loadingPromise = null;
  contextsClear();
  if (!enabled) return { success: true, level, enabled };
  try {
    await getBlocker();
    return { success: true, level, enabled };
  } catch (err) {
    return { success: false, error: String(err.message || err), level, enabled };
  }
}

// Les contextes gardent une référence au moteur précédent : on repart de zéro
// pour que le chargement suivant utilise bien les nouvelles listes.
function contextsClear() {
  contexts = new WeakMap();
}

export function getState() {
  return { enabled, level, loaded: Boolean(blocker) };
}

// Renvoie les statistiques de blocage d'un webContents, pour le panneau UI.
// `domains` : la liste des sites bloqués (dédupliquée, ordre d'arrivée) ;
// `byReason` : le décompte par catégorie, pour distinguer pubs et traceurs ;
// `total` : le nombre de requêtes réellement annulées.
const REASON_ORDER = ['ads', 'trackers', 'script', 'https', 'popup'];

export function getBlockedStats(webContentsId) {
  const blocks = blockedRequests.get(contentId(webContentsId));
  if (!blocks || blocks.size === 0) {
    return { total: 0, domains: [], byReason: emptyReasons() };
  }
  const byReason = emptyReasons();
  const domains = [];
  const seen = new Set();
  for (const { domain, reason } of blocks.values()) {
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      domains.push(domain);
    }
    if (reason in byReason) byReason[reason] += 1;
  }
  return {
    total: blocks.size,
    // `count` reste le nom historique lu par l'UI : on le conserve pour ne pas
    // casser un composant qui l'attendrait encore.
    count: blocks.size,
    domains,
    byReason,
  };
}

function emptyReasons() {
  const out = {};
  for (const r of REASON_ORDER) out[r] = 0;
  return out;
}

// Réinitialise les statistiques d'un webContents (à chaque chargement de page).
export function clearBlockedStats(webContentsId) {
  blockedRequests.delete(contentId(webContentsId));
}

// Les deux accès ci-dessus reçoivent un id venue de l'IPC : on normalise une
// fois pour ici plutôt que de comparer `1` et `'1'` partout.
function contentId(webContentsId) {
  const id = Number(webContentsId);
  return Number.isInteger(id) ? id : webContentsId;
}
