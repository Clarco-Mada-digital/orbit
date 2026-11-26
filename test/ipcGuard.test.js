import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGuestChannel, isAllowedSender, installWebviewIpcGuard } from '../electron/ipc-guard.js';

const fakeEvent = (type) => ({ sender: { getType: () => type } });

function fakeIpc() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { listeners.set(channel, fn); return this; },
  };
}

test('canaux des pages embarquées', () => {
  assert.equal(isGuestChannel('credentials:getLogins'), true);
  assert.equal(isGuestChannel('@ghostery/adblocker/inject-cosmetic-filters'), true);
  assert.equal(isGuestChannel('orbit-dialog:open'), true);
  assert.equal(isGuestChannel('vault:list'), false);
  assert.equal(isGuestChannel('documents:read'), false);
  assert.equal(isGuestChannel(''), false);
});

test('les canaux appelés PAR les preloads de page sont autorisés', () => {
  // Régression constatée au démarrage : ces deux invoke venaient bien d'un
  // preload de page et étaient refusés (« Error: forbidden » à chaque
  // chargement). Conséquence silencieuse : le réglage d'affichage du bouton de
  // téléchargement était ignoré, et les données de test retombaient sur des
  // valeurs génériques.
  assert.equal(isGuestChannel('media:buttonSurface'), true);
  assert.equal(isGuestChannel('fakedata:get'), true);
  // Pont de lecture vocale des sites : refusé, aucun site ne pouvait parler.
  assert.equal(isGuestChannel('tts:pageInfo'), true);
  assert.equal(isGuestChannel('tts:pageInfoAsync'), true);
  assert.equal(isGuestChannel('tts:page'), true);
  assert.equal(isGuestChannel('tts:speak'), false);
});

test('autoriser ces canaux n’ouvre pas leurs voisins', () => {
  // La liste est NOMINATIVE, pas par préfixe : une page ne doit pas atteindre
  // le journal des échecs de média ni l'écriture des données de test.
  assert.equal(isGuestChannel('media:failures'), false);
  assert.equal(isGuestChannel('fakedata:set'), false);
});

test("l'interface atteint tout, une page seulement ses canaux", () => {
  assert.equal(isAllowedSender(fakeEvent('window'), 'documents:read'), true);
  assert.equal(isAllowedSender(fakeEvent('webview'), 'documents:read'), false);
  assert.equal(isAllowedSender(fakeEvent('webview'), 'credentials:totp'), true);
  // webContents détruit : refus par prudence
  const broken = { sender: { getType: () => { throw new Error('destroyed'); } } };
  assert.equal(isAllowedSender(broken, 'documents:read'), false);
});

test('handle : une page embarquée est refusée sur un canal de l’interface', async () => {
  const ipc = installWebviewIpcGuard(fakeIpc(), { log: () => {} });
  ipc.handle('documents:read', () => 'ok');
  const fn = ipc.handlers.get('documents:read');
  assert.equal(await fn(fakeEvent('window')), 'ok');
  assert.throws(() => fn(fakeEvent('webview')), /forbidden/);
});

test('on : sendSync refusé reçoit une réponse au lieu de bloquer', () => {
  const ipc = installWebviewIpcGuard(fakeIpc(), { log: () => {} });
  let called = false;
  ipc.on('files:pick', (event) => { called = true; event.returnValue = 'x'; });
  const event = fakeEvent('webview');
  ipc.listeners.get('files:pick')(event);
  assert.equal(called, false);
  assert.equal(event.returnValue, null);
});

test('installation idempotente', () => {
  const ipc = fakeIpc();
  installWebviewIpcGuard(ipc, { log: () => {} });
  const wrapped = ipc.handle;
  installWebviewIpcGuard(ipc, { log: () => {} });
  assert.equal(ipc.handle, wrapped);
});
