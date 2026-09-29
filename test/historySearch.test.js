import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, hostLabel, matchScore, recencyScore, scoreEntry,
  dedupe, searchHistory, searchOpenPages,
} from '../src/lib/historySearch.js';

// Le classement fait tout l'intérêt de la recherche transverse : sur un
// historique de plusieurs centaines d'entrées, un simple « contient »
// remonterait n'importe quoi. Ces tests fixent l'ordre attendu.

const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

test('normalize : insensible à la casse et aux accents', () => {
  assert.equal(normalize('Réunion Équipe'), 'reunion equipe');
  assert.equal(normalize('ÀÉÎÕÜ'), 'aeiou');
  assert.equal(normalize(null), '');
});

test('hostLabel : hôte lisible, sans www', () => {
  assert.equal(hostLabel('https://www.github.com/a/b'), 'github.com');
  assert.equal(hostLabel('https://mail.google.com/'), 'mail.google.com');
  assert.equal(hostLabel('pas-une-url'), '');
});

test('matchScore : une correspondance en début de mot bat un fragment perdu', () => {
  assert.equal(matchScore('facture', 'facture'), 1);
  assert.ok(matchScore('facture client', 'facture') > matchScore('les factures', 'acture'));
  // Début de mot après un séparateur
  assert.ok(matchScore('rapport-annuel', 'annuel') > matchScore('xxannuelxx', 'annuel'));
  assert.equal(matchScore('quoi que ce soit', 'absent'), 0);
  assert.equal(matchScore('texte', ''), 0);
});

test('recencyScore : décroît avec l’âge', () => {
  const frais = recencyScore(NOW - HOUR, NOW);
  const semaine = recencyScore(NOW - 7 * DAY, NOW);
  const mois = recencyScore(NOW - 30 * DAY, NOW);
  assert.ok(frais > semaine && semaine > mois);
  assert.ok(frais > 0.9, 'une page vue il y a une heure doit rester quasi maximale');
  assert.ok(Math.abs(semaine - 0.5) < 0.05, 'une semaine doit valoir environ la moitié');
  assert.equal(recencyScore(0, NOW), 0);
});

test('scoreEntry : à correspondance égale, la page récente gagne', () => {
  const base = { title: 'Facture 2026', url: 'https://a.test/f', visits: 1 };
  const recent = scoreEntry({ ...base, at: NOW - HOUR }, 'facture', NOW);
  const vieux = scoreEntry({ ...base, at: NOW - 30 * DAY }, 'facture', NOW);
  assert.ok(recent > vieux);
});

test('scoreEntry : le titre pèse plus que l’URL', () => {
  const parTitre = scoreEntry(
    { title: 'facture', url: 'https://a.test/xyz', at: NOW, visits: 1 }, 'facture', NOW
  );
  const parUrl = scoreEntry(
    { title: 'Sans rapport', url: 'https://a.test/facture', at: NOW, visits: 1 }, 'facture', NOW
  );
  assert.ok(parTitre > parUrl, 'on se souvient d’un intitulé, pas d’un chemin');
});

test('scoreEntry : les visites répétées comptent, mais sont plafonnées', () => {
  const e = (visits) => ({ title: 'doc', url: 'https://a.test', at: NOW, visits });
  assert.ok(scoreEntry(e(8), 'doc', NOW) > scoreEntry(e(1), 'doc', NOW));
  // Au-delà de 10 visites, plus d'effet : un site vu 500 fois ne doit pas
  // écraser une page pertinente.
  assert.equal(scoreEntry(e(10), 'doc', NOW), scoreEntry(e(500), 'doc', NOW));
});

test('scoreEntry : aucune correspondance → 0', () => {
  assert.equal(scoreEntry({ title: 'a', url: 'https://b.test', at: NOW }, 'zzz', NOW), 0);
});

test('dedupe : une même URL n’apparaît qu’une fois, visites cumulées', () => {
  const out = dedupe([
    { url: 'https://a.test', title: 'Ancien', at: NOW - DAY, visits: 2 },
    { url: 'https://a.test', title: 'Récent', at: NOW, visits: 3 },
    { url: 'https://b.test', title: 'Autre', at: NOW, visits: 1 },
  ]);
  assert.equal(out.length, 2);
  const a = out.find((e) => e.url === 'https://a.test');
  assert.equal(a.visits, 5, 'les visites doivent se cumuler');
  assert.equal(a.title, 'Récent', 'le titre le plus récent doit gagner');
  assert.equal(a.at, NOW);
});

test('dedupe : entrées sans URL ignorées', () => {
  assert.deepEqual(dedupe([null, {}, { title: 'x' }]), []);
});

test('searchHistory : classe par pertinence puis fraîcheur', () => {
  const entries = [
    { url: 'https://x.test/1', title: 'Notes diverses sur la facture', at: NOW - 10 * DAY, visits: 1 },
    { url: 'https://x.test/2', title: 'Facture client Dupont', at: NOW - HOUR, visits: 4 },
    { url: 'https://x.test/3', title: 'Sans rapport', at: NOW, visits: 9 },
  ];
  const res = searchHistory(entries, 'facture', { now: NOW });
  assert.equal(res.length, 2, 'l’entrée sans rapport ne doit pas remonter');
  assert.equal(res[0].url, 'https://x.test/2', 'la plus pertinente ET récente d’abord');
});

test('searchHistory : une seule lettre ne déclenche rien', () => {
  const entries = [{ url: 'https://x.test', title: 'Facture', at: NOW, visits: 1 }];
  assert.deepEqual(searchHistory(entries, 'f', { now: NOW }), []);
  assert.deepEqual(searchHistory(entries, '', { now: NOW }), []);
  assert.deepEqual(searchHistory(entries, '  ', { now: NOW }), []);
});

test('searchHistory : borne le nombre de résultats', () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    url: `https://x.test/${i}`, title: `Facture ${i}`, at: NOW - i * HOUR, visits: 1,
  }));
  assert.equal(searchHistory(entries, 'facture', { now: NOW }).length, 6);
  assert.equal(searchHistory(entries, 'facture', { now: NOW, limit: 3 }).length, 3);
});

test('searchHistory : historique vide ou absent', () => {
  assert.deepEqual(searchHistory([], 'facture', { now: NOW }), []);
  assert.deepEqual(searchHistory(null, 'facture', { now: NOW }), []);
});

test('searchOpenPages : trouve par le TITRE courant, pas par le nom d’app', () => {
  const apps = [
    { id: 'drive', name: 'Drive', title: 'Facture 2026 — Google Drive', url: 'https://drive.test/x' },
    { id: 'slack', name: 'Slack', title: 'Général', url: 'https://slack.test' },
  ];
  const res = searchOpenPages(apps, 'facture');
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'drive');
});

test('searchOpenPages : pas de doublon avec la liste des apps', () => {
  // « Slack » remonte déjà dans la section applications de la palette :
  // le répéter ici ferait doublon.
  const apps = [{ id: 'slack', name: 'Slack', title: 'Slack — Général', url: 'https://slack.test' }];
  assert.deepEqual(searchOpenPages(apps, 'slack'), []);
});

test('searchOpenPages : ignore les apps en veille ou sans titre', () => {
  const apps = [
    { id: 'a', name: 'A', title: 'Facture', url: 'https://a.test', sleeping: true },
    { id: 'b', name: 'B', url: 'https://b.test' },
  ];
  assert.deepEqual(searchOpenPages(apps, 'facture'), []);
});

test('searchOpenPages : entrées vides tolérées', () => {
  assert.deepEqual(searchOpenPages(null, 'x'), []);
  assert.deepEqual(searchOpenPages([null, undefined], 'facture'), []);
});
