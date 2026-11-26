import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleBatch, parseLibreBatch, mostlyIn, isLocalServer, makeCache } from '../electron/page-translate.js';

test('Google : lot aligné, et forme à plat pour un seul texte', () => {
  assert.deepEqual(parseGoogleBatch([['Bonjour', 'en'], ['Merci', 'en']], 2), [
    { t: 'Bonjour', lang: 'en' },
    { t: 'Merci', lang: 'en' },
  ]);
  assert.deepEqual(parseGoogleBatch(['Bonjour', 'en'], 1), [{ t: 'Bonjour', lang: 'en' }]);
  // Une réponse qui ne compte pas autant de morceaux est refusée : on ne
  // poserait pas une traduction sur le mauvais texte.
  assert.throws(() => parseGoogleBatch([['Bonjour', 'en']], 2));
  assert.throws(() => parseGoogleBatch({ error: 1 }, 1));
});

test('LibreTranslate : tableaux de traductions et de langues détectées', () => {
  assert.deepEqual(
    parseLibreBatch({ translatedText: ['Salut', 'Oui'], detectedLanguage: [{ language: 'en' }, { language: 'en' }] }, 2),
    [{ t: 'Salut', lang: 'en' }, { t: 'Oui', lang: 'en' }]
  );
  assert.deepEqual(parseLibreBatch({ translatedText: 'Salut' }, 1), [{ t: 'Salut', lang: '' }]);
  assert.throws(() => parseLibreBatch({ translatedText: ['a'] }, 2));
});

test('page déjà dans la langue cible : majorité nette, et pas sur trop peu d’indices', () => {
  assert.equal(mostlyIn([{ lang: 'fr' }, { lang: 'fr' }, { lang: 'fr-FR' }, { lang: 'en' }], 'fr'), true);
  assert.equal(mostlyIn([{ lang: 'en' }, { lang: 'en' }, { lang: 'fr' }], 'fr'), false);
  assert.equal(mostlyIn([{ lang: 'fr' }, { lang: 'fr' }], 'fr'), false);
});

test('serveur local : seul cas permis pour une page privée ou en tunnel', () => {
  for (const url of ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://192.168.1.20', 'http://10.0.0.3', 'http://nas.local']) {
    assert.equal(isLocalServer(url), true, url);
  }
  for (const url of ['https://libretranslate.com', 'http://172.32.0.1', 'pas une url', '']) {
    assert.equal(isLocalServer(url), false, url);
  }
});

test('cache : par langue cible, et borné', () => {
  const cache = makeCache(2);
  cache.set('fr', 'Hello', 'Bonjour');
  assert.equal(cache.get('fr', 'Hello'), 'Bonjour');
  assert.equal(cache.get('es', 'Hello'), undefined);
  cache.set('fr', 'A', 'a');
  cache.set('fr', 'B', 'b');
  // « Hello » a été lu récemment mais « A » et « B » sont venus après : la
  // plus ancienne entrée part.
  assert.equal(cache.get('fr', 'Hello'), undefined);
  assert.equal(cache.get('fr', 'B'), 'b');
});
