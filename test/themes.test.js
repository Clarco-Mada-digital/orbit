// ---------------------------------------------------------------------------
// Thèmes (src/lib/themes.js).
//
// Le test central est celui du CONTRASTE. Un thème se dessine à l'œil, et
// l'œil se trompe : un cyan néon sur noir profond paraît éclatant alors que
// le gris des sous-titres, lui, est devenu illisible. Personne ne s'en rend
// compte avant qu'un utilisateur ne travaille deux heures dedans.
//
// Ce fichier refuse donc une palette illisible AVANT qu'elle ne soit livrée.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKINS,
  MODES,
  DEFAULT_SKIN,
  DEFAULT_MODE,
  SKIN_META,
  CONTRAST_RULES,
  allPalettes,
  checkContrast,
  contrastRatio,
  effectiveMode,
  hexToTriplet,
  migrateThemeSetting,
  mixWhite,
  normalizeMode,
  normalizeSkin,
  relativeLuminance,
  resolveAccent,
  resolveTheme,
  themeVars,
} from '../src/lib/themes.js';

// --- Contraste : la garde ------------------------------------------------

test('contrastRatio : valeurs de référence', () => {
  // Noir sur blanc = 21:1, c'est la borne haute de WCAG
  assert.equal(Math.round(contrastRatio('0 0 0', '255 255 255')), 21);
  // Une couleur contre elle-même = 1:1
  assert.equal(contrastRatio('80 80 80', '80 80 80'), 1);
  assert.ok(relativeLuminance('255 255 255') > relativeLuminance('0 0 0'));
});

test('CHAQUE thème livré reste lisible dans les deux ambiances', () => {
  const problems = [];
  for (const { skin, mode, palette } of allPalettes()) {
    for (const failure of checkContrast(palette)) {
      problems.push(
        `${skin}/${mode} : ${failure.text} sur ${failure.bg} = ${failure.ratio}:1 ` +
          `(minimum ${failure.min}:1)`
      );
    }
  }
  assert.deepEqual(problems, [], `palettes illisibles :\n  - ${problems.join('\n  - ')}`);
});

test('les huit palettes existent (4 thèmes × 2 ambiances)', () => {
  const palettes = allPalettes();
  assert.equal(palettes.length, SKINS.length * 2);
  // Aucune couleur manquante : un jeton absent donnerait du texte invisible
  const keys = CONTRAST_RULES.flatMap((r) => [r.text, r.bg]);
  for (const { skin, mode, palette } of palettes) {
    for (const key of keys) {
      assert.ok(palette[key], `${skin}/${mode} : jeton « ${key} » absent`);
    }
  }
});

test('chaque thème a une signature DIFFÉRENTE des autres', () => {
  // Deux thèmes qui se ressemblent au point d'avoir le même accent et le même
  // fond ne sont pas deux thèmes : c'est le même, livré deux fois.
  const seen = new Map();
  for (const { skin, mode, palette } of allPalettes()) {
    const signature = `${mode}:${palette.accent}:${palette.bgPrimary}`;
    const previous = seen.get(signature);
    assert.equal(previous, undefined, `${skin} et ${previous} sont indiscernables en ${mode}`);
    seen.set(signature, skin);
  }
});

// --- Deux axes -----------------------------------------------------------

test('resolveTheme : chaque couple thème/ambiance rend palette ET caractère', () => {
  for (const skin of SKINS) {
    for (const mode of ['dark', 'light']) {
      const theme = resolveTheme(skin, mode);
      assert.equal(theme.skin, skin);
      assert.equal(theme.mode, mode);
      assert.ok(theme.palette, `${skin}/${mode} sans palette`);
      assert.ok(theme.traits, `${skin}/${mode} sans caractère`);
      assert.ok(theme.traits.font, `${skin}/${mode} sans police`);
    }
  }
});

test('resolveTheme : le caractère ne change pas avec l’ambiance', () => {
  // La silhouette d'un thème est son identité : passer du clair au sombre
  // change les couleurs, pas les angles.
  for (const skin of SKINS) {
    const dark = resolveTheme(skin, 'dark');
    const light = resolveTheme(skin, 'light');
    assert.deepEqual(dark.traits, light.traits, `${skin} change de silhouette selon l’ambiance`);
  }
});

test('effectiveMode : « auto » suit le système', () => {
  assert.equal(effectiveMode('auto', true), 'light');
  assert.equal(effectiveMode('auto', false), 'dark');
  // Un choix explicite ne suit rien
  assert.equal(effectiveMode('dark', true), 'dark');
  assert.equal(effectiveMode('light', false), 'light');
});

test('normalizeSkin / normalizeMode : une valeur inconnue retombe sur le défaut', () => {
  assert.equal(normalizeSkin('néon-2099'), DEFAULT_SKIN);
  assert.equal(normalizeSkin(undefined), DEFAULT_SKIN);
  assert.equal(normalizeMode('sépia'), DEFAULT_MODE);
  // Et un thème inconnu ne fait pas planter la résolution
  const theme = resolveTheme('néon-2099', 'sépia');
  assert.equal(theme.skin, DEFAULT_SKIN);
  assert.ok(theme.palette);
});

test('SKIN_META couvre exactement les thèmes livrés', () => {
  assert.deepEqual(SKIN_META.map((s) => s.id).sort(), [...SKINS].sort());
  for (const meta of SKIN_META) {
    assert.ok(meta.name, `${meta.id} sans nom affiché`);
    assert.ok(meta.descKey, `${meta.id} sans clé de description`);
  }
});

// --- Migration -----------------------------------------------------------

test('migrateThemeSetting : l’ancien réglage devient une AMBIANCE, pas un thème', () => {
  // `theme: 'light'` voulait dire « je travaille en clair ». Le lire comme un
  // nom de thème aurait basculé ces installations en sombre à la mise à jour.
  assert.deepEqual(migrateThemeSetting({ theme: 'light' }), { skin: 'orbit', mode: 'light' });
  assert.deepEqual(migrateThemeSetting({ theme: 'dark' }), { skin: 'orbit', mode: 'dark' });
  assert.deepEqual(migrateThemeSetting({ theme: 'auto' }), { skin: 'orbit', mode: 'auto' });
});

test('migrateThemeSetting : le réglage à deux axes a la priorité', () => {
  assert.deepEqual(
    migrateThemeSetting({ themeSkin: 'tech', themeMode: 'light', theme: 'dark' }),
    { skin: 'tech', mode: 'light' }
  );
  // Un seul des deux renseigné : l'autre prend son défaut
  assert.deepEqual(migrateThemeSetting({ themeSkin: 'amber' }), { skin: 'amber', mode: 'dark' });
});

test('migrateThemeSetting : réglages vides ou abîmés → un couple valide', () => {
  for (const input of [{}, null, undefined, { theme: 'n’importe quoi' }]) {
    const out = migrateThemeSetting(input || {});
    assert.ok(SKINS.includes(out.skin));
    assert.ok(MODES.includes(out.mode));
  }
});

// --- Accent : le thème propose, l'utilisateur dispose --------------------

test('resolveAccent : sans choix de l’utilisateur, la couleur du thème', () => {
  const tech = resolveTheme('tech', 'dark');
  assert.equal(resolveAccent(tech, null), tech.palette.accent);
  assert.equal(resolveAccent(tech, ''), tech.palette.accent);
  assert.equal(resolveAccent(tech, '  '), tech.palette.accent);
});

test('resolveAccent : un choix explicite gagne toujours', () => {
  const tech = resolveTheme('tech', 'dark');
  assert.equal(resolveAccent(tech, '#ff0000'), '255 0 0');
  // Casse et forme abrégée : seule la forme à 6 chiffres est acceptée, le
  // reste retombe sur le thème plutôt que de produire « NaN NaN NaN ».
  assert.equal(resolveAccent(tech, '#FF00FF'), '255 0 255');
  assert.equal(resolveAccent(tech, '#f0f'), tech.palette.accent);
  assert.equal(resolveAccent(tech, 'rouge'), tech.palette.accent);
});

test('hexToTriplet / mixWhite', () => {
  assert.equal(hexToTriplet('#6366f1'), '99 102 241');
  assert.equal(hexToTriplet('6366f1'), '99 102 241');
  assert.equal(mixWhite('0 0 0', 0), '0 0 0');
  assert.equal(mixWhite('0 0 0', 1), '255 255 255');
  assert.equal(mixWhite('100 100 100', 0.5), '178 178 178');
});

// --- Variables CSS -------------------------------------------------------

test('themeVars : toutes les variables attendues, aucune vide', () => {
  const vars = themeVars(resolveTheme('tech', 'dark'));
  const expected = [
    '--bg-primary', '--bg-secondary', '--bg-elevated', '--bg-hover',
    '--text-primary', '--text-secondary', '--text-muted',
    '--border', '--border-light',
    '--accent-primary', '--accent-hover', '--accent-light',
    '--radius-card', '--radius-control', '--radius-pill',
    '--border-width', '--shadow-card', '--glow', '--tracking',
  ];
  for (const key of expected) {
    assert.ok(key in vars, `variable ${key} absente`);
    assert.ok(String(vars[key]).length > 0, `variable ${key} vide`);
  }
});

test('themeVars : l’accent de l’utilisateur se propage au survol et à l’accent clair', () => {
  const vars = themeVars(resolveTheme('orbit', 'dark'), '#ff0000');
  assert.equal(vars['--accent-primary'], '255 0 0');
  // Le survol doit être DIFFÉRENT de l'accent, sinon le bouton ne réagit plus
  assert.notEqual(vars['--accent-hover'], vars['--accent-primary']);
  assert.notEqual(vars['--accent-light'], vars['--accent-primary']);
});

test('themeVars : chaque thème produit une silhouette distincte', () => {
  // Si deux thèmes rendent les mêmes variables de caractère, l'un des deux ne
  // sert à rien — c'est le piège du « thème » qui n'est qu'un changement de
  // teinte.
  const shapes = SKINS.map((skin) => {
    const v = themeVars(resolveTheme(skin, 'dark'));
    return [v['--radius-card'], v['--shadow-card'], v['--glow'], v['--tracking']].join('|');
  });
  assert.equal(new Set(shapes).size, SKINS.length, 'des thèmes ont la même silhouette');
});

// --- Le piège de la fusion avec les valeurs par défaut -------------------
//
// Ce que ces tests gardent, et pourquoi ils lisent du TEXTE au lieu d'importer
// le magasin.
//
// Le store produit ses réglages ainsi : `{ ...defaultSettings, ...persistés }`
// (useStore.js). Donner une valeur par défaut à `themeSkin` la rend donc
// TOUJOURS présente ; `migrateThemeSetting`, qui donne la priorité au réglage
// à deux axes, croirait alors que l'utilisateur a choisi un thème et
// ignorerait l'ancien `theme: 'light'`. Toute installation réglée en clair
// basculerait en sombre à la mise à jour. Je suis tombé dans ce piège en
// écrivant cette fonctionnalité.
//
// `useStore.js` importe zustand, absent pendant `npm test` (la suite du projet
// tourne sans `node_modules`). L'importer ici rendrait ce fichier vert en local
// et rouge en CI. On lit donc la SOURCE en texte : la garde vaut alors dans les
// deux environnements, et sans dépendance.
test('les réglages par défaut ne déclarent NI themeSkin NI themeMode', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/stores/useStore.js', 'utf8');
  const block = /export const defaultSettings = \{([\s\S]*?)\n\};/.exec(source);
  assert.ok(block, 'bloc defaultSettings introuvable dans useStore.js');

  // On ignore les lignes de commentaire : le bloc EXPLIQUE justement pourquoi
  // ces deux clés sont absentes, et le mot y apparaît donc légitimement.
  const declared = block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('*'))
    .join('\n');

  for (const key of ['themeSkin', 'themeMode']) {
    assert.ok(
      !new RegExp(`\\b${key}\\s*:`).test(declared),
      `${key} a une valeur par défaut : toute installation en mode clair ` +
        'basculerait en sombre à la mise à jour (voir le commentaire dans useStore.js)'
    );
  }
});

test('migration : une installation réglée en CLAIR le reste après mise à jour', () => {
  // La forme réelle : des défauts SANS les deux clés (garanti par le test
  // ci-dessus), et par-dessus ce que l'utilisateur avait sur son disque.
  const defaultsWithoutTheme = { theme: 'dark', accentColor: '#6366f1', fontSize: 'medium' };
  const merged = { ...defaultsWithoutTheme, theme: 'light' };

  const out = migrateThemeSetting(merged);
  assert.equal(out.mode, 'light', 'l’installation a basculé en sombre contre le gré de l’utilisateur');
  assert.equal(out.skin, 'orbit', 'l’apparence d’origine doit rester le thème « orbit »');
});

test('migration : une fois le thème choisi, ce choix prime sur l’ancien réglage', () => {
  const chosen = { theme: 'light', themeSkin: 'tech', themeMode: 'dark' };
  assert.deepEqual(migrateThemeSetting(chosen), { skin: 'tech', mode: 'dark' });
});

// --- L'accent par défaut masquait la couleur de chaque thème -------------
//
// Bug trouvé en LANÇANT l'application, pas en lisant le code : le thème Tech
// s'affichait en indigo au lieu de cyan.
//
// `accentColor` vaut '#6366f1' dans les réglages par défaut. Comme
// `resolveAccent` fait gagner tout accent fourni, la couleur signature d'un
// thème n'apparaissait jamais — elle était systématiquement écrasée par une
// valeur que l'utilisateur n'avait pourtant jamais choisie.
//
// Mes tests ne le voyaient pas : ils appelaient `resolveAccent(theme, null)`,
// un cas qui ne se produit pas à l'exécution. Même leçon que pour la
// migration — tester la forme RÉELLE des réglages, pas la forme idéalisée.
test('accent : la valeur par défaut historique laisse parler le thème', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('src/App.jsx', 'utf8');

  // La constante existe et vaut bien l'ancien défaut
  const legacy = /const LEGACY_ACCENT = '(#[0-9a-f]{6})'/i.exec(app);
  assert.ok(legacy, 'LEGACY_ACCENT doit être déclaré dans App.jsx');

  const store = readFileSync('src/stores/useStore.js', 'utf8');
  const fromDefaults = /accentColor:\s*'(#[0-9a-f]{6})'/i.exec(store);
  assert.ok(fromDefaults, 'accentColor doit avoir une valeur par défaut dans useStore.js');
  assert.equal(
    legacy[1].toLowerCase(),
    fromDefaults[1].toLowerCase(),
    'LEGACY_ACCENT doit suivre la valeur par défaut de accentColor, sinon le thème est de nouveau écrasé'
  );

  // Et le comportement attendu, côté résolution
  const tech = resolveTheme('tech', 'dark');
  assert.equal(resolveAccent(tech, null), tech.palette.accent, 'sans choix → couleur du thème');
  assert.equal(resolveAccent(tech, '#ff0000'), '255 0 0', 'choix explicite → il gagne');
  assert.notEqual(
    tech.palette.accent,
    hexToTriplet(legacy[1]),
    'le thème Tech doit avoir une couleur DIFFÉRENTE de l’accent historique, sinon le test ne prouve rien'
  );
});
