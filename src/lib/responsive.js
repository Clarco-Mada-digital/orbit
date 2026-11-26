// Vue responsive de l'inspecteur — logique pure (testable sans React).
//
// Ce qu'on a mesuré sur un <webview> (Electron 45) avant de choisir :
//   • l'émulation d'appareil d'Electron (`enableDeviceEmulation`) ignore la
//     largeur demandée — la page restait à 980 px ;
//   • celle du protocole DevTools (`setDeviceMetricsOverride`) DÉFORME le
//     rendu d'une page embarquée (largeur fausse, mise à l'échelle bancale).
// La seule méthode fiable : donner réellement au <webview> la taille de
// l'appareil. `innerWidth`, les media queries et la mise en page sont alors
// exactement ceux d'un vrai écran de cette taille. Pour un appareil plus
// grand que la place disponible, on RÉDUIT l'affichage (transform), sans
// toucher à la taille de la page. Le tactile et l'agent utilisateur mobile,
// eux, passent par le protocole DevTools, où ils fonctionnent.
// La densité d'écran (devicePixelRatio) n'est PAS émulée : la forcer est
// précisément ce qui déforme le rendu.

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// `kind` : phone | tablet | desktop. Les mobiles et tablettes activent le
// tactile et leur agent utilisateur par défaut.
export const DEVICES = [
  { id: 'responsive', name: 'Responsive', kind: 'custom', width: 400, height: 800 },
  { id: 'iphone-se', name: 'iPhone SE', kind: 'phone', width: 375, height: 667, ua: IOS_UA },
  { id: 'iphone-15', name: 'iPhone 15', kind: 'phone', width: 393, height: 852, ua: IOS_UA },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', kind: 'phone', width: 430, height: 932, ua: IOS_UA },
  { id: 'pixel-8', name: 'Pixel 8', kind: 'phone', width: 412, height: 915, ua: ANDROID_UA },
  { id: 'galaxy-s24', name: 'Galaxy S24', kind: 'phone', width: 360, height: 780, ua: ANDROID_UA },
  { id: 'galaxy-fold', name: 'Galaxy Z Fold (plié)', kind: 'phone', width: 344, height: 882, ua: ANDROID_UA },
  { id: 'ipad-mini', name: 'iPad mini', kind: 'tablet', width: 768, height: 1024, ua: IPAD_UA },
  { id: 'ipad-air', name: 'iPad Air', kind: 'tablet', width: 820, height: 1180, ua: IPAD_UA },
  { id: 'ipad-pro', name: 'iPad Pro 12,9"', kind: 'tablet', width: 1024, height: 1366, ua: IPAD_UA },
  { id: 'galaxy-tab', name: 'Galaxy Tab S9', kind: 'tablet', width: 800, height: 1280, ua: ANDROID_TABLET_UA },
  { id: 'laptop', name: 'Portable 1366', kind: 'desktop', width: 1366, height: 768 },
  { id: 'laptop-hd', name: 'Portable 1440', kind: 'desktop', width: 1440, height: 900 },
  { id: 'desktop', name: 'Bureau Full HD', kind: 'desktop', width: 1920, height: 1080 },
];

// Points de rupture courants, pour la règle cliquable au-dessus de la page.
export const BREAKPOINTS = [320, 375, 425, 768, 1024, 1440];

export const MIN_SIZE = 200;
export const MAX_SIZE = 4096;

export function deviceById(id) {
  return DEVICES.find((d) => d.id === id) || DEVICES[0];
}

export function clampSize(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
}

// Réglage de départ pour un appareil (ou d'une configuration enregistrée).
export function responsiveState(deviceId = 'iphone-15', previous = null) {
  const device = deviceById(deviceId);
  const mobile = device.kind === 'phone' || device.kind === 'tablet';
  return {
    deviceId: device.id,
    width: device.width,
    height: device.height,
    rotated: false,
    zoom: previous?.zoom ?? 'fit',
    touch: mobile,
    mobileUa: mobile,
    // Réglages qui ne dépendent pas de l'appareil : conservés quand on en
    // change.
    network: previous?.network ?? 'none',
    frame: previous?.frame ?? true,
    multi: previous?.multi ?? false,
  };
}

// Taille AFFICHÉE de la page (rotation comprise).
export function viewportOf(state) {
  const w = clampSize(state?.width);
  const h = clampSize(state?.height);
  return state?.rotated ? { width: h, height: w } : { width: w, height: h };
}

// Échelle d'affichage : `fit` réduit pour tenir dans la place disponible
// (jamais d'agrandissement : une page agrandie mentirait sur la netteté),
// sinon la valeur choisie (0,5 / 0,75 / 1…).
export function displayScale(state, stage, margin = 24) {
  const { width, height } = viewportOf(state);
  if (state?.zoom !== 'fit') {
    const z = Number(state?.zoom);
    return Number.isFinite(z) && z > 0 ? z : 1;
  }
  const availW = Math.max(1, (Number(stage?.width) || 0) - margin * 2);
  const availH = Math.max(1, (Number(stage?.height) || 0) - margin * 2);
  return Math.min(1, availW / width, availH / height);
}

// Agent utilisateur à imposer, ou null pour garder celui d'Orbit.
export function userAgentFor(state) {
  if (!state?.mobileUa) return null;
  return deviceById(state.deviceId).ua || ANDROID_UA;
}

// Réduction d'affichage par ZOOM de la page (et non par transform CSS).
// Mesuré : avec un transform, la boîte réelle du <webview> garde sa taille
// non réduite, déborde sur les poignées et leur vole les clics. Avec le zoom,
// l'élément a la taille affichée et la page voit pourtant la largeur de
// l'appareil (innerWidth = largeur de l'élément ÷ zoom).
// La largeur de l'élément est ENTIÈRE et le zoom en est déduit : la page doit
// voir exactement 768 px, pas 767 — sinon les points de rupture mentent.
//
// `shared` : plusieurs pages du MÊME site sur la même session (vue Multi).
// Chromium y mémorise le zoom par site : toutes reçoivent donc le dernier
// appliqué. On impose alors un zoom COMMUN (arrondi), et chaque boîte prend
// la largeur exacte — fractionnaire — qui fait voir à sa page la largeur de
// son appareil (mesuré : sans cela, 1369 px au lieu de 1366).
export function zoomPlan(view, scale, { shared = false } = {}) {
  if (shared) {
    const w = Math.max(1, Math.round(Number(view?.width) || 1));
    const h = Math.max(1, Math.round(Number(view?.height) || 1));
    const s0 = Number(scale);
    const zoom = s0 > 0 ? Math.round(Math.min(4, Math.max(0.25, s0)) * 1000) / 1000 : 1;
    return { zoom, boxWidth: w * zoom, boxHeight: h * zoom };
  }
  const width = Math.max(1, Math.round(Number(view?.width) || 1));
  const height = Math.max(1, Math.round(Number(view?.height) || 1));
  const s = Number(scale);
  if (!(s > 0) || s === 1) return { zoom: 1, boxWidth: width, boxHeight: height };
  // Chromium zoome de 25 % à 500 % ; au-delà de 100 %, c'est une loupe sur
  // la présentation (la page voit toujours la largeur de l'appareil).
  const boxWidth = Math.max(1, Math.floor(width * Math.min(4, Math.max(0.25, s))));
  const zoom = boxWidth / width;
  return { zoom, boxWidth, boxHeight: Math.round(height * zoom) };
}

// ---------------------------------------------------------------------------
// Réseau simulé. Valeurs des profils de Chrome (débits en octets/seconde,
// latence en millisecondes), pour que les mesures se comparent à celles qu'on
// lit ailleurs.
// ---------------------------------------------------------------------------
const kbps = (v) => Math.round((v * 1000) / 8);
export const NETWORK_PRESETS = [
  { id: 'none', conditions: null },
  { id: 'fast4g', conditions: { latency: 165, download: kbps(9000 * 0.9), upload: kbps(1500 * 0.9) } },
  { id: '3g', conditions: { latency: 562.5, download: kbps(1600 * 0.9), upload: kbps(750 * 0.9) } },
  { id: 'slow3g', conditions: { latency: 2000, download: kbps(500 * 0.8), upload: kbps(500 * 0.8) } },
  { id: 'offline', conditions: { offline: true, latency: 0, download: 0, upload: 0 } },
];

export function networkConditionsFor(id) {
  return NETWORK_PRESETS.find((p) => p.id === id)?.conditions || null;
}

// ---------------------------------------------------------------------------
// Cadre d'appareil pour la capture « avec cadre ». Géométrie seulement : le
// dessin est fait sur un <canvas> (WebView.jsx). Proportions d'un appareil
// actuel, à l'échelle de l'écran capturé.
// ---------------------------------------------------------------------------
export function deviceFrame(kind, width, height) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const short = Math.min(w, h);
  if (kind === 'phone') {
    const bezel = Math.round(short * 0.035) + 8;
    const radius = Math.round(short * 0.13);
    const portrait = h >= w;
    // Îlot de la caméra, centré sur le bord court du haut (ou de gauche en
    // paysage).
    const islandLong = Math.round(short * 0.3);
    const islandShort = Math.round(short * 0.075);
    const island = portrait
      ? { x: bezel + (w - islandLong) / 2, y: bezel + Math.round(short * 0.03), w: islandLong, h: islandShort }
      : { x: bezel + Math.round(short * 0.03), y: bezel + (h - islandLong) / 2, w: islandShort, h: islandLong };
    return { bezel, outerRadius: radius + bezel, innerRadius: radius, island, width: w + bezel * 2, height: h + bezel * 2 };
  }
  if (kind === 'tablet') {
    const bezel = Math.round(short * 0.03) + 10;
    const radius = Math.round(short * 0.025);
    return { bezel, outerRadius: radius + bezel, innerRadius: radius, island: null, width: w + bezel * 2, height: h + bezel * 2 };
  }
  // Ordinateur et taille libre : une fine bordure de fenêtre, coins doux.
  const bezel = 10;
  return { bezel, outerRadius: 14, innerRadius: 6, island: null, width: w + bezel * 2, height: h + bezel * 2 };
}

// ---------------------------------------------------------------------------
// Capture d'appareil par TUILES : positions de défilement de la scène qui
// amènent tour à tour chaque morceau de l'appareil à l'écran.
//   total : taille de l'appareil ; view : taille de la zone visible.
// ---------------------------------------------------------------------------
export function tileOffsets(total, view) {
  const t = Math.max(1, Math.floor(Number(total) || 1));
  const v = Math.max(1, Math.floor(Number(view) || 1));
  if (t <= v) return [0];
  const out = [];
  for (let p = 0; p < t - v; p += v) out.push(p);
  out.push(t - v);
  return out;
}

// ---------------------------------------------------------------------------
// Plusieurs appareils côte à côte : une échelle COMMUNE, pour que les tailles
// restent comparables d'un appareil à l'autre.
// ---------------------------------------------------------------------------
export const MULTI_DEFAULT = ['iphone-15', 'ipad-air', 'laptop'];

export function multiScale(views, stage, { gap = 24, margin = 24 } = {}) {
  const list = Array.isArray(views) ? views : [];
  if (!list.length) return 1;
  const sumW = list.reduce((s, v) => s + v.width, 0);
  const maxH = Math.max(...list.map((v) => v.height));
  const availW = Math.max(1, (Number(stage?.width) || 0) - margin * 2 - gap * (list.length - 1));
  const availH = Math.max(1, (Number(stage?.height) || 0) - margin * 2 - 28); // place du nom
  return Math.max(0.1, Math.min(1, availW / sumW, availH / maxH));
}
