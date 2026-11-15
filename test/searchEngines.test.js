// ---------------------------------------------------------------------------
// Moteurs de recherche et résolution d'une saisie libre (src/lib/searchEngines).
//
// Ce que ces tests protègent avant tout : la FRONTIÈRE entre « c'est une
// adresse » et « c'est une recherche ». S'y tromper est invisible en lecture
// de code et très agaçant à l'usage — chercher « mon-nas:8080 » sur Google,
// ou ouvrir « https://chat gpt » comme un site.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_ENGINES,
  allEngines,
  defaultEngine,
  engineByKeyword,
  engineUrl,
  isValidEngine,
  matchEngines,
  normalizeKeyword,
  parseBang,
  resolveOmniInput,
} from '../src/lib/searchEngines.js';

// --- Catalogue intégré ----------------------------------------------------

test('moteurs intégrés : raccourcis uniques et URL contenant {q}', () => {
  const keywords = new Set();
  for (const e of BUILTIN_ENGINES) {
    assert.ok(e.id && e.name, `moteur sans id/nom : ${JSON.stringify(e)}`);
    assert.ok(e.url.includes('{q}'), `${e.id} : URL sans {q}`);
    assert.ok(/^https:\/\//.test(e.url), `${e.id} : URL non https`);
    assert.ok(!keywords.has(e.keyword), `raccourci en double : @${e.keyword}`);
    keywords.add(e.keyword);
  }
});

test('moteurs intégrés : aucun alias ne masque le raccourci d’un autre', () => {
  const keywords = new Set(BUILTIN_ENGINES.map((e) => e.keyword));
  for (const e of BUILTIN_ENGINES) {
    for (const alias of e.aliases || []) {
      assert.ok(!keywords.has(alias), `l’alias « ${alias} » de ${e.id} masque un raccourci`);
    }
  }
});

// --- Moteurs personnalisés ------------------------------------------------

test('isValidEngine : une URL sans emplacement pour les termes est refusée', () => {
  const base = { name: 'Interne', keyword: 'in' };
  assert.ok(isValidEngine({ ...base, url: 'https://intra/s?q={q}' }));
  assert.ok(isValidEngine({ ...base, url: 'https://intra/s?q=%s' }));
  // Sans {q} : toutes les recherches ouvriraient la même page
  assert.ok(!isValidEngine({ ...base, url: 'https://intra/s' }));
  assert.ok(!isValidEngine({ ...base, url: 'ftp://intra/s?q={q}' }));
  assert.ok(!isValidEngine({ name: '', keyword: 'in', url: 'https://i?q={q}' }));
  assert.ok(!isValidEngine({ name: 'X', keyword: '', url: 'https://i?q={q}' }));
  assert.ok(!isValidEngine(null));
});

test('normalizeKeyword : le « @ » recopié dans le champ est toléré', () => {
  assert.equal(normalizeKeyword('@Gh'), 'gh');
  assert.equal(normalizeKeyword('  !ddg '), 'ddg');
  assert.equal(normalizeKeyword(''), '');
});

test('allEngines : un moteur invalide est ignoré, pas affiché à moitié', () => {
  const engines = allEngines({ customEngines: [{ name: 'Cassé', keyword: 'c', url: 'https://x' }] });
  assert.ok(!engines.some((e) => e.name === 'Cassé'));
});

test('allEngines : un raccourci personnalisé l’emporte sur l’intégré', () => {
  const custom = { id: 'c1', name: 'Mon Google', keyword: 'g', url: 'https://intra?q={q}' };
  const engines = allEngines({ customEngines: [custom] });
  const found = engines.filter((e) => e.keyword === 'g');
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Mon Google');
});

test('allEngines : les moteurs masqués disparaissent', () => {
  const engines = allEngines({ hiddenEngines: ['bing', 'qwant'] });
  assert.ok(!engines.some((e) => e.id === 'bing'));
  assert.ok(!engines.some((e) => e.id === 'qwant'));
});

test('defaultEngine : un id qui ne pointe plus sur rien retombe sur un moteur réel', () => {
  assert.equal(defaultEngine({ engine: 'startpage' }).id, 'startpage');
  assert.equal(defaultEngine({ engine: 'moteur-supprime' }).id, 'google');
  // Google lui-même masqué : il reste un moteur, jamais `undefined`
  const fallback = defaultEngine({ engine: 'google', hiddenEngines: ['google'] });
  assert.ok(fallback && fallback.url.includes('{q}'));
});

// --- Raccourcis « @g » ----------------------------------------------------

test('parseBang : découpe le raccourci et retient s’il est refermé', () => {
  assert.deepEqual(parseBang('@g'), { prefix: '@', keyword: 'g', terms: '', complete: false });
  assert.deepEqual(parseBang('@g chat'), { prefix: '@', keyword: 'g', terms: 'chat', complete: true });
  assert.deepEqual(parseBang('!ddg x y'), { prefix: '!', keyword: 'ddg', terms: 'x y', complete: true });
  assert.deepEqual(parseBang('@'), { prefix: '@', keyword: '', terms: '', complete: false });
  assert.equal(parseBang('google chat'), null);
  assert.equal(parseBang(''), null);
});

test('engineByKeyword : raccourci et alias, insensible à la casse', () => {
  const engines = allEngines({});
  assert.equal(engineByKeyword(engines, 'g').id, 'google');
  assert.equal(engineByKeyword(engines, 'DDG').id, 'duckduckgo');
  assert.equal(engineByKeyword(engines, 'wiki').id, 'wikipedia');
  assert.equal(engineByKeyword(engines, 'zzz'), null);
  assert.equal(engineByKeyword(engines, ''), null);
});

test('matchEngines : les raccourcis qui commencent par la frappe passent devant', () => {
  const engines = allEngines({});
  const matches = matchEngines(engines, 'g');
  assert.equal(matches[0].id, 'google', 'un @g doit proposer Google en premier');
  assert.ok(matches.some((e) => e.id === 'github'));
  // Préfixe vide : tout le catalogue, pour la liste affichée sur un « @ » seul
  assert.equal(matchEngines(engines, '').length, engines.length);
});

test('engineUrl : termes encodés, langue substituée', () => {
  const google = BUILTIN_ENGINES.find((e) => e.id === 'google');
  assert.equal(engineUrl(google, 'c++ & rust'), 'https://www.google.com/search?q=c%2B%2B%20%26%20rust');
  const wiki = BUILTIN_ENGINES.find((e) => e.id === 'wikipedia');
  assert.ok(engineUrl(wiki, 'orbite', 'en').startsWith('https://en.wikipedia.org/'));
  assert.ok(engineUrl(wiki, 'orbite', 'fr').startsWith('https://fr.wikipedia.org/'));
  assert.equal(engineUrl(google, '   '), null);
  assert.equal(engineUrl(null, 'x'), null);
});

test('engineUrl : un moteur personnalisé en %s est servi comme un {q}', () => {
  const engine = { name: 'Intra', keyword: 'i', url: 'https://intra/s?q=%s' };
  assert.equal(engineUrl(engine, 'devis 2026'), 'https://intra/s?q=devis%202026');
});

// --- Résolution d'une saisie libre ---------------------------------------

test('resolveOmniInput : du texte libre devient une recherche', () => {
  const r = resolveOmniInput('comment réparer un vélo', { search: { engine: 'duckduckgo' } });
  assert.equal(r.kind, 'search');
  assert.equal(r.engine.id, 'duckduckgo');
  assert.equal(r.bang, false);
  assert.ok(r.url.startsWith('https://duckduckgo.com/?q=comment'));
});

test('resolveOmniInput : une adresse reste une adresse', () => {
  assert.deepEqual(resolveOmniInput('github.com'), { kind: 'url', url: 'https://github.com' });
  assert.deepEqual(resolveOmniInput('https://x.fr/a?b=1'), { kind: 'url', url: 'https://x.fr/a?b=1' });
  // Le cas qui ne marchait pas : un serveur local sans schéma ni domaine
  assert.deepEqual(resolveOmniInput('localhost:5173'), { kind: 'url', url: 'http://localhost:5173' });
  assert.deepEqual(resolveOmniInput('192.168.1.10:8080/admin'), {
    kind: 'url',
    url: 'http://192.168.1.10:8080/admin',
  });
});

test('resolveOmniInput : un raccourci explicite l’emporte sur l’adresse', () => {
  // « @g github.com » = cherche cette chaîne, pas « ouvre ce site »
  const r = resolveOmniInput('@g github.com');
  assert.equal(r.kind, 'search');
  assert.equal(r.engine.id, 'google');
  assert.equal(r.terms, 'github.com');
  assert.equal(r.bang, true);
});

test('resolveOmniInput : un raccourci en cours de frappe propose les moteurs', () => {
  const partial = resolveOmniInput('@g');
  assert.equal(partial.kind, 'engines');
  assert.equal(partial.engines[0].id, 'google');

  const all = resolveOmniInput('@');
  assert.equal(all.kind, 'engines');
  assert.ok(all.engines.length > 5);

  // Raccourci reconnu mais sans termes : on attend la suite, on ne cherche pas
  const waiting = resolveOmniInput('@yt ');
  assert.equal(waiting.kind, 'engines');
  assert.equal(waiting.engine.id, 'youtube');
});

test('resolveOmniInput : un raccourci incomplet propose les moteurs voisins', () => {
  // « @gi » ne désigne rien, mais commence comme @g / @gh : on propose
  const r = resolveOmniInput('@g');
  assert.equal(r.kind, 'engines');
  assert.equal(r.engine.id, 'google');
});

test('resolveOmniInput : « !important css » n’est pas un raccourci, c’est une recherche', () => {
  // Un « @ » ou « ! » qui ne ressemble à AUCUN moteur ne doit pas mener à une
  // liste vide : la saisie suit son cours et part au moteur par défaut.
  const r = resolveOmniInput('!important css');
  assert.equal(r.kind, 'search');
  assert.equal(r.bang, false);
  assert.equal(r.terms, '!important css');

  const mention = resolveOmniInput('@zzzz');
  assert.equal(mention.kind, 'search');
  assert.equal(mention.terms, '@zzzz');
});

test('resolveOmniInput : une saisie vide ne décide rien', () => {
  assert.deepEqual(resolveOmniInput(''), { kind: 'empty' });
  assert.deepEqual(resolveOmniInput('   '), { kind: 'empty' });
  assert.deepEqual(resolveOmniInput(null), { kind: 'empty' });
});

test('resolveOmniInput : un moteur personnalisé est utilisable par raccourci', () => {
  const search = {
    customEngines: [{ id: 'c1', name: 'Intranet', keyword: 'intra', url: 'https://intra/s?q={q}' }],
  };
  const r = resolveOmniInput('@intra devis', { search });
  assert.equal(r.kind, 'search');
  assert.equal(r.url, 'https://intra/s?q=devis');
});
