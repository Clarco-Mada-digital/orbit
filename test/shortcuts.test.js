import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchShortcutInput, shortcutKeys } from '../src/lib/shortcuts.js';

// Sur Linux (et le CI ubuntu), le modificateur d'Orbit est Alt.
const alt = (key, extra = {}) => matchShortcutInput({ type: 'keyDown', alt: true, key, ...extra });

test('Alt+K → recherche', () => assert.equal(alt('k'), 'search'));
test('Alt+, → paramètres', () => assert.equal(alt(','), 'settings'));
test('Alt+L → modifier l’adresse', () => assert.equal(alt('l'), 'edit-url'));
test('Alt+Maj+O → boutique', () => assert.equal(alt('o', { shift: true }), 'store'));
test('Alt+Maj+E → relecture locale du champ actif', () =>
  assert.equal(alt('e', { shift: true }), 'proofread-editor'));
test('Alt+Maj+I → assistant IA sur le champ actif', () =>
  assert.equal(alt('i', { shift: true }), 'assistant-editor'));
test('Alt+Maj+A → ouvrir la discussion avec l’assistant IA', () =>
  assert.equal(alt('a', { shift: true }), 'assistant-chat'));
test('la touche de discussion peut être changée et la combinaison précédente redevient disponible', () => {
  assert.equal(matchShortcutInput({ type: 'keyDown', alt: true, shift: true, key: 'j' }, 'j'), 'assistant-chat');
  assert.equal(matchShortcutInput({ type: 'keyDown', alt: true, shift: true, key: 'a' }, 'j'), null);
});
test('un raccourci de discussion désactivé ne correspond à aucune touche', () =>
  assert.equal(matchShortcutInput({ type: 'keyDown', alt: true, shift: true, key: 'a' }, null), null));
test('la liste des raccourcis suit le réglage choisi et peut masquer la discussion IA', () => {
  const configured = shortcutKeys((key) => key, {
    assistantChatEnabled: true,
    assistantChatShortcutEnabled: true,
    assistantChatShortcutKey: 'u',
  });
  assert.ok(configured.some((item) => item.desc === 'sc.assistantChat' && item.keys.includes('U')));
  const disabled = shortcutKeys((key) => key, {
    assistantChatEnabled: false,
    assistantChatShortcutEnabled: true,
    assistantChatShortcutKey: 'u',
  });
  assert.ok(!disabled.some((item) => item.desc === 'sc.assistantChat'));
});
test('Alt+chiffre → aller à l’app', () => assert.equal(alt('3'), 'app-3'));
test('Alt+0 → réinitialiser le zoom', () => assert.equal(alt('0'), 'zoom-reset'));

test('Ctrl+F → rechercher dans la page', () =>
  assert.equal(matchShortcutInput({ type: 'keyDown', control: true, key: 'f' }), 'find'));

test('sans modificateur → aucun raccourci', () =>
  assert.equal(matchShortcutInput({ type: 'keyDown', key: 'k' }), null));

test('événement qui n’est pas keyDown → ignoré', () =>
  assert.equal(matchShortcutInput({ type: 'keyUp', alt: true, key: 'k' }), null));
