import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBangsSource, compactBang, compactBangs, buildBangIndex, lookupBang, matchBangs, searchBangCatalog,
} from '../src/lib/bangs.js';
import { resolveOmniInput } from '../src/lib/searchEngines.js';

const SOURCE = `// en-tête
// MIT
[
 { "s": "Amazon.com", "ts": [ "a", "amz", "amazon", ], "u": "https://www.amazon.com/s?k={searchTerms}" },
 { "s": "Google", "ts": [ "g", "п" ], "u": "https://www.google.com/search?q={searchTerms}" },
 { "s": "Wayback", "ts": [ "ia", "wayback" ], "u": "https://web.archive.org/web/*/{searchTerms}" },
 { "s": "Doublon", "ts": [ "amz" ], "u": "https://example.com/?q={searchTerms}" },
 { "s": "Http", "ts": [ "insecure" ], "u": "http://example.com/?q={searchTerms}" },
 { "s": "Sans termes", "ts": [ "noterm" ], "u": "https://example.com/" },
 { "s": "Javascript", "ts": [ "js" ], "u": "javascript:alert({searchTerms})" },
]`;

const data = compactBangs(parseBangsSource(SOURCE));
const index = buildBangIndex(data);

test('lecture de la source : commentaires et virgules finales', () => {
  assert.equal(parseBangsSource(SOURCE).length, 7);
});

test('entrées invalides écartées (http, sans termes, autre schéma)', () => {
  const names = data.map((e) => e[0]);
  assert.deepEqual(names, ['Amazon.com', 'Google', 'Wayback']);
  assert.equal(compactBang({ s: 'x', ts: ['x'], u: 'https://a.b/{searchTerms}/{searchTerms}' }), null);
});

test('raccourcis non lisibles par la palette retirés, premier déclarant gagne', () => {
  assert.deepEqual(data[1][2], ['g']);
  assert.equal(lookupBang(index, 'amz').name, 'Amazon.com');
  assert.equal(lookupBang(index, 'amz').url, 'https://www.amazon.com/s?k={q}');
  assert.equal(lookupBang(index, 'amz').keyword, 'amz');
});

test('complétion par préfixe, une ligne par site', () => {
  const hits = matchBangs(index, 'am');
  assert.deepEqual(hits.map((e) => e.name), ['Amazon.com']);
  assert.deepEqual(matchBangs(index, ''), []);
});

test('recherche dans le catalogue par nom', () => {
  assert.equal(searchBangCatalog(data, 'wayb')[0].name, 'Wayback');
});

test('le catalogue passe APRÈS les moteurs intégrés et personnalisés', () => {
  // @ia est un alias intégré (Perplexity) : le catalogue ne le vole pas.
  const ia = resolveOmniInput('@ia chat', { bangs: index });
  assert.equal(ia.engine.id, 'perplexity');
  const amz = resolveOmniInput('@amz casque', { bangs: index });
  assert.equal(amz.kind, 'search');
  assert.equal(amz.url, 'https://www.amazon.com/s?k=casque');
  const mine = resolveOmniInput('@amz casque', {
    bangs: index,
    search: { customEngines: [{ id: 'x', name: 'Mon Amazon', keyword: 'amz', url: 'https://www.amazon.fr/s?k={q}' }] },
  });
  assert.equal(mine.url, 'https://www.amazon.fr/s?k=casque');
});

test('catalogue désactivé dans les réglages', () => {
  const r = resolveOmniInput('@amz casque', { bangs: index, search: { bangCatalog: false } });
  assert.notEqual(r.url, 'https://www.amazon.com/s?k=casque');
});

test('complétion mêlant moteurs et catalogue', () => {
  const r = resolveOmniInput('@am', { bangs: index });
  assert.equal(r.kind, 'engines');
  assert.ok(r.engines.some((e) => e.catalog && e.name === 'Amazon.com'));
});
