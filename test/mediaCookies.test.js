// ---------------------------------------------------------------------------
// Cookies confiés à yt-dlp (src/lib/mediaCookies.js).
//
// Ces tests gardent une FRONTIÈRE DE SÉCURITÉ, pas un confort : télécharger
// une vidéo Facebook ne doit jamais sortir la session d'un autre site. Un
// cookie qui fuite ici est un compte compromis, pas un bogue d'affichage.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registrableDomain,
  cookieMatchesHost,
  selectCookiesForUrl,
  toNetscapeCookieFile,
} from '../src/lib/mediaCookies.js';

const NOW = 1_800_000_000_000; // ms
const future = Math.floor(NOW / 1000) + 86_400;
const past = Math.floor(NOW / 1000) - 86_400;

const cookie = (over = {}) => ({
  name: 'sid',
  value: 'secret',
  domain: '.facebook.com',
  path: '/',
  secure: true,
  expirationDate: future,
  ...over,
});

// --- Domaines -------------------------------------------------------------

test('registrableDomain : le site derrière un sous-domaine', () => {
  assert.equal(registrableDomain('www.facebook.com'), 'facebook.com');
  assert.equal(registrableDomain('web.m.facebook.com'), 'facebook.com');
  assert.equal(registrableDomain('facebook.com'), 'facebook.com');
  assert.equal(registrableDomain('WWW.YouTube.COM'), 'youtube.com');
  // Suffixes composés : « bbc.co.uk » est le site, pas « co.uk »
  assert.equal(registrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('a.b.company.com.au'), 'company.com.au');
  // Une IP reste elle-même
  assert.equal(registrableDomain('192.168.1.10'), '192.168.1.10');
  assert.equal(registrableDomain(''), '');
});

test('cookieMatchesHost : le point initial couvre les sous-domaines', () => {
  assert.ok(cookieMatchesHost('.facebook.com', 'www.facebook.com'));
  assert.ok(cookieMatchesHost('facebook.com', 'facebook.com'));
  assert.ok(!cookieMatchesHost('.facebook.com', 'facebook.com.evil.test'));
  assert.ok(!cookieMatchesHost('.youtube.com', 'www.facebook.com'));
  assert.ok(!cookieMatchesHost('', 'facebook.com'));
});

// --- Le filtre, c'est la sécurité ----------------------------------------

test('selectCookiesForUrl : seuls les cookies du site visé sortent', () => {
  const jar = [
    cookie({ name: 'fb', domain: '.facebook.com' }),
    cookie({ name: 'banque', domain: '.ma-banque.fr' }),
    cookie({ name: 'yt', domain: '.youtube.com' }),
    cookie({ name: 'sous', domain: 'web.facebook.com' }),
  ];
  const kept = selectCookiesForUrl(jar, 'https://www.facebook.com/watch/?v=1');
  assert.deepEqual(kept.map((c) => c.name).sort(), ['fb']);
  // Celui de la banque ne doit JAMAIS apparaître
  assert.ok(!kept.some((c) => c.domain.includes('banque')));
});

test('selectCookiesForUrl : un domaine qui ressemble n’est pas le domaine', () => {
  const jar = [cookie({ name: 'piege', domain: '.facebook.com.evil.test' })];
  assert.deepEqual(selectCookiesForUrl(jar, 'https://www.facebook.com/x'), []);
});

test('selectCookiesForUrl : un cookie « secure » ne part pas en clair', () => {
  const jar = [cookie({ name: 's', domain: '.exemple.fr', secure: true })];
  assert.equal(selectCookiesForUrl(jar, 'https://exemple.fr/v').length, 1);
  assert.equal(selectCookiesForUrl(jar, 'http://exemple.fr/v').length, 0);
});

test('selectCookiesForUrl : entrées invalides → rien, jamais une exception', () => {
  assert.deepEqual(selectCookiesForUrl(null, 'https://x.fr'), []);
  assert.deepEqual(selectCookiesForUrl([cookie()], 'pas une url'), []);
  assert.deepEqual(selectCookiesForUrl([{ domain: '.x.fr' }], 'https://x.fr'), []); // sans nom
});

// --- Mise en forme --------------------------------------------------------

test('toNetscapeCookieFile : en-tête obligatoire et sept colonnes tabulées', () => {
  const text = toNetscapeCookieFile([cookie()], { now: NOW });
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.ok(text.startsWith('# Netscape HTTP Cookie File'), 'yt-dlp refuse le fichier sans cette ligne');
  assert.equal(lines.length, 1);
  const cols = lines[0].split('\t');
  assert.equal(cols.length, 7);
  assert.deepEqual(cols, ['.facebook.com', 'TRUE', '/', 'TRUE', String(future), 'sid', 'secret']);
});

test('toNetscapeCookieFile : un cookie de session s’écrit avec 0 en expiration', () => {
  const text = toNetscapeCookieFile([cookie({ expirationDate: undefined })], { now: NOW });
  const line = text.split('\n').find((l) => l.includes('sid'));
  assert.equal(line.split('\t')[4], '0', 'c’est le cookie de session qui porte la connexion');
});

test('toNetscapeCookieFile : un cookie périmé est écarté', () => {
  assert.equal(toNetscapeCookieFile([cookie({ expirationDate: past })], { now: NOW }), null);
});

test('toNetscapeCookieFile : pas de cookie → null, pas un fichier vide', () => {
  // Un fichier vide fait échouer yt-dlp : l'appelant doit sauter --cookies.
  assert.equal(toNetscapeCookieFile([], { now: NOW }), null);
  assert.equal(toNetscapeCookieFile(null, { now: NOW }), null);
});

test('toNetscapeCookieFile : une tabulation dans une valeur ne casse pas le fichier', () => {
  // Sans ce filtre, une valeur piégée ajouterait des colonnes, voire une
  // ligne entière — donc un cookie pour un domaine qu’on n’a pas choisi.
  const jar = [
    cookie({ name: 'bon', value: 'ok' }),
    cookie({ name: 'piege', value: 'a\tb' }),
    cookie({ name: 'saut', value: 'a\n.evil.test\tTRUE\t/\tFALSE\t0\tx\ty' }),
  ];
  const text = toNetscapeCookieFile(jar, { now: NOW });
  assert.ok(text.includes('bon'));
  assert.ok(!text.includes('piege'));
  assert.ok(!text.includes('evil.test'));
  for (const line of text.split('\n').filter((l) => l && !l.startsWith('#'))) {
    assert.equal(line.split('\t').length, 7);
  }
});
