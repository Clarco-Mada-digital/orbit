import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as mf from '../electron/media-failures.js';

beforeEach(() => mf.reset());

// Ce journal existe pour instruire « certaines vidéos ne se lisent pas ». Les
// tests verrouillent les deux choses qui le rendent utile ou inutile : qu'il
// reconnaisse un segment vidéo sans se laisser noyer par le bavardage d'une
// messagerie, et qu'il dise si c'est NOUS qui avons retiré le cookie.

test('reconnaît un média annoncé comme tel par Chromium', () => {
  assert.equal(mf.looksLikeMedia('https://exemple.com/sans-extension', 'media'), true);
});

test('reconnaît les segments téléchargés en xhr par les lecteurs MSE', () => {
  const urls = [
    'https://video.xx.fbcdn.net/v/t42.1790-2/abc.mp4?_nc_cat=1',
    'https://rr3---sn-x.googlevideo.com/videoplayback?itag=140',
    'https://cdn.exemple.com/stream/chunk-00042.m4s',
    'https://cdn.exemple.com/master.m3u8',
    'https://cdn.exemple.com/manifest.mpd',
    'https://cdn.exemple.com/hls/360p.ts',
    'https://video.xx.fbcdn.net/v/t39.25447-2/x?bytestart=0&byteend=9999',
  ];
  for (const u of urls) {
    assert.equal(mf.looksLikeMedia(u, 'xhr'), true, `non reconnu : ${u}`);
  }
});

test('ignore le bavardage normal d’une application', () => {
  // Sans ce filtre, le journal se remplirait d'appels d'API qui échouent pour
  // des raisons sans rapport avec la lecture — et n'expliquerait plus rien.
  const urls = [
    'https://www.messenger.com/api/graphql/',
    'https://exemple.com/ajax/presence/update.php',
    'https://exemple.com/avatar.png',
  ];
  for (const u of urls) {
    assert.equal(mf.looksLikeMedia(u, 'xhr'), false, `faussement reconnu : ${u}`);
  }
  // Un type de ressource qui ne transporte jamais de média est écarté d'emblée,
  // même si son URL ressemble à un fichier vidéo.
  assert.equal(mf.looksLikeMedia('https://exemple.com/promo.mp4', 'script'), false);
  assert.equal(mf.looksLikeMedia('https://exemple.com/promo.mp4', 'image'), false);
});

test('consigne un échec et le relit, le plus récent d’abord', () => {
  mf.record(7, { url: 'https://cdn/x1.mp4', status: 403 });
  mf.record(7, { url: 'https://cdn/x2.mp4', status: 404 });
  const out = mf.list(7);
  assert.equal(out.length, 2);
  assert.equal(out[0].url, 'https://cdn/x2.mp4');
  assert.equal(out[0].status, 404);
  assert.equal(out[1].status, 403);
});

test('les pages ne mélangent pas leurs échecs', () => {
  mf.record(1, { url: 'https://cdn/a.mp4', status: 403 });
  mf.record(2, { url: 'https://cdn/b.mp4', status: 500 });
  assert.equal(mf.list(1).length, 1);
  assert.equal(mf.list(2)[0].url, 'https://cdn/b.mp4');
  assert.deepEqual(mf.list(999), []);
});

test('le cookie retiré par le bouclier est attribué à la bonne requête', () => {
  // C'est l'information décisive : elle distingue « le CDN refuse » de « nous
  // avons retiré de quoi l'autoriser ».
  mf.noteCookieStrip('req-1');
  const a = mf.record(3, { url: 'https://cdn/a.mp4', status: 403, requestId: 'req-1' });
  const b = mf.record(3, { url: 'https://cdn/b.mp4', status: 403, requestId: 'req-2' });
  assert.equal(a.cookieStripped, true);
  assert.equal(b.cookieStripped, false);
});

test('une marque de cookie n’est consommée qu’une fois', () => {
  mf.noteCookieStrip('req-1');
  mf.record(3, { url: 'https://cdn/a.mp4', status: 403, requestId: 'req-1' });
  const again = mf.record(3, { url: 'https://cdn/a.mp4', status: 403, requestId: 'req-1' });
  assert.equal(again.cookieStripped, false);
});

test('le journal est borné : une page vidéo émet des centaines de segments', () => {
  for (let i = 0; i < 200; i += 1) mf.record(4, { url: `https://cdn/s${i}.m4s`, status: 403 });
  const out = mf.list(4);
  assert.ok(out.length <= 25, `journal non borné : ${out.length} entrées`);
  // Ce sont les DERNIERS échecs qui expliquent la vidéo en cours.
  assert.equal(out[0].url, 'https://cdn/s199.m4s');
});

test('un chargement de page repart d’un journal vierge', () => {
  mf.record(5, { url: 'https://cdn/a.mp4', status: 403 });
  mf.clear(5);
  assert.deepEqual(mf.list(5), []);
});

test('un identifiant de page invalide ne consigne rien et ne jette pas', () => {
  assert.equal(mf.record(undefined, { url: 'https://cdn/a.mp4' }), null);
  assert.equal(mf.record('pas-un-id', { url: 'https://cdn/a.mp4' }), null);
});

test('la raison distingue « le serveur refuse » de « nous avons bloqué »', () => {
  mf.record(6, { url: 'https://cdn/a.mp4', status: 403, reason: 'status' });
  mf.record(6, { url: 'https://ads/b.mp4', reason: 'blocked' });
  const [blocked, refused] = mf.list(6);
  assert.equal(blocked.reason, 'blocked');
  assert.equal(blocked.status, 0);
  assert.equal(refused.reason, 'status');
});
