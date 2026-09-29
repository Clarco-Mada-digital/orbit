import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  globToRegExp, urlMatches, matchLinkRule, parseTimeOfDay,
  dueTimeRules, validateRule, isValidRule, describeRule,
} from '../src/lib/rules.js';

// Les règles redirigent des liens et changent de profil toutes seules. Une
// erreur ici se manifeste par « Orbit fait n'importe quoi sans que je
// comprenne pourquoi » — d'où l'insistance sur les cas de NON-correspondance.

// --- Motifs ---------------------------------------------------------------

test('globToRegExp : `*` remplace n’importe quoi, le reste est littéral', () => {
  assert.ok(globToRegExp('*.github.com').test('api.github.com'));
  assert.ok(globToRegExp('https://x.test/*').test('https://x.test/a/b'));
  // Les caractères spéciaux d'expression régulière sont neutralisés
  assert.ok(globToRegExp('a.test').test('a.test'));
  assert.equal(globToRegExp('a.test').test('axtest'), false, 'le point ne doit pas être joker');
  assert.equal(globToRegExp(''), null);
});

test('urlMatches : un domaine nu attrape ses chemins et sous-domaines', () => {
  // Ce que les gens écrivent spontanément
  assert.equal(urlMatches('github.com', 'https://github.com/orbit/pull/1'), true);
  assert.equal(urlMatches('github.com', 'https://api.github.com/x'), true);
  assert.equal(urlMatches('github.com', 'https://gitlab.com/x'), false);
});

test('urlMatches : motif explicite avec joker', () => {
  assert.equal(urlMatches('https://*.slack.com/*', 'https://app.slack.com/client/x'), true);
  assert.equal(urlMatches('https://*.slack.com/*', 'https://slack.example.com/x'), false);
});

test('urlMatches : entrées vides ou invalides', () => {
  assert.equal(urlMatches('', 'https://a.test'), false);
  assert.equal(urlMatches('a.test', ''), false);
  assert.equal(urlMatches(null, null), false);
  assert.equal(urlMatches('*', 'pas-une-url'), true, 'la chaîne brute reste comparée');
});

// --- Règles de lien -------------------------------------------------------

const R = (over) => ({ id: 'r', trigger: 'link', action: 'openInApp', targetAppId: 'a1', ...over });

test('matchLinkRule : la PREMIÈRE règle qui correspond gagne', () => {
  const rules = [
    R({ id: 'r1', pattern: 'github.com', targetAppId: 'gh' }),
    R({ id: 'r2', pattern: '*', targetAppId: 'fourre-tout' }),
  ];
  assert.equal(matchLinkRule(rules, 'https://github.com/x').id, 'r1');
  assert.equal(matchLinkRule(rules, 'https://autre.test').id, 'r2');
});

test('matchLinkRule : une règle désactivée est ignorée', () => {
  const rules = [R({ id: 'off', pattern: 'github.com', enabled: false })];
  assert.equal(matchLinkRule(rules, 'https://github.com/x'), null);
});

test('matchLinkRule : restriction à l’app d’origine', () => {
  const rules = [R({ id: 'r1', pattern: '*', fromAppId: 'slack' })];
  assert.equal(matchLinkRule(rules, 'https://x.test', { fromAppId: 'slack' })?.id, 'r1');
  assert.equal(matchLinkRule(rules, 'https://x.test', { fromAppId: 'gmail' }), null);
  assert.equal(matchLinkRule(rules, 'https://x.test'), null);
});

test('matchLinkRule : action inconnue ignorée (données d’une version future)', () => {
  const rules = [R({ pattern: '*', action: 'teleporter' })];
  assert.equal(matchLinkRule(rules, 'https://x.test'), null);
});

test('matchLinkRule : aucune règle → null (comportement par défaut)', () => {
  assert.equal(matchLinkRule([], 'https://x.test'), null);
  assert.equal(matchLinkRule(null, 'https://x.test'), null);
  assert.equal(matchLinkRule([R({ pattern: '*' })], ''), null);
});

// --- Règles horaires ------------------------------------------------------

test('parseTimeOfDay : accepte h:mm et hh:mm, rejette le reste', () => {
  assert.equal(parseTimeOfDay('09:00'), 540);
  assert.equal(parseTimeOfDay('9:05'), 545);
  assert.equal(parseTimeOfDay('23:59'), 1439);
  assert.equal(parseTimeOfDay('24:00'), null);
  assert.equal(parseTimeOfDay('12:60'), null);
  assert.equal(parseTimeOfDay('midi'), null);
  assert.equal(parseTimeOfDay(''), null);
});

const at9 = (over) => ({
  id: 't1', trigger: 'time', at: '09:00', targetProfileId: 'work', ...over,
});
// Lundi 2026-09-28, 9 h 00 pile
const LUNDI_9H = new Date(2026, 8, 28, 9, 0, 0);

test('dueTimeRules : se déclenche à l’heure dite', () => {
  assert.equal(dueTimeRules([at9()], { now: LUNDI_9H, lastRun: {} }).length, 1);
  const a8h59 = new Date(2026, 8, 28, 8, 59, 0);
  assert.equal(dueTimeRules([at9()], { now: a8h59, lastRun: {} }).length, 0);
});

test('dueTimeRules : ne se rejoue pas dans la même minute', () => {
  // Sans ce garde-fou, une règle de 9 h se redéclencherait à chaque tick et
  // empêcherait tout changement manuel de profil pendant une minute entière.
  const lastRun = { t1: LUNDI_9H.getTime() - 5000 };
  assert.equal(dueTimeRules([at9()], { now: LUNDI_9H, lastRun }).length, 0);
  // Mais le lendemain, oui
  const demain = new Date(2026, 8, 29, 9, 0, 0);
  assert.equal(dueTimeRules([at9()], { now: demain, lastRun }).length, 1);
});

test('dueTimeRules : restriction aux jours choisis', () => {
  const semaine = at9({ days: [1, 2, 3, 4, 5] }); // lundi→vendredi
  assert.equal(dueTimeRules([semaine], { now: LUNDI_9H, lastRun: {} }).length, 1);
  const dimanche = new Date(2026, 8, 27, 9, 0, 0);
  assert.equal(dueTimeRules([semaine], { now: dimanche, lastRun: {} }).length, 0);
  // Liste vide = tous les jours
  assert.equal(dueTimeRules([at9({ days: [] })], { now: dimanche, lastRun: {} }).length, 1);
});

test('dueTimeRules : règle désactivée ou heure invalide ignorée', () => {
  assert.equal(dueTimeRules([at9({ enabled: false })], { now: LUNDI_9H, lastRun: {} }).length, 0);
  assert.equal(dueTimeRules([at9({ at: 'midi' })], { now: LUNDI_9H, lastRun: {} }).length, 0);
  assert.equal(dueTimeRules(null, { now: LUNDI_9H }).length, 0);
});

// --- Validation -----------------------------------------------------------

test('validateRule : une règle complète passe', () => {
  assert.deepEqual(validateRule(R({ pattern: 'github.com' })), []);
  assert.equal(isValidRule(at9()), true);
});

test('validateRule : un motif vide est refusé (il attraperait tout)', () => {
  assert.ok(validateRule(R({ pattern: '' })).includes('rules.err.pattern'));
  assert.ok(validateRule(R({ pattern: '   ' })).includes('rules.err.pattern'));
});

test('validateRule : openInApp exige une app cible', () => {
  assert.ok(
    validateRule(R({ pattern: 'x.test', targetAppId: null })).includes('rules.err.targetApp')
  );
  // Les autres actions n'en ont pas besoin
  assert.deepEqual(validateRule(R({ pattern: 'x.test', action: 'external', targetAppId: null })), []);
});

test('validateRule : règle horaire incomplète', () => {
  assert.ok(validateRule(at9({ at: '99:99' })).includes('rules.err.time'));
  assert.ok(validateRule(at9({ targetProfileId: '' })).includes('rules.err.targetProfile'));
});

test('validateRule : déclencheur inconnu et entrées vides', () => {
  assert.ok(validateRule({ trigger: 'lune' }).includes('rules.err.trigger'));
  assert.deepEqual(validateRule(null), ['rules.err.empty']);
});

test('describeRule : clé de traduction + variables', () => {
  assert.deepEqual(describeRule(R({ pattern: 'github.com' })), {
    key: 'rules.desc.openInApp',
    vars: { pattern: 'github.com' },
  });
  assert.deepEqual(describeRule(at9()), { key: 'rules.desc.time', vars: { at: '09:00' } });
});
