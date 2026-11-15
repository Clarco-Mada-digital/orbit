// ---------------------------------------------------------------------------
// Thèmes importés (src/lib/customTheme.js).
//
// Deux choses sont testées ici, et la seconde compte autant que la première :
//
//   • qu'un fichier valide soit accepté, et un fichier cassé refusé ;
//   • que le REFUS SOIT UTILE. Un format qu'on adopte est un format dont les
//     messages d'erreur disent quoi corriger. « Thème invalide » renvoie
//     l'auteur à son fichier sans indice, et il abandonne. Plusieurs tests
//     vérifient donc que le message nomme la clé fautive.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_FORMAT,
  exportTheme,
  parseTheme,
  removeTheme,
  themeFileName,
  upsertTheme,
} from '../src/lib/customTheme.js';
import { PALETTE_KEYS, SKINS, resolveTheme, themeVars } from '../src/lib/themes.js';

// Une palette complète et lisible, pour servir de base aux cas de test.
const palette = (over = {}) => ({
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
  ...over,
});

const valid = (over = {}) => ({
  orbitTheme: THEME_FORMAT,
  id: 'nord',
  name: 'Nord',
  dark: palette(),
  light: palette({
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
  }),
  ...over,
});

const json = (obj) => JSON.stringify(obj);

// --- Le chemin heureux ----------------------------------------------------

test('parseTheme : un thème complet est accepté', () => {
  const res = parseTheme(json(valid()));
  assert.equal(res.ok, true, res.errors.join(' / '));
  assert.equal(res.theme.id, 'nord');
  assert.equal(res.theme.name, 'Nord');
  assert.deepEqual(res.warnings, []);
  for (const key of PALETTE_KEYS) {
    assert.ok(res.theme.dark[key], `couleur ${key} absente après lecture`);
  }
});

test('parseTheme : les couleurs hexadécimales sont converties', () => {
  // C'est ce que donnent tous les outils de design : les refuser ferait
  // trébucher l'auteur au premier essai.
  const res = parseTheme(json(valid({ dark: palette({ accent: '#22d3ee' }) })));
  assert.equal(res.ok, true, res.errors.join(' / '));
  assert.equal(res.theme.dark.accent, '34 211 238');
});

test('parseTheme : un thème importé se résout comme un thème livré', () => {
  // Tout le reste de l'application ne doit pas savoir d'où vient le thème.
  const { theme } = parseTheme(json(valid()));
  const resolved = resolveTheme('nord', 'dark', false, [theme]);
  assert.equal(resolved.skin, 'nord');
  assert.equal(resolved.custom, true);
  assert.equal(resolved.palette.accent, '99 102 241');
  // Et il produit des variables CSS complètes, caractère hérité compris
  const vars = themeVars(resolved);
  assert.ok(vars['--radius-card'], 'le caractère par défaut n’a pas été hérité');
  assert.equal(vars['--bg-primary'], '10 10 15');
});

test('parseTheme : le caractère est facultatif clé par clé', () => {
  const res = parseTheme(json(valid({ traits: { radiusCard: '0', glow: 1 } })));
  assert.equal(res.ok, true, res.errors.join(' / '));
  assert.deepEqual(res.theme.traits, { radiusCard: '0', glow: 1 });
  // Les clés absentes sont héritées à la résolution, pas inventées ici
  const resolved = resolveTheme('nord', 'dark', false, [res.theme]);
  assert.equal(resolved.traits.radiusCard, '0');
  assert.ok(resolved.traits.font, 'la police devait être héritée');
});

// --- Les refus, et leur utilité ------------------------------------------

test('parseTheme : un JSON cassé dit OÙ il casse', () => {
  const res = parseTheme('{ "orbitTheme": 1, ');
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /JSON illisible/);
  // Le message de JSON.parse mentionne la position : on le garde tel quel
  assert.ok(res.errors[0].length > 20, 'le message doit rester informatif');
});

test('parseTheme : une couleur fautive est NOMMÉE', () => {
  const res = parseTheme(json(valid({ dark: palette({ accent: 'bleu-ciel' }) })));
  assert.equal(res.ok, false);
  const message = res.errors.join('\n');
  assert.match(message, /dark\.accent/, 'le message doit nommer la clé fautive');
  assert.match(message, /R G B|RRGGBB/, 'le message doit dire ce qui est attendu');
});

test('parseTheme : une couleur manquante est nommée elle aussi', () => {
  const incomplete = palette();
  delete incomplete.textMuted;
  const res = parseTheme(json(valid({ dark: incomplete })));
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /dark\.textMuted.*manquante/);
});

test('parseTheme : une composante hors de 0-255 est refusée', () => {
  for (const bad of ['300 0 0', '-1 0 0', '10 10', '10 10 10 10', '1.5 0 0']) {
    const res = parseTheme(json(valid({ dark: palette({ accent: bad }) })));
    assert.equal(res.ok, false, `« ${bad} » aurait dû être refusé`);
  }
});

test('parseTheme : un identifiant de thème livré est refusé', () => {
  // Laisser passer écraserait un thème d'Orbit, irrécupérable sans supprimer
  // l'import.
  for (const id of SKINS) {
    const res = parseTheme(json(valid({ id })));
    assert.equal(res.ok, false, `« ${id} » aurait dû être refusé`);
    assert.match(res.errors.join('\n'), /déjà celui d’un thème/);
  }
});

test('parseTheme : identifiants mal formés refusés avec la règle', () => {
  for (const id of ['', 'A', 'mon theme', 'thème', 'x', '-abc', 'a'.repeat(33)]) {
    const res = parseTheme(json(valid({ id })));
    assert.equal(res.ok, false, `« ${id} » aurait dû être refusé`);
  }
  // Et les formes valides passent
  for (const id of ['nord', 'mon-theme', 'theme2099', 'ab']) {
    assert.equal(parseTheme(json(valid({ id }))).ok, true, `« ${id} » aurait dû être accepté`);
  }
});

test('parseTheme : version du format absente ou inconnue', () => {
  const missing = parseTheme(json(valid({ orbitTheme: undefined })));
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /orbitTheme/);

  const future = parseTheme(json(valid({ orbitTheme: 99 })));
  assert.equal(future.ok, false);
  assert.match(future.errors.join('\n'), /99/, 'le message doit citer la version lue');
});

test('parseTheme : sans aucune ambiance, refus', () => {
  const res = parseTheme(json(valid({ dark: undefined, light: undefined })));
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /au moins une ambiance/);
});

test('parseTheme : un réglage de forme inconnu liste ceux qui existent', () => {
  const res = parseTheme(json(valid({ traits: { rayon: '2px' } })));
  assert.equal(res.ok, false);
  const message = res.errors.join('\n');
  assert.match(message, /traits\.rayon/);
  assert.match(message, /radiusCard/, 'le message doit lister les réglages connus');
});

test('parseTheme : valeurs de forme mal typées', () => {
  const cases = [
    { traits: { radiusCard: 12 } }, // nombre au lieu d'une longueur CSS
    { traits: { radiusCard: 'gros' } },
    { traits: { glow: 5 } }, // hors de 0-1
    { traits: { glow: 'oui' } },
    { traits: { tracking: '2px' } }, // em attendu
    { traits: { uppercase: 'oui' } },
    { traits: { texture: 'vagues' } },
  ];
  for (const over of cases) {
    const res = parseTheme(json(valid(over)));
    assert.equal(res.ok, false, `${JSON.stringify(over)} aurait dû être refusé`);
  }
});

test('parseTheme : rien ne peut s’échapper dans une déclaration CSS', () => {
  // `font` et `shadowCard` partent dans des propriétés CSS. Un point-virgule
  // ou une accolade permettrait d'y glisser d'autres règles.
  for (const over of [
    { traits: { font: 'Inter; color: red' } },
    { traits: { font: 'a}body{display:none' } },
    { traits: { shadowCard: '0 0 0 red; position: fixed' } },
    { traits: { shadowCard: 'x'.repeat(250) } },
  ]) {
    const res = parseTheme(json(valid(over)));
    assert.equal(res.ok, false, `${JSON.stringify(over)} aurait dû être refusé`);
  }
});

test('parseTheme : un fichier vide ou démesuré est refusé sans exception', () => {
  assert.equal(parseTheme('').ok, false);
  assert.equal(parseTheme('   ').ok, false);
  assert.equal(parseTheme(null).ok, false);
  assert.equal(parseTheme('[]').ok, false);
  assert.equal(parseTheme('"texte"').ok, false);
  assert.equal(parseTheme(`{"x":"${'a'.repeat(300_000)}"}`).ok, false);
});

// --- Avertir sans interdire ----------------------------------------------

test('parseTheme : un thème peu lisible passe, avec un avertissement précis', () => {
  // C'est l'interface de son auteur : on le prévient, on ne lui interdit pas.
  const unreadable = palette({ textPrimary: '60 60 66', textMuted: '40 40 46' });
  const res = parseTheme(json(valid({ dark: unreadable, light: undefined })));
  assert.equal(res.ok, true, 'un thème peu lisible ne doit pas être REFUSÉ');
  const message = res.warnings.join('\n');
  assert.match(message, /Lisibilité/);
  assert.match(message, /textPrimary/, 'l’avertissement doit nommer la paire en cause');
  assert.match(message, /:1/, 'et donner le rapport mesuré');
});

test('parseTheme : une seule ambiance avertit sur le mode auto', () => {
  const res = parseTheme(json(valid({ light: undefined })));
  assert.equal(res.ok, true);
  assert.match(res.warnings.join('\n'), /auto/);
  // Et la résolution réutilise bien l'ambiance fournie
  const light = resolveTheme('nord', 'light', false, [res.theme]);
  assert.equal(light.palette.bgPrimary, '10 10 15');
});

// --- Export --------------------------------------------------------------

test('exportTheme : un thème livré ressort en fichier réimportable', () => {
  for (const skin of SKINS) {
    const text = exportTheme(skin);
    assert.ok(text, `${skin} non exporté`);
    const res = parseTheme(text);
    assert.equal(res.ok, true, `${skin} : export non réimportable — ${res.errors.join(' / ')}`);
    // L'identifiant est suffixé : sans ça, l'import buterait sur « id déjà pris »
    assert.notEqual(res.theme.id, skin);
    assert.deepEqual(res.warnings, [], `${skin} : l’export d’un thème livré ne doit rien signaler`);
  }
});

test('exportTheme : l’export d’un export reste importable (id borné)', () => {
  // Un identifiant long tronqué trop tard dépasserait les 32 caractères
  // autorisés, et la copie d'une copie serait refusée.
  let text = exportTheme('tech');
  for (let i = 0; i < 4; i += 1) {
    const res = parseTheme(text);
    assert.equal(res.ok, true, `tour ${i} : ${res.errors.join(' / ')}`);
    text = exportTheme(res.theme.id, [res.theme]);
    assert.ok(text, `tour ${i} : export impossible`);
  }
});

test('exportTheme : un thème inconnu ne rend rien', () => {
  assert.equal(exportTheme('inexistant'), null);
});

// --- Liste ---------------------------------------------------------------

test('upsertTheme : réimporter un thème corrigé le REMPLACE', () => {
  // Le geste le plus fréquent quand on écrit un thème : corriger et réimporter.
  const first = { id: 'nord', name: 'Nord' };
  const fixed = { id: 'nord', name: 'Nord v2' };
  const list = upsertTheme(upsertTheme([], first), fixed);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Nord v2');
});

test('upsertTheme / removeTheme : listes absentes tolérées', () => {
  assert.deepEqual(upsertTheme(null, { id: 'a' }), [{ id: 'a' }]);
  assert.deepEqual(removeTheme(null, 'a'), []);
  assert.deepEqual(removeTheme([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }]);
});

test('themeFileName : nom de fichier sûr', () => {
  assert.equal(themeFileName('nord'), 'orbit-theme-nord.json');
  assert.equal(themeFileName('Mon Thème/..'), 'orbit-theme-mon-th-me---.json');
  assert.equal(themeFileName(''), 'orbit-theme-theme.json');
});
