import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchShortcutInput } from '../src/lib/shortcuts.js';

// Sur Linux (et le CI ubuntu), le modificateur d'Orbit est Alt.
const alt = (key, extra = {}) => matchShortcutInput({ type: 'keyDown', alt: true, key, ...extra });

test('Alt+K → recherche', () => assert.equal(alt('k'), 'search'));
test('Alt+, → paramètres', () => assert.equal(alt(','), 'settings'));
test('Alt+Maj+O → boutique', () => assert.equal(alt('o', { shift: true }), 'store'));
test('Alt+chiffre → aller à l’app', () => assert.equal(alt('3'), 'app-3'));
test('Alt+0 → réinitialiser le zoom', () => assert.equal(alt('0'), 'zoom-reset'));

test('Ctrl+F → rechercher dans la page', () =>
  assert.equal(matchShortcutInput({ type: 'keyDown', control: true, key: 'f' }), 'find'));

test('sans modificateur → aucun raccourci', () =>
  assert.equal(matchShortcutInput({ type: 'keyDown', key: 'k' }), null));

test('événement qui n’est pas keyDown → ignoré', () =>
  assert.equal(matchShortcutInput({ type: 'keyUp', alt: true, key: 'k' }), null));
