import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appPartition, resolveProxy, appViewKey } from '../src/lib/session.js';

// La partition détermine le « coffre à cookies » d'une app : une erreur ici
// mélangerait les sessions de deux comptes. D'où ces garde-fous.
test('appPartition : conteneur prioritaire sur tout le reste', () => {
  const app = { containerId: 'c1', profileId: 'work', id: 'a', sessionKey: 'sk' };
  assert.equal(appPartition(app, false), 'persist:ctn:c1');
  assert.equal(appPartition(app, true), 'persist:ctn:c1');
});

test('appPartition : session partagée = une par profil', () => {
  assert.equal(appPartition({ profileId: 'work', id: 'a' }, true), 'persist:work');
});

test('appPartition : isolée = sessionKey, sinon profil:id', () => {
  assert.equal(appPartition({ profileId: 'work', id: 'a', sessionKey: 'sk' }, false), 'persist:sk');
  assert.equal(appPartition({ profileId: 'work', id: 'a' }, false), 'persist:work:a');
});

test('resolveProxy : app > profil > global, vide sinon', () => {
  assert.equal(resolveProxy({ proxy: 'socks5://a' }, { proxy: 'p' }, 'g'), 'socks5://a');
  assert.equal(resolveProxy({}, { proxy: 'p' }, 'g'), 'p');
  assert.equal(resolveProxy({}, {}, 'g'), 'g');
  assert.equal(resolveProxy({}, {}, ''), '');
});

test('appPartition : une page volante garde sa session jetable, même en profil partagé', () => {
  // Consulter un lien de passage ne doit JAMAIS écrire dans le coffre à
  // cookies d'un compte connecté : c'est la garantie de la page volante.
  const fly = { id: 'fly-1', profileId: 'work', sessionKey: 'fly:fly-1', ephemeral: true };
  assert.equal(appPartition(fly, false), 'persist:fly:fly-1');
  assert.equal(appPartition(fly, true), 'persist:fly:fly-1');
  // Un conteneur explicite reste prioritaire (cas théorique, mais l'ordre compte)
  assert.equal(appPartition({ ...fly, containerId: 'c1' }, true), 'persist:ctn:c1');
});

test('appViewKey : une page volante ne remonte pas quand le profil bascule en partagé', () => {
  const fly = { id: 'fly-1', ephemeral: true };
  assert.equal(appViewKey(fly, false), 'fly-1');
  assert.equal(appViewKey(fly, true), 'fly-1');
});

test('appViewKey : change avec conteneur / partage (force le remontage)', () => {
  assert.equal(appViewKey({ id: 'a', containerId: 'c1' }, false), 'a:ctn:c1');
  assert.equal(appViewKey({ id: 'a' }, true), 'a:shared');
  assert.equal(appViewKey({ id: 'a' }, false), 'a');
});
