// ---------------------------------------------------------------------------
// Inspecteur intégré : les outils de développement de Chromium DANS Orbit.
//
// Ce qu'on a mesuré (Electron 45) avant de choisir cette forme :
//   • Les outils hébergés dans une balise <webview> sont à moitié morts :
//     panneau Elements vide, Lighthouse grisé (« Can only audit pages on HTTP
//     or HTTPS ») — le frontal n'y reçoit pas tous les messages de l'hôte.
//   • Hébergés dans une vue NATIVE (WebContentsView), ils fonctionnent comme
//     dans Chrome : DOM, styles, console, réseau, sources, stockage…
// On pose donc une WebContentsView par-dessus la fenêtre principale, à
// l'emplacement exact que l'interface lui réserve sous la page (l'interface
// nous envoie ce rectangle, et le renvoie à chaque redimensionnement).
//
// Conséquence d'une vue native : elle passe AU-DESSUS du DOM d'Orbit. Quand
// une boîte de dialogue s'ouvre, l'interface masque le panneau (voir
// DevToolsPanel.jsx), sinon la vue recouvrirait le bas de la boîte.
//
// Lighthouse, lui, ne peut PAS auditer une page de <webview> : l'audit
// expire au bout de 30 s (le pilote interne de Lighthouse ne retrouve pas
// la cible). Sur une fenêtre ordinaire, il aboutit. `openLighthouse` ouvre
// donc la page dans une fenêtre dédiée, SUR LA MÊME SESSION (on reste
// connecté), avec les outils ouverts directement sur Lighthouse.
// ---------------------------------------------------------------------------
import { BrowserWindow, WebContentsView, webContents } from 'electron';

const panels = new Map(); // id du webContents inspecté → { view, window }

// Seules les pages embarquées dans la fenêtre principale sont inspectables
// d'ici : jamais l'interface d'Orbit elle-même, jamais une autre fenêtre.
function guestOf(id, mainWindow) {
  const wc = webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed() || wc.getType() !== 'webview') return null;
  const host = wc.hostWebContents;
  if (!mainWindow || mainWindow.isDestroyed() || !host || host.id !== mainWindow.webContents.id) return null;
  return wc;
}

function cleanBounds(bounds) {
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  return { x: n(bounds?.x), y: n(bounds?.y), width: n(bounds?.width), height: n(bounds?.height) };
}

function destroy(guestId) {
  const entry = panels.get(guestId);
  if (!entry) return;
  panels.delete(guestId);
  try {
    if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(entry.view);
  } catch {
    /* fenêtre en cours de fermeture */
  }
  try {
    const guest = webContents.fromId(guestId);
    if (guest && !guest.isDestroyed() && guest.isDevToolsOpened()) guest.closeDevTools();
  } catch {
    /* page déjà fermée */
  }
  try {
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  } catch {
    /* déjà fermée */
  }
}

// Affiche (ou crée) le panneau d'une page, au rectangle donné (coordonnées de
// la zone de contenu de la fenêtre). `inspectAt` : point { x, y } de la page à
// sélectionner dans l'arbre — le « Inspecter » du clic droit.
export function show({ mainWindow, guestId, bounds, inspectAt }) {
  const guest = guestOf(guestId, mainWindow);
  if (!guest) return { success: false, error: 'invalid-page' };
  let entry = panels.get(guest.id);
  if (!entry) {
    const view = new WebContentsView();
    view.setBackgroundColor('#202124');
    entry = { view, window: mainWindow };
    panels.set(guest.id, entry);
    // L'ordre compte : la vue hôte doit être désignée AVANT l'ouverture,
    // sinon Electron ouvre sa propre fenêtre détachée.
    guest.setDevToolsWebContents(view.webContents);
    guest.openDevTools({ mode: 'detach', activate: false });
    guest.once('destroyed', () => destroy(guest.id));
    mainWindow.contentView.addChildView(view);
  }
  const rect = cleanBounds(bounds);
  entry.view.setBounds(rect);
  entry.view.setVisible(rect.width > 0 && rect.height > 0);
  if (inspectAt && Number.isFinite(inspectAt.x) && Number.isFinite(inspectAt.y)) {
    try {
      guest.inspectElement(Math.round(inspectAt.x), Math.round(inspectAt.y));
    } catch {
      /* point hors page */
    }
  }
  return { success: true };
}

// Masque sans fermer : l'état des outils (onglet, sélection, console) est
// conservé pour quand on revient sur la page.
export function hide({ guestId }) {
  const entry = panels.get(Number(guestId));
  if (entry) {
    try {
      entry.view.setVisible(false);
    } catch {
      /* vue détruite */
    }
  }
  return { success: true };
}

export function close({ guestId }) {
  destroy(Number(guestId));
  return { success: true };
}

export function isOpen(guestId) {
  return panels.has(Number(guestId));
}

// Fenêtre d'audit Lighthouse : la page, rechargée dans une fenêtre ordinaire
// sur la même session, et les outils ouverts sur l'onglet Lighthouse.
const SHOW_LIGHTHOUSE = `(async () => {
  try {
    const UI = await import('./ui/legacy/legacy.js');
    await UI.ViewManager.ViewManager.instance().showView('lighthouse');
    return true;
  } catch (e) {
    return false;
  }
})()`;

export function openLighthouse({ mainWindow, guestId, icon }) {
  const guest = guestOf(guestId, mainWindow);
  if (!guest) return { success: false, error: 'invalid-page' };
  const url = guest.getURL();
  if (!/^https?:\/\//i.test(url)) return { success: false, error: 'not-http' };
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: `Lighthouse — ${url}`,
    autoHideMenuBar: true,
    backgroundColor: '#202124',
    ...(icon ? { icon } : {}),
    webPreferences: {
      // Même session : un audit de la page CONNECTÉE, pas de l'écran de login.
      session: guest.session,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Un audit dans une fenêtre passée derrière une autre doit garder ses
      // vraies mesures de rendu.
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(guest.getUserAgent());
  win.webContents.on('devtools-opened', () => {
    const tools = win.webContents.devToolsWebContents;
    if (!tools) return;
    const select = () => tools.executeJavaScript(SHOW_LIGHTHOUSE, true).catch(() => false);
    if (tools.isLoading()) tools.once('did-finish-load', () => setTimeout(select, 300));
    else select();
  });
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.openDevTools({ mode: 'right' });
  });
  win.loadURL(url).catch(() => {});
  return { success: true };
}

// ---------------------------------------------------------------------------
// Vue responsive : tactile, agent utilisateur mobile, réseau lent.
//
// La TAILLE de l'appareil est donnée par l'interface (le <webview> est
// réellement redimensionné, voir src/lib/responsive.js). Ici, seulement ce
// que le protocole DevTools fait bien sur une page embarquée : émuler le
// tactile, et changer l'agent utilisateur. Le débogueur cohabite avec
// l'inspecteur ouvert (mesuré).
// ---------------------------------------------------------------------------
const emulated = new Map(); // id du webContents → { attachedByUs, ua }

// Conditions réseau envoyées par l'interface (src/lib/responsive.js), revues
// ici : jamais un nombre arbitraire vers le protocole.
function networkConditions(network) {
  if (!network || typeof network !== 'object') return null;
  const n = (v, max) => Math.min(max, Math.max(0, Number(v) || 0));
  return {
    offline: network.offline === true,
    latency: n(network.latency, 60000),
    downloadThroughput: n(network.download, 1e9) || -1,
    uploadThroughput: n(network.upload, 1e9) || -1,
  };
}

const NO_THROTTLE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

export async function emulate({ mainWindow, guestId, touch = false, userAgent = null, network = null }) {
  const guest = guestOf(guestId, mainWindow);
  if (!guest) return { success: false, error: 'invalid-page' };
  const dbg = guest.debugger;
  let entry = emulated.get(guest.id);
  try {
    if (!entry) {
      const attachedByUs = !dbg.isAttached();
      if (attachedByUs) dbg.attach('1.3');
      entry = { attachedByUs, ua: null };
      emulated.set(guest.id, entry);
      guest.once('destroyed', () => emulated.delete(guest.id));
    }
    // Le site se croit sur un écran tactile (pointer: coarse, ontouchstart,
    // maxTouchPoints) et bascule son interface en conséquence.
    // PAS de `setEmitTouchEventsForMouse` (souris convertie en doigt) : sur
    // une page de <webview>, la conversion déborde sur l'interface d'Orbit
    // autour de la page — les poignées ne recevaient plus de mousedown
    // (mesuré).
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: Boolean(touch), maxTouchPoints: touch ? 5 : 0 });
    // Réseau : lent, ou hors ligne. Le domaine Network doit être actif pour
    // que les conditions s'appliquent.
    const conditions = networkConditions(network);
    if (conditions || entry.network) {
      if (!entry.networkEnabled) {
        await dbg.sendCommand('Network.enable');
        entry.networkEnabled = true;
      }
      await dbg.sendCommand('Network.emulateNetworkConditions', conditions || NO_THROTTLE);
      entry.network = Boolean(conditions);
    }
    const ua = userAgent ? String(userAgent) : guest.getUserAgent();
    const changed = (entry.ua || null) !== (userAgent || null);
    await dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: ua });
    entry.ua = userAgent || null;
    // Le serveur choisit souvent sa version (mobile ou bureau) sur l'agent
    // utilisateur de la REQUÊTE : sans rechargement, rien ne changerait.
    if (changed) guest.reload();
    return { success: true, reloaded: changed };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

export async function stopEmulation({ guestId }) {
  const id = Number(guestId);
  const entry = emulated.get(id);
  if (!entry) return { success: true };
  emulated.delete(id);
  const guest = webContents.fromId(id);
  if (!guest || guest.isDestroyed()) return { success: true };
  const dbg = guest.debugger;
  try {
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false });
    await dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: guest.getUserAgent() });
    if (entry.networkEnabled) {
      await dbg.sendCommand('Network.emulateNetworkConditions', NO_THROTTLE);
      await dbg.sendCommand('Network.disable');
    }
  } catch {
    /* débogueur déjà parti */
  }
  if (entry.attachedByUs) {
    try {
      dbg.detach();
    } catch {
      /* déjà détaché */
    }
  }
  // Revenir à la version « bureau » du site.
  if (entry.ua) guest.reload();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Nettoyage du site inspecté.
//   'cache' : vide le cache HTTP de la session, puis recharge sans cache ;
//   'data'  : efface cookies et stockages (localStorage, IndexedDB, service
//             workers, cache) de l'ORIGINE de la page — on est déconnecté du
//             site, et seulement de lui.
// ---------------------------------------------------------------------------
export async function clearSite({ mainWindow, guestId, what }) {
  const guest = guestOf(guestId, mainWindow);
  if (!guest) return { success: false, error: 'invalid-page' };
  const ses = guest.session;
  try {
    if (what === 'cache') {
      await ses.clearCache();
      guest.reloadIgnoringCache();
      return { success: true };
    }
    if (what !== 'data') return { success: false, error: 'invalid-kind' };
    let origin;
    try {
      origin = new URL(guest.getURL()).origin;
    } catch {
      origin = null;
    }
    if (!origin || origin === 'null') return { success: false, error: 'no-origin' };
    const host = new URL(origin).hostname;
    // Les cookies se suppriment un par un, par leur adresse exacte.
    const cookies = await ses.cookies.get({ domain: host });
    await Promise.all(
      cookies.map((c) =>
        ses.cookies
          .remove(`${c.secure ? 'https' : 'http'}://${String(c.domain || '').replace(/^\./, '')}${c.path || '/'}`, c.name)
          .catch(() => {})
      )
    );
    await ses.clearStorageData({ origin });
    guest.reloadIgnoringCache();
    return { success: true, cookies: cookies.length };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}
