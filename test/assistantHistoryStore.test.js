import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendSessionMessages, createAssistantSession } from '../src/lib/assistantSessions.js';

// Comme pour fly-pages.test.js : zustand lit `window.localStorage`, absent sous
// Node. On installe un stockage EN MÉMOIRE avant d'importer le store, en y
// laissant une installation v15 — c'est le cas réel d'une mise à jour.
const memory = new Map();
const localStorageStub = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
globalThis.window = { localStorage: localStorageStub };
globalThis.localStorage = localStorageStub;

const NOW = new Date('2026-10-23T12:00:00').getTime();
const DAY = 86_400_000;

memory.set(
  'orbit-storage',
  JSON.stringify({
    state: { onboarded: true, settings: { language: 'fr' } },
    version: 15,
  })
);

const { useStore } = await import('../src/stores/useStore.js');

const sessions = () => useStore.getState().assistantSessions;

function chatSession(id, text, now) {
  return appendSessionMessages(
    createAssistantSession({ mode: 'chat', text, now, id }),
    [
      { role: 'user', content: text },
      { role: 'assistant', content: `Réponse à ${text}` },
    ],
    { now }
  );
}

test('une installation existante démarre avec un historique vide', () => {
  assert.deepEqual(sessions(), []);
  assert.ok(Array.isArray(sessions()));
});

test('une conversation est enregistrée et persiste dans le stockage', () => {
  useStore.getState().saveAssistantSession(chatSession('s-1', 'Bonjour Orbit', NOW));

  assert.equal(sessions().length, 1);
  assert.equal(sessions()[0].id, 's-1');
  assert.equal(sessions()[0].title, 'Bonjour Orbit');
  assert.equal(sessions()[0].category, 'discussion');
  assert.equal(sessions()[0].messages.length, 2);

  const persisted = JSON.parse(memory.get('orbit-storage')).state.assistantSessions;
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].messages.at(-1).content, 'Réponse à Bonjour Orbit');
});

test('continuer une conversation met à jour la session au lieu d’en créer une', () => {
  const current = sessions().find((session) => session.id === 's-1');
  const continued = appendSessionMessages(
    current,
    [
      { role: 'user', content: 'Et pour un e-mail ?', command: 'email' },
      { role: 'assistant', content: 'Voici un brouillon.' },
    ],
    { now: NOW + DAY, command: 'email' }
  );
  useStore.getState().saveAssistantSession(continued);

  assert.equal(sessions().length, 1, 'aucun doublon');
  assert.equal(sessions()[0].messages.length, 4);
  assert.equal(sessions()[0].command, 'email');
  assert.equal(sessions()[0].category, 'writing');
  assert.equal(sessions()[0].updatedAt, NOW + DAY);
});

test('renommer et supprimer une conversation', () => {
  useStore.getState().saveAssistantSession(chatSession('s-2', 'Idées de vacances', NOW - DAY));
  assert.deepEqual(sessions().map((session) => session.id), ['s-1', 's-2']);

  useStore.getState().renameAssistantSession('s-2', '  Projet   vacances  ');
  assert.equal(sessions().find((session) => session.id === 's-2').title, 'Projet vacances');

  // Un titre vide ne doit pas rendre la conversation anonyme.
  useStore.getState().renameAssistantSession('s-2', '   ');
  assert.equal(sessions().find((session) => session.id === 's-2').title, 'Projet vacances');

  useStore.getState().deleteAssistantSession('s-2');
  assert.deepEqual(sessions().map((session) => session.id), ['s-1']);
  useStore.getState().deleteAssistantSession('inconnue');
  assert.equal(sessions().length, 1);
});

test('tout effacer vide l’historique, y compris dans le stockage', () => {
  useStore.getState().clearAssistantSessions();
  assert.deepEqual(sessions(), []);
  const persisted = JSON.parse(memory.get('orbit-storage')).state.assistantSessions;
  assert.deepEqual(persisted, []);
});
