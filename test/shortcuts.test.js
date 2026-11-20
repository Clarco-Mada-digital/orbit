import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchShortcutInput, shortcutKeys, matchCombo } from '../src/lib/shortcuts.js';

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
test('Alt+Maj+S → options de capture d’écran', () =>
  assert.equal(alt('s', { shift: true }), 'screenshot'));
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
  assert.ok(configured.some((item) => item.desc === 'sc.screenshot' && item.keys.includes('S')));
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

// --- Raccourcis ajoutés (écran partagé, pages, panneaux) --------------------

const altK = (key, extra = {}) => ({ key, alt: true, ctrl: false, meta: false, shift: false, ...extra });
const cmdK = (key, extra = {}) => ({ key, meta: true, ctrl: false, alt: false, shift: false, ...extra });

test('nouveaux raccourcis (Windows / Linux)', () => {
  assert.equal(matchCombo(altK('X', { shift: true }), false), 'split-toggle');
  assert.equal(matchCombo(altK('C', { shift: true }), false), 'split-direction');
  assert.equal(matchCombo(altK('G', { shift: true }), false), 'split-focus');
  assert.equal(matchCombo(altK('t'), false), 'new-page');
  assert.equal(matchCombo(altK('w'), false), 'close-page');
  assert.equal(matchCombo(altK('T', { shift: true }), false), 'downloads');
  assert.equal(matchCombo(altK('V', { shift: true }), false), 'vault');
  assert.equal(matchCombo(altK('N', { shift: true }), false), 'detach');
  assert.equal(matchCombo({ key: 'F1' }, false), 'help');
});

test('macOS : ⌘X / ⌘Z restent couper / annuler', () => {
  assert.equal(matchCombo(cmdK('x'), true), null);
  assert.equal(matchCombo(cmdK('z'), true), null);
  assert.equal(matchCombo(cmdK('X', { shift: true }), true), 'split-toggle');
});

test('AZERTY : Alt + touche « 1 » physique', () => {
  assert.equal(matchCombo(altK('&', { code: 'Digit1' }), false), 'app-1');
  assert.equal(matchCombo(altK('1', { shift: true, code: 'Digit1' }), false), 'app-1');
});

test('Ctrl+F reste la recherche ; ⇧D / ⇧F laissés aux extensions', () => {
  assert.equal(matchCombo({ key: 'f', ctrl: true }, false), 'find');
  assert.equal(matchCombo(cmdK('G', { shift: true }), true), 'split-focus');
  // ⇧D et ⇧F restent aux extensions (Mouse Scroll, Fake Data)
  assert.equal(matchCombo(altK('D', { shift: true }), false), null);
  assert.equal(matchCombo(altK('F', { shift: true }), false), null);
});
