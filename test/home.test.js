import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCENT_BACKGROUND,
  DEFAULT_HOME,
  HOME_BACKGROUNDS,
  backgroundStyle,
  greetingKey,
  normalizeHome,
  resolveBackground,
} from '../src/lib/home.js';

// La page d'accueil lit `settings.home`, qui peut venir d'une installation
// ancienne (clé absente) ou d'un utilisateur (valeurs limites via les
// curseurs). Ces tests verrouillent la normalisation et le choix du fond, car
// une erreur ici se voit tout de suite : fond noir ou texte illisible.

test('normalizeHome : réglage absent → valeurs par défaut', () => {
  assert.deepEqual(normalizeHome(undefined), DEFAULT_HOME);
  assert.deepEqual(normalizeHome(null), DEFAULT_HOME);
});

test('normalizeHome : les valeurs partielles complètent les défauts', () => {
  const h = normalizeHome({ background: 'ocean', blur: 4 });
  assert.equal(h.background, 'ocean');
  assert.equal(h.blur, 4);
  assert.equal(h.dim, DEFAULT_HOME.dim);
  assert.deepEqual(h.widgets, DEFAULT_HOME.widgets);
});

test('normalizeHome : widgets fusionnés un par un', () => {
  // Un utilisateur qui décoche la météo ne doit pas perdre l'horloge et les apps.
  const h = normalizeHome({ widgets: { weather: false } });
  assert.equal(h.widgets.weather, false);
  assert.equal(h.widgets.clock, true);
  assert.equal(h.widgets.apps, true);
});

test('normalizeHome : bornes des curseurs (flou 0-24, assombrir 0-80)', () => {
  assert.equal(normalizeHome({ blur: 999 }).blur, 24);
  assert.equal(normalizeHome({ blur: -5 }).blur, 0);
  assert.equal(normalizeHome({ dim: 200 }).dim, 80);
  assert.equal(normalizeHome({ dim: -1 }).dim, 0);
  // Valeur non numérique (champ vidé) → on retombe sur le défaut, pas NaN.
  assert.equal(normalizeHome({ blur: 'abc' }).blur, DEFAULT_HOME.blur);
  assert.equal(normalizeHome({ blur: null }).blur, DEFAULT_HOME.blur);
  // Arrondi : le curseur envoie parfois une décimale.
  assert.equal(normalizeHome({ blur: 3.6 }).blur, 4);
});

test('normalizeHome : imageUrl non textuelle → chaîne vide', () => {
  assert.equal(normalizeHome({ imageUrl: 42 }).imageUrl, '');
  assert.equal(normalizeHome({ imageUrl: 'http://x/y.png' }).imageUrl, 'http://x/y.png');
});

test('resolveBackground : défaut et inconnu → dégradé accent', () => {
  assert.deepEqual(resolveBackground(undefined), { kind: 'gradient', css: ACCENT_BACKGROUND });
  assert.deepEqual(resolveBackground({ background: 'inexistant' }), {
    kind: 'gradient',
    css: ACCENT_BACKGROUND,
  });
});

test('resolveBackground : un fond prêt à l’emploi renvoie son dégradé', () => {
  const preset = HOME_BACKGROUNDS.find((b) => b.id === 'aurora');
  assert.deepEqual(resolveBackground({ background: 'aurora' }), {
    kind: 'gradient',
    css: preset.css,
  });
});

test('resolveBackground : tous les fonds non-accent ont un dégradé CSS', () => {
  for (const b of HOME_BACKGROUNDS) {
    if (b.accent) continue;
    assert.equal(typeof b.css, 'string');
    assert.ok(b.css.includes('gradient'), `${b.id} devrait être un dégradé`);
  }
});

test('resolveBackground : une image prime sur le dégradé choisi', () => {
  const bg = resolveBackground({ background: 'plum', imageUrl: 'file:///photo.jpg' });
  assert.deepEqual(bg, { kind: 'image', imageUrl: 'file:///photo.jpg' });
});

test('backgroundStyle : image → background-image avec URL, et couverture', () => {
  const s = backgroundStyle({ kind: 'image', imageUrl: 'https://x/p.jpg' });
  assert.equal(s.backgroundImage, 'url("https://x/p.jpg")');
  assert.equal(s.backgroundSize, 'cover');
  assert.equal(s.backgroundPosition, 'center');
});

test('backgroundStyle : dégradé → background-image = le CSS du fond', () => {
  const s = backgroundStyle({ kind: 'gradient', css: 'linear-gradient(#000, #fff)' });
  assert.equal(s.backgroundImage, 'linear-gradient(#000, #fff)');
});

test('backgroundStyle : fond absent → pas d’image (jamais "undefined")', () => {
  assert.equal(backgroundStyle(null).backgroundImage, 'none');
});

test('greetingKey : bornes de la journée', () => {
  const at = (h) => greetingKey(new Date(2026, 0, 15, h, 0, 0));
  assert.equal(at(5), 'home.greetMorning');
  assert.equal(at(11), 'home.greetMorning');
  assert.equal(at(12), 'home.greetAfternoon');
  assert.equal(at(17), 'home.greetAfternoon');
  assert.equal(at(18), 'home.greetEvening');
  assert.equal(at(22), 'home.greetEvening');
  assert.equal(at(23), 'home.greetNight');
  assert.equal(at(0), 'home.greetNight');
  assert.equal(at(4), 'home.greetNight');
});
