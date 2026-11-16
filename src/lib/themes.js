// ---------------------------------------------------------------------------
// Thèmes d'Orbit : DEUX AXES indépendants.
//
//   skin  — l'identité visuelle   : orbit | tech | paper | amber
//   mode  — l'ambiance            : dark | light | auto (suit le système)
//
// Pourquoi deux axes et pas une liste à plat. Le réglage d'origine mélangeait
// les deux (`theme: 'dark' | 'light' | 'auto'`). Ajouter « tech » à cette
// liste aurait condamné Tech à n'exister qu'en une seule ambiance, et « auto »
// — qui suit le système — n'aurait plus rien voulu dire pour lui. Chaque thème
// a donc sa déclinaison claire ET sombre.
//
// Ce qu'un thème porte. Pas seulement des couleurs : si on ne change que la
// teinte, « Tech » n'est qu'un mode sombre avec un autre accent. Le CARACTÈRE
// vient des `traits` — rayon des angles, épaisseur du liseré, halo, police,
// interlettrage, texture de fond. C'est ce qui fait qu'un thème se reconnaît
// au premier coup d'œil, écran coupé en deux.
//
// Module SANS DÉPENDANCE : il décrit et il calcule, il ne touche pas au DOM
// (c'est App.jsx qui pose les variables). Testé par test/themes.test.js, qui
// vérifie notamment le CONTRASTE de chaque paire texte/fond : un joli thème
// illisible ne doit pas pouvoir être livré.
// ---------------------------------------------------------------------------

export const SKINS = ['orbit', 'tech', 'paper', 'amber', 'noel'];
export const MODES = ['auto', 'dark', 'light'];

export const DEFAULT_SKIN = 'orbit';
export const DEFAULT_MODE = 'dark';

// --- Caractère -------------------------------------------------------------
//
// Valeurs communes aux deux ambiances d'un même thème : la silhouette ne
// change pas quand on passe du clair au sombre, seules les couleurs bougent.
//
//   radiusCard/Control/Pill  arrondis (0 = angles vifs)
//   borderWidth              épaisseur du liseré
//   shadowCard               ombre portée des surfaces ('none' = tout plat)
//   glow                     intensité du halo d'accent (0 = aucun)
//   font                     police de l'interface
//   tracking                 interlettrage (em)
//   uppercase                libellés de section en capitales
//   texture                  fond de l'application ('none' | 'grid' | 'glow')
const TRAITS = {
  orbit: {
    radiusCard: '0.75rem',
    radiusControl: '0.5rem',
    radiusPill: '9999px',
    borderWidth: '1px',
    shadowCard: '0 10px 15px -3px rgb(0 0 0 / 0.25)',
    glow: 0,
    font: 'Inter',
    tracking: '0em',
    uppercase: false,
    texture: 'none',
  },
  // Tech : angles vifs, liseré net, halo franc, police technique. Tout ce qui
  // adoucit l'interface est retiré — pas d'arrondi, pas d'ombre diffuse, mais
  // une lueur d'accent qui souligne les bords.
  tech: {
    radiusCard: '2px',
    radiusControl: '1px',
    radiusPill: '2px',
    borderWidth: '1px',
    shadowCard: 'none',
    glow: 1,
    font: 'JetBrains Mono',
    tracking: '0.04em',
    uppercase: true,
    texture: 'grid',
  },
  // Papier : l'opposé. Aucun relief, aucun halo, arrondi généreux, très peu de
  // contraste de surface — pour travailler des heures sans fatigue.
  paper: {
    radiusCard: '1rem',
    radiusControl: '0.625rem',
    radiusPill: '9999px',
    borderWidth: '1px',
    shadowCard: 'none',
    glow: 0,
    font: 'Inter',
    tracking: '0em',
    uppercase: false,
    texture: 'none',
  },
  // Nuit chaude : ambre et brun au lieu du bleu. Relief doux, halo discret.
  amber: {
    radiusCard: '0.875rem',
    radiusControl: '0.5rem',
    radiusPill: '9999px',
    borderWidth: '1px',
    shadowCard: '0 8px 20px -6px rgb(0 0 0 / 0.45)',
    glow: 0.35,
    font: 'Inter',
    tracking: '0em',
    uppercase: false,
    texture: 'glow',
  },
  // Noël : sapin, or et neige. Arrondis doux, lueur chaude comme une guirlande
  // — assez marquée pour se voir, assez discrète pour travailler dessus.
  noel: {
    radiusCard: '0.875rem',
    radiusControl: '0.625rem',
    radiusPill: '9999px',
    borderWidth: '1px',
    shadowCard: '0 8px 24px -10px rgb(0 0 0 / 0.5)',
    glow: 0.55,
    font: 'Inter',
    tracking: '0.01em',
    uppercase: false,
    texture: 'glow',
  },
};

// --- Palettes --------------------------------------------------------------
//
// Triplets RGB (le format attendu par Tailwind v4 via `rgb(var(--x))`).
// `accent` est la couleur SIGNATURE du thème : une proposition, que le choix
// explicite de l'utilisateur écrase (voir resolveAccent plus bas).
const PALETTES = {
  orbit: {
    dark: {
      bgPrimary: '10 10 15',
      bgSecondary: '19 19 26',
      bgElevated: '28 28 36',
      bgHover: '37 37 47',
      textPrimary: '228 231 235',
      textSecondary: '156 163 175',
      textMuted: '128 135 148',
      border: '37 37 47',
      borderLight: '42 42 56',
      accent: '99 102 241',
    },
    light: {
      bgPrimary: '247 248 251',
      bgSecondary: '255 255 255',
      bgElevated: '243 244 248',
      bgHover: '235 237 242',
      textPrimary: '17 24 39',
      textSecondary: '75 85 99',
      textMuted: '107 114 128',
      border: '226 229 236',
      borderLight: '213 217 226',
      accent: '79 70 229',
    },
  },
  tech: {
    dark: {
      // Noir bleuté très profond : c'est lui qui fait ressortir le halo cyan.
      bgPrimary: '4 8 14',
      bgSecondary: '9 15 24',
      bgElevated: '14 22 34',
      bgHover: '21 32 47',
      textPrimary: '219 240 248',
      textSecondary: '150 180 198',
      textMuted: '120 150 170',
      border: '28 48 68',
      borderLight: '38 64 90',
      accent: '34 211 238',
    },
    light: {
      // Déclinaison claire : blanc froid légèrement bleuté, liseré net. Le
      // cyan est assombri — sur fond clair, le cyan vif ne se voit plus.
      bgPrimary: '240 245 249',
      bgSecondary: '255 255 255',
      bgElevated: '236 243 248',
      bgHover: '222 234 243',
      textPrimary: '8 20 30',
      textSecondary: '51 74 92',
      textMuted: '82 104 122',
      border: '198 216 229',
      borderLight: '180 202 218',
      accent: '14 116 144',
    },
  },
  paper: {
    light: {
      // Blanc cassé chaud, pas de blanc pur : moins d'éblouissement.
      bgPrimary: '250 249 246',
      bgSecondary: '255 254 252',
      bgElevated: '246 244 240',
      bgHover: '238 236 230',
      textPrimary: '38 36 32',
      textSecondary: '82 78 71',
      textMuted: '112 107 98',
      border: '228 225 218',
      borderLight: '218 214 206',
      accent: '120 86 54',
    },
    dark: {
      // Gris chaud plutôt que noir : même esprit reposant, la nuit.
      bgPrimary: '26 25 23',
      bgSecondary: '33 32 29',
      bgElevated: '42 40 37',
      bgHover: '54 51 47',
      textPrimary: '234 231 225',
      textSecondary: '176 170 161',
      textMuted: '146 140 131',
      border: '54 51 47',
      borderLight: '66 62 57',
      accent: '196 160 118',
    },
  },
  noel: {
    dark: {
      // Vert sapin très profond : le fond d'un soir de réveillon.
      bgPrimary: '9 20 16',
      bgSecondary: '14 28 22',
      bgElevated: '20 37 30',
      bgHover: '28 49 40',
      // Blanc de neige, un peu chaud pour ne pas bleuir sur le vert.
      textPrimary: '244 241 233',
      textSecondary: '201 215 205',
      textMuted: '140 166 152',
      border: '30 52 42',
      borderLight: '40 66 54',
      // Or des boules et des étoiles : c'est la signature du thème.
      accent: '230 190 105',
    },
    light: {
      // Neige : blancs légèrement verts, jamais du blanc pur.
      bgPrimary: '246 249 246',
      bgSecondary: '255 255 255',
      bgElevated: '236 243 238',
      bgHover: '226 236 230',
      textPrimary: '15 35 26',
      textSecondary: '51 82 66',
      textMuted: '92 116 103',
      border: '210 224 214',
      borderLight: '196 213 202',
      // Baie de houx : le rouge de Noël tient le rôle d'accent sur fond clair,
      // là où l'or deviendrait illisible.
      accent: '178 34 52',
    },
  },
  amber: {
    dark: {
      bgPrimary: '18 13 9',
      bgSecondary: '26 19 13',
      bgElevated: '36 26 18',
      bgHover: '48 35 24',
      textPrimary: '245 232 216',
      textSecondary: '196 176 154',
      textMuted: '164 144 122',
      border: '55 40 27',
      borderLight: '72 53 36',
      accent: '245 158 11',
    },
    light: {
      // Crème : la même chaleur, de jour.
      bgPrimary: '252 247 238',
      bgSecondary: '255 252 246',
      bgElevated: '249 242 230',
      bgHover: '243 233 216',
      textPrimary: '41 29 17',
      textSecondary: '92 70 45',
      textMuted: '122 96 66',
      border: '234 221 200',
      borderLight: '224 208 184',
      accent: '161 98 7',
    },
  },
};

// Nom affiché et pitch, pour le sélecteur de thème. Les clés i18n vivent dans
// le dictionnaire ; on garde ici le nom propre, qui ne se traduit pas.
export const SKIN_META = [
  { id: 'orbit', name: 'Orbit', descKey: 'st.skin.orbit' },
  { id: 'tech', name: 'Tech', descKey: 'st.skin.tech' },
  { id: 'paper', name: 'Papier', descKey: 'st.skin.paper' },
  { id: 'amber', name: 'Nuit chaude', descKey: 'st.skin.amber' },
  { id: 'noel', name: 'Noël', descKey: 'st.skin.noel' },
];

// Tables des thèmes LIVRÉS. Exportées pour deux usages : l'export d'un thème
// comme point de départ (« je veux partir du Tech et changer trois couleurs »)
// et la documentation, qui liste les jetons attendus.
export const BUILTIN_TRAITS = TRAITS;
export const BUILTIN_PALETTES = PALETTES;

// Jetons attendus d'une palette et d'un caractère. Une seule source, dont se
// servent la validation d'un thème importé (src/lib/customTheme.js), le test
// de contraste et le guide de création — qui ne peuvent donc plus diverger de
// ce que le code lit vraiment.
export const PALETTE_KEYS = [
  'bgPrimary', 'bgSecondary', 'bgElevated', 'bgHover',
  'textPrimary', 'textSecondary', 'textMuted',
  'border', 'borderLight', 'accent',
];

export const TRAIT_KEYS = [
  'radiusCard', 'radiusControl', 'radiusPill',
  'borderWidth', 'shadowCard', 'glow',
  'font', 'tracking', 'uppercase', 'texture',
];

export const TEXTURES = ['none', 'grid', 'glow'];

// --- Résolution ------------------------------------------------------------

// Thèmes personnalisés : un tableau d'objets déjà validés par
// src/lib/customTheme.js. On les indexe par id pour que la résolution les
// trouve aussi vite qu'un thème livré.
function customById(customThemes) {
  const map = new Map();
  for (const theme of Array.isArray(customThemes) ? customThemes : []) {
    if (theme?.id) map.set(theme.id, theme);
  }
  return map;
}

// La liste complète des identifiants disponibles, thèmes importés compris.
export function availableSkins(customThemes) {
  return [...SKINS, ...customById(customThemes).keys()];
}

export function normalizeSkin(skin, customThemes) {
  if (SKINS.includes(skin)) return skin;
  if (customById(customThemes).has(skin)) return skin;
  return DEFAULT_SKIN;
}

export function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : DEFAULT_MODE;
}

// Mode EFFECTIF : « auto » devient clair ou sombre selon le système.
export function effectiveMode(mode, prefersLight = false) {
  const normalized = normalizeMode(mode);
  if (normalized !== 'auto') return normalized;
  return prefersLight ? 'light' : 'dark';
}

// Le thème complet (palette + caractère) pour un couple skin/mode.
//
// `customThemes` permet de résoudre un thème IMPORTÉ exactement comme un thème
// livré : tout le reste de l'application (variables CSS, aperçus, contraste)
// n'a donc pas à savoir d'où vient le thème affiché.
//
// Un thème importé peut ne décrire qu'UNE ambiance. Plutôt que de laisser un
// trou — qui casserait le mode « auto » — on réutilise celle qu'il fournit :
// mieux vaut un thème qui ne change pas avec le système qu'une interface sans
// couleurs. Le guide de création le dit explicitement.
export function resolveTheme(skin, mode, prefersLight = false, customThemes = null) {
  const id = normalizeSkin(skin, customThemes);
  const resolved = effectiveMode(mode, prefersLight);
  const custom = customById(customThemes).get(id);

  if (custom) {
    const palette = custom[resolved] || custom.dark || custom.light;
    return {
      skin: id,
      mode: resolved,
      palette,
      traits: { ...TRAITS[DEFAULT_SKIN], ...(custom.traits || {}) },
      custom: true,
      name: custom.name || id,
    };
  }

  return {
    skin: id,
    mode: resolved,
    palette: PALETTES[id][resolved],
    traits: TRAITS[id],
    custom: false,
    name: SKIN_META.find((m) => m.id === id)?.name || id,
  };
}

// --- Migration -------------------------------------------------------------
//
// Les réglages d'avant ne connaissent que `theme: 'dark' | 'light' | 'auto'`.
// Les lire comme un thème donnerait « thème inconnu → orbit sombre », donc
// une surprise au premier démarrage pour qui travaillait en clair.
//
// On rend TOUJOURS un couple valide, sans jamais écrire dans les réglages :
// l'ancienne valeur reste en place, et une installation qui reviendrait à une
// version précédente retrouve son réglage intact.
export function migrateThemeSetting({ themeSkin, themeMode, theme } = {}, customThemes = null) {
  // Réglage déjà à deux axes : on le prend tel quel.
  if (themeSkin || themeMode) {
    return { skin: normalizeSkin(themeSkin, customThemes), mode: normalizeMode(themeMode) };
  }
  // Ancien réglage : l'apparence d'alors devient le thème « orbit », et la
  // valeur devient le MODE — c'était bien de l'ambiance qu'il s'agissait.
  if (MODES.includes(theme)) return { skin: DEFAULT_SKIN, mode: theme };
  return { skin: DEFAULT_SKIN, mode: DEFAULT_MODE };
}

// --- Accent ---------------------------------------------------------------
//
// Conflit réel, trouvé en lisant App.jsx : l'accent est posé en style INLINE
// sur `:root`, ce qui bat toute règle CSS d'un thème. La couleur signature
// d'un thème serait donc silencieusement écrasée.
//
// La règle retenue : le thème PROPOSE, l'utilisateur DISPOSE.
//   • accent choisi explicitement (ou accent du profil actif) → il gagne ;
//   • sinon → la couleur signature du thème.
//
// `userAccent` doit être null/'' quand l'utilisateur n'a rien choisi : c'est
// à l'appelant de ne pas transmettre la valeur par défaut historique.
export function resolveAccent(theme, userAccent) {
  const hex = String(userAccent || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hexToTriplet(hex);
  return theme.palette.accent;
}

export function hexToTriplet(hex) {
  const value = String(hex).replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

// Éclaircit un triplet vers le blanc (survol, accent clair).
export function mixWhite(triplet, ratio) {
  const [r, g, b] = triplet.split(/\s+/).map(Number);
  const mix = (c) => Math.round(c + (255 - c) * ratio);
  return `${mix(r)} ${mix(g)} ${mix(b)}`;
}

// --- Variables CSS ---------------------------------------------------------
//
// Tout ce qu'App.jsx doit poser sur <html>. Un seul objet : le jour où un
// thème ajoute un jeton, il n'y a qu'ici à toucher.
export function themeVars(theme, userAccent = null) {
  const { palette: p, traits: tr } = theme;
  const accent = resolveAccent(theme, userAccent);
  return {
    '--bg-primary': p.bgPrimary,
    '--bg-secondary': p.bgSecondary,
    '--bg-elevated': p.bgElevated,
    '--bg-hover': p.bgHover,
    '--text-primary': p.textPrimary,
    '--text-secondary': p.textSecondary,
    '--text-muted': p.textMuted,
    '--border': p.border,
    '--border-light': p.borderLight,
    '--accent-primary': accent,
    '--accent-hover': mixWhite(accent, 0.15),
    '--accent-light': mixWhite(accent, 0.4),
    // Caractère
    '--radius-card': tr.radiusCard,
    '--radius-control': tr.radiusControl,
    '--radius-pill': tr.radiusPill,
    '--border-width': tr.borderWidth,
    '--shadow-card': tr.shadowCard,
    '--glow': String(tr.glow),
    '--tracking': tr.tracking,
  };
}

// --- Contraste (WCAG 2.1) --------------------------------------------------
//
// Sert au test de garde ET au sélecteur de thème. Un thème « tech » néon sur
// noir est exactement le cas où le texte devient illisible sans qu'on s'en
// aperçoive en le dessinant.

function channelLuminance(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(triplet) {
  const [r, g, b] = String(triplet).split(/\s+/).map(Number);
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

// Rapport de contraste entre deux triplets : de 1 (identiques) à 21
// (noir sur blanc).
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// Paires qui doivent rester lisibles, avec leur seuil.
//
// Les seuils ne sont pas tous à 4.5 : `textMuted` sert à des mentions
// secondaires (sous-titres, légendes) pour lesquelles WCAG admet 3:1 en
// grande taille, et l'exiger à 4.5 obligerait à un gris si sombre qu'il ne
// se distinguerait plus du texte normal — on perdrait la hiérarchie qu'il
// sert justement à créer.
export const CONTRAST_RULES = [
  { text: 'textPrimary', bg: 'bgPrimary', min: 4.5 },
  { text: 'textPrimary', bg: 'bgSecondary', min: 4.5 },
  { text: 'textPrimary', bg: 'bgElevated', min: 4.5 },
  { text: 'textSecondary', bg: 'bgPrimary', min: 4.5 },
  { text: 'textSecondary', bg: 'bgElevated', min: 4.5 },
  { text: 'textMuted', bg: 'bgPrimary', min: 3 },
  { text: 'textMuted', bg: 'bgElevated', min: 3 },
  { text: 'accent', bg: 'bgPrimary', min: 3 },
  { text: 'accent', bg: 'bgElevated', min: 3 },
];

// Vérifie une palette. Rend la liste des manquements (vide = tout va bien).
export function checkContrast(palette) {
  const failures = [];
  for (const rule of CONTRAST_RULES) {
    const ratio = contrastRatio(palette[rule.text], palette[rule.bg]);
    if (ratio < rule.min) {
      failures.push({ ...rule, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return failures;
}

// Toutes les palettes livrées, pour le test de garde et le sélecteur.
export function allPalettes() {
  const out = [];
  for (const skin of SKINS) {
    for (const mode of ['dark', 'light']) {
      out.push({ skin, mode, palette: PALETTES[skin][mode] });
    }
  }
  return out;
}
