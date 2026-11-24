import { test } from 'node:test';
import assert from 'node:assert/strict';

import { familyUrl } from '../src/lib/webFonts.js';

// index.html demandait seize familles à chaque lancement pour n'en afficher
// qu'une. Ces tests verrouillent les deux façons dont le chargement à la
// demande peut casser en silence : une URL mal formée (la police ne s'applique
// pas, sans erreur) et une requête inutile (on réintroduit ce qu'on vient de
// retirer).

test('construit l’URL d’une police à charger', () => {
  assert.equal(
    familyUrl('Poppins'),
    'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap'
  );
});

test('les espaces du nom deviennent des +', () => {
  // « Playfair Display » sans encodage renvoie une 400 et la police n'arrive
  // jamais — sans la moindre erreur visible.
  assert.match(familyUrl('Playfair Display'), /family=Playfair\+Display:/);
  assert.match(familyUrl('Source Sans 3'), /family=Source\+Sans\+3:/);
});

test('les deux polices déjà dans index.html ne sont pas redemandées', () => {
  assert.equal(familyUrl('Inter'), null);
  assert.equal(familyUrl('JetBrains Mono'), null);
});

test('une pile CSS est ramenée à son premier nom', () => {
  // `document.body.style.fontFamily` peut contenir une pile complète ; la
  // demander telle quelle à Google ne donnerait rien.
  assert.match(familyUrl('Poppins, sans-serif'), /family=Poppins:/);
  assert.match(familyUrl('"Playfair Display", serif'), /family=Playfair\+Display:/);
  // …et si le premier nom est déjà chargé, on ne demande rien.
  assert.equal(familyUrl('Inter, system-ui, sans-serif'), null);
});

test('les familles génériques ne sont jamais demandées', () => {
  for (const g of ['sans-serif', 'serif', 'monospace', 'system-ui', 'cursive']) {
    assert.equal(familyUrl(g), null, `${g} ne doit pas partir sur le réseau`);
  }
});

test('une valeur vide ou absurde ne produit pas d’URL', () => {
  assert.equal(familyUrl(''), null);
  assert.equal(familyUrl('   '), null);
  assert.equal(familyUrl(null), null);
  assert.equal(familyUrl(undefined), null);
});
