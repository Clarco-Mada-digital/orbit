import { app, BrowserWindow, session, ipcMain, shell, Notification, dialog, net, screen, Menu, clipboard, globalShortcut, Tray, nativeImage, powerMonitor } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { unpackCrx } from './crx.js';
import { init as initKeepass, setEnabled as keepassSetEnabled, getLogins as keepassGetLogins, associate as keepassAssociate, checkStatus as keepassCheckStatus } from './keepass.js';
import * as security from './security.js';
import * as adblock from './adblock.js';
import { matchShortcutInput } from '../src/lib/shortcuts.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

// --- Barre système (tray) + fenêtre ----------------------------------------
let tray = null;
let isQuitting = false;
let closeToTray = false; // synchronisé depuis les réglages du renderer (opt-in)
let trayInfoShown = false;
let summonAccel = null;

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
    path.join(__dirname, '../dist/icons/icon-32.png'), // build packagé
    path.join(__dirname, '../public/icons/icon-32.png'), // dev
    path.join(__dirname, '../build/icon.png'), // repli
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
    // On passe un nativeImage (pas un chemin) : Electron l'écrit dans un
    // fichier temporaire du VRAI disque, seul moyen pour AppIndicator de lire
    // l'icône (un chemin dans app.asar donne une icône « fantôme »).
    let image = nativeImage.createFromPath(trayIconPath());
    if (image.isEmpty()) {
      image = nativeImage.createFromPath(path.join(__dirname, '../build/icon.png'));
    }
    if (!image.isEmpty()) {
      try {
        image = image.resize({ width: 24, height: 24 });
      } catch {
        /* garde l'original */
      }
    }
    tray = new Tray(image.isEmpty() ? trayIconPath() : image);
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
    console.error('[orbit] tray échoué:', err.message);
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
function setupHeaderBypass(ses) {
  if (!ses || !ses.webRequest) return;
  try {
    // Blocage réseau des pubs/traceurs (no-op si l'adblock est désactivé)
    ses.webRequest.onBeforeRequest((details, callback) => {
      adblock.beforeRequest(ses, details, callback);
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
      });
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
  'fullscreen',
  'clipboard-read',
  'clipboard-sanitized-write',
  'pointerLock',
  'background-sync',
  'openExternal',
]);

function setupPermissions(ses) {
  if (!ses) return;
  try {
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    // Même politique pour les vérifications synchrones (ex. navigator.permissions)
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
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
    item.on('updated', (_e, state) => broadcastDownload({ ...snapshot(state), event: 'updated' }));
    item.once('done', (_e, state) => {
      broadcastDownload({ ...snapshot(state), event: 'done' });
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

// Lecture à voix haute via la Web Speech API DANS la page (voix de l'OS, hors
// ligne). On exécute le JS dans le webContents invité.
function speakText(wc, text) {
  const t = String(text || '').slice(0, 32000);
  if (!t) return;
  wc.executeJavaScript(
    `(() => { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(${JSON.stringify(
      t
    )}); speechSynthesis.speak(u); } catch (e) {} })();`
  ).catch(() => {});
}

function stopSpeaking(wc) {
  wc.executeJavaScript('try { speechSynthesis.cancel(); } catch (e) {}').catch(() => {});
}

// Lit tout le texte visible de la page à voix haute.
function speakPage(wc) {
  wc.executeJavaScript(
    `(() => { try { speechSynthesis.cancel(); const t = (document.body ? document.body.innerText : '').slice(0, 32000); if (t) speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } catch (e) {} })();`
  ).catch(() => {});
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
        head.innerHTML = '<span style="font-weight:600;color:#9ca3af">🌐 Traduction (' + (d.detected||'auto') + ' → ' + d.target + ')</span>';
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
// Menu contextuel des pages (clic droit) — absent par défaut dans un <webview>
// ---------------------------------------------------------------------------
// Construit un menu natif adapté à ce qui est sous le curseur : image (copier /
// enregistrer), lien (ouvrir / copier / télécharger), sélection (copier /
// rechercher), champ éditable (couper/copier/coller + suggestions du
// correcteur), et navigation (précédent / suivant / recharger).
function buildGuestContextMenu(wc, params) {
  const t = [];
  const can = (flag) => Boolean(params.editFlags && params.editFlags[flag]);

  if (params.linkURL) {
    t.push({ label: 'Ouvrir le lien dans le navigateur', click: () => shell.openExternal(params.linkURL) });
    t.push({ label: "Copier l'adresse du lien", click: () => clipboard.writeText(params.linkURL) });
    t.push({ label: 'Télécharger le lien…', click: () => wc.downloadURL(params.linkURL) });
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
    t.push({ label: "Enregistrer l'image…", click: () => wc.downloadURL(params.srcURL) });
    t.push({ label: "Ouvrir l'image dans le navigateur", click: () => shell.openExternal(params.srcURL) });
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
  } else if (params.selectionText && params.selectionText.trim()) {
    const sel = params.selectionText.trim();
    t.push({ label: 'Copier', click: () => wc.copy() });
    t.push({
      label: `Traduire la sélection (→ ${translateConfig.target})`,
      click: () => translateSelection(wc, sel),
    });
    t.push({ label: 'Lire à voix haute', click: () => speakText(wc, sel) });
    t.push({ label: 'Arrêter la lecture', click: () => stopSpeaking(wc) });
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
  // Lecture vocale / traduction de la page entière (utile sans sélection)
  if (!params.isEditable) {
    t.push({ label: 'Lire la page à voix haute', click: () => speakPage(wc) });
    t.push({ label: 'Arrêter la lecture', click: () => stopSpeaking(wc) });
    t.push({ type: 'separator' });
  }
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
    if (!isHostPrefix) {
      setParams.domain = (current.domain || '').replace(/^\./, '');
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
  mainWindow.on('close', (e) => {
    // Fermer-vers-le-tray : on masque au lieu de quitter (sauf « Quitter » réel)
    if (!isQuitting && closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
      if (!trayInfoShown) {
        trayInfoShown = true;
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: 'Orbit continue en arrière-plan',
              body: 'Clic sur l’icône de la barre système pour rouvrir, clic droit → Quitter.',
              icon: path.join(__dirname, '../build/icon.png'),
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
    clearInterval(captiveWatchTimer);
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

    // Filtrage cosmétique de l'adblock : masque les emplacements publicitaires
    // résiduels (cadres vides). On injecte le CSS calculé pour l'URL à chaque
    // chargement de page (insertCSS — compatible Electron 33).
    const injectCosmetics = () => {
      try {
        const styles = adblock.getCosmeticStyles(guestContents.getURL());
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
      try {
        buildGuestContextMenu(guestContents, params).popup({ window: mainWindow });
      } catch (err) {
        console.error('[orbit] menu contextuel échoué:', err);
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
      icon: path.join(__dirname, '../build/icon.png'),
      // Son perso joué côté renderer → on coupe le son système pour éviter le doublon
      silent: silent === true,
    });

    // Clic sur la notification → Orbit revient au premier plan ET ouvre l'app
    // qui l'a émise (avant, un clic ne faisait rien : on devait retrouver
    // l'app à la main). La sélection de l'app se fait côté React via IPC.
    notif.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (appId) mainWindow.webContents.send('orbit:activate-app', appId);
    });

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
ipcMain.handle('security:lockApp', () => security.lockApp());
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
    } else {
      proxyCreds.delete(ses);
      await ses.setProxy({ mode: 'direct' });
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

// Diagnostic : logs du preload KeePassXC → terminal de l'app
ipcMain.on('keepass:dbg', (_event, message) => {
  console.log('[keepass-preload]', message);
});

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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
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

app.on('before-quit', () => {
  isQuitting = true;
});

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
