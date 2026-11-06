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
