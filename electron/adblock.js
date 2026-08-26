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
    if (ctx) return ctx.onBeforeRequest(details, callback);
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
