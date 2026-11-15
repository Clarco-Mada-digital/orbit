import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANNOTATION_TOOLS } from '../src/lib/annotate.js';
import { STUDIO_KEYS } from '../src/lib/studioLayout.js';
import { DEFAULT_PHONE_SETTINGS } from '../src/lib/phone.js';
import { SENSITIVE_PATTERNS } from '../src/lib/sensitive.js';

// ---------------------------------------------------------------------------
// LA DÉMARCHE DE DOCUMENTATION, VÉRIFIÉE PAR LE CODE.
//
// Une documentation ne se périme pas d'un coup : elle se périme fonctionnalité
// par fonctionnalité, en silence, parce qu'on a livré sans écrire la ligne qui
// va avec. Ces tests ferment ce trou — ils confrontent le guide aux LISTES QUI
// VIVENT DANS LE CODE (outils d'annotation, raccourcis du studio, widgets du
// Téléphone, extensions livrées). Ajouter un outil sans le documenter fait
// échouer `npm test`, avec le nom de ce qui manque.
//
// Ce qu'ils NE vérifient pas : la justesse de la prose. Aucun test ne peut la
// garantir — mais au moins, plus rien ne peut manquer à l'appel.
// ---------------------------------------------------------------------------

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = fs.readFileSync(path.join(ROOT, 'docs', 'guide-utilisateur.md'), 'utf8');
const guide = GUIDE.toLowerCase();

// Chaque entrée dit COMMENT reconnaître qu'une fonctionnalité est documentée :
// un ou plusieurs termes, dont au moins un doit apparaître dans le guide.
const ANNOTATION_TERMS = {
  arrow: ['flèche'],
  rect: ['rectangle'],
  ellipse: ['ellipse'],
  pen: ['dessin libre', 'stylo'],
  highlight: ['surligneur'],
  text: ['écrire sur l’image', "écrire sur l'image", 'outil texte'],
  step: ['étape numérotée', 'étapes numérotées', 'pastille numérotée'],
  blur: ['pixellis', 'masquer'],
  crop: ['recadr'],
};

const STUDIO_TERMS = {
  background: ['fond'],
  layout: ['disposition'],
  corner: ['coin'],
  zoom: ['zoom'],
  halo: ['halo'],
  mirror: ['miroir'],
  framing: ['cadrage'],
  voice: ['anneau de voix'],
  zoomPulse: ['coup de zoom'],
  pause: ['pause'],
  stop: ['arrêt', 'arrêter'],
  minimize: ['réduire', 'réduit'],
  annotate: ['annoter l’écran', "annoter l'écran"],
};

const PHONE_WIDGET_TERMS = {
  clock: ['horloge'],
  device: ['batterie'],
  favorites: ['favoris'],
  recent: ['récentes'],
  notifications: ['notifications'],
  quickControls: ['contrôles rapides'],
  calls: ['appels récents', 'journal d’appels', "journal d'appels"],
};

const mentions = (terms) => terms.some((term) => guide.includes(term.toLowerCase()));

test('guide : chaque outil d\'annotation des captures est documenté', () => {
  const missing = ANNOTATION_TOOLS.filter((tool) => !mentions(ANNOTATION_TERMS[tool] || [tool]));
  assert.deepEqual(
    missing,
    [],
    `Outils absents du guide utilisateur : ${missing.join(', ')}.\n` +
      'Documentez-les dans docs/guide-utilisateur.md, puis relancez `npm run docs`.'
  );
});

test('guide : chaque raccourci du studio est documenté', () => {
  const actions = [...new Set(Object.values(STUDIO_KEYS))];
  const missing = actions.filter((action) => !mentions(STUDIO_TERMS[action] || [action]));
  assert.deepEqual(missing, [], `Actions du studio absentes du guide : ${missing.join(', ')}`);
});

test('guide : chaque widget de l\'accueil du Téléphone est documenté', () => {
  const widgets = Object.keys(DEFAULT_PHONE_SETTINGS.homeWidgets);
  const missing = widgets.filter((widget) => !mentions(PHONE_WIDGET_TERMS[widget] || [widget]));
  assert.deepEqual(missing, [], `Widgets du Téléphone absents du guide : ${missing.join(', ')}`);
});

test('guide : chaque type de donnée sensible masquable est documenté', () => {
  const terms = { email: ['e-mail'], iban: ['iban'], card: ['carte'], phone: ['téléphone'] };
  const missing = SENSITIVE_PATTERNS.map((pattern) => pattern.kind).filter(
    (kind) => !mentions(terms[kind] || [kind])
  );
  assert.deepEqual(missing, [], `Types de données sensibles absents du guide : ${missing.join(', ')}`);
});

test('guide : chaque extension livrée avec Orbit est documentée', () => {
  const catalogPath = path.join(ROOT, 'extensions-dist', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const missing = catalog.extensions
    .map((extension) => extension.name)
    .filter((name) => !guide.includes(name.toLowerCase()));
  assert.deepEqual(
    missing,
    [],
    `Extensions livrées absentes du guide : ${missing.join(', ')}.\n` +
      'Une extension qu’on livre et qui n’est nulle part dans le guide est une extension que personne n’installera.'
  );
});

test('HTML et PDF sont GÉNÉRÉS, jamais écrits à la main', () => {
  // Le repère est posé par scripts/build-docs.js. S'il disparaît, c'est que
  // quelqu'un a édité le HTML directement — et sa modification sera perdue à
  // la prochaine génération.
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'guide-utilisateur.html'), 'utf8');
  assert.ok(
    html.includes('GÉNÉRÉ par scripts/build-docs.js'),
    'docs/guide-utilisateur.html doit être produit par `npm run docs`'
  );
  // Le PDF doit exister : c'est le format que l'on partage.
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'guide-utilisateur.pdf')));
});

test('guide : le HTML publié n\'est pas en retard sur le Markdown', () => {
  // Garde-fou le plus simple qui soit, et le plus utile : si la source a été
  // modifiée après la dernière génération, le site et le PDF montrent encore
  // l'ancienne version.
  const mdTime = fs.statSync(path.join(ROOT, 'docs', 'guide-utilisateur.md')).mtimeMs;
  const htmlTime = fs.statSync(path.join(ROOT, 'docs', 'guide-utilisateur.html')).mtimeMs;
  assert.ok(
    htmlTime >= mdTime - 1000,
    'docs/guide-utilisateur.md a changé depuis la dernière génération : lancez `npm run docs`.'
  );
});

// ---------------------------------------------------------------------------
// GUIDE DE CRÉATION DE THÈME (docs/guide-themes.md)
//
// Même démarche que ci-dessus, appliquée à un public différent : ici le
// lecteur n'est pas un utilisateur mais un AUTEUR, qui va écrire un fichier
// d'après ce guide. Une clé oubliée dans la doc, c'est un thème qu'il écrit
// incomplet et qu'Orbit refuse, sans qu'il comprenne pourquoi.
//
// On confronte donc le guide aux listes dont la validation se sert vraiment
// (src/lib/themes.js), plus les exemples qu'il contient à l'analyseur
// lui-même : un exemple faux dans une documentation est pire qu'une
// documentation absente.
// ---------------------------------------------------------------------------
const THEMES_GUIDE = fs.readFileSync(path.join(ROOT, 'docs', 'guide-themes.md'), 'utf8');

test('guide des thèmes : chaque couleur du format est documentée', async () => {
  const { PALETTE_KEYS } = await import('../src/lib/themes.js');
  const missing = PALETTE_KEYS.filter((key) => !THEMES_GUIDE.includes(key));
  assert.deepEqual(missing, [], `couleurs absentes du guide : ${missing.join(', ')}`);
});

test('guide des thèmes : chaque réglage de forme est documenté', async () => {
  const { TRAIT_KEYS, TEXTURES } = await import('../src/lib/themes.js');
  const missing = TRAIT_KEYS.filter((key) => !THEMES_GUIDE.includes(key));
  assert.deepEqual(missing, [], `réglages absents du guide : ${missing.join(', ')}`);
  // Les textures sont une liste fermée : l'auteur doit pouvoir lire laquelle
  // choisir, sinon il invente un nom et son import est refusé.
  const texturesMissing = TEXTURES.filter((name) => !THEMES_GUIDE.includes(name));
  assert.deepEqual(texturesMissing, [], `textures absentes : ${texturesMissing.join(', ')}`);
});

test('guide des thèmes : les thèmes livrés y sont nommés', async () => {
  const { SKINS } = await import('../src/lib/themes.js');
  const missing = SKINS.filter((skin) => !THEMES_GUIDE.includes(skin));
  assert.deepEqual(missing, [], `thèmes absents du guide : ${missing.join(', ')}`);
});

test('guide des thèmes : la version du format annoncée est la bonne', async () => {
  const { THEME_FORMAT } = await import('../src/lib/customTheme.js');
  // Le guide affirme « Vaut 1 aujourd'hui » et ses exemples écrivent
  // "orbitTheme": 1. Changer la version du format sans toucher au guide
  // laisserait des exemples que l'application refuse.
  assert.match(
    THEMES_GUIDE,
    new RegExp(`"orbitTheme":\\s*${THEME_FORMAT}\\b`),
    `le guide doit montrer la version ${THEME_FORMAT} du format`
  );
});

test('guide des thèmes : l’exemple « minimal » est réellement accepté', async () => {
  const { parseTheme } = await import('../src/lib/customTheme.js');
  // On extrait le PREMIER bloc JSON complet du guide (l'exemple minimal) et on
  // le passe à l'analyseur. Un exemple qui ne marche pas est le plus sûr moyen
  // de faire abandonner un auteur dès sa première tentative.
  const block = /```json\n([\s\S]*?)\n```/.exec(THEMES_GUIDE);
  assert.ok(block, 'aucun exemple JSON trouvé dans le guide');
  const res = parseTheme(block[1]);
  assert.equal(res.ok, true, `l’exemple minimal du guide est refusé : ${res.errors.join(' / ')}`);
  assert.deepEqual(
    res.warnings.filter((w) => w.includes('Lisibilité')),
    [],
    'l’exemple du guide doit être lisible : c’est le modèle que tout le monde copiera'
  );
});
