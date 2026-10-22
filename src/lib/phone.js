// ---------------------------------------------------------------------------
// Téléphone (scrcpy) — LOGIQUE PURE, aucune dépendance.
//
// Tout ce qui peut être décidé sans parler au matériel vit ici : lecture des
// sorties d'`adb`/`scrcpy`, validation des réglages, construction de la ligne
// de commande du miroir, encodage du texte envoyé au téléphone… Le processus
// principal s'en sert, l'interface aussi, et `node --test` peut verrouiller ces
// décisions sans lancer Electron ni brancher un téléphone.
// ---------------------------------------------------------------------------

// Code retour de `scrcpy --list-apps` :
//   «  * » = application système, «  - » = application utilisateur
// Le libellé peut contenir des espaces ; le nom de paquet, jamais. On coupe donc
// au dernier champ.
export function parseScrcpyApps(output) {
  const apps = [];
  const seen = new Set();
  for (const raw of String(output || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let rest = null;
    let system = false;
    if (line.startsWith(' * ')) {
      rest = line.slice(3);
      system = true;
    } else if (line.startsWith(' - ')) {
      rest = line.slice(3);
    }
    if (rest === null) continue;
    const cut = rest.lastIndexOf(' ');
    if (cut < 0) continue;
    const name = rest.slice(0, cut).trim();
    const pkg = rest.slice(cut + 1).trim();
    if (!name || !pkg || !pkg.includes('.')) continue;
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    apps.push({ package: pkg, name, system });
  }
  return apps;
}

// Application actuellement au premier plan, depuis `dumpsys activity
// activities` (ou `dumpsys window`). Sert au bouton Retour : si le retour
// renvoie sur l'écran d'accueil du téléphone alors qu'une application a été
// ouverte depuis Orbit, on la relance au lieu d'afficher le lanceur.
export function parseForegroundPackage(output) {
  const pattern =
    /(?:mResumedActivity|topResumedActivity|mCurrentFocus|mFocusedApp)[^\n]*?\b([A-Za-z][A-Za-z0-9_.]*\.[A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/g;
  let found = null;
  let match;
  while ((match = pattern.exec(String(output || ''))) !== null) {
    found = { package: match[1], component: `${match[1]}/${match[2]}` };
  }
  return found;
}

// Sortie de `adb devices` : en-tête, puis « SERIAL\tÉTAT ». On garde aussi les
// appareils réseau (`192.168.1.20:5555`) et les états qui ne sont PAS
// exploitables (unauthorized, offline) : l'interface doit pouvoir le dire.
const DEVICE_STATES = new Set([
  'device',
  'offline',
  'unauthorized',
  'bootloader',
  'recovery',
  'sideload',
  'connecting',
  'authorizing',
]);

export function parseAdbDevices(output) {
  const devices = [];
  const seen = new Set();
  for (const raw of String(output || '').split('\n')) {
    const line = raw.trim();
    if (!line || /^List of devices/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1].toLowerCase();
    if (!serial || !DEVICE_STATES.has(state)) continue;
    const key = `${serial}:${state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    devices.push({ serial, state, wireless: /:\d+$/.test(serial) });
  }
  return devices;
}

// Version de scrcpy depuis sa bannière (`scrcpy 4.1 <https://…>`).
export function parseScrcpyVersion(banner) {
  const token = String(banner || '')
    .split('\n')[0]
    .split(/\s+/)[1];
  if (!token || !/^\d/.test(token)) return null;
  const release = token.split(/[-+]/)[0];
  const parts = release.split('.').map((n) => Number(n) || 0);
  const [major, minor, patch] = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  return { major, minor, patch, release };
}

// Compare deux versions « x.y.z ». > 0 si a est plus récente.
export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => Number(n) || 0);
  const pb = String(b || '0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Ce que scrcpy doit avoir pour tout ce que l'extension demande :
//   • 2.0 : `--list-apps` (inventaire avec libellés localisés) ;
//   • 3.0 : `--new-display` (écrans virtuels, mode fenêtre) ;
//   • 4.0 : `--flex-display` / `--keep-active` (facultatifs).
export const MIN_SCRCPY = { list: '2.0', window: '3.0', smooth: '4.0' };

export function scrcpyCapabilities(version) {
  const v = typeof version === 'string' ? version : version?.release;
  return {
    listApps: compareVersions(v, MIN_SCRCPY.list) >= 0,
    virtualDisplay: compareVersions(v, MIN_SCRCPY.window) >= 0,
    flexDisplay: compareVersions(v, MIN_SCRCPY.smooth) >= 0,
    keepActive: compareVersions(v, MIN_SCRCPY.smooth) >= 0,
    // L'audio (et donc `--no-audio`) n'existe qu'à partir de scrcpy 2.0.
    audio: compareVersions(v, MIN_SCRCPY.list) >= 0,
  };
}

// Adresse réseau acceptée : hôte ou hôte:port. On refuse tout ce qui pourrait
// traverser un shell (pas de guillemets, pas d'espaces, pas de `$`).
export function deviceAddressValid(value) {
  const s = String(value || '').trim();
  return /^[A-Za-z0-9._-]+(?::\d{1,5})?$/.test(s);
}

const PACKAGE = /^[A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?$/;
export function packageValid(pkg) {
  return PACKAGE.test(String(pkg || ''));
}

// Texte envoyé par `adb shell input text`. Deux règles du terrain :
//   • les espaces se transmettent avec `%s` (`input text` ne les prend pas) ;
//   • l'apostrophe doit être ré-échappée pour le shell de l'appareil.
export function encodeInputText(value) {
  const text = String(value || '').replace(/\r?\n/g, ' ').replace(/ /g, '%s');
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

// Arguments du miroir dédié (une vraie fenêtre scrcpy, pas la visionneuse
// intégrée). Les options non comprises par une version ancienne sont retirées
// par l'appelant, à partir de `scrcpyCapabilities`.
export function buildMirrorArgs({ serial, title, packageName, settings } = {}) {
  const s = normalizePhoneSettings(settings);
  const args = [];
  if (serial) args.push('--serial', serial);
  if (title) args.push(`--window-title=${title}`);
  if (packageName && packageValid(packageName)) args.push(`--start-app=${packageName}`);
  args.push(`--max-fps=${s.mirrorFps}`);
  args.push(`--video-bit-rate=${s.mirrorBitrate}`);
  if (!s.mirrorAudio) args.push('--no-audio');
  if (s.mirrorAlwaysOnTop) args.push('--always-on-top');
  return args;
}

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const PACKAGE_LIST = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((p) => packageValid(p)))].slice(0, 64) : [];

// Réglages de l'app Téléphone. Ils ne viennent pas seulement du disque : la
// page les écrit par IPC. Plusieurs finissent sur la ligne de commande de
// scrcpy (`--max-fps`, `--video-bit-rate`) ou désignent un paquet à lancer :
// d'où une validation stricte, avec des bornes, plutôt que la confiance.
export const DEFAULT_PHONE_SETTINGS = {
  serial: null,
  favoritePackages: [],
  recentPackages: [],
  showSystemApps: false,
  openMode: 'integrated', // integrated | mirror
  // Plafond de résolution de la capture intégrée (px). Par défaut la définition
  // d'un téléphone courant : la vue plein écran reste nette sans jamais
  // dépasser ce que l'appareil sait produire. Le baisser accélère l'aperçu.
  captureWidth: 1080,
  refreshMs: 400, // intervalle de rafraîchissement de la visionneuse
  iconConcurrency: 3, // extractions d'icônes simultanées
  iconSize: 'medium', // small | medium | large
  gridMin: 132, // largeur minimale d'une tuile (px)
  appGridColumns: 6,
  appGridRows: 4,
  sortMode: 'name', // name | recent | package
  mirrorFps: 60,
  mirrorBitrate: '8M',
  mirrorAudio: false,
  mirrorAlwaysOnTop: true,
  // Écran virtuel par application (l'app remplit la zone d'Orbit).
  appDisplayWidth: 1280,
  appDisplayHeight: 800,
  appDisplayDpi: 160,
  appDisplayOrientation: 'landscape',
  appWindowScale: 55,
  appFollowWindow: true,
  homeBackground: 'aurora',
  homeWidgets: {
    clock: true,
    device: true,
    favorites: true,
    recent: true,
    notifications: true,
    quickControls: true,
  },
  // Alerte système à chaque nouvelle notification du téléphone.
  desktopNotifications: true,
  autoUpdateEngine: true,
  enginePath: null, // moteur choisi (renseigné après installation)
};

const BITRATES = new Set(['2M', '4M', '6M', '8M', '12M', '16M', '24M']);
const ICON_SIZES = new Set(['small', 'medium', 'large']);
const SORT_MODES = new Set(['name', 'recent', 'package']);
const OPEN_MODES = new Set(['integrated', 'mirror']);

export function normalizePhoneSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const current = s.serial == null ? null : String(s.serial);
  return {
    ...DEFAULT_PHONE_SETTINGS,
    serial: current && deviceAddressValid(current) ? current : null,
    favoritePackages: PACKAGE_LIST(s.favoritePackages),
    recentPackages: PACKAGE_LIST(s.recentPackages),
    showSystemApps: bool(s.showSystemApps, DEFAULT_PHONE_SETTINGS.showSystemApps),
    openMode: OPEN_MODES.has(s.openMode) ? s.openMode : DEFAULT_PHONE_SETTINGS.openMode,
    captureWidth: clampInt(s.captureWidth, 240, 1600, DEFAULT_PHONE_SETTINGS.captureWidth),
    refreshMs: clampInt(s.refreshMs, 120, 2000, DEFAULT_PHONE_SETTINGS.refreshMs),
    iconConcurrency: clampInt(s.iconConcurrency, 1, 8, DEFAULT_PHONE_SETTINGS.iconConcurrency),
    iconSize: ICON_SIZES.has(s.iconSize) ? s.iconSize : DEFAULT_PHONE_SETTINGS.iconSize,
    gridMin: clampInt(s.gridMin, 88, 240, DEFAULT_PHONE_SETTINGS.gridMin),
    appGridColumns: clampInt(s.appGridColumns, 3, 12, DEFAULT_PHONE_SETTINGS.appGridColumns),
    appGridRows: clampInt(s.appGridRows, 2, 8, DEFAULT_PHONE_SETTINGS.appGridRows),
    sortMode: SORT_MODES.has(s.sortMode) ? s.sortMode : DEFAULT_PHONE_SETTINGS.sortMode,
    mirrorFps: clampInt(s.mirrorFps, 15, 240, DEFAULT_PHONE_SETTINGS.mirrorFps),
    mirrorBitrate: BITRATES.has(s.mirrorBitrate)
      ? s.mirrorBitrate
      : DEFAULT_PHONE_SETTINGS.mirrorBitrate,
    mirrorAudio: bool(s.mirrorAudio, DEFAULT_PHONE_SETTINGS.mirrorAudio),
    mirrorAlwaysOnTop: bool(s.mirrorAlwaysOnTop, DEFAULT_PHONE_SETTINGS.mirrorAlwaysOnTop),
    appDisplayWidth: clampInt(s.appDisplayWidth, 800, 1920, DEFAULT_PHONE_SETTINGS.appDisplayWidth),
    appDisplayHeight: clampInt(s.appDisplayHeight, 480, 1400, DEFAULT_PHONE_SETTINGS.appDisplayHeight),
    appDisplayDpi: clampInt(s.appDisplayDpi, 72, 320, DEFAULT_PHONE_SETTINGS.appDisplayDpi),
    appDisplayOrientation: ['landscape', 'portrait'].includes(s.appDisplayOrientation)
      ? s.appDisplayOrientation
      : DEFAULT_PHONE_SETTINGS.appDisplayOrientation,
    appWindowScale: clampInt(s.appWindowScale, 35, 85, DEFAULT_PHONE_SETTINGS.appWindowScale),
    appFollowWindow: bool(s.appFollowWindow, DEFAULT_PHONE_SETTINGS.appFollowWindow),
    homeBackground: ['aurora', 'ocean', 'sunset', 'midnight'].includes(s.homeBackground)
      ? s.homeBackground
      : DEFAULT_PHONE_SETTINGS.homeBackground,
    homeWidgets: Object.fromEntries(
      Object.keys(DEFAULT_PHONE_SETTINGS.homeWidgets).map((key) => [
        key,
        bool(s.homeWidgets?.[key], DEFAULT_PHONE_SETTINGS.homeWidgets[key]),
      ])
    ),
    desktopNotifications: bool(s.desktopNotifications, DEFAULT_PHONE_SETTINGS.desktopNotifications),
    autoUpdateEngine: bool(s.autoUpdateEngine, DEFAULT_PHONE_SETTINGS.autoUpdateEngine),
    enginePath: typeof s.enginePath === 'string' && s.enginePath ? s.enginePath : null,
  };
}

// Initiales d'une application, pour la recherche « gmp » → Google Maps.
export function initialsOf(name) {
  return String(name || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w[0])
    .join('')
    .toLowerCase();
}

// Filtre la liste : nom, paquet, ou initiales. Une requête vide ne filtre rien.
export function filterPhoneApps(apps, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return apps;
  return apps.filter((app) => {
    const name = String(app.name || '').toLowerCase();
    const pkg = String(app.package || '').toLowerCase();
    return name.includes(q) || pkg.includes(q) || initialsOf(name).includes(q);
  });
}

function indexOfPackage(list, pkg) {
  const i = list.indexOf(pkg);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

// Tri de l'inventaire. « recent » suit l'ordre des derniers lancements (index 0
// = le plus récent) ; les paquets jamais ouverts passent après, par nom.
export function sortPhoneApps(apps, mode, recentPackages = []) {
  const list = [...apps];
  if (mode === 'package') {
    list.sort((a, b) => String(a.package).localeCompare(String(b.package)));
  } else if (mode === 'recent') {
    list.sort((a, b) => {
      const ra = indexOfPackage(recentPackages, a.package);
      const rb = indexOfPackage(recentPackages, b.package);
      if (ra !== rb) return ra - rb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    });
  } else {
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
  }
  return list;
}

// Le Téléphone n'est plus une app de la barre latérale : il s'ouvre depuis un
// bouton de barre (comme une extension de navigateur) et vit dans un panneau.
// Ces entrées ont existé dans un état persisté : on les retire au chargement.
export function stripNativeApps(apps) {
  const list = Array.isArray(apps) ? apps : [];
  const removed = list.filter((a) => a?.native);
  if (!removed.length) return null;
  return {
    apps: list.filter((a) => !a?.native),
    removedIds: removed.map((a) => a.id),
  };
}

// Place le bouton « Téléphone » dans la barre du haut, juste avant la cloche de
// notifications, sans écraser une disposition choisie par l'utilisateur.
// Retourne la nouvelle disposition, ou `null` si le bouton y est déjà.
export function withPhoneModule(topbar) {
  if (!topbar || typeof topbar !== 'object') return null;
  const zones = ['left', 'center', 'right'];
  if (zones.some((z) => Array.isArray(topbar[z]) && topbar[z].includes('phone'))) return null;
  const right = Array.isArray(topbar.right) ? topbar.right : [];
  const at = right.indexOf('notifications');
  const next = at >= 0 ? [...right.slice(0, at), 'phone', ...right.slice(at)] : [...right, 'phone'];
  return { ...topbar, right: next };
}

// ---------------------------------------------------------------------------
// Notifications Android (`dumpsys notification --noredact`).
//
// Chaque `NotificationRecord` décrit une notification affichée. On ne garde que
// ce qui se lit : paquet, titre, texte, horodatage, catégorie (un appel se
// traite différemment d'une mise à jour d'application) et surtout sa clé, seule
// façon de la désigner ensuite pour l'écarter.
export function parseAndroidNotifications(dump) {
  const items = [];
  const blocks = String(dump || '').split(/NotificationRecord\(/).slice(1);
  for (const block of blocks) {
    const pkg = /pkg=([\w.]+)/.exec(block);
    if (!pkg) continue;
    // Le bloc suivant commence à la prochaine en-tête : on ne lit pas ses
    // extras (sinon le texte d'une notification fuit sur la précédente).
    const scope = block.split(/\n\s{4}NotificationRecord/)[0];
    const title = /android\.title=String \(([\s\S]*?)\)\n/.exec(scope);
    const titleBig = /android\.title\.big=String \(([\s\S]*?)\)\n/.exec(scope);
    const text = /android\.text=String \(([\s\S]*?)\)\n/.exec(scope);
    const when = /^\s+when=(\d+)/m.exec(scope);
    const category = /category=(\w+)/.exec(scope);
    // La clé utile est sur sa propre ligne ; celle de l'en-tête du bloc porte
    // un « : » final et ne désigne pas la notification.
    const key = /^\s+key=([^\s]+)\s*$/m.exec(scope);
    const clean = (m) => (m ? m[1].replace(/\s+/g, ' ').trim() : '');
    const t = clean(title) || clean(titleBig);
    const b = clean(text);
    if (!t && !b) continue;
    items.push({
      key: key ? key[1] : `${pkg[1]}-${items.length}`,
      package: pkg[1],
      title: t,
      text: b,
      when: when ? Number(when[1]) : null,
      category: category ? category[1] : null,
    });
  }
  // Les plus récentes d'abord ; celles sans horodatage ferment la marche.
  items.sort((a, b) => (b.when || 0) - (a.when || 0));
  return items;
}

// Android n'expose pas de « dismiss » en ADB : `cmd notification` ne connaît
// que `snooze`. Une mise en sommeil de 24 h retire la notification du volet
// sans toucher à l'application qui l'a posée.
export const NOTIFICATION_SNOOZE_MS = 24 * 60 * 60 * 1000;

export function notificationSnoozeCommand(key, ms = NOTIFICATION_SNOOZE_MS) {
  const safe = String(key || '').replace(/'/g, `'\\''`);
  return `cmd notification snooze --for ${Math.max(1000, Math.round(ms))} '${safe}'`;
}

// Taille d'un écran virtuel Android calquée sur la zone d'Orbit.
//
// C'est ce qui permet à une application de REMPLIR la fenêtre : au lieu de
// recopier un écran de téléphone en portrait (et de laisser des bandes noires),
// on crée un écran à l'aspect de la zone, et Android y recompose l'app comme
// sur un petit bureau. Bornes volontairement modestes : un écran virtuel trop
// grand coûte cher à capturer (chaque trame est un screenshot complet).
export function virtualDisplaySize(availWidth, availHeight) {
  const aw = Math.max(320, Number(availWidth) || 1280);
  const ah = Math.max(240, Number(availHeight) || 800);
  const ratio = Math.min(2.6, Math.max(0.75, aw / ah));
  const width = Math.min(1600, Math.max(800, Math.round((aw * 1.25) / 8) * 8));
  let height = Math.round(width / ratio / 8) * 8;
  height = Math.min(1400, Math.max(480, height));
  return { width, height, dpi: 160 };
}

// Taille d'un PNG lue dans son en-tête IHDR (octets 16 à 23), sans décoder
// l'image. C'est ce qui permet au processus principal de savoir si un
// redimensionnement est nécessaire SANS passer par nativeImage (décodage +
// ré-encodage PNG, la partie coûteuse de chaque capture).
export function pngSize(buffer) {
  if (!buffer || typeof buffer.length !== 'number' || buffer.length < 24) return null;
  // Signature PNG : 89 50 4E 47 0D 0A 1A 0A
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i += 1) {
    if (buffer[i] !== signature[i]) return null;
  }
  // Le premier bloc doit être IHDR, sinon l'en-tête n'est pas à cet endroit.
  if (String.fromCharCode(buffer[12], buffer[13], buffer[14], buffer[15]) !== 'IHDR') {
    return null;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

// Lanceurs / coquilles système du téléphone. Après un « Retour », si le premier
// plan devient l'un d'eux, c'est que l'app ouverte depuis Orbit vient d'être
// quittée : on la relance plutôt que de laisser l'utilisateur sur l'accueil du
// mobile (ce qu'il n'a pas demandé).
const LAUNCHER_PACKAGES = new Set([
  'android',
  'com.android.systemui',
  'com.android.launcher',
  'com.android.launcher2',
  'com.android.launcher3',
  'com.google.android.apps.nexuslauncher',
  'com.google.android.apps.nexuslauncher.auto',
  'com.miui.home',
  'com.sec.android.app.launcher',
  'com.huawei.android.launcher',
  'com.honor.launcher',
  'com.oppo.launcher',
  'com.coloros.launcher',
  'com.vivo.launcher',
  'com.bbk.launcher2',
  'com.teslacoilsw.launcher',
  'com.microsoft.launcher',
  'com.oneplus.launcher',
  'net.oneplus.launcher',
]);

export function isLauncherPackage(pkg) {
  const p = String(pkg || '').trim().toLowerCase();
  // Un paquet vide ne permet pas de conclure : on ne relance pas à l'aveugle.
  if (!p) return false;
  if (LAUNCHER_PACKAGES.has(p)) return true;
  // Cas génériques (launchers constructeurs non listés) : le mot « launcher »
  // ou « home » comme segment du nom de paquet.
  return /(?:^|\.)(?:launcher|home)(?:\.|$)/.test(p);
}

// Plafond de la capture intégrée : si le téléphone est plus large, on réduit
// AVANT d'envoyer l'image au renderer (le redimensionnement se fait dans le
// processus principal, avec l'image native).
export function scaledSize(width, height, maxWidth) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const max = Number(maxWidth) || 0;
  if (!w || !h || !max || w <= max) return { width: w, height: h };
  return { width: max, height: Math.max(1, Math.round((h * max) / w)) };
}
