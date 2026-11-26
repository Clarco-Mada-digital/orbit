// ---------------------------------------------------------------------------
// Thèmes importés : lecture, validation, export.
//
// Un thème d'Orbit est un simple fichier JSON. Pas de CSS à écrire, pas de
// classe à connaître : des couleurs et une dizaine de réglages de forme. Le
// format est documenté dans docs/guide-themes.md, et ce module en est la
// référence exécutable — c'est lui qui décide ce qui est accepté.
//
// DEUX PRINCIPES qui expliquent presque tout le fichier.
//
// 1. UNE ERREUR DOIT DIRE QUOI CORRIGER. « Thème invalide » renvoie l'auteur
//    à son fichier sans indice. Chaque refus nomme donc la clé fautive et ce
//    qu'on attendait à la place. C'est la différence entre un format qu'on
//    peut adopter et un format qu'on abandonne.
//
// 2. ON AVERTIT, ON N'INTERDIT PAS. Un thème livré avec Orbit DOIT passer le
//    contrôle de contraste (test/themes.test.js le refuse sinon). Un thème
//    qu'un utilisateur écrit pour lui-même, non : c'est son interface, et lui
//    interdire un gris un peu sombre serait paternaliste. On nomme les paires
//    problématiques, il décide.
//
// Module SANS DÉPENDANCE : il lit du texte et rend des objets. Testé par
// test/customTheme.test.js.
// ---------------------------------------------------------------------------
import {
  BUILTIN_PALETTES,
  BUILTIN_TRAITS,
  PALETTE_KEYS,
  TRAIT_KEYS,
  TEXTURES,
  SKINS,
  checkContrast,
} from './themes.js';

// Version du format. Elle existe pour qu'un fichier écrit aujourd'hui puisse
// être reconnu — ou refusé avec un message clair — par une version future
// d'Orbit qui aurait changé de jetons.
export const THEME_FORMAT = 1;

// Un identifiant sert de clé de réglage : court, sans espace, stable.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

// Longueurs maximales : un fichier de thème n'a aucune raison d'être énorme,
// et un nom de 10 000 caractères casserait l'affichage du sélecteur.
const MAX_FILE_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 48;
// Auteur et description : facultatifs, utiles pour partager un thème (catalogue
// de la communauté). Du texte pur, coupé à cette longueur.
const MAX_DESCRIPTION_LENGTH = 160;

// Triplet RGB « R G B », chaque composante de 0 à 255. C'est le format que
// Tailwind attend (`rgb(var(--bg-primary))`), et il accepte donc aussi bien
// « 10 10 15 » que « 10  10  15 ».
function parseTriplet(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return numbers.join(' ');
}

// Une couleur écrite en hexadécimal est acceptée et convertie : c'est ce que
// donnent tous les outils de design, et refuser « #0a0a0f » pour exiger
// « 10 10 15 » ferait trébucher tout le monde au premier essai.
function parseColor(value) {
  if (typeof value === 'string') {
    const hex = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    if (hex) {
      const h = hex[1];
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
    }
  }
  return parseTriplet(value);
}

// Longueur CSS acceptée pour un rayon ou une épaisseur. On n'accepte pas
// n'importe quelle chaîne : elle part dans une variable CSS, et une valeur
// fantaisiste casserait silencieusement la mise en page au lieu d'être
// signalée ici.
const LENGTH_PATTERN = /^(0|[0-9]*\.?[0-9]+(px|rem|em|%))$/;

function validatePalette(raw, where, errors) {
  if (!raw || typeof raw !== 'object') return null;
  const palette = {};
  for (const key of PALETTE_KEYS) {
    const color = parseColor(raw[key]);
    if (!color) {
      errors.push(
        raw[key] === undefined
          ? `${where}.${key} : couleur manquante`
          : `${where}.${key} : « ${String(raw[key]).slice(0, 24)} » n’est pas une couleur ` +
            '(attendu « R G B » de 0 à 255, ou #RRGGBB)'
      );
      continue;
    }
    palette[key] = color;
  }
  return palette;
}

// Le caractère est FACULTATIF, clé par clé : un thème qui ne veut changer que
// les couleurs n'a rien à écrire ici, et hérite de la silhouette d'Orbit.
function validateTraits(raw, errors) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object') {
    errors.push('traits : doit être un objet (ou absent)');
    return {};
  }
  const traits = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TRAIT_KEYS.includes(key)) {
      errors.push(`traits.${key} : réglage inconnu (connus : ${TRAIT_KEYS.join(', ')})`);
      continue;
    }
    switch (key) {
      case 'radiusCard':
      case 'radiusControl':
      case 'radiusPill':
      case 'borderWidth':
        // `9999px` pour une pastille complètement ronde est courant : on ne
        // borne pas la valeur, seulement sa forme.
        if (typeof value !== 'string' || !LENGTH_PATTERN.test(value.trim())) {
          errors.push(`traits.${key} : longueur CSS attendue (ex. « 2px », « 0.75rem », « 0 »)`);
        } else {
          traits[key] = value.trim();
        }
        break;
      case 'glow': {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 1) {
          errors.push('traits.glow : nombre de 0 (aucun halo) à 1 (halo franc)');
        } else {
          traits[key] = n;
        }
        break;
      }
      case 'tracking':
        if (typeof value !== 'string' || !/^-?[0-9]*\.?[0-9]+em$/.test(value.trim())) {
          errors.push('traits.tracking : interlettrage en em (ex. « 0em », « 0.04em »)');
        } else {
          traits[key] = value.trim();
        }
        break;
      case 'uppercase':
        if (typeof value !== 'boolean') errors.push('traits.uppercase : true ou false');
        else traits[key] = value;
        break;
      case 'texture':
        if (!TEXTURES.includes(value)) {
          errors.push(`traits.texture : au choix ${TEXTURES.join(', ')}`);
        } else {
          traits[key] = value;
        }
        break;
      case 'shadowCard':
        // Une ombre est une valeur CSS libre : on vérifie seulement qu'elle
        // reste courte et sans caractère capable de sortir de la déclaration.
        if (typeof value !== 'string' || value.length > 200 || /[;{}<>]/.test(value)) {
          errors.push('traits.shadowCard : ombre CSS courte, ou « none »');
        } else {
          traits[key] = value.trim();
        }
        break;
      case 'font':
        // La police part dans `font-family` : on refuse les caractères qui
        // permettraient d'y glisser autre chose.
        if (typeof value !== 'string' || !value.trim() || value.length > 64 || /[;{}<>"']/.test(value)) {
          errors.push('traits.font : nom de police simple (ex. « Inter », « JetBrains Mono »)');
        } else {
          traits[key] = value.trim();
        }
        break;
      default:
        break;
    }
  }
  return traits;
}

// --- Lecture d'un fichier -------------------------------------------------
//
// Rend TOUJOURS la même forme, jamais d'exception :
//   { ok, theme, errors: [...], warnings: [...] }
//
// `errors` empêche l'import. `warnings` ne l'empêche pas — c'est là que vont
// les problèmes de contraste et les ambiances manquantes.
export function parseTheme(text) {
  const errors = [];
  const warnings = [];

  const source = String(text ?? '');
  if (!source.trim()) return { ok: false, theme: null, errors: ['Fichier vide'], warnings };
  if (source.length > MAX_FILE_BYTES) {
    return { ok: false, theme: null, errors: ['Fichier trop volumineux pour un thème'], warnings };
  }

  let raw;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    // Le message de JSON.parse indique la position : il est plus utile que
    // n'importe quelle reformulation de notre part.
    return { ok: false, theme: null, errors: [`JSON illisible : ${error.message}`], warnings };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, theme: null, errors: ['Le fichier doit contenir un objet JSON'], warnings };
  }

  // Version du format
  const format = raw.orbitTheme;
  if (format === undefined) {
    errors.push(`orbitTheme : version du format manquante (attendu ${THEME_FORMAT})`);
  } else if (format !== THEME_FORMAT) {
    errors.push(
      `orbitTheme : version ${format} non reconnue — cette version d’Orbit lit le format ${THEME_FORMAT}`
    );
  }

  // Identifiant
  const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
  if (!ID_PATTERN.test(id)) {
    errors.push(
      'id : 2 à 32 caractères, minuscules, chiffres ou tirets (ex. « nord », « mon-theme »)'
    );
  } else if (SKINS.includes(id)) {
    // Laisser passer écraserait un thème livré, qu'on ne pourrait plus
    // retrouver sans supprimer l'import.
    errors.push(`id : « ${id} » est déjà celui d’un thème d’Orbit — choisissez-en un autre`);
  }

  // Nom affiché
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) errors.push('name : nom affiché manquant');
  else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`name : ${MAX_NAME_LENGTH} caractères au maximum`);
  }

  // Auteur et description (facultatifs) : jamais une erreur, seulement coupés.
  const author = typeof raw.author === 'string' ? raw.author.trim().slice(0, MAX_NAME_LENGTH) : '';
  const description =
    typeof raw.description === 'string' ? raw.description.trim().slice(0, MAX_DESCRIPTION_LENGTH) : '';

  // Ambiances. Au moins une est exigée ; les deux sont recommandées.
  const hasDark = raw.dark !== undefined;
  const hasLight = raw.light !== undefined;
  if (!hasDark && !hasLight) {
    errors.push('Il faut au moins une ambiance : « dark », « light », ou les deux');
  }
  const dark = hasDark ? validatePalette(raw.dark, 'dark', errors) : null;
  const light = hasLight ? validatePalette(raw.light, 'light', errors) : null;
  if (hasDark && !dark) errors.push('dark : doit être un objet de couleurs');
  if (hasLight && !light) errors.push('light : doit être un objet de couleurs');

  if (hasDark !== hasLight) {
    warnings.push(
      `Ce thème ne décrit que l’ambiance « ${hasDark ? 'dark' : 'light'} » : elle servira aussi ` +
        'pour l’autre. Le mode « auto » n’aura donc aucun effet sur lui.'
    );
  }

  const traits = validateTraits(raw.traits, errors);

  if (errors.length) return { ok: false, theme: null, errors, warnings };

  const theme = {
    id,
    name,
    ...(author ? { author } : {}),
    ...(description ? { description } : {}),
    traits,
    ...(dark ? { dark } : {}),
    ...(light ? { light } : {}),
  };

  // Contraste : on avertit, paire par paire, sans refuser.
  for (const mode of ['dark', 'light']) {
    const palette = theme[mode];
    if (!palette) continue;
    for (const failure of checkContrast(palette)) {
      warnings.push(
        `Lisibilité (${mode}) : ${failure.text} sur ${failure.bg} donne ${failure.ratio}:1, ` +
          `en dessous du minimum conseillé de ${failure.min}:1`
      );
    }
  }

  return { ok: true, theme, errors, warnings };
}

// --- Export ---------------------------------------------------------------

// Un thème livré, rendu sous forme de fichier importable. C'est le point de
// départ le plus utile pour qui veut créer le sien : on exporte « tech », on
// change trois couleurs, on réimporte.
export function exportTheme(skin, customThemes = null) {
  const custom = (Array.isArray(customThemes) ? customThemes : []).find((c) => c?.id === skin);
  if (custom) {
    return serialize({
      // Un thème exporté puis réimporté entrerait en conflit avec lui-même :
      // on suffixe l'identifiant et le nom pour que la copie soit distincte.
      id: suffixId(custom.id),
      name: `${custom.name} (copie)`,
      author: custom.author,
      description: custom.description,
      traits: custom.traits || {},
      dark: custom.dark,
      light: custom.light,
    });
  }

  if (!SKINS.includes(skin)) return null;
  return serialize({
    id: suffixId(skin),
    name: `${skin} (copie)`,
    traits: BUILTIN_TRAITS[skin],
    dark: BUILTIN_PALETTES[skin].dark,
    light: BUILTIN_PALETTES[skin].light,
  });
}

function suffixId(id) {
  // 32 caractères au maximum, comme ID_PATTERN l'exige : on tronque avant
  // d'ajouter le suffixe, sinon l'export d'un id long serait irréimportable.
  return `${String(id).slice(0, 25)}-copie`;
}

function serialize({ id, name, author, description, traits, dark, light }) {
  const body = {
    orbitTheme: THEME_FORMAT,
    id,
    name,
    ...(author ? { author } : {}),
    ...(description ? { description } : {}),
    traits,
    ...(dark ? { dark } : {}),
    ...(light ? { light } : {}),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

// --- Gestion de la liste --------------------------------------------------

// Ajoute ou remplace un thème dans la liste des thèmes personnalisés.
// Réimporter un thème corrigé est le geste le plus fréquent pendant qu'on en
// écrit un : il remplace, il ne s'ajoute pas en double.
export function upsertTheme(list, theme) {
  const current = Array.isArray(list) ? list : [];
  const index = current.findIndex((c) => c?.id === theme.id);
  if (index === -1) return [...current, theme];
  const next = [...current];
  next[index] = theme;
  return next;
}

export function removeTheme(list, id) {
  return (Array.isArray(list) ? list : []).filter((c) => c?.id !== id);
}

// Nom de fichier proposé à l'enregistrement.
export function themeFileName(id) {
  const safe = String(id || 'theme').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `orbit-theme-${safe || 'theme'}.json`;
}
