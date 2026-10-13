// ---------------------------------------------------------------------------
// Page d'accueil (« Home ») : ce qu'on voit dans un profil quand AUCUNE app
// n'est ouverte. Ce module ne contient que des décisions PURES — les fonds
// proposés, celui qui est réellement appliqué et le message d'accueil. Le
// rendu (components/HomeDashboard.jsx) s'appuie dessus, et les tests
// verrouillent ces décisions sans avoir besoin de React.
//
// Aucune dépendance : importable par `node --test` (comme i18n.dict.js).
// ---------------------------------------------------------------------------

// Fond qui suit la couleur d'accent réglée par l'utilisateur. On NE peut pas
// figer les couleurs ici : elles vivent dans les variables CSS
// --accent-primary / --accent-hover, posées sur <html> par App.jsx et mises à
// jour en direct (et par profil si l'option est activée). D'où la référence
// `rgb(var(--…))` — ce texte est interprété par le moteur CSS, pas par nous.
export const ACCENT_BACKGROUND =
  'radial-gradient(1200px 800px at 18% 12%, rgb(var(--accent-primary) / 0.55), transparent 62%), ' +
  'radial-gradient(1000px 720px at 88% 92%, rgb(var(--accent-hover) / 0.4), transparent 58%), ' +
  'linear-gradient(160deg, #0b1020 0%, #07070c 100%)';

// Fonds prêts à l'emploi. Tous sont sombres : le texte de l'accueil est blanc
// quel que soit le thème, sinon il deviendrait illisible sur une photo claire.
// `accent: true` = dégradé dynamique (voir ACCENT_BACKGROUND ci-dessus).
export const HOME_BACKGROUNDS = [
  { id: 'accent', accent: true },
  { id: 'night', css: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)' },
  { id: 'aurora', css: 'linear-gradient(135deg, #022c22 0%, #065f46 42%, #0ea5e9 100%)' },
  { id: 'sunset', css: 'linear-gradient(135deg, #7c2d12 0%, #b91c1c 45%, #f59e0b 100%)' },
  { id: 'ocean', css: 'linear-gradient(135deg, #082f49 0%, #0369a1 52%, #22d3ee 100%)' },
  { id: 'plum', css: 'linear-gradient(135deg, #2e1065 0%, #7e22ce 50%, #ec4899 100%)' },
  { id: 'mono', css: 'linear-gradient(135deg, #111827 0%, #1f2937 55%, #374151 100%)' },
  { id: 'plain', css: 'linear-gradient(135deg, #0b0b12 0%, #16161f 100%)' },
];

export const DEFAULT_HOME = {
  background: 'accent', // id de HOME_BACKGROUNDS
  imageUrl: '', // image personnalisée (URL ou data URL) — prime sur le dégradé
  blur: 0, // 0-24 px de flou appliqué à l'image
  dim: 30, // 0-80 % de voile sombre posé sur le fond (lisibilité)
  widgets: { clock: true, weather: true, apps: true },
};

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Fusionne un réglage `home` partiel (cas courant d'une installation mise à
// jour, où la clé n'existe pas encore) avec les valeurs par défaut. Le rendu et
// les réglages passent TOUJOURS par ici : jamais de `settings.home.xxx` brut.
export function normalizeHome(home) {
  const h = home || {};
  return {
    ...DEFAULT_HOME,
    ...h,
    imageUrl: typeof h.imageUrl === 'string' ? h.imageUrl : '',
    blur: clampInt(h.blur, 0, 24, DEFAULT_HOME.blur),
    dim: clampInt(h.dim, 0, 80, DEFAULT_HOME.dim),
    widgets: { ...DEFAULT_HOME.widgets, ...(h.widgets || {}) },
  };
}

// Forme du fond à peindre : soit une image, soit un dégradé (css ou accent).
// Le composant n'a plus qu'à la transformer en `style` React.
export function resolveBackground(home) {
  const h = normalizeHome(home);
  // Une image personnalisée prime : c'est un choix explicite de l'utilisateur.
  if (h.imageUrl) return { kind: 'image', imageUrl: h.imageUrl };
  const preset = HOME_BACKGROUNDS.find((b) => b.id === h.background);
  if (preset && preset.css) return { kind: 'gradient', css: preset.css };
  // Inconnu, ou preset « accent » → dégradé dynamique.
  return { kind: 'gradient', css: ACCENT_BACKGROUND };
}

// Style React du fond (sans le flou, qui exige un scale pour ne pas laisser
// apparaître les bords flous — c'est le rôle du composant).
export function backgroundStyle(bg) {
  if (!bg || bg.kind === 'image') {
    return {
      backgroundImage: bg && bg.imageUrl ? `url("${bg.imageUrl}")` : 'none',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundColor: '#07070c',
    };
  }
  return { backgroundImage: bg.css, backgroundColor: '#07070c' };
}

// Message d'accueil selon l'heure. On renvoie une CLÉ i18n (pas une phrase) :
// le composant la traduit, sinon on figerait le français ici.
export function greetingKey(date) {
  const d = date instanceof Date ? date : new Date();
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'home.greetMorning';
  if (h >= 12 && h < 18) return 'home.greetAfternoon';
  if (h >= 18 && h < 23) return 'home.greetEvening';
  return 'home.greetNight';
}
