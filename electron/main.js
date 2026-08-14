import { app, BrowserWindow, session, ipcMain, shell, Notification, dialog, net, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { unpackCrx } from './crx.js';
import { init as initKeepass, setEnabled as keepassSetEnabled, getLogins as keepassGetLogins, associate as keepassAssociate, checkStatus as keepassCheckStatus } from './keepass.js';
import { matchShortcutInput } from '../src/lib/shortcuts.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

// ---------------------------------------------------------------------------
// Identité navigateur : Chrome pur pour les pages, client identifié pour Google
// ---------------------------------------------------------------------------
// WhatsApp et Google veulent des identités CONTRADICTOIRES — c'est la raison
// pour laquelle corriger l'un cassait l'autre. Constaté en comparant les
// configurations côte à côte, sur les vraies pages :
//
//  - WhatsApp refuse tout jeton produit dans l'UA (« WhatsApp fonctionne avec
//    Google Chrome 100 ou version ultérieure »). Electron en ajoute un
//    automatiquement d'après package.json : « … Orbit/1.0.0 Chrome/130.0.6723.191
//    Electron/33.4.11 Safari/537.36 ». Retirer « Electron » ne suffisait pas :
//    « Orbit/1.0.0 » bloquait tout autant. Il lui faut une UA Chrome PURE.
//
//  - Google fait exactement l'inverse : une UA Chrome pure est refusée
//    (« Ce navigateur ou cette application ne sont peut-être pas sécurisés »),
//    alors qu'une UA portant un jeton produit — un client identifié, ici
//    « Orbit/1.0.0 » — est acceptée.
//
// D'où la séparation PAR DOMAINE :
//   • partout (pages, requêtes, navigator.userAgent) : CHROME_UA, l'UA du
//     vrai Chrome, sans aucun jeton (version réduite Chrome/130.0.0.0 comme
//     le vrai Chrome depuis la v101) ;
//   • en-tête User-Agent des requêtes vers les domaines Google uniquement :
//     GOOGLE_UA. Seul l'EN-TÊTE compte pour Google : la page peut continuer à
//     voir l'UA Chrome pure (vérifié), donc rien à retoucher côté page.
//
// Et on ne touche à rien d'autre : réécrire les en-têtes Sec-CH-UA ou
// navigator.userAgentData pour y annoncer « Google Chrome » fait au contraire
// refuser la connexion Google (mesuré).
const CHROME_MAJOR = (process.versions.chrome || '130.0.0.0').split('.')[0];
const UA_PLATFORM =
  process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : 'X11; Linux x86_64';
const CHROME_UA = `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;

// UA envoyée AUX SEULS domaines Google : même base, plus le jeton produit qui
// identifie Orbit comme un client à part entière (et surtout PAS « Electron »,
// que Google traite comme un navigateur embarqué).
const GOOGLE_UA = `Mozilla/5.0 (${UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Orbit/${app.getVersion()} Chrome/${process.versions.chrome} Safari/537.36`;

// UA par défaut de TOUT le process (fenêtre, requêtes, webviews)
app.userAgentFallback = CHROME_UA;

app.on('web-contents-created', (event, contents) => {
  if (contents.getType() !== 'webview') return;
  try {
    // Fixée AVANT toute navigation : l'attribut `useragent` du <webview>
    // pourrait arriver après le début du chargement (ordre des attributs
    // posés par React) — ici, c'est garanti.
    contents.setUserAgent(CHROME_UA);
  } catch (err) {
    console.error('[orbit] guest UA failed:', err);
  }
});

// ---------------------------------------------------------------------------
// État de la fenêtre (taille, position, maximisé) — persisté au redimensionner
// ---------------------------------------------------------------------------
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
  } catch {
    return null;
  }
}

function saveWindowState(state) {
  try {
    fs.writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// La fenêtre restaurée doit rester visible sur au moins un écran
// (au cas où un moniteur a été débranché depuis la dernière session).
function isBoundsVisible(bounds) {
  try {
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return (
        bounds.x < a.x + a.width &&
        bounds.x + bounds.width > a.x &&
        bounds.y < a.y + a.height &&
        bounds.y + bounds.height > a.y
      );
    });
  } catch {
    return true;
  }
}

// Sauvegarde différée (debounce) : pas d'écriture disque à chaque pixel de
// redimensionnement.
let boundsSaveTimer = null;
function persistWindowState() {
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    saveWindowState({ ...bounds, maximized });
  }, 400);
}

// ---------------------------------------------------------------------------
// Contournement X-Frame-Options / CSP : supprime les headers qui empêchent
// d'embarquer les apps web (Gmail, Slack, Notion…) dans les <webview>.
// ---------------------------------------------------------------------------
function setupHeaderBypass(ses) {
  if (!ses || !ses.webRequest) return;
  try {
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };

      delete headers['x-frame-options'];
      delete headers['X-Frame-Options'];
      delete headers['content-security-policy'];
      delete headers['Content-Security-Policy'];
      delete headers['content-security-policy-report-only'];

      callback({ responseHeaders: headers });
    });
  } catch (err) {
    console.error('[orbit] header bypass failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Connexion Google : UA « client identifié » en en-tête, sur les seuls
// domaines Google (voir le bloc « Identité navigateur » en haut du fichier).
// Le reste du web — WhatsApp en tête — continue de voir CHROME_UA.
// ---------------------------------------------------------------------------
const googleUASessions = new WeakSet();

function setupGoogleUA(ses) {
  if (!ses || !ses.webRequest || googleUASessions.has(ses)) return;
  googleUASessions.add(ses);
  try {
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      const host = ((details.url || '').match(/^https?:\/\/([^/]+)/) || [])[1] || '';
      const isGoogle =
        /(^|\.)google\.\w+$/.test(host) ||
        /(^|\.)(gstatic|googleusercontent|googleapis|ggpht|googlevideo)\.com$/.test(host);
      if (isGoogle) headers['User-Agent'] = GOOGLE_UA;
      callback({ requestHeaders: headers });
    });
  } catch (err) {
    console.error('[orbit] google UA rewrite failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Sessions durables : les cookies de SESSION (sans expiration) sont perdus à
// chaque fermeture de l'app (comportement Chromium). Beaucoup de sites les
// utilisent (cPanel, messageries…) → « il faut se reconnecter à chaque fois ».
// On les « élève » en cookies persistants (expiration +1 an, côté client
// uniquement — le serveur ne voit pas la différence) pour rester connecté
// comme dans un navigateur classique. La déconnexion manuelle (logout du
// site) fonctionne toujours : le site supprime lui-même le cookie.
// ---------------------------------------------------------------------------
// Timers de debounce par COOKIE (partition + nom + domaine + chemin) : si on
// avait un seul timer par partition, deux cookies de session qui changent en
// même temps s'annuleraient mutuellement et ne seraient jamais persistés.
const sessionKeepers = new Map(); // "partition|name|domain|path" -> timer

const FAR_FUTURE = () => Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

function cookieSetUrl(c) {
  return `${c.secure ? 'https' : 'http'}://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`;
}

// Persiste un cookie de session en cookie persistant (+1 an, côté client
// uniquement — le serveur ne voit pas la différence).
//
// Anti-écrasement : on RELIT le cookie juste avant d'écrire et on persiste
// l'état le PLUS RÉCENT (valeur courante), jamais une valeur périmée. Pendant
// un flux de connexion (ex. la 2FA de GitHub), le site met à jour son cookie
// de session plusieurs fois en quelques secondes ; si on réécrivait la valeur
// capturée (ancienne) par-dessus la nouvelle, la session deviendrait
// incohérente → le site nous déconnecterait (boucle login → 2FA → login).
async function persistOneCookie(ses, c) {
  try {
    const fresh = await ses.cookies.get({
      url: cookieSetUrl(c),
      name: c.name,
      domain: c.domain,
    });
    const current = fresh && fresh.length > 0 ? fresh[0] : null;
    // Cookie supprimé entre-temps (logout, expiration) → rien à faire
    if (!current) return;
    // Déjà persistant → rien à faire (évite une écriture inutile)
    if (!current.session) return;

    await ses.cookies.set({
      url: cookieSetUrl(c),
      name: current.name,
      // Valeur COURANTE (la plus récente), jamais la valeur capturée
      value: current.value,
      // SANS le point initial : Electron normalise déjà le domaine en lui
      // ajoutant le point (sinon '.github.com' → '..github.com' → invalide
      // → le cookie existant est SUPPRIMÉ et le nouveau n'est pas posé →
      // session perdue pendant la 2FA → boucle login !)
      domain: (current.domain || '').replace(/^\./, ''),
      path: current.path || '/',
      secure: current.secure,
      httpOnly: current.httpOnly,
      sameSite: current.sameSite,
      expirationDate: FAR_FUTURE(),
    });
  } catch {
    /* ignore */
  }
}

// Active la persistance des cookies de session pour une partition (webview d'app)
function setupSessionCookiePersistence(partition) {
  try {
    const ses = getSessionForPartition(partition);
    if (sessionKeepers.has(partition + '|*')) return;
    sessionKeepers.set(partition + '|*', true);

    // Migration immédiate des cookies de session déjà présents au démarrage
    (async () => {
      try {
        const cookies = await ses.cookies.get({});
        for (const c of cookies) {
          if (c.session) await persistOneCookie(ses, c);
        }
      } catch { /* ignore */ }
    })();

    // + chaque cookie de session posé/rafraîchi en cours d'utilisation
    ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
      if (removed || !cookie || !cookie.session) return;
      const key = `${partition}|${cookie.name}|${cookie.domain}|${cookie.path || '/'}`;
      clearTimeout(sessionKeepers.get(key));
      sessionKeepers.set(
        key,
        setTimeout(() => {
          sessionKeepers.delete(key);
          persistOneCookie(ses, cookie);
        }, 1500)
      );
    });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Extensions Chrome — support natif Electron (session.loadExtension)
// ---------------------------------------------------------------------------

// Sessions où les extensions sont injectées (par défaut + profils)
const EXT_PARTITIONS = ['default', 'persist:work', 'persist:personal'];
const knownPartitions = new Set(EXT_PARTITIONS);

// Extensions actives (source de vérité = store React, synchronisé ici)
let enabledExtensions = []; // [{ id, name, version, path, managed }]
const loadedPerPartition = new Map(); // partition -> Set(extensionId)

function getSessionForPartition(partition) {
  return partition === 'default'
    ? session.defaultSession
    : session.fromPartition(partition);
}

// Extrait l'ID d'une extension depuis une URL du Chrome Web Store ou un ID brut
// (les IDs Chrome font exactement 32 caractères, lettres a-p)
function extractExtensionId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const urlMatch = s.match(/\/([a-p]{32})[\/?#]?$/i);
  if (urlMatch) return urlMatch[1];
  if (/^[a-p]{32}$/i.test(s)) return s;
  return null;
}

// Télécharge le .crx officiel depuis le Chrome Web Store (endpoint update2)
async function downloadCrxFromWebStore(extensionId, destPath) {
  const candidates = [
    `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=126.0.0.0&x=id%3D${extensionId}%26uc`,
    `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=126.0.0.0&x=id%3D${extensionId}`,
  ];
  for (const url of candidates) {
    try {
      const res = await net.fetch(url, { redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // Vérifie que c'est bien un .crx (et pas une page d'erreur HTML)
      if (buf.length < 100 || buf.toString('utf8', 0, 4) !== 'Cr24') continue;
      fs.writeFileSync(destPath, buf);
      return true;
    } catch (err) {
      console.error('[orbit] téléchargement crx échoué:', err.message);
    }
  }
  return false;
}

// Charge les extensions actives dans une session (une seule fois par session)
async function ensureExtensionsForPartition(partition) {
  try {
    const ses = getSessionForPartition(partition);
    const loaded = loadedPerPartition.get(partition) || new Set();
    for (const ext of enabledExtensions) {
      if (loaded.has(ext.id)) continue;
      try {
        const loadedExt = await ses.loadExtension(ext.path);
        loaded.add(loadedExt.id);
      } catch (err) {
        console.error('[orbit] échec chargement extension', ext.name, ':', err.message);
      }
    }
    loadedPerPartition.set(partition, loaded);
  } catch (err) {
    console.error('[orbit] ensureExtensionsForPartition failed:', err.message);
  }
}

// Réconcilie l'état du store React avec les sessions (charger / décharger)
async function syncExtensions(list) {
  enabledExtensions = (list || []).filter((e) => e.enabled);
  for (const partition of knownPartitions) {
    try {
      const ses = getSessionForPartition(partition);
      for (const ext of ses.getAllExtensions()) {
        if (!enabledExtensions.some((e) => e.id === ext.id)) {
          ses.removeExtension(ext.id);
        }
      }
    } catch { /* ignore */ }
    loadedPerPartition.delete(partition);
    await ensureExtensionsForPartition(partition);
  }
  return { success: true };
}

function removeExtensionFromAll(id, managedPath) {
  for (const partition of knownPartitions) {
    try {
      const ses = getSessionForPartition(partition);
      if (ses.getAllExtensions().some((e) => e.id === id)) {
        ses.removeExtension(id);
      }
    } catch { /* ignore */ }
    loadedPerPartition.get(partition)?.delete(id);
  }
  // On ne supprime que les dossiers qu'on a nous-mêmes extraits (.crx)
  if (managedPath) {
    try { fs.rmSync(managedPath, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// Tout window.open depuis l'UI React → navigateur système
function openExternalHandler({ url }) {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
  return { action: 'deny' };
}

// Popup d'une app embarquée (OAuth Google, connexion, target=_blank…) →
// s'ouvre DANS Orbit, dans une fenêtre qui PARTAGE la session du webview.
// Sans ça, la connexion partait dans le navigateur système et les cookies
// n'arrivaient jamais dans l'app → impossible de se connecter.
function openInAppPopup(guestContents, url) {
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
    return { action: 'deny' };
  }
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      parent: mainWindow,
      width: 920,
      height: 720,
      minWidth: 480,
      minHeight: 420,
      autoHideMenuBar: true,
      backgroundColor: '#0a0a0f',
      webPreferences: {
        // Même session que l'app → mêmes cookies → connexion réussie
        session: guestContents.session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: true,
        // Le même preload KeePassXC que les webviews : la popup de connexion
        // (ex. « Se connecter avec Google » dans Drive) est AUSSI une page de
        // formulaire — l'auto-remplissage des identifiants y fonctionne.
        preload: path.join(__dirname, 'keepass-preload.cjs'),
      },
    },
  };
}

function createWindow() {
  // Restaure la taille/position de la dernière session (si toujours visible)
  const saved = loadWindowState();
  const defaultBounds = { width: 1400, height: 900 };
  const restored =
    saved && saved.width && saved.height && isBoundsVisible(saved)
      ? { width: saved.width, height: saved.height, x: saved.x, y: saved.y }
      : defaultBounds;

  mainWindow = new BrowserWindow({
    ...restored,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    // Icône de la fenêtre (Linux/Windows)
    ...(process.platform !== 'darwin'
      ? { icon: path.join(__dirname, '../build/icon.png') }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // nécessaire pour afficher les apps dans la fenêtre
      spellcheck: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    if (process.env.ORBIT_DEVTOOLS !== '0') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Mémorise la taille/position au redimensionnement / déplacement
  mainWindow.on('resize', persistWindowState);
  mainWindow.on('move', persistWindowState);
  mainWindow.on('maximize', persistWindowState);
  mainWindow.on('unmaximize', persistWindowState);
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const maximized = mainWindow.isMaximized();
      saveWindowState({ ...(maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()), maximized });
    }
  });

  // Rétablit le mode maximisé si la dernière session l'était
  if (saved && saved.maximized) {
    mainWindow.once('ready-to-show', () => mainWindow.maximize());
  }

  // window.open depuis l'UI React → navigateur système
  mainWindow.webContents.setWindowOpenHandler(openExternalHandler);

  // Sécuriser les <webview> et appliquer le bypass à leur session
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // Durcir le guest
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;

    // Preload de détection/remplissage des identifiants (KeePassXC).
    // Injecté ici (le main process connaît __dirname ; les preloads
    // sandboxés, eux, n'y ont pas accès).
    webPreferences.preload = path.join(__dirname, 'keepass-preload.cjs');

    // Appliquer le contournement X-Frame-Options à la partition du webview
    // (chaque profil utilise sa propre partition → cookies séparés)
    const partition = (params && params.partition) || 'persist:default';
    if (partition !== 'default') {
      try {
        setupHeaderBypass(session.fromPartition(partition));
      } catch (err) {
        console.error('[orbit] partition bypass failed:', err);
      }
    }

    // UA « client identifié » pour les requêtes Google (connexion Gmail/Drive,
    // « Se connecter avec Google »), pendant que la page garde CHROME_UA
    try {
      setupGoogleUA(session.fromPartition(partition));
    } catch (err) {
      console.error('[orbit] partition google UA failed:', err);
    }

    // Injecter les extensions actives dans la session du webview
    knownPartitions.add(partition);
    ensureExtensionsForPartition(partition);

    // Sessions durables : les cookies de session deviennent persistants
    // (sinon déconnexion à chaque fermeture de l'app)
    setupSessionCookiePersistence(partition);
  });

  // Raccourcis GLOBAUX : interceptés AVANT que les apps embarquées ne les
  // voient (before-input-event) → Alt+K, Alt+Page… ouvrent Orbit même quand
  // le focus est dans Gmail/Slack, et les apps gardent leurs raccourcis Ctrl.
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    // Diagnostic : UA réellement reçue par chaque webview. Tout écart avec
    // l'UA Chrome authentique casse WhatsApp (« Chrome 100 ou version
    // ultérieure ») ou la connexion Google.
    guestContents.on('did-navigate', () => {
      const ua = guestContents.getUserAgent() || '';
      if (ua !== CHROME_UA) {
        console.log('[orbit] ⚠️ UA inattendue →', guestContents.getURL().slice(0, 60), '|', ua.slice(0, 110));
      }
    });

    guestContents.on('before-input-event', (event, input) => {
      const action = matchShortcutInput(input);
      if (action) {
        event.preventDefault();
        mainWindow.webContents.send('orbit:shortcut', action);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// IPC — contrôles de fenêtre uniquement (le reste passe par les <webview>)
// ---------------------------------------------------------------------------
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
  return { success: true };
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return { success: false };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { success: true, maximized: mainWindow.isMaximized() };
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
  return { success: true };
});

// ---------------------------------------------------------------------------
// Notifications système (messages non lus des apps)
// ---------------------------------------------------------------------------
ipcMain.handle('notifications:show', (_event, { title, body } = {}) => {
  if (!Notification.isSupported()) return { success: false };
  try {
    new Notification({
      title: title || 'Orbit',
      body: body || '',
      icon: path.join(__dirname, '../build/icon.png'),
      silent: false,
    }).show();
    return { success: true };
  } catch (err) {
    console.error('[orbit] notification failed:', err);
    return { success: false };
  }
});

// Badge de la fenêtre (dock macOS / Unity) = total de messages non lus
ipcMain.handle('notifications:setBadge', (_event, count) => {
  try {
    if (typeof app.setBadgeCount === 'function') {
      app.setBadgeCount(Math.max(0, count || 0));
    }
    return { success: true };
  } catch (err) {
    console.error('[orbit] badge failed:', err);
    return { success: false };
  }
});

// ---------------------------------------------------------------------------
// IPC — Extensions Chrome
// ---------------------------------------------------------------------------
ipcMain.handle('extensions:sync', (_event, list) => syncExtensions(list));

ipcMain.handle('extensions:pickFolder', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir le dossier de l'extension (celui qui contient manifest.json)",
    properties: ['openDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('extensions:pickCrx', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir un fichier d'extension (.crx)",
    properties: ['openFile'],
    filters: [{ name: 'Extension Chrome', extensions: ['crx'] }],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('extensions:install', async (_event, { kind, path: extPath } = {}) => {
  try {
    let dir = extPath;
    let managed = false;
    if (kind === 'crx') {
      const name = path.basename(extPath, '.crx').replace(/[^a-zA-Z0-9._-]/g, '_');
      dir = path.join(app.getPath('userData'), 'extensions', `${name}-${Date.now()}`);
      await unpackCrx(extPath, dir);
      managed = true;
    }
    // Chargement de validation sur la session par défaut
    const ext = await session.defaultSession.loadExtension(dir);
    return {
      success: true,
      extension: {
        id: ext.id,
        name: ext.name,
        version: ext.version,
        path: dir,
        managed,
        source: kind === 'crx' ? 'crx' : 'folder',
      },
    };
  } catch (err) {
    console.error('[orbit] installation extension échouée:', err);
    return { success: false, error: String(err.message || err) };
  }
});

// Installation directe depuis le Chrome Web Store (collez l'URL ou l'ID)
ipcMain.handle('extensions:installWebStore', async (_event, { idOrUrl } = {}) => {
  try {
    const extId = extractExtensionId(idOrUrl);
    if (!extId) {
      return {
        success: false,
        error: "Collez l'URL de l'extension (chromewebstore.google.com/…) ou son ID",
      };
    }

    const extRoot = path.join(app.getPath('userData'), 'extensions');
    fs.mkdirSync(extRoot, { recursive: true });
    const tmpCrx = path.join(extRoot, `.cws-${extId}-${Date.now()}.crx`);

    const ok = await downloadCrxFromWebStore(extId, tmpCrx);
    if (!ok) {
      return {
        success: false,
        error:
          'Téléchargement impossible depuis le Chrome Web Store (extension payante, retirée ou ID invalide ?)',
      };
    }

    const dir = path.join(extRoot, `${extId}-${Date.now()}`);
    try {
      await unpackCrx(tmpCrx, dir);
    } finally {
      try { fs.unlinkSync(tmpCrx); } catch { /* ignore */ }
    }

    const ext = await session.defaultSession.loadExtension(dir);
    return {
      success: true,
      extension: {
        id: ext.id,
        name: ext.name,
        version: ext.version,
        path: dir,
        managed: true,
        source: 'webstore',
      },
    };
  } catch (err) {
    console.error('[orbit] installation web store échouée:', err);
    return { success: false, error: String(err.message || err) };
  }
});

ipcMain.handle('extensions:uninstall', (_event, { id, path: extPath, managed } = {}) => {
  try {
    removeExtensionFromAll(id, managed ? extPath : null);
    enabledExtensions = enabledExtensions.filter((e) => e.id !== id);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// Infos d'affichage d'une extension (nom, version, icône, page d'options)
// pour la barre d'extensions de l'en-tête (comme un navigateur).
// L'icône est lue depuis le disque et renvoyée en data URL : les ressources
// chrome-extension:// non listées dans web_accessible_resources sont bloquées
// par Chromium (ERR_BLOCKED_BY_CLIENT) depuis la page React.
ipcMain.handle('extensions:getInfo', (_event, { id, path: extPath } = {}) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8'));
    const icons = manifest.icons || {};
    const sizes = Object.keys(icons).map(Number).sort((a, b) => b - a);

    let iconUrl = null;
    if (sizes.length > 0) {
      try {
        const iconFile = icons[sizes[0]];
        const iconPath = path.join(extPath, iconFile);
        if (fs.existsSync(iconPath)) {
          const ext = path.extname(iconFile).toLowerCase();
          const mime =
            ext === '.svg' ? 'image/svg+xml' :
            ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
            ext === '.gif' ? 'image/gif' :
            ext === '.webp' ? 'image/webp' :
            ext === '.ico' ? 'image/x-icon' :
            'image/png';
          iconUrl = `data:${mime};base64,${fs.readFileSync(iconPath).toString('base64')}`;
        }
      } catch {
        /* icône illisible → placeholder */
      }
    }

    // Avertissements : fonctionnalités demandées par l'extension que le
    // support natif d'Electron ne fournit pas (native messaging, MV3…)
    const perms = [
      ...(manifest.permissions || []),
      ...(manifest.optional_permissions || []),
    ];
    const warnings = [];
    if (perms.includes('nativeMessaging')) {
      warnings.push(
        'Nécessite le native messaging : ne pourra pas se connecter à une application locale (ex. KeePassXC)'
      );
    }
    if (manifest.manifest_version === 3 && manifest.background?.service_worker) {
      warnings.push('Manifest V3 avec service worker : support partiel dans Electron');
    }

    return {
      success: true,
      info: {
        name: manifest.name,
        version: manifest.version,
        hasOptions: Boolean(manifest.options_ui?.page || manifest.options_page),
        iconUrl,
        warnings,
      },
    };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// Ouvre la page d'options d'une extension (chrome-extension://<id>/options.html)
// Fiabilisé : on ATTEND le chargement de l'extension avant d'ouvrir la page
// (sinon la fenêtre s'affiche vide/morte), on force le focus, et les erreurs
// remontent à l'interface au lieu de laisser une fenêtre inerte.
ipcMain.handle('extensions:openOptions', async (_event, { id, path: extPath } = {}) => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8'));
    const optionsPage = manifest.options_ui?.page || manifest.options_page;
    if (!optionsPage) {
      return { success: false, error: "Cette extension n'a pas de page d'options" };
    }

    // Session dédiée à la page d'options : garantit que chrome-extension://
    // résout, même si l'extension est désactivée ou pas encore chargée ailleurs.
    const ses = session.fromPartition(`persist:ext-options-${id}`);
    if (!ses.getAllExtensions().some((e) => e.id === id)) {
      await ses.loadExtension(extPath);
    }

    const win = new BrowserWindow({
      width: 900,
      height: 700,
      minWidth: 480,
      minHeight: 420,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: true,
      },
    });

    // Afficher + focus UNE FOIS la page prête (évite la fenêtre blanche inerte)
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });

    await win.loadURL(`chrome-extension://${id}/${optionsPage}`);
    return { success: true };
  } catch (err) {
    console.error("[orbit] ouverture page d'options échouée:", err);
    return { success: false, error: String(err.message || err) };
  }
});

// ---------------------------------------------------------------------------
// IPC — KeePassXC (pont natif : auto-remplissage des identifiants)
// ---------------------------------------------------------------------------
ipcMain.handle('keepass:status', async () => {
  try {
    return await keepassCheckStatus();
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

ipcMain.handle('keepass:setEnabled', (_event, enabled) => {
  keepassSetEnabled(enabled !== false);
  return { success: true };
});

// Association : déclenche le dialog d'approbation dans KeePassXC
ipcMain.handle('keepass:associate', async () => {
  try {
    return await keepassAssociate();
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// Appelé par le preload des <webview> quand un champ de connexion reçoit le focus
ipcMain.handle('keepass:getLogins', async (_event, { url } = {}) => {
  try {
    return await keepassGetLogins(url);
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// Diagnostic : logs du preload KeePassXC → terminal de l'app
ipcMain.on('keepass:dbg', (_event, message) => {
  console.log('[keepass-preload]', message);
});

// Purge les cookies/session d'un compte désinstallé (session unique par app)
ipcMain.handle('sessions:clear', (_event, { profileId, appId } = {}) => {
  try {
    const partition = `persist:${profileId}:${appId}`;
    const ses = session.fromPartition(partition);
    ses.clearStorageData().catch(() => {});
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Identifiant d'app Windows : indispensable pour les notifications natives
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.orbit.app');
  }

  // Pont KeePassXC : charge l'association persistée + génère les clés de session
  initKeepass(app.getPath('userData'));

  // Bypass pour la session principale (page React)
  setupHeaderBypass(session.defaultSession);
  setupGoogleUA(session.defaultSession);

  // Bypass pour les sessions des profils connus + extensions actives
  for (const p of ['work', 'personal']) {
    try {
      setupHeaderBypass(session.fromPartition(`persist:${p}`));
      setupGoogleUA(session.fromPartition(`persist:${p}`));
    } catch {
      /* ignore */
    }
  }

  createWindow();

  // Recharger les extensions au démarrage (Electron ne les garde pas en mémoire)
  for (const p of EXT_PARTITIONS) {
    ensureExtensionsForPartition(p);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// window.open : l'UI React part vers le navigateur système, mais les popups
// des apps embarquées (OAuth, connexion…) s'ouvrent DANS Orbit avec la même
// session, pour que la connexion aboutisse dans l'application.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (contents.getType() === 'webview') {
      return openInAppPopup(contents, url);
    }
    return openExternalHandler({ url });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
