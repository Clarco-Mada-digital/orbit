import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADBLOCK_LEVELS,
  DEFAULT_ADBLOCK_LEVEL,
  engineFileFor,
  normalizeLevel,
} from '../electron/adblock-levels.js';

test('les niveaux exposés sont standard et complet', () => {
  assert.deepEqual(ADBLOCK_LEVELS, ['standard', 'complet']);
  assert.equal(DEFAULT_ADBLOCK_LEVEL, 'standard');
});

test('une valeur inconnue retombe sur le niveau par défaut', () => {
  assert.equal(normalizeLevel('agressif'), 'standard');
  assert.equal(normalizeLevel(''), 'standard');
  assert.equal(normalizeLevel(undefined), 'standard');
  assert.equal(normalizeLevel(null), 'standard');
  assert.equal(normalizeLevel(42), 'standard');
  assert.equal(normalizeLevel('complet'), 'complet');
  assert.equal(normalizeLevel('standard'), 'standard');
});

test('chaque niveau a son propre fichier de cache', () => {
  const standard = engineFileFor('standard');
  const complet = engineFileFor('complet');
  assert.notEqual(standard, complet);
  // Un fichier de cache partagé ferait relire les listes de l'autre niveau :
  // le réglage n'aurait alors aucun effet visible.
  assert.equal(engineFileFor('inconnu'), standard);
  assert.match(standard, /^adblocker-engine.*\.bin$/);
  assert.match(complet, /^adblocker-engine.*\.bin$/);
});
