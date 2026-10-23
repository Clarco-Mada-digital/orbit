import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeOrbitAction } from '../src/lib/assistantActions.js';

const apps = [
  { id: 'mail', name: 'Mail', profileId: 'work' },
  { id: 'drive', name: 'Google Drive', profileId: 'personal' },
];

test('assistant action proposals require an explicit open command', () => {
  assert.deepEqual(proposeOrbitAction('Ouvre Google Drive', apps), {
    type: 'app',
    appId: 'drive',
    profileId: 'personal',
    name: 'Google Drive',
  });
  assert.equal(proposeOrbitAction('Je parle des paramètres Orbit', apps), null);
  assert.equal(proposeOrbitAction('Je préfère ouvrir les paramètres', apps), null);
});

test('assistant action proposals support settings in French and English', () => {
  assert.deepEqual(proposeOrbitAction('Ouvre les paramètres', apps), { type: 'settings' });
  assert.deepEqual(proposeOrbitAction('open settings', apps), { type: 'settings' });
});

test('assistant proposes only whitelisted theme changes for confirmation', () => {
  assert.deepEqual(proposeOrbitAction('Mets le thème en sombre', apps), {
    type: 'setting',
    setting: 'theme',
    value: 'dark',
  });
  assert.deepEqual(proposeOrbitAction('switch to light', apps), {
    type: 'setting',
    setting: 'theme',
    value: 'light',
  });
  assert.equal(proposeOrbitAction('disable the ad blocker', apps), null);
});

test('assistant action proposals avoid matching app names inside other words', () => {
  assert.equal(proposeOrbitAction('Open the email draft', apps), null);
  assert.equal(proposeOrbitAction('ouvre application inconnue', apps), null);
});

test('assistant action proposals handle malformed input without throwing', () => {
  assert.equal(proposeOrbitAction(undefined, apps), null);
  assert.equal(proposeOrbitAction('open Mail', null), null);
});

test('custom app proposals preserve the display name and accept HTTPS or loopback HTTP', () => {
  assert.deepEqual(
    proposeOrbitAction('Ajoute une application Mon Portail https://example.org/app', apps),
    {
      type: 'create-app',
      name: 'Mon Portail',
      url: 'https://example.org/app',
    }
  );
  assert.deepEqual(
    proposeOrbitAction('add shortcut http://localhost:3000', apps),
    {
      type: 'create-app',
      name: 'localhost',
      url: 'http://localhost:3000/',
    }
  );
});

test('custom app proposals reject insecure remote and credential-bearing URLs', () => {
  assert.equal(proposeOrbitAction('ajoute app Exemple http://example.org', apps), null);
  assert.equal(proposeOrbitAction('add app Portal https://user:pass@example.org', apps), null);
});
