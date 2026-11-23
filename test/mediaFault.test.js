import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeMediaFault, mediaFaultKey } from '../src/lib/mediaFault.js';

// Quatre causes produisent le même écran noir. Ces tests verrouillent l'ordre
// de priorité (on nomme d'abord ce qui n'est pas réglable, puis ce qui vient de
// nous, puis ce qui vient du site) et surtout le SILENCE quand il n'y a rien à
// dire : une bannière affichée à tort sur une vidéo qui marche serait pire que
// pas de bannière.

test('rien d’observé → rien à dire', () => {
  assert.equal(describeMediaFault(), null);
  assert.equal(describeMediaFault({}), null);
  assert.equal(describeMediaFault({ drm: false, error: null, failures: [] }), null);
});

test('un abandon de lecture ne dit rien (c’est un geste normal)', () => {
  // MEDIA_ERR_ABORTED arrive quand on change de vidéo ou qu'on quitte la page.
  assert.equal(describeMediaFault({ error: { code: 1, message: '' } }), null);
});

test('le DRM est annoncé en premier : aucun réglage ne le corrige', () => {
  const f = describeMediaFault({
    drm: true,
    error: { code: 4, message: 'x' },
    failures: [{ reason: 'blocked', url: 'https://cdn/x.mp4' }],
  });
  assert.equal(f.kind, 'drm');
  assert.equal(f.action, 'browser');
  assert.match(f.detail, /Widevine/);
});

test('un segment annulé par le bloqueur est nommé comme tel', () => {
  const f = describeMediaFault({
    failures: [{ reason: 'blocked', url: 'https://ads.exemple.com/pre-roll.mp4' }],
  });
  assert.equal(f.kind, 'blocked');
  assert.equal(f.action, 'shields');
  assert.match(f.detail, /ads\.exemple\.com/);
});

test('le cookie retiré par le bouclier passe avant le simple refus du serveur', () => {
  // C'est le cas le plus trompeur : le site a l'air de refuser, alors que c'est
  // nous qui avons enlevé de quoi l'autoriser. Il doit l'emporter sur la
  // lecture naïve du statut.
  const f = describeMediaFault({
    failures: [
      { reason: 'status', status: 403, url: 'https://video.xx.fbcdn.net/v/t42/x.mp4', cookieStripped: true },
    ],
  });
  assert.equal(f.kind, 'cookie');
  assert.equal(f.action, 'shields');
  assert.match(f.detail, /video\.xx\.fbcdn\.net/);
  assert.match(f.detail, /403/);
});

test('un refus du serveur sans cookie retiré désigne le site', () => {
  const f = describeMediaFault({
    failures: [{ reason: 'status', status: 404, url: 'https://cdn.exemple.com/v.mp4' }],
  });
  assert.equal(f.kind, 'status');
  assert.match(f.title, /404/);
  assert.equal(f.action, 'reload');
});

test('un statut inférieur à 400 n’est pas un refus', () => {
  // Une réponse 206 (contenu partiel) est le fonctionnement NORMAL du
  // streaming par segments : la prendre pour une panne serait absurde.
  assert.equal(
    describeMediaFault({ failures: [{ reason: 'status', status: 206, url: 'https://cdn/v.mp4' }] }),
    null
  );
});

test('sans trace réseau, on s’en tient à ce que dit le lecteur', () => {
  assert.equal(describeMediaFault({ error: { code: 2, message: '' } }).kind, 'network');
  assert.equal(describeMediaFault({ error: { code: 3, message: '' } }).kind, 'decode');
  assert.equal(describeMediaFault({ error: { code: 4, message: '' } }).kind, 'source');
});

test('un code de lecteur inconnu reprend son message, sans jamais rester vide', () => {
  const f = describeMediaFault({ error: { code: 42, message: 'PIPELINE_ERROR_DECODE' } });
  assert.equal(f.kind, 'unknown');
  assert.equal(f.detail, 'PIPELINE_ERROR_DECODE');
  const muet = describeMediaFault({ error: { code: 42, message: '' } });
  assert.ok(muet.detail.length > 0);
});

test('une URL illisible ne fait pas tomber le message', () => {
  const f = describeMediaFault({ failures: [{ reason: 'status', status: 500, url: 'pas-une-url' }] });
  assert.equal(f.kind, 'status');
  assert.ok(f.detail.length > 0);
});

test('la clé de panne est stable, et vide pour une absence de panne', () => {
  const a = describeMediaFault({ drm: true });
  assert.equal(mediaFaultKey(a), mediaFaultKey(describeMediaFault({ drm: true })));
  assert.notEqual(mediaFaultKey(a), mediaFaultKey(describeMediaFault({ error: { code: 2 } })));
  assert.equal(mediaFaultKey(null), '');
});
