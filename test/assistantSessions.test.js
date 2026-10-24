import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ASSISTANT_SESSIONS,
  MAX_SESSION_CHARS,
  MAX_SESSION_MESSAGES,
  appendSessionMessages,
  countSessionsByCategory,
  createAssistantSession,
  filterAssistantSessions,
  groupAssistantSessions,
  removeAssistantSession,
  sessionCategory,
  sessionGroupId,
  sessionTitle,
  setSessionTitle,
  sortSessions,
  upsertAssistantSession,
} from '../src/lib/assistantSessions.js';

const NOW = new Date('2026-10-23T12:00:00').getTime();
const DAY = 86_400_000;

function sessionAt(id, updatedAt, extra = {}) {
  return {
    ...createAssistantSession({ mode: 'chat', text: `Conversation ${id}`, now: updatedAt, id }),
    updatedAt,
    ...extra,
  };
}

test('une session est classée selon la commande utilisée, sinon selon le mode', () => {
  assert.equal(sessionCategory({ command: 'fix' }), 'essentials');
  assert.equal(sessionCategory({ command: 'email' }), 'writing');
  assert.equal(sessionCategory({ command: 'translate' }), 'analysis');
  assert.equal(sessionCategory({ command: 'orbit' }), 'orbit');
  assert.equal(sessionCategory({ command: 'inconnue' }), 'discussion');
  assert.equal(sessionCategory({ mode: 'chat' }), 'discussion');
  // Une action rapide n'a pas de commande saisie : son mode fait foi.
  assert.equal(sessionCategory({ mode: 'correct' }), 'essentials');
  assert.equal(sessionCategory({ mode: 'rewrite' }), 'essentials');
  assert.equal(sessionCategory({ mode: 'summarize' }), 'essentials');
});

test('le titre vient du premier texte et reste court', () => {
  assert.equal(sessionTitle('  Bonjour   le monde '), 'Bonjour le monde');
  assert.equal(sessionTitle(''), '');
  const long = sessionTitle('mot '.repeat(60));
  assert.ok(long.length <= 65, long);
  assert.ok(long.endsWith('…'), long);

  const created = createAssistantSession({ mode: 'chat', text: 'Corrige ce message', now: NOW });
  assert.equal(created.title, 'Corrige ce message');
  assert.equal(created.category, 'discussion');
  assert.equal(created.messages.length, 0);
  assert.equal(created.createdAt, NOW);
  assert.equal(created.updatedAt, NOW);
});

test('chaque échange est ajouté dans l’ordre et la session est réhorodatée', () => {
  const created = createAssistantSession({ mode: 'chat', text: 'Bonjour', now: NOW });
  const next = appendSessionMessages(
    created,
    [
      { role: 'user', content: 'Bonjour', command: 'fix' },
      { role: 'assistant', content: 'Bonjour.' },
    ],
    { now: NOW + 1000, command: 'fix' }
  );
  assert.equal(next.messages.length, 2);
  assert.deepEqual(next.messages[0], { role: 'user', content: 'Bonjour', command: 'fix' });
  assert.equal(next.messages[1].role, 'assistant');
  assert.equal(next.updatedAt, NOW + 1000);
  // La commande utilisée reclasse la session dans son thème.
  assert.equal(next.category, 'essentials');
  assert.equal(next.command, 'fix');

  // Les messages techniques (mauvais rôle, contenu non textuel) sont ignorés.
  const filtered = appendSessionMessages(created, [
    { role: 'tool', content: 'x' },
    { role: 'user', content: 42 },
  ], { now: NOW });
  assert.equal(filtered.messages.length, 0);
});

test('l’historique garde les échanges récents et respecte le budget', () => {
  let session = createAssistantSession({ mode: 'chat', text: 'Départ', now: NOW });
  const many = Array.from({ length: MAX_SESSION_MESSAGES + 12 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
  }));
  session = appendSessionMessages(session, many, { now: NOW });
  assert.equal(session.messages.length, MAX_SESSION_MESSAGES);
  // On a bien coupé le début, pas la fin.
  assert.equal(session.messages.at(-1).content, `message ${many.length - 1}`);
  assert.ok(
    session.messages.reduce((sum, message) => sum + message.content.length, 0) <= MAX_SESSION_CHARS
  );

  const huge = appendSessionMessages(
    createAssistantSession({ mode: 'summarize', text: 'Long', now: NOW }),
    [
      { role: 'user', content: 'a'.repeat(MAX_SESSION_CHARS - 10) },
      { role: 'assistant', content: 'b'.repeat(500) },
    ],
    { now: NOW }
  );
  assert.ok(huge.messages.length >= 1);
  const total = huge.messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(total <= MAX_SESSION_CHARS, `${total}`);
  assert.equal(huge.messages.at(-1).role, 'assistant');
});

test('les sessions sont triées, plafonnées et supprimables', () => {
  const sessions = Array.from({ length: MAX_ASSISTANT_SESSIONS + 5 }, (_, index) => (
    sessionAt(`s-${index}`, NOW - index * DAY)
  ));
  const upserted = upsertAssistantSession(sessions, sessionAt('s-99', NOW + DAY));
  assert.equal(upserted.length, MAX_ASSISTANT_SESSIONS);
  assert.equal(upserted[0].id, 's-99');
  // La plus ancienne est sortie de l'historique.
  assert.ok(!upserted.some((session) => session.id === `s-${MAX_ASSISTANT_SESSIONS + 4}`));

  // Un enregistrement existant remplace l'ancienne version sans doublon.
  const replaced = upsertAssistantSession(upserted, { ...upserted[0], title: 'Nouveau titre' });
  assert.equal(replaced.filter((session) => session.id === 's-99').length, 1);
  assert.equal(replaced[0].title, 'Nouveau titre');

  assert.equal(removeAssistantSession(upserted, 's-99').length, MAX_ASSISTANT_SESSIONS - 1);
  assert.deepEqual(sortSessions(null), []);
});

test('renommer refuse un titre vide et borne la longueur', () => {
  const session = sessionAt('s-1', NOW);
  assert.equal(setSessionTitle(session, '   '), session);
  assert.equal(setSessionTitle(session, '  Mon   titre  ').title, 'Mon titre');
  assert.equal(setSessionTitle(session, 'x'.repeat(200)).title.length, 80);
});

test('la recherche ignore les accents et peut filtrer par catégorie', () => {
  const sessions = [
    sessionAt('s-1', NOW, { title: 'Facture EDF', category: 'writing' }),
    appendSessionMessages(
      sessionAt('s-2', NOW - DAY, { title: 'Orthographe', category: 'essentials' }),
      [{ role: 'assistant', content: 'La facture est prête.' }],
      { now: NOW - DAY }
    ),
    sessionAt('s-3', NOW - 2 * DAY, { title: 'Idées cadeaux', category: 'writing' }),
  ];

  assert.deepEqual(
    filterAssistantSessions(sessions, { query: 'facture' }).map((session) => session.id),
    ['s-1', 's-2']
  );
  assert.deepEqual(
    filterAssistantSessions(sessions, { query: 'idees' }).map((session) => session.id),
    ['s-3']
  );
  assert.deepEqual(
    filterAssistantSessions(sessions, { category: 'writing' }).map((session) => session.id),
    ['s-1', 's-3']
  );
  assert.equal(filterAssistantSessions(sessions, { query: 'introuvable' }).length, 0);
  assert.equal(filterAssistantSessions(sessions).length, 3);
});

test('l’historique se regroupe par ancienneté', () => {
  assert.equal(sessionGroupId(NOW, NOW), 'today');
  assert.equal(sessionGroupId(NOW - DAY, NOW), 'yesterday');
  assert.equal(sessionGroupId(NOW - 3 * DAY, NOW), 'week');
  assert.equal(sessionGroupId(NOW - 10 * DAY, NOW), 'month');
  assert.equal(sessionGroupId(NOW - 90 * DAY, NOW), 'older');

  const groups = groupAssistantSessions([
    sessionAt('s-1', NOW),
    sessionAt('s-2', NOW - DAY),
    sessionAt('s-3', NOW - 2 * DAY),
    sessionAt('s-4', NOW - 40 * DAY),
  ], NOW);
  assert.deepEqual(groups.map((group) => group.id), ['today', 'yesterday', 'week', 'older']);
  assert.deepEqual(groups.map((group) => group.sessions.map((session) => session.id)), [
    ['s-1'],
    ['s-2'],
    ['s-3'],
    ['s-4'],
  ]);
  assert.deepEqual(groupAssistantSessions([], NOW), []);
});

test('les compteurs par catégorie ignorent les sessions inconnues', () => {
  const counts = countSessionsByCategory([
    sessionAt('s-1', NOW, { category: 'writing' }),
    sessionAt('s-2', NOW, { category: 'writing' }),
    sessionAt('s-3', NOW, { category: 'orbit' }),
    sessionAt('s-4', NOW, { category: 'abimee' }),
  ]);
  assert.deepEqual(counts, {
    discussion: 0,
    essentials: 0,
    writing: 2,
    analysis: 0,
    orbit: 1,
  });
});
