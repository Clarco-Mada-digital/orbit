import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRecord,
  withoutUrl,
  withoutSince,
  countSince,
} from '../src/lib/historySearch.js';

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

// --- Oubli ----------------------------------------------------------------
// Les filtres d'oubli vivent dans historySearch.js (donc importables sans
// zustand) : c'est ce que le magasin applique derrière `forget`,
// `forgetSince` et les compteurs affichés avant un vidage.

test('withoutUrl retire la page visée et seulement celle-là', () => {
  const entries = [
    { url: 'https://a.test/1', at: 3 },
    { url: 'https://b.test/2', at: 2 },
    { url: 'https://a.test/1?x=1', at: 1 },
  ];
  const left = withoutUrl(entries, 'https://a.test/1');
  assert.deepEqual(left.map((e) => e.url), ['https://b.test/2', 'https://a.test/1?x=1']);
  // Sans URL, rien n'est supprimé : un appel accidentel ne doit pas tout vider.
  assert.equal(withoutUrl(entries, '').length, 3);
  assert.equal(withoutUrl(entries, undefined).length, 3);
});

test('withoutSince ne garde que ce qui précède la date', () => {
  const entries = [
    { url: 'https://a.test', at: 1000 },
    { url: 'https://b.test', at: 500 },
    { url: 'https://c.test' }, // sans date : traitée comme très ancienne
  ];
  assert.deepEqual(
    withoutSince(entries, 600).map((e) => e.url),
    ['https://b.test', 'https://c.test']
  );
  // La borne est inclusive sur ce qu'on efface : une entrée pile à l'heure
  // demandée part, sinon « oublier la dernière heure » en laisserait une.
  assert.deepEqual(withoutSince(entries, 500).map((e) => e.url), ['https://c.test']);
  // Date invalide : on ne touche à rien plutôt que de tout effacer.
  assert.equal(withoutSince(entries, NaN).length, 3);
  assert.equal(withoutSince(entries, undefined).length, 3);
});

test('countSince annonce exactement ce que le bouton va effacer', () => {
  const entries = [{ at: 1000 }, { at: 900 }, { at: 100 }, {}];
  assert.equal(countSince(entries, 900), 2);
  assert.equal(countSince(entries, 1001), 0);
  // countSince compte EXACTEMENT ce que withoutSince retire, entrée sans date
  // comprise : les deux fonctions doivent rester le miroir l'une de l'autre.
  assert.equal(countSince(entries, 0), 4);
  assert.equal(countSince(entries, 0), entries.length - withoutSince(entries, 0).length);
  assert.equal(countSince(entries, 900), entries.length - withoutSince(entries, 900).length);
  assert.equal(countSince([], 10), 0);
  assert.equal(countSince(undefined, 10), 0);
});
