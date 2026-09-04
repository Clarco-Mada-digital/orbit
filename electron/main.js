import { app, BrowserWindow, session, ipcMain, shell, Notification, dialog, net, screen, Menu, clipboard, globalShortcut, Tray, nativeImage, powerMonitor, powerSaveBlocker, webContents, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { unpackCrx } from './crx.js';
import { init as initKeepass, setEnabled as keepassSetEnabled, getLogins as keepassGetLogins, associate as keepassAssociate, checkStatus as keepassCheckStatus } from './keepass.js';
import * as security from './security.js';
import * as adblock from './adblock.js';
import * as vault from './vault.js';
import * as sitePermissions from './site-permissions.js';
import * as tts from './tts.js';
import * as downloader from './downloader.js';
import electronUpdater from 'electron-updater';
import { matchShortcutInput } from '../src/lib/shortcuts.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// Résout un chemin de ressource vers le VRAI fichier sur disque. En packagé,
// les ressources sont dans app.asar (illisible par nativeImage / la couche
// X11-GTK) : on privilégie leur copie dé-packagée (app.asar.unpacked), rendue
// disponible par "asarUnpack" dans package.json.
function resourcePath(rel) {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', rel);
    if (fs.existsSync(unpacked)) return unpacked;
    return path.join(process.resourcesPath, 'app.asar', rel);
  }
  return path.join(__dirname, '..', rel);
}

// --- Barre système (tray) + fenêtre ----------------------------------------
let tray = null;
let isQuitting = false;
let closeToTray = false; // synchronisé depuis les réglages du renderer (opt-in)
// L'utilisateur a confirmé vouloir quitter malgré des téléchargements en cours
let downloadQuitConfirmed = false;
let trayInfoShown = false;
let summonAccel = null;

// Notifications VIVANTES : tant qu'une notification est à l'écran, on garde une
// référence forte sur l'objet Electron. Sinon le ramasse-miettes peut le
// collecter dès la fin du handler qui l'a créée, et ses événements ('click',
// 'action') ne sont plus jamais délivrés.
const liveNotifications = new Set();
function keepNotificationAlive(notif) {
  liveNotifications.add(notif);
  const drop = () => liveNotifications.delete(notif);
  notif.on('close', drop);
  notif.on('click', drop);
  notif.on('failed', drop);
  // Filet : certains serveurs de notification Linux n'émettent jamais 'close'.
  setTimeout(drop, 5 * 60 * 1000).unref?.();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showMainWindow();
}

// Choisit une icône de tray existante et de taille raisonnable. Sous Linux
// (AppIndicator), on passe le CHEMIN d'une petite PNG (l'applet la met à
// l'échelle lui-même) — redimensionner un 1024px en 18px rendait une icône vide.
function trayIconPath() {
  const candidates = [
    resourcePath('dist/icons/icon-32.png'), // 32px net, dé-packagé sur disque
    resourcePath('build/icon.png'), // repli 1024px
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* suivant */
    }
  }
  return candidates[candidates.length - 1];
}

function createTray() {
  if (tray) return;
  try {
    // Linux (AppIndicator / StatusNotifier) : on passe le CHEMIN du fichier sur
    // le VRAI disque (app.asar.unpacked, garanti par asarUnpack) directement à
    // `new Tray()`. C'est la méthode documentée par Electron, et la plus fiable
    // ici : passer une nativeImage oblige Electron à écrire un fichier temporaire
    // que certains hôtes SNI (XApp/Cinnamon) ne savent pas toujours lire → icône
    // manquante ou cassée. Surtout, PAS de resize : l'hôte met l'icône à
    // l'échelle lui-même, et un redimensionnement préalable (surtout avec un
    // facteur d'écran > 1) produit parfois une icône vide/déformée.
    //
    // ⚠️ RÉGRESSION ÉLECTRON (ne PAS monter au-delà de 43.2.x) : depuis 43.3.0,
    // Chromium route les items SNI par nom de service, mais les hôtes de tray
    // Linux (xApp/Cinnamon, extension GNOME AppIndicator) adressent l'item par
    // son nom UNIQUE (:1.xxx) via Gio.DBusProxy → `GetAll` échoue avec
    // « error occurred in GetAll » → le watcher ne lit jamais l'icône → le tray
    // affiche le placeholder « image cassée » (rose, non cliquable). Voir
    // electron/electron#52674. Electron est épinglé à 43.2.0 dans package.json
    // (dernière version saine) — vérifier le correctif upstream avant tout bump.
    if (process.platform === 'linux') {
      tray = new Tray(trayIconPath());
    } else {
      let image = nativeImage.createFromPath(trayIconPath());
      if (image.isEmpty()) {
        image = nativeImage.createFromPath(resourcePath('build/icon.png'));
      }
      tray = new Tray(image);
    }
    tray.setToolTip('Orbit');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Afficher Orbit', click: showMainWindow },
        { type: 'separator' },
        {
          label: 'Quitter',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ])
    );
    // IMPORTANT : sur Linux le clic gauche est peu fiable et on ne veut JAMAIS
    // masquer depuis le tray (risque de rester bloqué) → clic = TOUJOURS
    // afficher. Le masquage se fait uniquement via le bouton fermer.
    tray.on('click', showMainWindow);
    tray.on('double-click', showMainWindow);
  } catch (err) {
    console.error('[orbit] tray échoué:', err.message, '| icône:', trayIconPath());
  }
}

// Raccourci global d'invocation (afficher/masquer). accelerator null = désactivé.
function setSummonHotkey(accelerator) {
  try {
    if (summonAccel) {
      globalShortcut.unregister(summonAccel);
      summonAccel = null;
    }
    if (accelerator) {
      const ok = globalShortcut.register(accelerator, toggleMainWindow);
      if (ok) summonAccel = accelerator;
      return { success: ok };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// Instance unique : relancer Orbit ne crée pas une 2e fenêtre mais RAMÈNE
// l'existante au premier plan (filet de sécurité si la fenêtre est masquée).
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
}
app.on('second-instance', () => showMainWindow());

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
// Embarquement des apps web dans les <webview> : on lève UNIQUEMENT ce qui
// empêche l'affichage encadré, sans désarmer les autres protections.
//
// AVANT : on supprimait toute la CSP (Content-Security-Policy) → on retirait
// aussi les protections anti-XSS (script-src, object-src…) des apps embarquées.
// MAINTENANT : on retire seulement ce qui bloque l'encadrement —
//   • X-Frame-Options (entièrement, il n'a pas d'autre rôle) ;
//   • la SEULE directive `frame-ancestors` de la CSP,
// et on CONSERVE le reste de la CSP (script-src, etc.). C'est le comportement
// d'un vrai navigateur : la page garde ses propres défenses.
// ---------------------------------------------------------------------------

// Retire la directive `frame-ancestors` d'une valeur de CSP, garde le reste.
// Renvoie null si, une fois retirée, il ne reste plus rien d'utile.
function stripFrameAncestors(cspValue) {
  const kept = String(cspValue)
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^frame-ancestors\b/i.test(d));
  return kept.length ? kept.join('; ') : null;
}

// Réécrit une clé de header CSP (valeur = tableau de chaînes chez Electron).
function rewriteCspHeader(headers, key) {
  const value = headers[key];
  if (!value) return;
  const list = Array.isArray(value) ? value : [value];
  const next = list.map(stripFrameAncestors).filter(Boolean);
  if (next.length) headers[key] = next;
  else delete headers[key];
}

// Retire X-Frame-Options + frame-ancestors d'un jeu de headers (mutation en place)
function stripFramingHeaders(headers) {
  delete headers['x-frame-options'];
  delete headers['X-Frame-Options'];
  for (const key of Object.keys(headers)) {
    if (/^content-security-policy(-report-only)?$/i.test(key)) {
      rewriteCspHeader(headers, key);
    }
  }
}

// Écouteur UNIQUE par session pour onHeadersReceived ET onBeforeRequest.
// Electron n'autorise qu'un écouteur par événement : on compose donc nous-mêmes
// le bloqueur de pub (adblock.js) AVEC notre contournement d'encadrement.
// Réglage du bloqueur PAR APP : 'on' (toujours), 'off' (jamais) ou absent
// (suit le réglage global). Clé = id du webContents du <webview>, poussé par le
// renderer à chaque chargement — c'est le seul identifiant fiable : plusieurs
// apps peuvent partager une session (profil en mode partagé, conteneurs), donc
// la session ne suffit pas à savoir de quelle app vient une requête.
const adblockOverrides = new Map();

function adblockActiveFor(webContentsId) {
  const mode = webContentsId != null ? adblockOverrides.get(webContentsId) : undefined;
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return adblock.getState().enabled;
}

ipcMain.handle('adblock:setForContents', (_event, { webContentsId, mode } = {}) => {
  const id = Number(webContentsId);
  if (!Number.isInteger(id)) return { success: false };
  if (mode === 'on' || mode === 'off') {
    adblockOverrides.set(id, mode);
    // Le moteur n'est chargé que si le réglage global est actif : une app qui
    // force le blocage doit pouvoir le déclencher elle-même.
    if (mode === 'on') adblock.ensureEngine();
  } else {
    adblockOverrides.delete(id);
  }
  // Nettoyage : sans ça la Map grossirait à chaque rechargement d'app.
  try {
    webContents.fromId(id)?.once('destroyed', () => adblockOverrides.delete(id));
  } catch {
    /* le webContents peut déjà être parti */
  }
  return { success: true };
});

function setupHeaderBypass(ses) {
  if (!ses || !ses.webRequest) return;
  try {
    // Blocage réseau des pubs/traceurs (no-op si l'adblock est désactivé)
    ses.webRequest.onBeforeRequest((details, callback) => {
      adblock.beforeRequest(ses, details, callback, adblockActiveFor(details.webContentsId));
    });

    ses.webRequest.onHeadersReceived((details, callback) => {
      // 1) L'adblocker peut modifier les headers ($csp) ou annuler la requête
      adblock.headersReceived(ses, details, (adResp) => {
        adResp = adResp || {};
        if (adResp.cancel) {
          callback(adResp);
          return;
        }
        // 2) On repart des headers renvoyés par l'adblock (ou ceux d'origine)
        const headers = { ...(adResp.responseHeaders || details.responseHeaders) };
        // 3) Puis on lève X-Frame-Options / frame-ancestors pour l'embarquement
        stripFramingHeaders(headers);
        callback({ ...adResp, responseHeaders: headers });
      }, adblockActiveFor(details.webContentsId));
    });
  } catch (err) {
    console.error('[orbit] header bypass failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Permissions des apps embarquées : sans politique explicite, Electron accorde
// tout par défaut. On applique une politique « navigateur pro » :
//   • AUTORISÉ : ce qu'attendent les apps de travail — notifications, micro /
//     caméra (appels Slack, Meet, WhatsApp), plein écran, presse-papiers,
//     verrouillage du pointeur, MediaKeys (DRM lecture vidéo) ;
//   • REFUSÉ par défaut : accès matériel/sensible peu courant — géoloc, USB,
//     HID, série, MIDI, capteurs, détection d'inactivité…
// ---------------------------------------------------------------------------
const ALLOWED_PERMISSIONS = new Set([
  'notifications',
  'media', // micro + caméra (appels/visio)
  'mediaKeySystem', // DRM (lecture vidéo protégée)
  'geolocation', // géolocalisation (cartes, météo…)
  'fullscreen',
  'clipboard-read',
  'clipboard-sanitized-write',
  'pointerLock',
  'background-sync',
  'openExternal',
  'display-capture', // partage d'écran (WebRTC / appels vidéo)
  'desktop-capture', // idem, ancien nom
  // Sélecteur de fichiers/dossiers (showDirectoryPicker, showOpenFilePicker).
  // Son absence ici refusait la demande en silence : la promesse était rejetée
  // et les pages qui analysent un dossier ne démarraient jamais.
  'fileSystem',
]);

// Permissions pour lesquelles Orbit DEMANDE (comportement d'un navigateur) :
// tout ce qui touche au matériel, à la position ou à l'écran. Les autres
// gardent la politique globale ci-dessus, accordée ou refusée en silence.
const ASKABLE_PERMISSIONS = new Set([
  'media', // caméra / micro
  'geolocation',
  'notifications',
  'display-capture',
  'desktop-capture',
  'midiSysex',
  'clipboard-read',
  'idle-detection',
  'window-management',
  'fileSystem', // dossier ou fichier choisi par l'utilisateur
]);

// Sessions passant par un proxy : le WebRTC doit alors rester dans le tunnel.
const proxiedSessions = new WeakSet();
// `setupPermissions` est rejoué à chaque attachement de webview : les
// `setXHandler` se remplacent, mais un `on(...)` s'empilerait et rappellerait
// le callback plusieurs fois.
const fsRestrictedSessions = new WeakSet();

function applyWebRtcPolicy(ses, viaProxy) {
  try {
    ses.setWebRTCIPHandlingPolicy(viaProxy ? 'disable_non_proxied_udp' : 'default');
  } catch (_) { /* Electron < 15 */ }
}

function setupPermissions(ses) {
  if (!ses) return;
  try {
    // Signature Electron 12+ : (webContents, permission, callback, details).
    // Les versions anciennes plaçaient le callback en dernier — on accepte les
    // deux plutôt que de dépendre du numéro de version.
    ses.setPermissionRequestHandler((wc, permission, a, b, c) => {
      const cb = typeof a === 'function' ? a : typeof c === 'function' ? c : null;
      if (!cb) return;
      const details = b || {};
      const byDefault = () => cb(ALLOWED_PERMISSIONS.has(permission));

      if (!ASKABLE_PERMISSIONS.has(permission)) return byDefault();

      // De quel site vient la demande ? On préfère l'URL portée par la demande
      // (une iframe peut demander pour son propre compte) et on retombe sur
      // l'adresse de la page.
      let pageUrl = '';
      try {
        pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : '';
      } catch { /* contents déjà parti */ }
      const origin = sitePermissions.originOf(
        details.requestingUrl || details.securityOrigin || pageUrl
      );

      // Décision déjà prise pour ce site → on la rejoue sans rien demander.
      const known = sitePermissions.decisionFor(origin, permission);
      if (known) {
        permLog(`${permission} pour ${origin} — décision mémorisée : ${known}`);
        return cb(known === 'allow');
      }

      const mode = sitePermissions.getMode();
      if (mode !== 'ask' || !origin) {
        permLog(`${permission} pour ${origin || 'origine illisible'} — mode « ${mode} »`);
        if (mode === 'deny') return cb(false);
        return byDefault(); // 'allow', ou origine illisible (about:, blob:…)
      }

      permLog(`${permission} demandé par ${origin} — question posée`);
      askPermission(wc, permission, origin, {
        // Pour un dossier ou un fichier, la question n'a de sens qu'avec son
        // nom : « lire le dossier argus », pas « accéder à vos fichiers ».
        target: details.filePath ? path.basename(details.filePath) : '',
        isDirectory: !!details.isDirectory,
        writable: details.fileAccessType === 'writable',
      }).then((answer) => {
        // `null` = aucune interface pour poser la question (pop-up) : on
        // applique la politique par défaut plutôt que de bloquer l'app.
        if (answer === null) {
          permLog(`${permission} pour ${origin} — sans réponse, politique par défaut`);
          return byDefault();
        }
        cb(answer);
      });
    });

    // Vérifications synchrones (navigator.permissions.query, Notification.permission…)
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      const origin = sitePermissions.originOf(requestingOrigin || '');
      const known = sitePermissions.decisionFor(origin, permission);
      if (known) return known === 'allow';
      if (sitePermissions.getMode() === 'deny' && ASKABLE_PERMISSIONS.has(permission)) return false;
      return ALLOWED_PERMISSIONS.has(permission);
    });

    // Périphériques (caméra / micro) : sans handler, Electron refuse
    // l'accès même quand la permission 'media' est accordée.  WhatsApp,
    // Messenger… appellent getUserMedia() → besoin de ce handler pour
    // que la caméra et le micro soient réellement accessibles.
    try {
      ses.setDevicePermissionHandler((_details, callback) => {
        callback(true);
      });
    } catch (_) { /* Electron < 15 */ }

    // Partage d'écran (« Partager l'écran » dans un appel).
    // Le callback attend un FLUX, pas un booléen : `callback(true)` ne
    // partageait rien du tout. On passe la main au sélecteur du système
    // quand il existe, et on retombe sur l'écran principal sinon.
    try {
      ses.setDisplayMediaRequestHandler(
        async (_request, callback) => {
          try {
            const sources = await desktopCapturer.getSources({ types: ['screen'] });
            const screenSource = sources[0];
            callback(screenSource ? { video: screenSource } : {});
          } catch {
            callback({}); // un objet vide = refus, jamais un plantage
          }
        },
        { useSystemPicker: true }
      );
    } catch (_) { /* Electron < 30 */ }

    // Chromium refuse certains chemins sensibles (racine, dossiers système).
    // Sans écoute, la page échoue sans un mot : on journalise et on renvoie
    // l'utilisateur au sélecteur pour qu'il choisisse ailleurs.
    try {
      if (!fsRestrictedSessions.has(ses)) {
        fsRestrictedSessions.add(ses);
        ses.on('file-system-access-restricted', (_e, details, callback) => {
          permLog(
            `chemin protégé refusé à ${hostOf(details.origin || '')} ` +
              `(${details.isDirectory ? 'dossier' : 'fichier'}) — nouveau choix proposé`
          );
          callback('tryAgain');
        });
      }
    } catch (_) { /* Electron < 35 */ }

    // WebRTC : laisser passer l'UDP direct, sans quoi les appels n'aboutissent
    // pas. `disable_non_proxied_udp` fait exactement l'INVERSE de ce que
    // l'ancien commentaire annonçait : c'est le réglage le plus restrictif de
    // Chromium (« UDP uniquement à travers le proxy »). Sans proxy configuré,
    // il ne restait plus aucun candidat ICE direct — Messenger, WhatsApp et
    // Telegram sonnaient dans le vide. On ne le remet que si un proxy est
    // réellement en place, pour ne pas contourner le tunnel de l'utilisateur.
    applyWebRtcPolicy(ses, proxiedSessions.has(ses));
  } catch (err) {
    console.error('[orbit] permission handler failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Gestion des téléchargements (comme un navigateur)
// ---------------------------------------------------------------------------
// Chaque fichier téléchargé (clic droit « Enregistrer l'image », lien de
// téléchargement d'une app…) est enregistré dans le dossier Téléchargements de
// l'OS avec un nom unique, et sa progression est diffusée à l'interface (badge
// + panneau : ouvrir, afficher dans le dossier, annuler).
const downloads = new Map(); // id -> { item, savePath, url, filename }
const downloadSessions = new WeakSet();
let downloadSeq = 0;

function broadcastDownload(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('orbit:download', payload);
  }
}

// Chemin libre : « photo.png » → « photo (1).png » si déjà présent.
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let i = 1;
  let candidate;
  do {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  } while (fs.existsSync(candidate));
  return candidate;
}

// Un téléchargement se poursuit quand Orbit passe en arrière-plan : il est
// piloté par le processus PRINCIPAL (DownloadItem), pas par la page, et
// `backgroundThrottling` est déjà désactivé pour les webviews. Deux choses
// pouvaient tout de même l'interrompre, et sont traitées ici :
//   • la MISE EN VEILLE de la machine (rien ne l'empêchait) → powerSaveBlocker
//     tant qu'au moins un transfert est en cours ;
//   • la FERMETURE d'Orbit (le X quitte l'app quand « réduire dans la barre
//     système » est désactivé) → confirmation avant de quitter (voir before-quit).
let downloadBlockerId = null;

function activeDownloadCount() {
  let n = 0;
  for (const rec of downloads.values()) {
    if (!rec.item) continue;
    // Deux sortes de transferts partagent ce registre : les DownloadItem
    // d'Electron (qui exposent getState) et les téléchargements yt-dlp, dont
    // l'entrée n'est qu'un objet { cancel }. Appeler getState() sur le second
    // levait une TypeError — ce qui, dans `before-quit`, empêchait purement et
    // simplement de quitter l'application.
    if (typeof rec.item.getState === 'function') {
      if (rec.item.getState() === 'progressing') n += 1;
    } else if (rec.active) {
      n += 1;
    }
  }
  return n;
}

function refreshDownloadPowerBlocker() {
  const busy = activeDownloadCount() > 0;
  try {
    if (busy && downloadBlockerId === null) {
      // 'prevent-app-suspension' : l'écran peut s'éteindre, la machine ne se
      // met pas en veille. C'est exactement le cas « je laisse télécharger ».
      downloadBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!busy && downloadBlockerId !== null) {
      powerSaveBlocker.stop(downloadBlockerId);
      downloadBlockerId = null;
    }
  } catch {
    downloadBlockerId = null;
  }
}

function setupDownloads(ses) {
  if (!ses || downloadSessions.has(ses)) return;
  downloadSessions.add(ses);
  ses.on('will-download', (_event, item) => {
    const id = `dl-${Date.now()}-${(downloadSeq += 1)}`;
    const savePath = uniquePath(path.join(app.getPath('downloads'), item.getFilename()));
    item.setSavePath(savePath);
    downloads.set(id, { item, savePath, url: item.getURL(), filename: path.basename(savePath) });

    const snapshot = (state) => ({
      id,
      filename: path.basename(savePath),
      savePath,
      url: item.getURL(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: item.getReceivedBytes(),
      state: state || item.getState(),
    });

    broadcastDownload({ ...snapshot('progressing'), event: 'started' });
    refreshDownloadPowerBlocker();
    item.on('updated', (_e, state) => broadcastDownload({ ...snapshot(state), event: 'updated' }));
    item.once('done', (_e, state) => {
      broadcastDownload({ ...snapshot(state), event: 'done' });
      refreshDownloadPowerBlocker();
      // On garde le chemin un moment (ouvrir / afficher) puis on nettoie.
      const rec = downloads.get(id);
      if (rec) rec.item = null;
      setTimeout(() => downloads.delete(id), 10 * 60 * 1000);
    });
  });
}

// ---------------------------------------------------------------------------
// Traduction + lecture vocale natives (remplacent les extensions capricieuses)
// ---------------------------------------------------------------------------
// Config de traduction (synchronisée depuis les réglages du renderer).
//   engine : 'google' (endpoint public gtx) | 'libretranslate' (privé / auto-hébergé)
//   url/apiKey : serveur LibreTranslate (ex. http://localhost:5000) + clé éventuelle
let translateConfig = { target: 'fr', engine: 'google', url: '', apiKey: '' };

// Lecture à voix haute. Deux moteurs possibles :
//   • « système » (tts.js) — spd-say / say / SAPI : instantané, robotique ;
//   • « piper » — voix neuronales hors ligne, nettement plus naturelles.
//
// Piper n'est chargé QUE si l'utilisateur l'a choisi : `import()` dynamique, à
// l'usage. Tant qu'on ne s'en sert pas, son code n'est pas lu, aucun processus
// n'est lancé et rien n'est téléchargé.
let ttsPrefs = { engine: 'system', voiceId: '' };
let piperMod = null; // module chargé paresseusement
let mmsMod = null; // module MMS-TTS chargé paresseusement

async function loadPiper() {
  if (!piperMod) piperMod = await import('./piper.js');
  return piperMod;
}

async function loadMms() {
  if (!mmsMod) mmsMod = await import('./mms-tts.js');
  return mmsMod;
}

// Le PCM produit par Piper est rejoué par l'interface (Web Audio) : c'est le
// seul chemin identique sur les trois systèmes, et il respecte le volume réglé
// dans Orbit sans dépendre d'un lecteur externe (aplay, afplay…).
function pipeAudioToUi(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function speakWithPiper(text) {
  const piper = await loadPiper();
  return piper.speak(text, {
    voiceId: ttsPrefs.voiceId,
    onStart: ({ sampleRate }) => pipeAudioToUi('orbit:tts-start', { sampleRate }),
    onAudio: (chunk) => pipeAudioToUi('orbit:tts-audio', chunk),
    onEnd: () => pipeAudioToUi('orbit:tts-end', {}),
  });
}

async function speakWithMms(text) {
  const mms = await loadMms();
  return mms.speak(text, {
    onStart: ({ sampleRate }) => pipeAudioToUi('orbit:tts-start', { sampleRate }),
    onAudio: (chunk) => pipeAudioToUi('orbit:tts-audio', chunk),
    onEnd: () => pipeAudioToUi('orbit:tts-end', {}),
    onProgress: (p) => mainWindow?.webContents?.send('orbit:tts-progress', p),
  });
}

async function speakText(wc, text) {
  stopSpeaking();
  if (ttsPrefs.engine === 'piper' && ttsPrefs.voiceId) {
    try {
      const res = await speakWithPiper(text);
      if (res.success) return res;
      showPageToast(
        wc,
        res.error === 'voice-missing'
          ? 'Voix Piper introuvable — réinstallez-la dans Réglages → Lecture vocale.'
          : 'Moteur Piper non installé — Réglages → Lecture vocale.'
      );
    } catch (err) {
      console.error('[orbit] piper indisponible:', err.message);
    }
  }
  if (ttsPrefs.engine === 'mms-tts') {
    try {
      const res = await speakWithMms(text);
      if (res.success) return res;
      showPageToast(wc, 'Modèle MMS-TTS non installé — Réglages → Lecture vocale.');
    } catch (err) {
      console.error('[orbit] mms-tts indisponible:', err.message);
    }
  }
  const res = tts.speak(text, { lang: (translateConfig.target || 'fr').slice(0, 2) });
  if (!res.success && res.error === 'no-engine') {
    showPageToast(wc, res.hint || tts.missingEngineHint());
  }
  return res;
}

function stopSpeaking() {
  tts.stop();
  if (piperMod) {
    piperMod.stop();
    pipeAudioToUi('orbit:tts-end', {});
  }
  if (mmsMod) {
    mmsMod.stop();
    pipeAudioToUi('orbit:tts-end', {});
  }
}

function speakingNow() {
  return tts.isSpeaking() || Boolean(piperMod && piperMod.isSpeaking()) || Boolean(mmsMod && mmsMod.isSpeaking());
}

// Lit tout le texte visible de la page. Le texte est extrait dans la page, la
// lecture se fait dans le processus principal.
async function speakPage(wc) {
  try {
    const text = await wc.executeJavaScript(
      '(() => { try { return document.body ? document.body.innerText : ""; } catch (e) { return ""; } })()'
    );
    if (!text || !text.trim()) {
      showPageToast(wc, 'Rien à lire sur cette page.');
      return;
    }
    speakText(wc, text);
  } catch {
    showPageToast(wc, 'Lecture impossible sur cette page.');
  }
}

// Traduction via l'endpoint public Google (gtx) — pas de clé requise.
async function translateGoogle(q, target) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
    encodeURIComponent(target) +
    '&dt=t&q=' +
    encodeURIComponent(q);
  const res = await net.fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const translated = (data[0] || []).map((seg) => (seg && seg[0]) || '').join('');
  return { translated, detected: data[2] || '' };
}

// Traduction via un serveur LibreTranslate (privé / auto-hébergeable) — les
// textes ne sortent PAS vers un service tiers si le serveur est local.
async function translateLibre(q, target, baseUrl, apiKey) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('URL du serveur LibreTranslate manquante (Réglages → Confidentialité)');
  const res = await net.fetch(base + '/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q,
      source: 'auto',
      target,
      format: 'text',
      ...(apiKey ? { api_key: apiKey } : {}),
    }),
  });
  if (!res.ok) throw new Error('LibreTranslate HTTP ' + res.status);
  const data = await res.json();
  return {
    translated: data.translatedText || '',
    detected: (data.detectedLanguage && data.detectedLanguage.language) || '',
  };
}

async function translateText(text) {
  const q = String(text || '').slice(0, 5000);
  const { target, engine, url, apiKey } = translateConfig;
  if (engine === 'libretranslate') return translateLibre(q, target, url, apiKey);
  return translateGoogle(q, target);
}

// Petit bandeau d'information DANS la page invitée. Sert aux actions du menu
// contextuel qui peuvent échouer pour une raison que l'utilisateur ne peut pas
// deviner (aucune voix installée, page sans texte) : sans lui, un clic sur
// « Lire la page » ne produit rien du tout et rien ne l'explique.
function showPageToast(wc, message) {
  const payload = JSON.stringify(String(message || ''));
  wc
    .executeJavaScript(
      `(() => {
        try {
          document.getElementById('__orbit_toast__')?.remove();
          const box = document.createElement('div');
          box.id = '__orbit_toast__';
          box.textContent = ${payload};
          box.style.cssText = 'position:fixed;z-index:2147483647;left:50%;transform:translateX(-50%);bottom:24px;max-width:min(560px,90vw);background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:10px;padding:10px 14px;font-family:system-ui,sans-serif;font-size:13px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.5)';
          document.body.appendChild(box);
          setTimeout(() => box.remove(), 6000);
        } catch (e) {}
      })();`
    )
    .catch(() => {});
}

// Affiche le résultat de traduction en surimpression DANS la page (petit encart
// flottant, fermable), à la manière d'une extension de traduction.
function showTranslationOverlay(wc, original, translated, detected, target) {
  const payload = JSON.stringify({ original, translated, detected, target });
  wc.executeJavaScript(
    `(() => {
      try {
        const d = ${payload};
        document.getElementById('__orbit_tr__')?.remove();
        const box = document.createElement('div');
        box.id = '__orbit_tr__';
        box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:380px;background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;overflow:hidden';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#0b1220;border-bottom:1px solid #1f2937';
        // textContent et non innerHTML : « detected » vient de la réponse du
        // service de traduction. Concaténé dans du HTML, un service compromis
        // (ou un serveur LibreTranslate hostile) injectait du script dans la
        // page de l'app.
        const label = document.createElement('span');
        label.style.cssText = 'font-weight:600;color:#9ca3af';
        label.textContent = '🌐 Traduction (' + (d.detected||'auto') + ' → ' + d.target + ')';
        head.appendChild(label);
        const close = document.createElement('button');
        close.textContent = '✕';
        close.style.cssText = 'background:none;border:none;color:#9ca3af;cursor:pointer;font-size:14px';
        close.onclick = () => box.remove();
        head.appendChild(close);
        const body = document.createElement('div');
        body.style.cssText = 'padding:10px 12px';
        const tr = document.createElement('div');
        tr.textContent = d.translated;
        const or = document.createElement('div');
        or.textContent = d.original;
        or.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid #1f2937;color:#9ca3af;font-size:12px';
        body.appendChild(tr); body.appendChild(or);
        box.appendChild(head); box.appendChild(body);
        document.body.appendChild(box);
        clearTimeout(window.__orbit_tr_timer__);
        window.__orbit_tr_timer__ = setTimeout(() => box.remove(), 15000);
      } catch (e) {}
    })();`
  ).catch(() => {});
}

async function translateSelection(wc, text) {
  try {
    const { translated, detected } = await translateText(text);
    if (translated) {
      showTranslationOverlay(wc, text, translated, detected, translateConfig.target);
    }
  } catch (err) {
    console.error('[orbit] traduction échouée:', err.message);
    // Retour visible dans la page plutôt qu'un échec silencieux
    showTranslationOverlay(wc, text, '⚠️ ' + err.message, '', translateConfig.target);
  }
}

// ---------------------------------------------------------------------------
// Captures d'écran d'une page (clic droit → Capture d'écran)
// ---------------------------------------------------------------------------
// Trois modes : la zone VISIBLE (ce qu'on voit), la PAGE ENTIÈRE (au-delà du
// défilement, via le protocole DevTools) et une SÉLECTION dessinée à la souris.
// Le PNG part dans « Images/Orbit » ET dans le presse-papiers (coller direct
// dans un mail, un chat…), avec une entrée dans le panneau Téléchargements.

// Sélecteur de zone injecté DANS la page : superposition + rectangle tiré à la
// souris. Résout {x,y,width,height} en pixels CSS, ou null si annulé (Échap,
// clic simple). La superposition est retirée AVANT de résoudre — sinon elle se
// retrouverait sur la capture.
const PICK_REGION_JS = `(() => new Promise((resolve) => {
  try {
    if (typeof window.__orbitPickCancel__ === 'function') window.__orbitPickCancel__();
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,23,42,.28)';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;display:none;border:1.5px solid #6366f1;background:rgba(99,102,241,.18);pointer-events:none';
    const hint = document.createElement('div');
    hint.textContent = 'Glissez pour choisir la zone — Échap pour annuler';
    hint.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:#111827;color:#f3f4f6;font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none';
    ov.appendChild(box);
    ov.appendChild(hint);

    let sx = 0, sy = 0, dragging = false, rect = null;
    const cleanup = () => {
      window.__orbitPickCancel__ = null;
      ov.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    // Deux rendus d'attente : la page doit être REPEINTE sans la superposition
    // avant que le processus principal ne déclenche la capture.
    const done = (r) => {
      cleanup();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(r)));
    };
    const draw = (e) => {
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      box.style.left = x + 'px'; box.style.top = y + 'px';
      box.style.width = w + 'px'; box.style.height = h + 'px';
      rect = { x: x, y: y, width: w, height: h };
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    ov.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true; sx = e.clientX; sy = e.clientY;
      hint.style.display = 'none';
      box.style.display = 'block';
      draw(e);
    });
    ov.addEventListener('mousemove', (e) => { if (dragging) draw(e); });
    ov.addEventListener('mouseup', (e) => {
      if (!dragging) return;
      dragging = false;
      draw(e);
      done(rect && rect.width > 4 && rect.height > 4 ? rect : null);
    });
    document.addEventListener('keydown', onKey, true);
    window.__orbitPickCancel__ = () => done(null);
    (document.body || document.documentElement).appendChild(ov);
  } catch (e) { resolve(null); }
}))()`;

// Dossier des captures : « Images/Orbit », repli sur les téléchargements si le
// système n'expose pas de dossier Images (certains Linux minimalistes).
function screenshotDir() {
  let base;
  try {
    base = app.getPath('pictures');
  } catch {
    base = app.getPath('downloads');
  }
  const dir = path.join(base, 'Orbit');
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return base;
  }
}

function screenshotName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Orbit ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s.png`;
}

// Page ENTIÈRE : capturePage() s'arrête au viewport. On passe donc par le
// protocole DevTools (captureBeyondViewport), seul moyen d'aller au-delà du
// défilement. Chromium plafonne la surface : on borne à 16384 px.
async function captureFullPage(wc) {
  const dbg = wc.debugger;
  let attached = false;
  try {
    if (!dbg.isAttached()) {
      dbg.attach('1.3');
      attached = true;
    }
    const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize || {};
    const width = Math.min(Math.ceil(size.width || 0), 16384);
    const height = Math.min(Math.ceil(size.height || 0), 16384);
    if (!width || !height) throw new Error('taille de page inconnue');
    const shot = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64'));
  } catch (err) {
    // DevTools déjà ouverts (mode dev) → le débogueur refuse de s'attacher.
    // Mieux vaut la zone visible qu'aucune capture.
    console.error('[orbit] capture page entière indisponible:', err.message);
    return wc.capturePage();
  } finally {
    if (attached) {
      try {
        dbg.detach();
      } catch {
        /* déjà détaché */
      }
    }
  }
}

// Sélection : coordonnées rendues en pixels CSS → converties en points
// indépendants du périphérique (ce qu'attend capturePage) via le zoom de la page.
async function pickRegion(wc) {
  const r = await wc.executeJavaScript(PICK_REGION_JS, true);
  if (!r) return null;
  const zoom = typeof wc.getZoomFactor === 'function' ? wc.getZoomFactor() : 1;
  const rect = {
    x: Math.round(r.x * zoom),
    y: Math.round(r.y * zoom),
    width: Math.round(r.width * zoom),
    height: Math.round(r.height * zoom),
  };
  return rect.width > 2 && rect.height > 2 ? rect : null;
}

async function captureGuestPage(wc, mode) {
  try {
    let image;
    if (mode === 'full') {
      image = await captureFullPage(wc);
    } else if (mode === 'selection') {
      const rect = await pickRegion(wc);
      if (!rect) return; // annulé par l'utilisateur : rien à signaler
      image = await wc.capturePage(rect);
    } else {
      image = await wc.capturePage();
    }
    if (!image || image.isEmpty()) throw new Error('image vide');

    const savePath = uniquePath(path.join(screenshotDir(), screenshotName()));
    const png = image.toPNG();
    fs.writeFileSync(savePath, png);
    clipboard.writeImage(image);

    // Réutilise le panneau Téléchargements : la capture y apparaît terminée,
    // avec « ouvrir » / « afficher dans le dossier ».
    broadcastDownload({
      id: `shot-${Date.now()}`,
      filename: path.basename(savePath),
      savePath,
      url: wc.getURL(),
      totalBytes: png.length,
      receivedBytes: png.length,
      state: 'completed',
      event: 'done',
    });

    if (Notification.isSupported()) {
      const notif = new Notification({
        title: 'Capture enregistrée',
        body: `${path.basename(savePath)} — également copiée dans le presse-papiers`,
        silent: true,
      });
      notif.on('click', () => shell.showItemInFolder(savePath));
      keepNotificationAlive(notif); // sinon le clic « ouvrir le dossier » se perd
      notif.show();
    }
  } catch (err) {
    console.error('[orbit] capture échouée:', err);
    if (Notification.isSupported()) {
      new Notification({ title: 'Capture impossible', body: err.message }).show();
    }
  }
}

// ---------------------------------------------------------------------------
// Menu contextuel des pages (clic droit) — absent par défaut dans un <webview>
// ---------------------------------------------------------------------------
// Construit un menu natif adapté à ce qui est sous le curseur : image (copier /
// enregistrer), lien (ouvrir / copier / télécharger), sélection (copier /
// rechercher), champ éditable (couper/copier/coller + suggestions du
// correcteur), et navigation (précédent / suivant / recharger).
// Une URL venue de la PAGE EMBARQUÉE (params.linkURL, params.srcURL) n'est pas
// digne de confiance : la page choisit ce qu'elle met dans un href. La confier
// telle quelle à shell.openExternal revient à laisser un site déclencher le
// gestionnaire de protocole de l'OS — `file://` pour ouvrir un exécutable
// local, ou n'importe quel schéma applicatif enregistré sur la machine. Les
// autres points d'entrée (openExternalHandler, popup:openExternal) filtraient
// déjà ; le menu contextuel avait été oublié.
const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
// Le téléchargement accepte en plus blob:/data:, que les pages utilisent pour
// proposer un fichier généré côté client — mais jamais file:// ni un schéma
// arbitraire.
const isDownloadableUrl = (u) =>
  typeof u === 'string' && /^(https?|blob|data):/i.test(u);

function buildGuestContextMenu(wc, params) {
  const t = [];
  const can = (flag) => Boolean(params.editFlags && params.editFlags[flag]);

  if (params.linkURL) {
    if (isWebUrl(params.linkURL)) {
      t.push({
        label: 'Ouvrir le lien dans le navigateur',
        click: () => shell.openExternal(params.linkURL),
      });
    }
    t.push({ label: "Copier l'adresse du lien", click: () => clipboard.writeText(params.linkURL) });
    if (isDownloadableUrl(params.linkURL)) {
      t.push({ label: 'Télécharger le lien…', click: () => wc.downloadURL(params.linkURL) });
    }
    t.push({ type: 'separator' });
  }

  if (params.mediaType === 'video') {
    t.push({
      label: 'Image dans l’image (mini-fenêtre)',
      click: () =>
        wc
          .executeJavaScript(
            `(() => { try { const v=document.querySelector('video'); if(v && v.requestPictureInPicture && !document.pictureInPictureElement) v.requestPictureInPicture().catch(()=>{}); } catch(e){} })()`,
            true
          )
          .catch(() => {}),
    });
    t.push({ type: 'separator' });
  }

  if (params.hasImageContents) {
    t.push({ label: "Copier l'image", click: () => wc.copyImageAt(params.x, params.y) });
    t.push({ label: "Copier l'adresse de l'image", click: () => clipboard.writeText(params.srcURL) });
    if (isDownloadableUrl(params.srcURL)) {
      t.push({ label: "Enregistrer l'image…", click: () => wc.downloadURL(params.srcURL) });
    }
    if (isWebUrl(params.srcURL)) {
      t.push({
        label: "Ouvrir l'image dans le navigateur",
        click: () => shell.openExternal(params.srcURL),
      });
    }
    t.push({ type: 'separator' });
  }

  if (params.misspelledWord) {
    for (const s of (params.dictionarySuggestions || []).slice(0, 5)) {
      t.push({ label: s, click: () => wc.replaceMisspelling(s) });
    }
    if ((params.dictionarySuggestions || []).length) t.push({ type: 'separator' });
  }

  if (params.isEditable) {
    t.push({ label: 'Annuler', enabled: can('canUndo'), click: () => wc.undo() });
    t.push({ label: 'Rétablir', enabled: can('canRedo'), click: () => wc.redo() });
    t.push({ type: 'separator' });
    t.push({ label: 'Couper', enabled: can('canCut'), click: () => wc.cut() });
    t.push({ label: 'Copier', enabled: can('canCopy'), click: () => wc.copy() });
    t.push({ label: 'Coller', enabled: can('canPaste'), click: () => wc.paste() });
    t.push({ label: 'Tout sélectionner', click: () => wc.selectAll() });
    if (params.inputFieldType === 'password') {
      t.push({ type: 'separator' });
      t.push({ label: 'Générer un mot de passe', click: () => {
        const res = vault.generatePassword({ length: 20, symbols: true });
        if (res && res.password) {
          const escaped = JSON.stringify(res.password);
          wc.executeJavaScript(
            `(() => {
              const el = document.elementFromPoint(${params.x}, ${params.y});
              let input = null;
              if (el) {
                if (el.matches('input[type=password]')) input = el;
                else if (el.closest) input = el.closest('input[type=password]');
                if (!input) {
                  let node = el;
                  for (let i = 0; i < 10 && node && !input; i++) {
                    const root = node.getRootNode ? node.getRootNode() : null;
                    if (root && root !== document && root.host) {
                      const h = root.host;
                      if (h.matches && h.matches('input[type=password]')) input = h;
                      else if (h.shadowRoot) input = h.shadowRoot.querySelector('input[type=password]');
                      node = root.host;
                    } else break;
                  }
                }
              }
              if (!input) return;
              const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${escaped});
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.focus();
              input.style.outline = '2px solid #10b981';
              input.style.outlineOffset = '1px';
              setTimeout(() => { input.style.outline = ''; }, 1800);
            })()`,
            true
          ).catch(() => {});
        }
      }});
    }
  } else if (params.selectionText && params.selectionText.trim()) {
    const sel = params.selectionText.trim();
    t.push({ label: 'Copier', click: () => wc.copy() });
    t.push({
      label: `Traduire la sélection (→ ${translateConfig.target})`,
      click: () => translateSelection(wc, sel),
    });
    t.push({ label: 'Lire à voix haute', click: () => speakText(wc, sel) });
    // Proposé uniquement s'il y a effectivement quelque chose à arrêter.
    if (speakingNow()) {
      t.push({ label: 'Arrêter la lecture', click: () => stopSpeaking() });
    }
    t.push({
      label: `Rechercher « ${sel.length > 40 ? sel.slice(0, 40) + '…' : sel} »`,
      click: () => shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(sel)),
    });
  }

  // Historique : compatible avec l'ancienne API (wc.canGoBack) ET la nouvelle
  // (wc.navigationHistory) selon la version d'Electron.
  const nav = wc.navigationHistory;
  const canBack = nav?.canGoBack ? nav.canGoBack() : wc.canGoBack?.() || false;
  const canFwd = nav?.canGoForward ? nav.canGoForward() : wc.canGoForward?.() || false;
  const goBack = () => (nav?.goBack ? nav.goBack() : wc.goBack?.());
  const goForward = () => (nav?.goForward ? nav.goForward() : wc.goForward?.());

  if (t.length) t.push({ type: 'separator' });
  // Téléchargement média de la page (yt-dlp) : YouTube, Facebook, etc.
  if (!params.isEditable) {
    const pageUrl = params.pageURL || wc.getURL();
    t.push({ label: 'Télécharger la vidéo', click: () => startMediaDownload(pageUrl, 'video') });
    t.push({ label: 'Télécharger l’audio', click: () => startMediaDownload(pageUrl, 'audio') });
    t.push({ type: 'separator' });
    // Lecture vocale / traduction de la page entière (utile sans sélection)
    t.push({ label: 'Lire la page à voix haute', click: () => speakPage(wc) });
    if (speakingNow()) {
      t.push({ label: 'Arrêter la lecture', click: () => stopSpeaking() });
    }
    t.push({ type: 'separator' });
  }
  // Capture d'écran : toujours proposée (même dans un champ de saisie)
  t.push({
    label: "Capture d'écran",
    submenu: [
      { label: 'Zone visible', click: () => captureGuestPage(wc, 'visible') },
      { label: 'Page entière', click: () => captureGuestPage(wc, 'full') },
      { label: 'Sélection…', click: () => captureGuestPage(wc, 'selection') },
    ],
  });
  t.push({ type: 'separator' });
  t.push({ label: 'Précédent', enabled: canBack, click: goBack });
  t.push({ label: 'Suivant', enabled: canFwd, click: goForward });
  t.push({ label: 'Recharger', click: () => wc.reload() });
  t.push({ label: "Copier l'adresse de la page", click: () => clipboard.writeText(wc.getURL()) });
  if (isDev) {
    t.push({ type: 'separator' });
    t.push({ label: 'Inspecter', click: () => wc.inspectElement(params.x, params.y) });
  }

  return Menu.buildFromTemplate(t);
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

    // Cookies à PRÉFIXE (__Host- / __Secure-) : le navigateur impose des
    // règles strictes, et les VIOLER fait REJETER le cookie à la réécriture
    // → session détruite (c'était la vraie cause du « GitHub → 404 après
    // connexion » : __Host-user_session_same_site réécrit avec un attribut
    // Domain → rejeté → déconnexion). Beaucoup de sites modernes utilisent
    // ces préfixes pour leur cookie de session.
    //   • __Host- : DOIT être host-only (AUCUN attribut Domain), Path=/, Secure
    //   • __Secure- : DOIT être Secure
    const name = current.name || '';
    const isHostPrefix = name.startsWith('__Host-');
    const isSecurePrefix = name.startsWith('__Secure-');

    const setParams = {
      url: cookieSetUrl(current),
      name,
      // Valeur COURANTE (la plus récente), jamais la valeur capturée
      value: current.value,
      path: isHostPrefix ? '/' : current.path || '/',
      secure: isHostPrefix || isSecurePrefix ? true : current.secure,
      httpOnly: current.httpOnly,
      sameSite: current.sameSite,
      expirationDate: FAR_FUTURE(),
    };

    // On ne pose l'attribut Domain QUE pour les cookies non-__Host-.
    // SANS le point initial : Electron normalise déjà le domaine en lui
    // ajoutant le point (sinon '.github.com' → '..github.com' → invalide
    // → le cookie existant est SUPPRIMÉ et le nouveau n'est pas posé →
    // session perdue pendant la 2FA → boucle login !)
    // Cookie HOST-ONLY (posé sans attribut Domain) : Electron le renvoie avec
    // un domaine SANS point initial. Lui remettre un `domain` le transforme en
    // cookie de domaine (.exemple.com), qui ne remplace donc PAS l'original :
    // le navigateur se retrouve avec DEUX cookies de même nom et en envoie
    // deux dans l'en-tête Cookie. Beaucoup de serveurs prennent alors le
    // mauvais (ou rejettent la requête) → déconnexion apparemment aléatoire,
    // typiquement quand l'app repasse au premier plan et rejoue ses requêtes.
    // On ne pose donc `domain` que pour un VRAI cookie de domaine (point
    // initial), et sans ce point (Electron le rajoute lui-même ; '.github.com'
    // deviendrait '..github.com' → invalide → cookie existant supprimé et
    // nouveau rejeté → session perdue pendant la 2FA → boucle login).
    const rawDomain = current.domain || '';
    if (!isHostPrefix && rawDomain.startsWith('.')) {
      setParams.domain = rawDomain.slice(1);
    }

    await ses.cookies.set(setParams);
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

// Durcissement commun à TOUS les <webview> d'Orbit (fenêtre principale comme
// fenêtres secondaires) : sandbox, preload KeePassXC, contournement des
// en-têtes, extensions et cookies persistants pour la partition visée.
// On mémorise aussi la partition de chaque guest — indispensable pour ouvrir
// un pop-up dans la MÊME session que l'app d'origine.
let pendingGuestPartition = null;
const guestPartitions = new Map();

function hardenWebviewAttach(event, webPreferences, params) {
    // Durcir le guest
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // Garder les apps ACTIVES même quand la fenêtre est masquée/minimisée
    // (sinon Chromium gèle les timers/polling → plus de notifications quand
    // Orbit est caché, ex. via le raccourci global).
    webPreferences.backgroundThrottling = false;

    // Preload de détection/remplissage des identifiants (KeePassXC).
    // Injecté ici (le main process connaît __dirname ; les preloads
    // sandboxés, eux, n'y ont pas accès).
    webPreferences.preload = path.join(__dirname, 'credentials-preload.cjs');

    // Appliquer le contournement X-Frame-Options à la partition du webview
    // (chaque profil utilise sa propre partition → cookies séparés)
    const partition = (params && params.partition) || 'persist:default';
    if (partition !== 'default') {
      try {
        const pSes = session.fromPartition(partition);
        setupHeaderBypass(pSes);
        setupPermissions(pSes);
        setupDownloads(pSes);
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
    pendingGuestPartition = partition;
}

// Associe un <webview> à sa partition : sans ça, un pop-up ouvert depuis
// l'app ne saurait pas dans quel « coffre à cookies » se placer.
function rememberGuestPartition(guestContents) {
  if (!guestContents || pendingGuestPartition === null) return;
  const partition = pendingGuestPartition;
  pendingGuestPartition = null;
  guestPartitions.set(guestContents.id, partition);
  guestContents.once('destroyed', () => guestPartitions.delete(guestContents.id));
}

// Style des fenêtres secondaires, choisi dans Paramètres → Apparence :
//   'orbit'    → habillage Orbit (coins arrondis, en-tête épuré)
//   'native'   → fenêtre décorée par le système
//   'external' → navigateur par défaut
let popupStyle = 'orbit';
// Thème/accent poussés par l'interface pour habiller les pop-ups à l'identique
let popupTheme = { theme: 'dark', accent: '#6366f1' };
const orbitPopups = new Set();

ipcMain.handle('popup:setStyle', (_e, payload) => {
  if (payload && typeof payload.style === 'string') popupStyle = payload.style;
  if (payload && payload.theme) popupTheme.theme = payload.theme;
  if (payload && payload.accent) popupTheme.accent = payload.accent;
  return { success: true };
});

// La fenêtre appelante d'un contrôle de pop-up (fermer, réduire…)
const senderWindow = (event) => BrowserWindow.fromWebContents(event.sender);
ipcMain.handle('popup:close', (e) => {
  senderWindow(e)?.close();
  return { success: true };
});
ipcMain.handle('popup:minimize', (e) => {
  senderWindow(e)?.minimize();
  return { success: true };
});
ipcMain.handle('popup:maximize', (e) => {
  const win = senderWindow(e);
  if (win) (win.isMaximized() ? win.unmaximize() : win.maximize());
  return { success: true };
});
ipcMain.handle('popup:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  return { success: true };
});

// Fenêtre secondaire habillée par Orbit : cadre sans décoration système, coins
// arrondis, en-tête maison, et à l'intérieur un <webview> branché sur la MÊME
// partition que l'app d'origine (sans quoi la connexion échoue).
function createOrbitPopup(url, partition) {
  const parentBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const width = 920;
  const height = 720;
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 420,
    minHeight: 360,
    // Centrée sur la fenêtre principale : la pop-up « sort » visuellement d'Orbit
    ...(parentBounds
      ? {
          x: Math.round(parentBounds.x + (parentBounds.width - width) / 2),
          y: Math.round(parentBounds.y + (parentBounds.height - height) / 2),
        }
      : {}),
    parent: mainWindow,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Une pop-up transparente ne doit pas peindre avant d'être habillée :
    // sans ça, un rectangle noir apparaît le temps du premier rendu.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'popup-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: true,
    },
  });

  win.webContents.on('will-attach-webview', hardenWebviewAttach);
  win.webContents.on('did-attach-webview', (_event, guestContents) => {
    rememberGuestPartition(guestContents);
    // Menu contextuel natif dans la pop-up aussi (copier un lien, coller un
    // mot de passe…) — absent par défaut dans un <webview>.
    // Les pop-ups n'hébergent pas l'interface d'Orbit : menu natif.
    guestContents.on('context-menu', (_e, params) => {
      showGuestContextMenu(guestContents, params, win);
    });
  });

  // L'UI de la pop-up elle-même n'ouvre jamais de fenêtre : tout window.open
  // venant de son <webview> repasse par le gestionnaire global.
  win.webContents.setWindowOpenHandler(openExternalHandler);

  win.loadFile(path.join(__dirname, 'popup.html'), {
    query: {
      url,
      partition: partition || '',
      theme: popupTheme.theme,
      accent: popupTheme.accent,
    },
  });
  win.once('ready-to-show', () => win.show());
  orbitPopups.add(win);
  win.on('closed', () => orbitPopups.delete(win));
  return win;
}

// Popup d'une app embarquée (OAuth Google, connexion, target=_blank…) →
// s'ouvre DANS Orbit, dans une fenêtre qui PARTAGE la session du webview.
// Sans ça, la connexion partait dans le navigateur système et les cookies
// n'arrivaient jamais dans l'app → impossible de se connecter.
function openInAppPopup(guestContents, url) {
  const from = hostOf(guestContents.getURL());
  const blank = !url || url === 'about:blank' || url === 'about:blank#blocked';

  // Fenêtre VIDE pilotée ensuite par la page qui l'ouvre — le schéma classique
  // de `const w = window.open(); w.location = …`. La refuser rendait le bouton
  // inerte, sans le moindre message. Elle doit rester une vraie fenêtre
  // Electron : l'ouvrant garde ainsi son `window.opener` et peut la piloter,
  // ce que notre habillage maison ne permet pas.
  if (blank) {
    permLog(`fenêtre vide demandée par ${from} — ouverte, pilotée par la page`);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: mainWindow,
        width: 920,
        height: 720,
        autoHideMenuBar: true,
        backgroundColor: '#0a0a0f',
        webPreferences: {
          session: guestContents.session,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          spellcheck: true,
          preload: path.join(__dirname, 'credentials-preload.cjs'),
        },
      },
    };
  }

  if (!(url.startsWith('http://') || url.startsWith('https://'))) {
    permLog(`fenêtre refusée pour ${from} — schéma non géré (${String(url).slice(0, 24)}…)`);
    return { action: 'deny' };
  }

  if (popupStyle === 'external') {
    permLog(`fenêtre ${hostOf(url)} demandée par ${from} — navigateur externe`);
    shell.openExternal(url);
    return { action: 'deny' };
  }

  if (popupStyle === 'orbit') {
    permLog(`fenêtre ${hostOf(url)} demandée par ${from} — habillage Orbit`);
    // On refuse la fenêtre par défaut d'Electron pour construire la nôtre,
    // habillée, avec la partition de l'app d'origine.
    createOrbitPopup(url, guestPartitions.get(guestContents.id));
    return { action: 'deny' };
  }

  permLog(`fenêtre ${hostOf(url)} demandée par ${from} — fenêtre système`);

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
        preload: path.join(__dirname, 'credentials-preload.cjs'),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Portail captif (Wi-Fi public : hôtel, aéroport, MikroTik…)
// ---------------------------------------------------------------------------
// On teste une URL « témoin » qui DOIT répondre 204 (vide). Si le réseau la
// détourne (redirection / page HTML), c'est qu'un portail exige une connexion
// → on ouvre sa page de login dans une petite fenêtre, sans quitter Orbit.
let captiveWindow = null;
let captiveWatchTimer = null;

async function detectCaptivePortal() {
  const urls = [
    'http://www.gstatic.com/generate_204',
    'http://connectivitycheck.gstatic.com/generate_204',
  ];
  for (const url of urls) {
    try {
      const res = await net.fetch(url, { redirect: 'follow', cache: 'no-store' });
      if (res.status === 204) return { portal: false };
      // Réponse inattendue (redirection suivie / page HTML) → portail captif.
      return { portal: true, url: res.url || url };
    } catch {
      // Erreur réseau → soit hors-ligne, soit URL bloquée : on tente la suivante
    }
  }
  return { portal: false, offline: true };
}

function watchCaptiveResolved() {
  clearInterval(captiveWatchTimer);
  captiveWatchTimer = setInterval(async () => {
    const r = await detectCaptivePortal();
    if (!r.portal) {
      clearInterval(captiveWatchTimer);
      captiveWatchTimer = null;
      if (captiveWindow && !captiveWindow.isDestroyed()) captiveWindow.close();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('orbit:captive', { detected: false });
      }
    }
  }, 4000);
}

function openCaptivePortalWindow(url) {
  if (captiveWindow && !captiveWindow.isDestroyed()) {
    captiveWindow.show();
    captiveWindow.focus();
    return;
  }
  captiveWindow = new BrowserWindow({
    width: 480,
    height: 660,
    parent: mainWindow || undefined,
    title: 'Connexion au réseau Wi-Fi',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      // Session dédiée non persistée : le portail ne pollue pas les sessions
      // des apps, et ses cookies éphémères disparaissent ensuite.
      partition: 'captive-portal',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  captiveWindow.loadURL(url).catch(() => {});
  captiveWindow.on('closed', () => {
    captiveWindow = null;
  });
  // Referme automatiquement dès que la connexion passe (portail validé).
  watchCaptiveResolved();
}

function createWindow() {
  // Restaure la taille/position de la dernière session (si toujours visible)
  const saved = loadWindowState();
  const defaultBounds = { width: 1400, height: 900 };
  const restored =
    saved && saved.width && saved.height && isBoundsVisible(saved)
      ? { width: saved.width, height: saved.height, x: saved.x, y: saved.y }
      : defaultBounds;

  // Icône de la fenêtre en nativeImage (et NON un chemin) : un chemin dans
  // app.asar n'est pas lisible par la couche X11/GTK → _NET_WM_ICON reste vide
  // et la barre des tâches n'affiche aucune icône.
  const appIcon = nativeImage.createFromPath(resourcePath('build/icon.png'));

  mainWindow = new BrowserWindow({
    ...restored,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    // Icône de la fenêtre (Linux/Windows)
    ...(process.platform !== 'darwin' && !appIcon.isEmpty() ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // nécessaire pour afficher les apps dans la fenêtre
      spellcheck: true,
    },
  });

  // Renforce _NET_WM_ICON (barre des tâches / liste des fenêtres sous Linux)
  if (process.platform !== 'darwin' && !appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

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
  // Plein écran : prévient le renderer pour masquer barres et sidebar (F11)
  mainWindow.on('enter-full-screen', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('window:fullscreen-changed', false);
  });
  mainWindow.on('close', (e) => {
    // Fermer-vers-le-tray : on masque au lieu de quitter (sauf « Quitter » réel).
    // Filet de sécurité : on ne masque QUE si le tray existe ET est vivant.
    // Un tray cassé (échec de création, hôte SNI indisponible…) rendrait la
    // fenêtre INACCESSIBLE (aucun moyen de la rouvrir) — dans ce cas, on quitte
    // plutôt que de piéger l'utilisateur.
    const trayAlive = Boolean(tray && !tray.isDestroyed?.());
    if (!isQuitting && closeToTray && trayAlive) {
      e.preventDefault();
      mainWindow.hide();
      // Rappel des issues de secours : relancer Orbit ramène la fenêtre
      // (instance unique) et le raccourci global « afficher/masquer » marche
      // aussi quand la fenêtre est cachée.
      console.log(
        '[orbit] fenêtre masquée dans le tray — pour rouvrir : clic tray, relancer Orbit, ou raccourci global' +
          (summonAccel ? ` (${summonAccel})` : '')
      );
      if (!trayInfoShown) {
        trayInfoShown = true;
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: 'Orbit continue en arrière-plan',
              body: 'Clic sur l’icône de la barre système pour rouvrir, clic droit → Quitter.',
              icon: resourcePath('build/icon.png'),
              silent: true,
            }).show();
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const maximized = mainWindow.isMaximized();
      saveWindowState({ ...(maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()), maximized });
    }
    // Ferme les fenêtres secondaires, sinon l'app ne quitte pas (une fenêtre
    // resterait ouverte) sur Windows/Linux.
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.close();
    if (captiveWindow && !captiveWindow.isDestroyed()) captiveWindow.close();
    for (const popup of orbitPopups) {
      if (!popup.isDestroyed()) popup.close();
    }
    clearInterval(captiveWatchTimer);
  });

  // Rétablit le mode maximisé si la dernière session l'était
  if (saved && saved.maximized) {
    mainWindow.once('ready-to-show', () => mainWindow.maximize());
  }

  // window.open depuis l'UI React → navigateur système
  mainWindow.webContents.setWindowOpenHandler(openExternalHandler);

  // Sécuriser les <webview> et appliquer le bypass à leur session
  mainWindow.webContents.on('will-attach-webview', hardenWebviewAttach);


  // Raccourcis GLOBAUX : interceptés AVANT que les apps embarquées ne les
  // voient (before-input-event) → Alt+K, Alt+Page… ouvrent Orbit même quand
  // le focus est dans Gmail/Slack, et les apps gardent leurs raccourcis Ctrl.
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    // La partition vient d'être calculée dans hardenWebviewAttach (les deux
    // événements se suivent immédiatement pour un même webview).
    rememberGuestPartition(guestContents);

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

    // Filtrage cosmétique de l'adblock : masque les emplacements publicitaires
    // résiduels (cadres vides). On injecte le CSS calculé pour l'URL à chaque
    // chargement de page (insertCSS — compatible Electron 33).
    const injectCosmetics = () => {
      try {
        const styles = adblock.getCosmeticStyles(
          guestContents.getURL(),
          adblockActiveFor(guestContents.id)
        );
        if (styles) guestContents.insertCSS(styles, { cssOrigin: 'user' });
      } catch {
        /* jamais bloquant */
      }
    };
    guestContents.on('dom-ready', injectCosmetics);
    guestContents.on('did-frame-navigate', injectCosmetics);

    // Menu contextuel natif (clic droit) : copier/enregistrer une image,
    // ouvrir/copier/télécharger un lien, rechercher la sélection, couper/
    // coller dans un champ, précédent/suivant/recharger. Absent par défaut
    // dans un <webview> → on le construit et on l'affiche nous-mêmes.
    guestContents.on('context-menu', (_e, params) => {
      // Electron ne détecte pas toujours le type 'password' (Shadow DOM,
      // composants custom). On fait un probe JS rapide quand le champ est
      // éditable mais que inputFieldType n'est pas 'password'.
      if (params.isEditable && params.inputFieldType !== 'password') {
        const cx = params.x, cy = params.y;
        guestContents
          .executeJavaScript(
            `(() => {\n              try {\n                const el = document.elementFromPoint(${cx}, ${cy});\n                if (!el) return null;\n                // Light DOM direct\n                if (el.matches && el.matches('input[type="password"]')) return 'p';\n                // Shadow DOM ouvert : chercher dans le shadowRoot\n                if (el.shadowRoot) {\n                  if (el.shadowRoot.querySelector('input[type="password"]')) return 'p';\n                }\n                // Remonter les hosts Shadow DOM\n                let node = el;\n                for (let i = 0; i < 10 && node; i++) {\n                  const root = node.getRootNode ? node.getRootNode() : null;\n                  if (root && root !== document && root.host) {\n                    const h = root.host;\n                    if (h.matches && h.matches('input[type="password"]')) return 'p';\n                    if (h.shadowRoot && h.shadowRoot.querySelector('input[type="password"]')) return 'p';\n                    node = root.host;\n                  } else break;\n                }\n              } catch(e) {}\n              return null;\n            })()`,
            true
          )
          .then((r) => {
            if (r === 'p') params.inputFieldType = 'password';
            showGuestContextMenu(guestContents, params, mainWindow);
          })
          .catch(() => showGuestContextMenu(guestContents, params, mainWindow));
      } else {
        showGuestContextMenu(guestContents, params, mainWindow);
      }
    });
    guestContents.once('destroyed', () => {
      lastContextParams.delete(guestContents.id);
      forgetDialogState(guestContents.id);
    });
    // « Ne plus afficher de dialogues » ne vaut que pour la page en cours :
    // une nouvelle navigation repart d'une ardoise vierge, comme dans Chrome.
    guestContents.on('did-navigate', () => forgetDialogState(guestContents.id));

  });
}

// ---------------------------------------------------------------------------
// IPC — Lecture vocale (moteur système / Piper)
// ---------------------------------------------------------------------------
// Réservé à l'interface : installer Piper télécharge et rend exécutable un
// binaire, ce n'est pas une action qu'une page embarquée doit pouvoir demander.
handleFromUi('tts:setPrefs', (_e, { engine, voiceId } = {}) => {
  const validEngines = ['system', 'piper', 'mms-tts'];
  ttsPrefs = {
    engine: validEngines.includes(engine) ? engine : 'system',
    voiceId: String(voiceId || ''),
  };
  return { success: true };
});

// État affiché dans les réglages. Ne déclenche AUCUN téléchargement et ne
// charge le module Piper que si l'utilisateur ouvre cette section.
handleFromUi('tts:state', async () => {
  const system = { engine: tts.detectEngine(), hint: tts.missingEngineHint() };
  let piper = { installed: false, voices: [], catalog: [] };
  let mms = { installed: false };
  try {
    piper = (await loadPiper()).getState();
  } catch (err) {
    console.error('[orbit] état piper indisponible:', err.message);
  }
  try {
    mms = (await loadMms()).getState();
  } catch (err) {
    console.error('[orbit] état mms-tts indisponible:', err.message);
  }
  return { success: true, system, piper, mms, prefs: ttsPrefs };
});

// Progression envoyée à l'interface pendant les téléchargements (26 Mo pour le
// moteur, 28 à 120 Mo par voix : sans jauge, l'utilisateur croit à un blocage).
const ttsProgress = (payload) => pipeAudioToUi('orbit:tts-progress', payload);

handleFromUi('tts:installEngine', async () => {
  try {
    const piper = await loadPiper();
    await piper.install(ttsProgress);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

handleFromUi('tts:installVoice', async (_e, { id } = {}) => {
  try {
    const piper = await loadPiper();
    await piper.installVoice(id, ttsProgress);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

handleFromUi('tts:removeVoice', async (_e, { id } = {}) => (await loadPiper()).removeVoice(id));
handleFromUi('tts:uninstall', async () => (await loadPiper()).uninstall());

// MMS-TTS Malagasy : téléchargement du modèle (~250 Mo).
handleFromUi('tts:installMms', async () => {
  try {
    const mms = await loadMms();
    // Le modèle est téléchargé au premier appel de synthesize().
    // On force un téléchargement préventif ici.
    await mms.synthesize('Manao aho', {
      onProgress: (p) => mainWindow?.webContents?.send('orbit:tts-progress', p),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

handleFromUi('tts:uninstallMms', async () => {
  try {
    const mms = await loadMms();
    return mms.uninstall();
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// Essai de voix depuis les réglages, sans passer par une page.
handleFromUi('tts:preview', async (_e, { text } = {}) => {
  const sample = String(text || 'Bonjour, voici un aperçu de cette voix.');
  stopSpeaking();
  if (ttsPrefs.engine === 'piper' && ttsPrefs.voiceId) return speakWithPiper(sample);
  if (ttsPrefs.engine === 'mms-tts') return speakWithMms(sample);
  return tts.speak(sample, { lang: (translateConfig.target || 'fr').slice(0, 2) });
});

handleFromUi('tts:stop', () => {
  stopSpeaking();
  return { success: true };
});

// ---------------------------------------------------------------------------
// Menu contextuel dessiné par l'interface (au lieu du menu natif)
// ---------------------------------------------------------------------------
// Un Menu natif Electron ne se met pas en forme : impossible d'y placer une
// rangée d'icônes, des sections, ou le style d'Orbit. On envoie donc la
// description du clic à l'interface, qui dessine le menu en HTML — et on garde
// le menu natif en repli (réglage, ou fenêtre sans interface Orbit, ou erreur).
//
// SÉCURITÉ : les URL ne font PAS l'aller-retour. L'interface ne renvoie que le
// nom d'une action ; le processus principal relit les paramètres qu'il a lui-
// même mémorisés. Une interface compromise ne peut donc pas faire ouvrir une
// adresse de son choix — c'est le même raisonnement que pour `credentials:*`.
const lastContextParams = new Map(); // webContentsId -> params

let useCustomContextMenu = true;
ipcMain.handle('ctx:setMode', (_e, { custom } = {}) => {
  useCustomContextMenu = custom !== false;
  return { success: true };
});

// Texte affichable : une sélection peut peser plusieurs mégaoctets, l'interface
// n'a besoin que d'un aperçu pour composer ses libellés.
const preview = (text, max = 60) => {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t;
};

function contextMenuState(wc, params) {
  const nav = wc.navigationHistory;
  const selection = String(params.selectionText || '').trim();
  return {
    wcId: wc.id,
    x: params.x,
    y: params.y,
    zoom: (() => {
      try {
        return wc.getZoomFactor();
      } catch {
        return 1;
      }
    })(),
    isEditable: Boolean(params.isEditable),
    canCopy: Boolean(params.editFlags?.canCopy),
    canCut: Boolean(params.editFlags?.canCut),
    canPaste: Boolean(params.editFlags?.canPaste),
    hasSelection: selection.length > 0,
    selectionPreview: preview(selection, 40),
    hasLink: Boolean(params.linkURL),
    linkPreview: preview(params.linkURL, 50),
    hasImage: Boolean(params.hasImageContents),
    isVideo: params.mediaType === 'video',
    misspelled: params.misspelledWord || '',
    suggestions: (params.dictionarySuggestions || []).slice(0, 5),
    canBack: nav?.canGoBack ? nav.canGoBack() : wc.canGoBack?.() || false,
    canFwd: nav?.canGoForward ? nav.canGoForward() : wc.canGoForward?.() || false,
    translateTarget: translateConfig.target || 'fr',
    speaking: speakingNow(),
    isDev,
    isPasswordField: params.inputFieldType === 'password',
  };
}

// Affiche le menu : interface si possible, natif sinon. Renvoie true si
// l'interface a été sollicitée.
function showGuestContextMenu(guestContents, params, ownerWindow) {
  const custom =
    useCustomContextMenu &&
    ownerWindow === mainWindow &&
    mainWindow &&
    !mainWindow.isDestroyed();
  if (custom) {
    try {
      lastContextParams.set(guestContents.id, params);
      mainWindow.webContents.send('orbit:context-menu', contextMenuState(guestContents, params));
      return true;
    } catch (err) {
      console.error('[orbit] menu contextuel (interface) échoué:', err);
    }
  }
  try {
    buildGuestContextMenu(guestContents, params).popup({ window: ownerWindow });
  } catch (err) {
    console.error('[orbit] menu contextuel natif échoué:', err);
  }
  return false;
}

handleFromUi('ctx:action', (_event, { wcId, action, value } = {}) => {
  const wc = webContents.fromId(Number(wcId));
  const params = lastContextParams.get(Number(wcId));
  if (!wc || wc.isDestroyed() || !params) return { success: false, error: 'stale' };

  const nav = wc.navigationHistory;
  const pageUrl = params.pageURL || wc.getURL();

  switch (action) {
    case 'back':
      nav?.goBack ? nav.goBack() : wc.goBack?.();
      break;
    case 'forward':
      nav?.goForward ? nav.goForward() : wc.goForward?.();
      break;
    case 'reload':
      wc.reload();
      break;
    case 'copyPageUrl':
      clipboard.writeText(pageUrl);
      break;
    case 'copy':
      wc.copy();
      break;
    case 'cut':
      // Notre menu contextuel est une fenêtre React : afficher/cliquer lui a
      // retiré le focus. On le rend au webview AVANT toute action d'édition,
      // sinon cut/paste/remplacement agissent sur un champ « qui n'a plus le
      // curseur » et ne font rien.
      wc.focus();
      wc.cut();
      break;
    case 'paste':
      wc.focus();
      wc.paste();
      break;
    case 'selectAll':
      wc.focus();
      wc.selectAll();
      break;
    case 'replaceMisspelling':
      // On n'accepte que les suggestions que le correcteur a lui-même fournies.
      if ((params.dictionarySuggestions || []).includes(value)) {
        wc.focus();
        wc.replaceMisspelling(value);
      }
      break;
    case 'openLink':
      if (isWebUrl(params.linkURL)) shell.openExternal(params.linkURL);
      break;
    case 'copyLink':
      if (params.linkURL) clipboard.writeText(params.linkURL);
      break;
    case 'downloadLink':
      if (isDownloadableUrl(params.linkURL)) wc.downloadURL(params.linkURL);
      break;
    case 'copyImage':
      wc.copyImageAt(params.x, params.y);
      break;
    case 'copyImageUrl':
      if (params.srcURL) clipboard.writeText(params.srcURL);
      break;
    case 'saveImage':
      if (isDownloadableUrl(params.srcURL)) wc.downloadURL(params.srcURL);
      break;
    case 'openImage':
      if (isWebUrl(params.srcURL)) shell.openExternal(params.srcURL);
      break;
    case 'translate':
      if (params.selectionText) translateSelection(wc, params.selectionText.trim());
      break;
    case 'speakSelection':
      if (params.selectionText) speakText(wc, params.selectionText.trim());
      break;
    case 'speakPage':
      speakPage(wc);
      break;
    case 'stopSpeak':
      stopSpeaking();
      break;
    case 'search':
      if (params.selectionText) {
        shell.openExternal(
          'https://www.google.com/search?q=' + encodeURIComponent(params.selectionText.trim())
        );
      }
      break;
    case 'downloadVideo':
      startMediaDownload(pageUrl, 'video');
      break;
    case 'downloadAudio':
      startMediaDownload(pageUrl, 'audio');
      break;
    case 'screenshot':
      captureGuestPage(wc, value === 'full' || value === 'selection' ? value : 'visible');
      break;
    case 'pip':
      wc
        .executeJavaScript(
          `(() => { try { const v=document.querySelector('video'); if(v && v.requestPictureInPicture && !document.pictureInPictureElement) v.requestPictureInPicture().catch(()=>{}); } catch(e){} })()`,
          true
        )
        .catch(() => {});
      break;
    case 'inspect':
      if (isDev) wc.inspectElement(params.x, params.y);
      break;
    case 'generatePassword': {
      // Génère un mot de passe fort et l'injecte dans le champ
      const res = vault.generatePassword({ length: 20, symbols: true });
      if (res && res.password) {
        const escaped = JSON.stringify(res.password);
        wc.executeJavaScript(
          `(() => {
            // Cherche l'input password au clic, y compris dans le Shadow DOM
            const el = document.elementFromPoint(${params.x}, ${params.y});
            let input = null;
            if (el) {
              // Light DOM direct
              if (el.matches('input[type=password]')) input = el;
              else if (el.closest) input = el.closest('input[type=password]');
              // Shadow DOM : chercher dans le root du clic puis remonter
              if (!input) {
                let node = el;
                for (let i = 0; i < 10 && node && !input; i++) {
                  const root = node.getRootNode ? node.getRootNode() : null;
                  if (root && root !== document && root.host) {
                    const h = root.host;
                    if (h.matches && h.matches('input[type=password]')) input = h;
                    else if (h.shadowRoot) input = h.shadowRoot.querySelector('input[type=password]');
                    node = root.host;
                  } else break;
                }
              }
            }
            if (!input) return;
            const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${escaped});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.focus();
            input.style.outline = '2px solid #10b981';
            input.style.outlineOffset = '1px';
            setTimeout(() => { input.style.outline = ''; }, 1800);
          })()`,
          true
        ).catch(() => {});
      }
      break;
    }
    default:
      return { success: false, error: 'unknown-action' };
  }
  return { success: true };
});

// ---------------------------------------------------------------------------
// Dialogues des pages (alert / confirm / prompt) et demandes d'autorisation
// ---------------------------------------------------------------------------
// Deux choses très différentes arrivent ici, mais elles se ressemblent à
// l'écran : la page veut poser une question, et Orbit doit y répondre avec sa
// propre fenêtre modale plutôt qu'avec la boîte grise d'Electron.
//
// Le point délicat, c'est `confirm()` et `prompt()` : la page attend une
// réponse *tout de suite*, sur la même ligne de code. Une modale dessinée par
// React arrive, elle, plusieurs millisecondes plus tard. Un pont asynchrone
// renverrait donc une promesse — toujours vraie — et `if (confirm(...))`
// serait systématiquement pris. C'est exactement ce qui rendait la première
// version inutilisable.
//
// La page est donc réellement bloquée : son preload interroge le processus
// principal en IPC *synchrone* (`sendSync`), qui répond « pas encore » par
// tranches de quelques dizaines de millisecondes jusqu'au clic de
// l'utilisateur. Le rendu de la page est figé pendant ce temps — comme dans un
// vrai navigateur — sans que le reste d'Orbit soit gelé.
// ---------------------------------------------------------------------------

// Attente courte qui ne consomme pas de CPU. `Atomics.wait` est autorisé sur le
// fil principal de Node (contrairement au navigateur).
const dialogWaitBuffer = new Int32Array(new SharedArrayBuffer(4));
function idleSlice(ms) {
  try {
    Atomics.wait(dialogWaitBuffer, 0, 0, ms);
  } catch {
    /* SharedArrayBuffer indisponible : la boucle tournera un peu plus vite */
  }
}

const POLL_SLICE_MS = 30;
const DIALOG_TIMEOUT_MS = 3 * 60 * 1000; // garde-fou : une page ne gèle pas pour toujours

// Demandes en cours : id → { kind, wcId, done, value, resolve }
const pendingPrompts = new Map();
let promptSeq = 0;

// Pages ayant reçu « ne plus afficher de dialogues » (remis à zéro à chaque
// navigation, comme le fait Chrome).
const silencedContents = new Set();
const dialogBursts = new Map(); // wcId → { count, since }

function forgetDialogState(wcId) {
  silencedContents.delete(wcId);
  dialogBursts.delete(wcId);
}

// Où afficher la modale ? Uniquement dans la fenêtre qui héberge l'interface
// d'Orbit. Une pop-up (fenêtre de connexion Google…) n'a pas cette interface :
// on renvoie null, et l'appelant retombe sur la boîte native d'Electron.
function orbitUiFor(wc) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const ui = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return null;
    if (wc.id === ui.id) return ui;
    const host = wc.hostWebContents;
    if (host && !host.isDestroyed() && host.id === ui.id) return ui;
    return null;
  } catch {
    return null;
  }
}

// L'interface accuse réception dès qu'elle affiche la modale. Sans cet accusé,
// on ne saurait pas distinguer « l'utilisateur réfléchit » de « la modale ne
// s'est jamais affichée » — et une demande de caméra restée sans réponse fait
// échouer un appel en silence, ce qui est le pire des deux mondes.
const ACK_TIMEOUT_MS = 3000;

function armAckTimeout(id, onLost) {
  const timer = setTimeout(() => {
    const entry = pendingPrompts.get(id);
    if (!entry || entry.acked || entry.done) return;
    permLog(`modale ${id} jamais affichée par l'interface — repli automatique`);
    onLost(entry);
  }, ACK_TIMEOUT_MS);
  timer.unref?.();
}

function finishPrompt(id, value) {
  const entry = pendingPrompts.get(id);
  if (!entry) return;
  entry.done = true;
  entry.value = value;
  if (entry.resolve) {
    pendingPrompts.delete(id);
    entry.resolve(value);
  }
  // Pour les dialogues JS, l'entrée reste jusqu'à ce que la page vienne
  // chercher sa réponse (`orbit-dialog:poll`).
}

// --- Dialogues JS -----------------------------------------------------------

// Ouverture : la page (via son preload) demande l'affichage et reçoit soit un
// identifiant à interroger, soit une réponse immédiate, soit « non pris en
// charge » (→ boîte native).
ipcMain.on('orbit-dialog:open', (event, payload = {}) => {
  const wc = event.sender;
  const ui = orbitUiFor(wc);
  const type = ['alert', 'confirm', 'prompt'].includes(payload.type) ? payload.type : 'alert';
  const cancelled = type === 'confirm' ? false : type === 'prompt' ? null : null;

  if (!ui) {
    permLog(`dialogue ${type} depuis ${hostOf(wc.getURL())} — pas d'interface, boîte native`);
    event.returnValue = { supported: false };
    return;
  }

  // « Ne plus afficher » coché, ou avalanche de dialogues : on répond
  // « annuler » sans rien montrer.
  if (silencedContents.has(wc.id)) {
    permLog(`dialogue ${type} depuis ${hostOf(wc.getURL())} — page mise en sourdine`);
    event.returnValue = { supported: true, done: true, value: cancelled };
    return;
  }

  const now = Date.now();
  const burst = dialogBursts.get(wc.id);
  if (!burst || now - burst.since > 20000) dialogBursts.set(wc.id, { count: 1, since: now });
  else burst.count += 1;
  const repeated = (dialogBursts.get(wc.id) || {}).count > 2;

  const id = `d${++promptSeq}`;
  pendingPrompts.set(id, { kind: 'js', wcId: wc.id, done: false, value: cancelled });
  ui.send('orbit:web-dialog', {
    id,
    kind: 'js',
    type,
    wcId: wc.id,
    origin: hostOf(wc.getURL()),
    message: String(payload.message || '').slice(0, 4000),
    defaultText: String(payload.defaultText || '').slice(0, 4000),
    // Au 3e dialogue d'affilée, on propose la case « ne plus afficher »,
    // comme un navigateur face à une page qui s'emballe.
    offerSilence: repeated,
  });
  permLog(`dialogue ${type} depuis ${hostOf(wc.getURL())} → modale ${id}`);
  armAckTimeout(id, () => finishPrompt(id, cancelled));
  event.returnValue = { supported: true, id };
});

// Attente : réponse « pas encore » par tranches courtes, jusqu'au clic.
ipcMain.on('orbit-dialog:poll', (event, id) => {
  const entry = pendingPrompts.get(id);
  if (!entry || entry.wcId !== event.sender.id) {
    event.returnValue = null;
    return;
  }
  if (!entry.done) idleSlice(POLL_SLICE_MS);
  if (entry.done) {
    pendingPrompts.delete(id);
    event.returnValue = { done: true, value: entry.value };
    return;
  }
  event.returnValue = { done: false };
});

// La page renonce (garde-fou de 3 minutes atteint).
ipcMain.on('orbit-dialog:drop', (event, id) => {
  const entry = pendingPrompts.get(id);
  if (entry && entry.wcId === event.sender.id) {
    pendingPrompts.delete(id);
    const ui = orbitUiFor(event.sender);
    if (ui) ui.send('orbit:web-dialog-close', { id });
  }
  event.returnValue = true;
});

// --- Autorisations ----------------------------------------------------------

// Demande à l'utilisateur. Résout `true`/`false`, ou `null` quand aucune
// interface ne peut poser la question (pop-up) — l'appelant applique alors sa
// politique par défaut.
function askPermission(wc, permission, origin, extra = {}) {
  const ui = orbitUiFor(wc);
  if (!ui) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = `p${++promptSeq}`;
    pendingPrompts.set(id, {
      kind: 'permission',
      wcId: wc ? wc.id : 0,
      done: false,
      resolve,
      origin,
      permission,
    });
    ui.send('orbit:web-dialog', {
      id,
      kind: 'permission',
      type: 'permission',
      wcId: wc ? wc.id : 0,
      permission,
      origin,
      ...extra,
    });
    // Modale jamais affichée : on rend la main à la politique par défaut
    // (`null`) au lieu de laisser l'appel se figer.
    armAckTimeout(id, () => {
      pendingPrompts.delete(id);
      resolve(null);
    });
    // Affichée mais laissée sans réponse pendant 2 minutes : on refuse — c'est
    // le choix sûr — et on ne mémorise rien.
    setTimeout(() => {
      if (pendingPrompts.has(id)) {
        pendingPrompts.delete(id);
        if (ui && !ui.isDestroyed()) ui.send('orbit:web-dialog-close', { id });
        resolve(false);
      }
    }, 2 * 60 * 1000).unref?.();
  });
}

// --- Réponse de l'interface -------------------------------------------------

handleFromUi('orbit-dialog:answer', (_event, { id, value, allowed, remember, silence } = {}) => {
  const entry = pendingPrompts.get(id);
  if (!entry) return { success: false, error: 'inconnu' };
  if (entry.kind === 'permission') {
    permLog(
      `réponse ${id} — ${entry.permission} sur ${entry.origin} : ` +
        `${allowed ? 'autorisé' : 'bloqué'}${remember ? ' (mémorisé)' : ''}`
    );
    // « Retenir mon choix » : la décision vaudra pour tout ce site, jusqu'à ce
    // qu'elle soit oubliée depuis Paramètres → Autorisations des sites.
    if (remember) sitePermissions.remember(entry.origin, entry.permission, !!allowed);
    finishPrompt(id, !!allowed);
    return { success: true };
  }
  permLog(`réponse ${id} — dialogue${silence ? ' + mise en sourdine' : ''}`);
  if (silence) silencedContents.add(entry.wcId);
  finishPrompt(id, value === undefined ? null : value);
  return { success: true };
});

handleFromUi('orbit-dialog:ack', (_event, { id } = {}) => {
  const entry = pendingPrompts.get(id);
  if (entry) entry.acked = true;
  permLog(`modale ${id} affichée${entry ? '' : ' (demande déjà close)'}`);
  return { success: true };
});

handleFromUi('permissions:remember', (_event, { origin, permission, allowed } = {}) => {
  sitePermissions.remember(origin, permission, allowed);
  return { success: true };
});
handleFromUi('permissions:list', () => ({ success: true, mode: sitePermissions.getMode(), sites: sitePermissions.list() }));
handleFromUi('permissions:setMode', (_event, mode) => sitePermissions.setMode(mode));
handleFromUi('permissions:forget', (_event, { origin, permission } = {}) =>
  origin ? sitePermissions.forget(origin, permission) : sitePermissions.forgetAll()
);

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

// Plein écran : bascule + état courant (F11 côté renderer)
ipcMain.handle('window:toggleFullscreen', () => {
  if (!mainWindow) return { success: false };
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return { success: true, fullscreen: mainWindow.isFullScreen() };
});
ipcMain.handle('window:getFullscreen', () => {
  return { success: true, fullscreen: mainWindow ? mainWindow.isFullScreen() : false };
});

// Barre système : fermer-vers-le-tray + raccourci global d'invocation
ipcMain.handle('tray:setCloseToTray', (_e, enabled) => {
  closeToTray = enabled !== false;
  return { success: true };
});
ipcMain.handle('tray:setSummonHotkey', (_e, accelerator) => setSummonHotkey(accelerator || null));

// ---------------------------------------------------------------------------
// Notifications système (messages non lus des apps)
// ---------------------------------------------------------------------------
ipcMain.handle('notifications:show', (_event, { title, body, appId, silent } = {}) => {
  if (!Notification.isSupported()) return { success: false };
  try {
    const notif = new Notification({
      title: title || 'Orbit',
      body: body || '',
      icon: resourcePath('build/icon.png'),
      // Son perso joué côté renderer → on coupe le son système pour éviter le doublon
      silent: silent === true,
    });

    // Clic sur la notification → Orbit revient au premier plan ET ouvre l'app
    // qui l'a émise. La sélection de l'app se fait côté React via IPC.
    notif.on('click', () => {
      showMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (appId) mainWindow.webContents.send('orbit:activate-app', appId);
    });

    // Garder la notification EN VIE jusqu'à sa fermeture. Sans cette référence,
    // l'objet devient éligible au ramasse-miettes dès la fin de ce handler :
    // la notification reste affichée par le système, mais l'objet JS qui porte
    // le gestionnaire 'click' peut disparaître → « je clique sur la
    // notification et rien ne s'ouvre ». C'est la cause la plus fréquente des
    // clics de notification sans effet dans Electron.
    keepNotificationAlive(notif);

    notif.show();
    return { success: true };
  } catch (err) {
    console.error('[orbit] notification failed:', err);
    return { success: false };
  }
});

// Badge de la fenêtre (dock macOS / Unity) = total de messages non lus
ipcMain.handle('notifications:setBadge', (_event, count) => {
  try {
    const n = Math.max(0, count || 0);
    if (typeof app.setBadgeCount === 'function') {
      app.setBadgeCount(n);
    }
    // Infobulle du tray = nombre de messages non lus
    if (tray && !tray.isDestroyed?.()) {
      tray.setToolTip(n > 0 ? `Orbit — ${n} non lu${n > 1 ? 's' : ''}` : 'Orbit');
    }
    return { success: true };
  } catch (err) {
    console.error('[orbit] badge failed:', err);
    return { success: false };
  }
});

// ---------------------------------------------------------------------------
// Mini-lecteur flottant (toujours au-dessus) — pour l'audio surtout
// ---------------------------------------------------------------------------
// Petite fenêtre épinglée par-dessus les autres apps, avec pochette + contrôles.
// Elle ne pilote PAS le média elle-même : elle relaie ses actions à la fenêtre
// principale (qui possède les <webview>) et affiche l'état qu'on lui pousse.
let miniPlayerWindow = null;

const miniPlayerStateFile = () => path.join(app.getPath('userData'), 'miniplayer-state.json');
function loadMiniPlayerState() {
  try {
    return JSON.parse(fs.readFileSync(miniPlayerStateFile(), 'utf8'));
  } catch {
    return null;
  }
}
let mpSaveTimer = null;
function persistMiniPlayerPos() {
  clearTimeout(mpSaveTimer);
  mpSaveTimer = setTimeout(() => {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    const b = miniPlayerWindow.getBounds();
    try {
      fs.writeFileSync(miniPlayerStateFile(), JSON.stringify({ x: b.x, y: b.y }));
    } catch {
      /* ignore */
    }
  }, 400);
}

function createMiniPlayer() {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.show();
    miniPlayerWindow.focus();
    return;
  }
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const width = 340;
  const height = 108;
  // Position mémorisée si toujours visible, sinon coin bas-droite par défaut.
  const saved = loadMiniPlayerState();
  const pos =
    saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && isBoundsVisible({ ...saved, width, height })
      ? { x: saved.x, y: saved.y }
      : { x: wa.x + wa.width - width - 20, y: wa.y + wa.height - height - 20 };
  miniPlayerWindow = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'miniplayer-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  miniPlayerWindow.setAlwaysOnTop(true, 'floating');
  miniPlayerWindow.loadFile(path.join(__dirname, 'miniplayer.html'));
  miniPlayerWindow.once('ready-to-show', () => {
    miniPlayerWindow.show();
    // Demande à la fenêtre principale de pousser l'état courant
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('orbit:mp:request-state');
    }
  });
  miniPlayerWindow.on('move', persistMiniPlayerPos);
  miniPlayerWindow.on('closed', () => {
    miniPlayerWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Ressources système (widget « moniteur » de l'en-tête)
// ---------------------------------------------------------------------------
// Le pourcentage CPU se calcule sur la DIFFÉRENCE entre deux relevés : une
// lecture isolée de os.cpus() donne le cumul depuis le démarrage, pas la
// charge actuelle.
let lastCpuSample = null;

function cpuTotals() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

ipcMain.handle('system:stats', () => {
  const sample = cpuTotals();
  let cpu = null;
  if (lastCpuSample) {
    const dTotal = sample.total - lastCpuSample.total;
    const dIdle = sample.idle - lastCpuSample.idle;
    if (dTotal > 0) cpu = Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100));
  }
  lastCpuSample = sample;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cpu,
    cores: os.cpus().length,
    memUsed: totalMem - freeMem,
    memTotal: totalMem,
    uptime: os.uptime(),
    platform: process.platform,
  };
});

ipcMain.handle('miniplayer:open', () => {
  createMiniPlayer();
  return { success: true };
});

// Touches média globales (⏯ ⏭ ⏮) — option. Quand activées, elles pilotent
// l'app « en lecture » même quand Orbit n'a pas le focus. Désactivées par
// défaut (pour ne pas voler les touches à un lecteur natif).
const MEDIA_KEY_MAP = {
  MediaPlayPause: 'playpause',
  MediaNextTrack: 'next',
  MediaPreviousTrack: 'prev',
};
function setMediaKeys(enabled) {
  for (const accel of Object.keys(MEDIA_KEY_MAP)) {
    try {
      globalShortcut.unregister(accel);
    } catch {
      /* ignore */
    }
  }
  if (!enabled) return { success: true, enabled: false };
  for (const [accel, action] of Object.entries(MEDIA_KEY_MAP)) {
    try {
      globalShortcut.register(accel, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('orbit:media-key', action);
        }
      });
    } catch {
      /* certaines plateformes ne supportent pas ces touches */
    }
  }
  return { success: true, enabled: true };
}
ipcMain.handle('mediakeys:setEnabled', (_e, on) => setMediaKeys(on));

// État poussé par la fenêtre principale → relayé au mini-lecteur
ipcMain.handle('miniplayer:state', (_e, state) => {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('orbit:mp:state', state || null);
  }
  return { success: true };
});

// Action du mini-lecteur → relayée à la fenêtre principale (qui pilote le média)
ipcMain.handle('miniplayer:action', (_e, action = {}) => {
  if (action.type === 'close') {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.close();
    return { success: true };
  }
  if (action.type === 'goto') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('orbit:mp:action', action);
  }
  return { success: true };
});

// ---------------------------------------------------------------------------
// IPC — Bloqueur de pub
// ---------------------------------------------------------------------------
ipcMain.handle('adblock:setEnabled', (_e, on) => adblock.setEnabled(on));
ipcMain.handle('adblock:getState', () => adblock.getState());

// Config de traduction (langue cible + moteur Google/LibreTranslate)
ipcMain.handle('translate:setConfig', (_e, cfg = {}) => {
  translateConfig = {
    target: String(cfg.target || translateConfig.target || 'fr').slice(0, 8),
    engine: cfg.engine === 'libretranslate' ? 'libretranslate' : 'google',
    url: String(cfg.url || ''),
    apiKey: String(cfg.apiKey || ''),
  };
  return { success: true };
});

// ---------------------------------------------------------------------------
// IPC — Verrouillage / sécurité
// ---------------------------------------------------------------------------
ipcMain.handle('security:getState', () => security.getState());
ipcMain.handle('security:setAppLock', (_e, pin) => security.setAppLock(pin));
ipcMain.handle('security:removeAppLock', (_e, pin) => security.removeAppLock(pin));
ipcMain.handle('security:unlockApp', (_e, pin) => security.unlockApp(pin));
ipcMain.handle('security:lockApp', () => {
  // Verrouiller Orbit ferme aussi les trousseaux : laisser un coffre ouvert
  // derrière un écran de verrouillage viderait celui-ci de son sens.
  vault.lockAll();
  return security.lockApp();
});
ipcMain.handle('security:setProfileLock', (_e, { id, pin } = {}) => security.setProfileLock(id, pin));
ipcMain.handle('security:removeProfileLock', (_e, { id, pin } = {}) =>
  security.removeProfileLock(id, pin)
);
ipcMain.handle('security:unlockProfile', (_e, { id, pin } = {}) => security.unlockProfile(id, pin));
ipcMain.handle('security:lockProfile', (_e, id) => security.lockProfile(id));
ipcMain.handle('security:dropProfile', (_e, id) => security.dropProfile(id));

// Verrouillage automatique après inactivité SYSTÈME (clavier/souris n'importe
// où — compte même quand on utilise une app embarquée, contrairement à un
// détecteur limité à la fenêtre React).
let autoLockMinutes = 0;
let autoLockTimer = null;
function setupAutoLock(minutes) {
  autoLockMinutes = Number(minutes) || 0;
  clearInterval(autoLockTimer);
  autoLockTimer = null;
  if (autoLockMinutes <= 0) return;
  autoLockTimer = setInterval(() => {
    try {
      const idleSec = powerMonitor.getSystemIdleTime();
      if (idleSec < autoLockMinutes * 60) return;
      const st = security.getState();
      if (st.appLockEnabled && st.appUnlocked) {
        vault.lockAll();
        security.lockApp();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('orbit:relock');
        }
      }
    } catch {
      /* ignore */
    }
  }, 20000);
}
ipcMain.handle('security:setAutoLock', (_e, minutes) => {
  setupAutoLock(minutes);
  return { success: true };
});

// ---------------------------------------------------------------------------
// IPC — Proxy / VPN par partition (session)
// ---------------------------------------------------------------------------
// Route une partition (app/profil) via un proxy (SOCKS/HTTP) — permet
// d'utiliser un VPN uniquement sur certaines apps/profils. Chaîne vide = direct.
//
// Authentification : on accepte "scheme://user:pass@host:port". Les identifiants
// sont RETIRÉS des règles (Electron ne les accepte pas là) et fournis via
// l'événement 'login' (proxy 407). Stockés par session, jamais persistés.
const proxyCreds = new WeakMap(); // ses -> { username, password }

function splitProxyAuth(rules) {
  const m = /^(\w+:\/\/)(?:([^:@/]+):([^@/]+)@)?(.+)$/.exec(String(rules).trim());
  if (!m) return { clean: String(rules).trim(), username: null, password: null };
  const [, scheme, user, pass, hostport] = m;
  return { clean: scheme + hostport, username: user || null, password: pass || null };
}

ipcMain.handle('proxy:apply', async (_e, { partition, rules } = {}) => {
  try {
    const ses =
      !partition || partition === 'default'
        ? session.defaultSession
        : session.fromPartition(partition);
    if (rules && rules.trim()) {
      const { clean, username, password } = splitProxyAuth(rules);
      if (username) proxyCreds.set(ses, { username, password: password || '' });
      else proxyCreds.delete(ses);
      await ses.setProxy({ proxyRules: clean });
      proxiedSessions.add(ses);
      applyWebRtcPolicy(ses, true);
    } else {
      proxyCreds.delete(ses);
      await ses.setProxy({ mode: 'direct' });
      proxiedSessions.delete(ses);
      applyWebRtcPolicy(ses, false);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// Fournit les identifiants du proxy quand il en demande (407). N'intervient
// PAS pour l'authentification des sites eux-mêmes (laissée au comportement natif).
app.on('login', (event, webContents, _details, authInfo, callback) => {
  if (!authInfo || !authInfo.isProxy) return;
  try {
    const creds = webContents && webContents.session && proxyCreds.get(webContents.session);
    if (creds && creds.username) {
      event.preventDefault();
      callback(creds.username, creds.password);
    }
  } catch {
    /* laisse échouer proprement */
  }
});

// ---------------------------------------------------------------------------
// IPC — Portail captif
// ---------------------------------------------------------------------------
// Vérifie la connectivité ; si un portail est détecté, ouvre sa page et
// prévient l'interface (bannière). Appelé au démarrage, au retour en ligne et
// au focus de la fenêtre.
ipcMain.handle('captive:check', async () => {
  const r = await detectCaptivePortal();
  if (r.portal) {
    openCaptivePortalWindow(r.url);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('orbit:captive', { detected: true, url: r.url });
    }
  }
  return r;
});

// Rouvre manuellement la page du portail (bouton « Se connecter » de la bannière)
ipcMain.handle('captive:open', async () => {
  const r = await detectCaptivePortal();
  if (r.portal) openCaptivePortalWindow(r.url);
  else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('orbit:captive', { detected: false });
  }
  return r;
});

// ---------------------------------------------------------------------------
// IPC — Sauvegarde / restauration de la configuration
// ---------------------------------------------------------------------------
// Export chiffré optionnel : AES-256-GCM avec clé dérivée du mot de passe
// (scrypt + sel aléatoire) → portable entre machines (contrairement à
// safeStorage qui est lié au trousseau local).
function encryptBackup(jsonStr, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(password), salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  return JSON.stringify({
    orbit: 'enc1',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
  });
}
function decryptBackup(container, password) {
  const key = crypto.scryptSync(String(password), Buffer.from(container.salt, 'base64'), 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(container.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(container.tag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(container.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString('utf8'));
}

ipcMain.handle('backup:export', async (_e, { data, password } = {}) => {
  try {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter la configuration Orbit',
      defaultPath: `orbit-backup-${new Date().toISOString().slice(0, 10)}.orbit`,
      filters: [{ name: 'Sauvegarde Orbit', extensions: ['orbit', 'json'] }],
    });
    if (res.canceled || !res.filePath) return { success: false, canceled: true };
    const json = JSON.stringify(data);
    fs.writeFileSync(res.filePath, password ? encryptBackup(json, password) : json);
    return { success: true, path: res.filePath, encrypted: Boolean(password) };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

ipcMain.handle('backup:import', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Importer une configuration Orbit',
      properties: ['openFile'],
      filters: [{ name: 'Sauvegarde Orbit', extensions: ['orbit', 'json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return { success: false, canceled: true };
    const raw = fs.readFileSync(res.filePaths[0], 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { success: false, error: 'Fichier illisible ou corrompu' };
    }
    if (parsed && parsed.orbit === 'enc1') return { success: true, encrypted: true, blob: parsed };
    return { success: true, encrypted: false, data: parsed };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

ipcMain.handle('backup:decrypt', (_e, { blob, password } = {}) => {
  try {
    return { success: true, data: decryptBackup(blob, password) };
  } catch {
    return { success: false, error: 'Mot de passe incorrect ou fichier corrompu' };
  }
});

// ---------------------------------------------------------------------------
// IPC — Téléchargements
// ---------------------------------------------------------------------------
ipcMain.handle('downloads:open', (_event, id) => {
  const rec = downloads.get(id);
  if (rec?.savePath) shell.openPath(rec.savePath);
  return { success: Boolean(rec) };
});

ipcMain.handle('downloads:reveal', (_event, id) => {
  const rec = downloads.get(id);
  if (rec?.savePath) shell.showItemInFolder(rec.savePath);
  return { success: Boolean(rec) };
});

ipcMain.handle('downloads:cancel', (_event, id) => {
  const rec = downloads.get(id);
  try {
    rec?.item?.cancel();
  } catch {
    /* déjà terminé */
  }
  return { success: Boolean(rec) };
});

// Ouvre le dossier Téléchargements de l'OS
ipcMain.handle('downloads:openFolder', () => {
  shell.openPath(app.getPath('downloads'));
  return { success: true };
});

// Téléchargement vidéo/audio via yt-dlp — la progression alimente le MÊME
// panneau Téléchargements (broadcastDownload).
let mediaSeq = 0;
const mediaStarted = new Set();
function startMediaDownload(url, mode) {
  if (!url || !/^https?:\/\//.test(url)) return { success: false };
  const id = `yt-${Date.now()}-${(mediaSeq += 1)}`;
  downloader.downloadMedia({ id, url, mode }, (ev) => {
    const rec = downloads.get(id) || {};
    if (ev.proc) rec.item = { cancel: () => { try { ev.proc.kill('SIGTERM'); } catch { /* ignore */ } } };
    // yt-dlp n'a pas de DownloadItem : on suit nous-mêmes l'état pour que le
    // blocage de mise en veille et la confirmation de sortie en tiennent compte.
    rec.active = ev.state === 'progressing';
    if (ev.savePath) rec.savePath = ev.savePath;
    rec.url = url;
    rec.filename = ev.filename;
    downloads.set(id, rec);
    refreshDownloadPowerBlocker();
    const first = !mediaStarted.has(id);
    if (first) mediaStarted.add(id);
    broadcastDownload({
      id,
      filename: ev.filename,
      savePath: ev.savePath || rec.savePath || '',
      url,
      totalBytes: ev.totalBytes || 0,
      receivedBytes: ev.receivedBytes || 0,
      state: ev.state,
      event:
        ev.state === 'completed' || ev.state === 'interrupted'
          ? 'done'
          : first
            ? 'started'
            : 'updated',
    });
    if (ev.state === 'completed' || ev.state === 'interrupted') {
      mediaStarted.delete(id);
      setTimeout(() => downloads.delete(id), 10 * 60 * 1000);
    }
  });
  return { success: true, id };
}
ipcMain.handle('media:download', (_e, { url, mode } = {}) => startMediaDownload(url, mode));

// Ouvrir une app dans une fenêtre DÉTACHÉE (séparée), en réutilisant la même
// partition → session/connexion partagée avec l'onglet embarqué.
const detachedWindows = new Map();
ipcMain.handle('app:openDetached', (_e, { appId, url, partition, title } = {}) => {
  if (!url || !/^https?:\/\//.test(url) || !partition) return { success: false };
  const existing = detachedWindows.get(appId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { success: true };
  }
  const icon = nativeImage.createFromPath(resourcePath('build/icon.png'));
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 600,
    minHeight: 400,
    title: title || 'Orbit',
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    ...(process.platform !== 'darwin' && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setUserAgent(CHROME_UA);
  // Popups (OAuth, connexion) : fenêtre enfant avec la MÊME session
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//.test(u)) {
      return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition } } };
    }
    return { action: 'deny' };
  });
  win.loadURL(url);
  detachedWindows.set(appId, win);
  win.on('closed', () => detachedWindows.delete(appId));
  return { success: true };
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
      warnings.push(
        "Extension récente (Manifest V3) : sa tâche de fond peut ne pas tourner dans Orbit. " +
          "Si elle « ne fait rien », préférez la version classique (Manifest V2) de la même extension."
      );
    }
    // Bloqueurs de pub modernes (declarativeNetRequest) : non supporté par Electron
    if (
      manifest.manifest_version === 3 &&
      (perms.includes('declarativeNetRequest') || perms.includes('declarativeNetRequestWithHostAccess'))
    ) {
      warnings.push(
        'Bloqueur de contenu « nouvelle génération » (declarativeNetRequest) non pris en charge : ' +
          "installez plutôt uBlock Origin (version classique) pour un blocage efficace."
      );
    }

    return {
      success: true,
      info: {
        name: manifest.name,
        version: manifest.version,
        manifestVersion: manifest.manifest_version || 2,
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

// Clic DANS une app embarquée : relayé à l'interface pour qu'elle referme ses
// menus et panneaux. Les événements souris d'un <webview> ne traversent pas la
// frontière de processus ; c'est le seul moyen de les connaître.
ipcMain.on('guest:interact', (event) => {
  if (event.sender.getType() !== 'webview') return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('orbit:guest-interact');
  }
});

// Diagnostic : logs du preload d'identifiants.
//
// Ils partaient uniquement dans la console du processus principal — invisible
// dans l'application installée, dont la sortie standard n'est branchée nulle
// part. Une panne de proposition d'identifiants était donc indiagnosticable
// autrement qu'en relançant tout en mode développement.
// On les écrit aussi dans <userData>/credentials.log, tronqué quand il
// dépasse 256 Ko. Ce journal ne contient JAMAIS de mot de passe ni
// d'identifiant : uniquement des noms de domaine, des compteurs et des
// libellés d'erreur.
// Un journal par sujet, tronqué à 256 Ko. Aucun ne contient de secret :
// noms de domaine, compteurs, verdicts et libellés d'erreur seulement.
const logSizes = new Map();

function fileLog(name, tag, message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  console.log(tag, message);
  try {
    const file = path.join(app.getPath('userData'), name);
    let size = logSizes.get(name);
    if (size === undefined) {
      try {
        size = fs.statSync(file).size;
      } catch {
        size = 0;
      }
    }
    if (size > 256 * 1024) {
      fs.writeFileSync(file, '');
      size = 0;
    }
    fs.appendFileSync(file, line);
    logSizes.set(name, size + Buffer.byteLength(line));
  } catch {
    /* un journal ne doit jamais faire échouer ce qu'il observe */
  }
}

const credLog = (message) => fileLog('credentials.log', '[credentials]', message);

// Dialogues et autorisations : sans trace sur disque, une modale qui ne
// s'affiche pas est indiscernable d'une app silencieuse.
const permLog = (message) => fileLog('permissions.log', '[permissions]', message);

// Hôte d'une URL, pour le journal : on n'y écrit jamais l'URL complète, qui
// peut porter des jetons de connexion dans sa requête.
const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return '?';
  }
};

ipcMain.on('keepass:dbg', (event, message) => {
  credLog(`[page ${hostOf(event.sender.getURL())}] ${message}`);
});

// ---------------------------------------------------------------------------
// IPC — Coffre-fort intégré (trousseaux chiffrés)
// ---------------------------------------------------------------------------
// Aucun de ces handlers ne renvoie un mot de passe « en passant » : la liste
// des entrées part sans les mots de passe, qui ne sortent que par reveal/copy,
// sur une action explicite de l'utilisateur.
const vaultWindow = (event) => BrowserWindow.fromWebContents(event.sender) || mainWindow;

// `ipcMain.handle` écoute TOUS les webContents du processus, y compris les
// <webview> qui affichent des sites tiers. Leur preload est isolé, donc une
// page ne peut pas appeler ipcRenderer aujourd'hui — mais faire reposer la
// sécurité du coffre entier sur cette seule barrière est un mauvais pari : un
// défaut d'isolation, ou un preload modifié, exposerait TOUS les mots de passe
// de tous les sites d'un coup.
//
// On exige donc que l'appelant soit l'interface d'Orbit elle-même. Une page
// embarquée n'a aucune raison légitime de lire le coffre : elle passe par
// `credentials:*`, qui ne lui rend que les identifiants de SON propre domaine.
function fromOrbitUi(event) {
  try {
    return (
      event.sender.getType() !== 'webview' &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender.id === mainWindow.webContents.id
    );
  } catch {
    return false;
  }
}

// Enregistre un handler réservé à l'interface d'Orbit.
function handleFromUi(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOrbitUi(event)) {
      console.warn('[orbit] appel refusé sur', channel, '— émetteur non autorisé');
      return { success: false, error: 'forbidden' };
    }
    return fn(event, ...args);
  });
}

handleFromUi('vault:state', () => vault.getState());
handleFromUi('vault:create', (_e, payload) => vault.create(payload));
handleFromUi('vault:unlock', (_e, { id, password } = {}) => vault.unlock(id, password));
handleFromUi('vault:lock', (_e, { id } = {}) => (id ? vault.lock(id) : vault.lockAll()));
handleFromUi('vault:update', (_e, { id, ...patch } = {}) => vault.updateVault(id, patch));
handleFromUi('vault:changeMaster', (_e, { id, current, next } = {}) =>
  vault.changeMasterPassword(id, current, next)
);
handleFromUi('vault:remove', (_e, { id, password } = {}) => vault.remove(id, password));

handleFromUi('vault:entries', (_e, { id } = {}) => vault.listEntries(id));
handleFromUi('vault:saveEntry', (_e, { id, entry } = {}) => vault.saveEntry(id, entry));
handleFromUi('vault:deleteEntry', (_e, { id, entryId } = {}) => vault.deleteEntry(id, entryId));
handleFromUi('vault:setCategories', (_e, { id, categories } = {}) =>
  vault.setCategories(id, categories)
);
handleFromUi('vault:reveal', (_e, { id, entryId, field } = {}) =>
  vault.revealSecret(id, entryId, field)
);
handleFromUi('vault:copy', (_e, { id, entryId, field } = {}) =>
  vault.copySecret(id, entryId, field)
);
handleFromUi('vault:totp', (_e, { id, entryId } = {}) => vault.entryTotp(id, entryId));
handleFromUi('vault:audit', (_e, { id } = {}) => vault.audit(id));
handleFromUi('vault:strength', (_e, { password } = {}) => vault.strength(password));
handleFromUi('vault:generate', (_e, opts = {}) =>
  opts.passphrase ? vault.generatePassphrase(opts.words) : vault.generatePassword(opts)
);
handleFromUi('vault:import', (e, { id } = {}) =>
  vault.importFromFile(id, { window: vaultWindow(e) })
);
handleFromUi('vault:export', (e, { id, password, format } = {}) =>
  vault.exportToFile(id, { password, format, window: vaultWindow(e) })
);
handleFromUi('vault:ignored', () => ({ success: true, domains: vault.ignoredDomains() }));
handleFromUi('vault:unignore', (_e, { domain } = {}) => vault.unignoreDomain(domain));

// ---------------------------------------------------------------------------
// IPC — Identifiants UNIFIÉS (KeePassXC + coffre-fort intégré)
// ---------------------------------------------------------------------------
// Le preload des pages ne connaît qu'une seule source : ici. Les deux systèmes
// peuvent coexister (KeePassXC pour l'historique, le coffre pour le reste) et
// l'utilisateur voit une seule liste de comptes dans la page.
// L'URL est prise sur le webContents ÉMETTEUR, pas dans le message. Une page
// ne doit jamais pouvoir demander « les identifiants de banque.fr » : elle
// n'obtient que ceux du site qu'elle affiche réellement.
function senderUrl(event, fallback) {
  try {
    const real = event.sender.getURL();
    if (/^https?:\/\//i.test(real)) return real;
  } catch {
    /* webContents parti */
  }
  return /^https?:\/\//i.test(String(fallback || '')) ? fallback : '';
}

// Quelles sources d'identifiants Orbit interroge dans les pages. Réglé depuis
// l'interface (Paramètres → Mots de passe / KeePassXC), jamais depuis une page.
//   'both' | 'keepass' | 'vault' | 'none'
let credentialSource = 'both';
const useKeepass = () => credentialSource === 'both' || credentialSource === 'keepass';
const useVault = () => credentialSource === 'both' || credentialSource === 'vault';

handleFromUi('credentials:setSource', (_event, source) => {
  const allowed = ['both', 'keepass', 'vault', 'none'];
  credentialSource = allowed.includes(source) ? source : 'both';
  // KeePassXC garde son propre interrupteur interne : on le tient aligné pour
  // qu'aucune requête ne parte vers le socket quand l'utilisateur l'a écarté.
  keepassSetEnabled(useKeepass());
  return { success: true, source: credentialSource };
});

ipcMain.handle('credentials:getLogins', async (event, { url: claimed } = {}) => {
  const url = senderUrl(event, claimed);
  if (credentialSource === 'none') return { success: true, count: 0, entries: [], disabled: true };
  if (!url) return { success: true, count: 0, entries: [] };
  const entries = [];
  let keepassError = null;
  let kpCount = null;

  try {
    const kp = useKeepass() ? await keepassGetLogins(url) : null;
    if (kp && kp.success) {
      kpCount = (kp.entries || []).length;
      for (const e of kp.entries || []) entries.push({ ...e, source: 'keepass' });
    } else if (kp && kp.error && kp.error !== 'disabled' && kp.error !== 'not-associated') {
      keepassError = kp.error;
    }
  } catch (err) {
    keepassError = String(err.message || err);
  }

  const local = useVault()
    ? vault.findLogins(url)
    : { entries: [], lockedVaults: 0, openVaults: 0 };
  entries.push(...local.entries);

  // Un même compte peut exister des deux côtés (import depuis KeePassXC) :
  // on ne le montre qu'une fois, en gardant la version du coffre intégré.
  const seen = new Set();
  const merged = [];
  for (const e of entries) {
    const key = `${e.login}|${e.password}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }

  credLog(
    `getLogins ${hostOf(url)} — source=${credentialSource} keepass=${
      kpCount === null ? 'ignoré' : kpCount
    }${keepassError ? ' err=' + keepassError : ''} coffre=${local.entries.length} ` +
      `(ouverts=${local.openVaults} verrouillés=${local.lockedVaults}) → ${merged.length}`
  );

  return {
    success: true,
    count: merged.length,
    entries: merged,
    lockedVaults: local.lockedVaults,
    openVaults: local.openVaults,
    keepassError,
  };
});

// La page vient de soumettre un formulaire : faut-il proposer d'enregistrer ?
// Repose entièrement sur la soumission mise de côté ici même : la page n'a rien
// à fournir, donc rien à falsifier.
ipcMain.handle('credentials:shouldOffer', (event) => {
  // Enregistrer va forcément dans un trousseau intégré : sans lui, rien à
  // proposer (KeePassXC gère ses propres ajouts depuis son interface).
  if (!useVault()) return { offer: false, reason: 'vault-disabled' };
  const rec = pendingCredentials.get(event.sender.id);
  if (!rec) return { offer: false, reason: 'no-pending' };
  const { url, login, password } = rec;
  if (vault.isIgnored(url)) return { offer: false, reason: 'ignored' };
  const all = vault.list();
  const state = vault.lookupSaveState(url, login, password);
  // Déjà connu et inchangé (dans un trousseau ouvert) → rien à proposer.
  if (state.known && !state.changed) return { offer: false, reason: 'known' };
  // On renvoie TOUS les trousseaux (ouverts ET verrouillés) : la bannière
  // propose un select unifié + « ➕ Nouveau ». Déverrouiller/créer se fait à
  // ce moment-là, sans jamais devoir taper un nom exact.
  return {
    offer: true,
    update: state.known && state.changed,
    entryId: state.entryId || null,
    vaultId: state.vaultId || null,
    // createVault : plus aucun trousseau du tout → on démarre sur « Nouveau ».
    createVault: all.length === 0,
    vaults: all.map((v) => ({ id: v.id, name: v.name, icon: v.icon, unlocked: v.unlocked })),
  };
});

// La page ne transmet PAS le mot de passe : il n'a jamais quitté le processus
// principal (voir stashPending / takePending). Elle indique seulement dans quel
// trousseau ranger la soumission mise de côté.
ipcMain.handle('credentials:save', (event, { vaultId, entryId, title } = {}) => {
  const rec = pendingCredentials.get(event.sender.id);
  if (!rec) return { success: false, error: 'no-pending' };
  pendingCredentials.delete(event.sender.id);
  return vault.saveEntry(vaultId, {
    id: entryId || undefined,
    title: title || '',
    url: rec.url,
    username: rec.login,
    password: rec.password,
  });
});

ipcMain.handle('credentials:ignore', (event, { url: claimed } = {}) =>
  vault.ignoreDomain(senderUrl(event, claimed))
);

// Déverrouille un trousseau existant ET sauvegarde les identifiants en attente.
// Utilisé quand l'utilisateur choisit, dans la bannière, un trousseau verrouillé.
ipcMain.handle('credentials:unlockAndSave', (event, { vaultId, password: master, entryId, title } = {}) => {
  const rec = pendingCredentials.get(event.sender.id);
  if (!rec) return { success: false, error: 'no-pending' };
  const unlockRes = vault.unlock(vaultId, master);
  if (!unlockRes || unlockRes.success === false) {
    return { success: false, error: unlockRes?.error || 'unlock-failed' };
  }
  const saveRes = vault.saveEntry(vaultId, {
    id: entryId || undefined,
    title: title || '',
    url: rec.url,
    username: rec.login,
    password: rec.password,
  });
  if (saveRes.success) pendingCredentials.delete(event.sender.id);
  return saveRes;
});

// Crée un trousseau ET sauvegarde les identifiants en une seule étape.
// Utilisé quand aucun trousseau n'est ouvert : l'utilisateur crée un trousseau
// depuis le panneau de proposition d'enregistrement.
ipcMain.handle('credentials:createAndSave', (event, { name, password: master, entry } = {}) => {
  const rec = pendingCredentials.get(event.sender.id);
  if (!rec) return { success: false, error: 'no-pending' };
  const createResult = vault.create({ name, password: master });
  if (!createResult.success) return createResult;
  // Le trousseau est créé ET déverrouillé : on sauvegarde l'entrée
  const saveResult = vault.saveEntry(createResult.id, {
    title: entry?.title || '',
    url: rec.url,
    username: rec.login,
    password: rec.password,
  });
  if (saveResult.success) pendingCredentials.delete(event.sender.id);
  return saveResult;
});

// Formulaire soumis : on met les identifiants DE CÔTÉ le temps que la page
// navigue, puis la nouvelle page vient les reprendre pour proposer de les
// enregistrer. Ce relais vit dans le processus principal — le passer par
// sessionStorage exposerait le mot de passe aux scripts de la page.
const pendingCredentials = new Map(); // webContentsId -> { url, login, password, at }

ipcMain.handle('credentials:stashPending', (event, { login, password } = {}) => {
  const id = event.sender.id;
  const url = senderUrl(event, '');
  if (!password || !url) return { success: false };
  pendingCredentials.set(id, { url, login: String(login || ''), password: String(password), at: Date.now() });
  try {
    event.sender.once('destroyed', () => pendingCredentials.delete(id));
  } catch {
    /* ignore */
  }
  return { success: true };
});

// Ne renvoie JAMAIS le mot de passe : la page a seulement besoin de savoir
// qu'il y a une soumission en attente et pour quel compte, afin d'afficher la
// proposition. Le secret reste ici jusqu'à `credentials:save`.
ipcMain.handle('credentials:takePending', (event) => {
  const rec = pendingCredentials.get(event.sender.id);
  // Passé 90 s, la soumission n'a plus de rapport avec la page affichée.
  // `taken` : on ne propose qu'UNE fois. Le mot de passe reste ici jusqu'à
  // l'enregistrement, mais chaque navigation ne doit pas rouvrir la proposition
  // que l'utilisateur vient de fermer.
  if (!rec || rec.taken || Date.now() - rec.at > 90000) {
    if (rec && Date.now() - rec.at > 90000) pendingCredentials.delete(event.sender.id);
    return { success: false };
  }
  rec.taken = true;
  return { success: true, url: rec.url, login: rec.login };
});

ipcMain.handle('credentials:generate', (_event, opts = {}) => vault.generatePassword(opts));

// Purge les cookies/session d'un compte désinstallé (session unique par app).
// La clé de session est STABLE (sessionKey) : elle ne change pas quand l'app
// est déplacée d'un profil à l'autre, donc le compte/cache la suivent. Repli
// sur l'ancien schéma `profileId:appId` pour les données déjà installées.
ipcMain.handle('sessions:clear', (_event, { sessionKey, profileId, appId } = {}) => {
  try {
    const key = sessionKey || `${profileId}:${appId}`;
    const ses = session.fromPartition(`persist:${key}`);
    ses.clearStorageData().catch(() => {});
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// Purge les cookies d'un hôte précis (ex. webmail o2switch) : quand la session
// SERVEUR expire mais que le cookie « zombie » survit (élevé à +1 an par la
// persistance des sessions durables), le site boucle en redirections
// (ERR_TOO_MANY_REDIRECTS → page d'erreur ≈ page blanche). On retire alors
// uniquement les cookies de cet hôte pour revenir à un état de connexion sain.
ipcMain.handle('sessions:clearHost', async (_event, { sessionKey, host } = {}) => {
  try {
    if (!sessionKey || !host) return { success: false, error: 'sessionKey et host requis' };
    const ses = session.fromPartition(`persist:${sessionKey}`);
    const cookies = await ses.cookies.get({ domain: host });
    for (const c of cookies) {
      await ses.cookies.remove(cookieSetUrl(c), c.name).catch(() => {});
    }
    return { success: true, removed: cookies.length };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
// --- Mise à jour automatique (electron-updater) ----------------------------
const { autoUpdater } = electronUpdater;

// L'auto-update Linux ne fonctionne que depuis une AppImage (pas .deb/dev).
function updateSupported() {
  if (isDev || !app.isPackaged) return false;
  if (process.platform === 'linux' && !process.env.APPIMAGE) return false;
  return true;
}

let updateInitDone = false;
function initAutoUpdate() {
  if (updateInitDone || !updateSupported()) return;
  updateInitDone = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  autoUpdater.on('update-available', (info) => send('update:available', { version: info?.version }));
  autoUpdater.on('download-progress', (p) => send('update:progress', { percent: Math.round(p?.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => send('update:downloaded', { version: info?.version }));
  autoUpdater.on('error', (e) => send('update:error', { message: String(e?.message || e) }));
  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('update:check', async () => {
  if (!updateSupported()) return { success: false, reason: 'unsupported' };
  initAutoUpdate();
  try {
    const r = await autoUpdater.checkForUpdates();
    return { success: true, version: r?.updateInfo?.version || null };
  } catch (e) {
    return { success: false, reason: String(e?.message || e) };
  }
});
ipcMain.handle('update:install', () => {
  isQuitting = true;
  try {
    autoUpdater.quitAndInstall();
  } catch {
    /* ignore */
  }
  return { success: true };
});
ipcMain.handle('app:getVersion', () => app.getVersion());

app.whenReady().then(() => {
  // Seconde instance : on a déjà quitté plus haut, on ne construit rien.
  if (!gotInstanceLock) return;

  // Identifiant d'app Windows : indispensable pour les notifications natives
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.orbit.app');
  }

  // Pont KeePassXC : charge l'association persistée + génère les clés de session
  initKeepass(app.getPath('userData'));

  // Verrouillage (codes globaux / par profil) — chiffré au repos via safeStorage
  security.init(app.getPath('userData'));

  // Coffre-fort intégré : prépare le dossier des trousseaux (rien n'est
  // déverrouillé au démarrage — il faut toujours saisir le mot de passe maître)
  vault.init(app.getPath('userData'));

  // Autorisations par site (caméra, micro, position…) : décisions mémorisées
  sitePermissions.init(app.getPath('userData'));

  // Bloqueur de pub natif — l'état réel (on/off) est synchronisé par le
  // renderer depuis les réglages ; ici on prépare juste le chemin du cache.
  adblock.initAdblock(app.getPath('userData'), false);

  // Bypass + permissions + téléchargements pour la session principale (React)
  setupHeaderBypass(session.defaultSession);
  setupGoogleUA(session.defaultSession);
  setupPermissions(session.defaultSession);
  setupDownloads(session.defaultSession);

  // Idem pour les sessions des profils connus + extensions actives
  for (const p of ['work', 'personal']) {
    try {
      const pSes = session.fromPartition(`persist:${p}`);
      setupHeaderBypass(pSes);
      setupGoogleUA(pSes);
      setupPermissions(pSes);
      setupDownloads(pSes);
    } catch {
      /* ignore */
    }
  }

  createWindow();
  createTray();

  // Mise à jour automatique (après un court délai, laisser la fenêtre s'afficher)
  setTimeout(initAutoUpdate, 6000);

  // Recharger les extensions au démarrage (Electron ne les garde pas en mémoire)
  for (const p of EXT_PARTITIONS) {
    ensureExtensionsForPartition(p);
  }

  // Détection d'un portail captif au démarrage (délai : laisser le Wi-Fi s'établir)
  setTimeout(async () => {
    const r = await detectCaptivePortal();
    if (r.portal) {
      openCaptivePortalWindow(r.url);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('orbit:captive', { detected: true, url: r.url });
      }
    }
  }, 3500);

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

app.on('before-quit', (event) => {
  // Quitter annule les téléchargements en cours (le processus qui les écrit
  // s'arrête). On demande confirmation plutôt que de perdre le fichier — comme
  // le fait un navigateur.
  const pending = activeDownloadCount();
  if (pending > 0 && !downloadQuitConfirmed) {
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: 'warning',
      buttons: ['Continuer les téléchargements', 'Quitter quand même'],
      defaultId: 0,
      cancelId: 0,
      title: 'Téléchargements en cours',
      message:
        pending === 1
          ? 'Un téléchargement est en cours.'
          : `${pending} téléchargements sont en cours.`,
      detail: "Quitter Orbit les interrompt définitivement. Les fichiers incomplets seront perdus.",
    });
    if (choice === 0) return;
    downloadQuitConfirmed = true;
    app.quit();
    return;
  }
  isQuitting = true;
});

// Mise en veille / verrouillage de session de l'OS : on ferme les trousseaux.
// C'est le moment où l'utilisateur s'éloigne physiquement de la machine.
try {
  powerMonitor.on('suspend', () => vault.lockAll());
  powerMonitor.on('lock-screen', () => vault.lockAll());
} catch {
  /* powerMonitor n'émet pas ces événements partout */
}

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
