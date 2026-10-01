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
// Le moteur est mis en CACHE sur disque : téléchargé une fois, puis rechargé
// instantanément et hors-ligne aux lancements suivants.
// ---------------------------------------------------------------------------
import { ElectronBlocker, BlockingContext } from '@ghostery/adblocker-electron';
import { getDomain, getHostname } from 'tldts-experimental';
import fs from 'fs';
import path from 'path';

let blocker = null;
let enabled = false;
let cachePath = null;
let loadingPromise = null;

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
// `reason` ∈ 'ads' | 'trackers' | 'script' | 'https' : le panneau affiche un
// décompte par catégorie, pas un total indifférencié.
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
const contexts = new WeakMap();

export function initAdblock(userDataPath, initialEnabled) {
  cachePath = path.join(userDataPath, 'adblocker-engine.bin');
  enabled = Boolean(initialEnabled);
  // Si activé au démarrage, on lance le chargement du moteur en tâche de fond.
  if (enabled) getBlocker().catch(() => {});
}

async function getBlocker() {
  if (blocker) return blocker;
  if (loadingPromise) return loadingPromise;
  loadingPromise = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: cachePath,
    read: fs.promises.readFile,
    write: fs.promises.writeFile,
  })
    .then((b) => {
      blocker = b;
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
      return { success: true, enabled };
    } catch (err) {
      return { success: false, error: String(err.message || err), enabled };
    }
  }
  return { success: true, enabled };
}

// Filtrage COSMÉTIQUE : renvoie le CSS de masquage des emplacements
// publicitaires pour une URL (règles génériques + spécifiques à l'hôte).
// Injecté par main.js via webContents.insertCSS à chaque chargement de page.
// Compatible Electron 33 (n'utilise pas registerPreloadScript, réservé aux
// versions récentes).
export function getCosmeticStyles(url, active = enabled) {
  if (!active || !blocker) return '';
  try {
    const hostname = getHostname(url) || '';
    const domain = getDomain(url) || '';
    const { styles } = blocker.getCosmeticsFilters({
      url,
      hostname,
      domain,
      classes: [],
      ids: [],
      hrefs: [],
      getBaseRules: true,
      getInjectionRules: false,
      getExtendedRules: false,
      getRulesFromDOM: false,
      getRulesFromHostname: true,
    });
    return styles || '';
  } catch {
    return '';
  }
}

export function getState() {
  return { enabled };
}

// Renvoie les statistiques de blocage d'un webContents, pour le panneau UI.
// `domains` : la liste des sites bloqués (dédupliquée, ordre d'arrivée) ;
// `byReason` : le décompte par catégorie, pour distinguer pubs et traceurs ;
// `total` : le nombre de requêtes réellement annulées.
const REASON_ORDER = ['ads', 'trackers', 'script', 'https'];

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
