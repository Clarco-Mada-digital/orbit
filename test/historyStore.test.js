import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRecord } from '../src/lib/historySearch.js';

// `shouldRecord` est le filtre d'entrée de l'historique. C'est aussi un
// garde-fou de confidentialité : ce qu'il laisse passer finit écrit en clair
// dans le stockage local.
//
// Le reste du magasin (plafond, déduplication) dépend de zustand, qui n'est
// pas installé pendant `npm test` — voir la contrainte du projet.

test('shouldRecord : les pages ordinaires sont conservées', () => {
  assert.equal(shouldRecord('https://github.com/orbit/pull/12'), true);
  assert.equal(shouldRecord('http://intranet.local/doc'), true);
});

test('shouldRecord : les pages de connexion sont écartées', () => {
  // Sans intérêt à retrouver, et souvent porteuses de jetons à usage unique.
  assert.equal(shouldRecord('https://accounts.google.com/'), false);
  assert.equal(shouldRecord('https://example.com/login'), false);
  assert.equal(shouldRecord('https://example.com/oauth/authorize'), false);
  assert.equal(shouldRecord('https://example.com/2fa'), false);
});

test('shouldRecord : les URL à jeton ne sont jamais écrites', () => {
  // Écrire un jeton de session en clair dans le stockage local serait une
  // fuite ; et l'URL serait périmée de toute façon.
  assert.equal(shouldRecord('https://example.com/app?token=secret'), false);
  assert.equal(shouldRecord('https://example.com/app?access_token=secret'), false);
  assert.equal(shouldRecord('https://srv.test:2083/cpsess1234567890/frontend/x'), false);
});

test('shouldRecord : schémas non web refusés', () => {
  assert.equal(shouldRecord('file:///etc/passwd'), false);
  assert.equal(shouldRecord('about:blank'), false);
  assert.equal(shouldRecord('data:text/html,<h1>x</h1>'), false);
  assert.equal(shouldRecord('chrome://settings'), false);
  assert.equal(shouldRecord(''), false);
  assert.equal(shouldRecord(null), false);
});
