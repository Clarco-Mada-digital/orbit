import test from 'node:test';
import assert from 'node:assert/strict';
import { pushClosed, popClosed, closedEntryFor } from '../src/lib/closedTabs.js';
import { pickVoiceFor, voiceLang, baseLang } from '../electron/voice-pick.js';
import { pageDecision, siteOf } from '../electron/page-translate.js';

test('onglets fermés : jamais les pages privées, sans doublon, bornés', () => {
  assert.equal(closedEntryFor({ private: true, url: 'https://a.test' }), null);
  let list = [];
  list = pushClosed(list, { url: 'https://a.test', title: 'A' }, 3, 1);
  list = pushClosed(list, { url: 'https://b.test', title: 'B' }, 3, 2);
  list = pushClosed(list, { url: 'https://a.test', title: 'A bis' }, 3, 3);
  assert.deepEqual(list.map((e) => e.title), ['A bis', 'B']);
  list = pushClosed(list, { url: 'https://c.test' }, 3, 4);
  list = pushClosed(list, { url: 'https://d.test' }, 3, 5);
  assert.equal(list.length, 3);
  const { entry, rest } = popClosed(list);
  assert.equal(entry.url, 'https://d.test');
  assert.equal(rest.length, 2);
  assert.deepEqual(popClosed([]), { entry: null, rest: [] });
});

test('voix : celle des réglages, sauf si une voix installée parle la langue du texte', () => {
  const installed = ['fr_FR-siwis-low', 'en_US-amy-medium'];
  assert.equal(voiceLang('en_GB-alba-medium'), 'en');
  assert.equal(baseLang('en-US'), 'en');
  assert.equal(baseLang('n importe quoi'), '');
  assert.equal(pickVoiceFor('en-US', 'fr_FR-siwis-low', installed), 'en_US-amy-medium');
  assert.equal(pickVoiceFor('fr', 'fr_FR-siwis-low', installed), 'fr_FR-siwis-low');
  // Aucune voix dans la langue : on garde le choix de l'utilisateur.
  assert.equal(pickVoiceFor('de', 'fr_FR-siwis-low', installed), 'fr_FR-siwis-low');
  assert.equal(pickVoiceFor('', 'fr_FR-siwis-low', installed), 'fr_FR-siwis-low');
});

test('traduction automatique : toujours / jamais / proposer', () => {
  const base = { target: 'fr', always: ['en'], never: ['example.com'], offer: true };
  assert.equal(pageDecision({ ...base, lang: 'en-US', site: 'news.test' }), 'auto');
  assert.equal(pageDecision({ ...base, lang: 'en', site: 'example.com' }), null);
  assert.equal(pageDecision({ ...base, lang: 'de', site: 'news.test' }), 'offer');
  assert.equal(pageDecision({ ...base, lang: 'de', offer: false, site: 'news.test' }), null);
  assert.equal(pageDecision({ ...base, lang: 'fr-FR', site: 'news.test' }), null);
  assert.equal(pageDecision({ ...base, lang: '', site: 'news.test' }), null);
  assert.equal(siteOf('https://www.Example.com/page'), 'example.com');
  assert.equal(siteOf('file:///tmp/a.html'), '');
});
