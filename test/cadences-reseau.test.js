import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WEATHER_REFRESH_MS } from '../src/lib/weather.js';
import { RATE_TTL } from '../src/lib/convert.js';
import { CATALOG_TTL_MS } from '../src/lib/extensionCatalog.js';

// Ces trois constantes commandent tout ce qu'Orbit va chercher sur le réseau
// SANS qu'on le lui demande. Elles ne se voient pas à l'usage : une valeur
// ramenée à quelques minutes ne casse rien, n'allume aucun voyant, et se paie
// en forfait mobile. D'où ce garde-fou — il n'y a pas d'autre endroit où
// l'erreur se verrait.
//
// Historique : la météo était à 15 minutes, DOUBLÉE d'un minuteur qui forçait
// le cache, soit 96 requêtes par jour tant qu'Orbit restait ouvert.

const HEURE = 60 * 60 * 1000;

test('la météo ne se relit pas plus d’une fois par demi-journée', () => {
  assert.ok(
    WEATHER_REFRESH_MS >= 12 * HEURE,
    `météo trop bavarde : ${WEATHER_REFRESH_MS / HEURE} h entre deux lectures`
  );
});

test('les taux de change ne se relisent pas plus d’une fois par jour', () => {
  // La source ne publie qu'un relevé quotidien : lire plus souvent, c'est
  // redemander la même valeur.
  assert.ok(RATE_TTL >= 24 * HEURE, `taux trop bavards : ${RATE_TTL / HEURE} h`);
});

test('le catalogue d’extensions ne se relit pas plus d’une fois par jour', () => {
  assert.ok(CATALOG_TTL_MS >= 24 * HEURE, `catalogue trop bavard : ${CATALOG_TTL_MS / HEURE} h`);
});

test('aucune de ces durées n’est nulle ou absurde', () => {
  // Une constante passée à 0 rendrait le cache inopérant : chaque lecture
  // repartirait sur le réseau, sans que rien ne le signale.
  for (const [nom, v] of [
    ['WEATHER_REFRESH_MS', WEATHER_REFRESH_MS],
    ['RATE_TTL', RATE_TTL],
    ['CATALOG_TTL_MS', CATALOG_TTL_MS],
  ]) {
    assert.ok(Number.isFinite(v) && v > 0, `${nom} doit être une durée positive`);
  }
});
