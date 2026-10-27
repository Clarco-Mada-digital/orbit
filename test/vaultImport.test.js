import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyImportedFields } from '../electron/vault-import.js';

test('vault import merge fills empty fields without replacing existing values', () => {
  const entry = {
    title: 'Work account',
    url: 'https://example.com',
    username: 'ada',
    password: 'current-secret',
    totp: '',
    notes: '',
    updatedAt: 10,
    passwordUpdatedAt: 9,
    history: [],
  };

  const changed = applyImportedFields(
    entry,
    {
      title: 'Imported title',
      url: 'https://example.com',
      username: 'ada',
      password: 'imported-secret',
      totp: 'JBSWY3DPEHPK3PXP',
      notes: 'Imported note',
    },
    'merge',
    20
  );

  assert.equal(changed, true);
  assert.equal(entry.title, 'Work account');
  assert.equal(entry.password, 'current-secret');
  assert.equal(entry.totp, 'JBSWY3DPEHPK3PXP');
  assert.equal(entry.notes, 'Imported note');
  assert.equal(entry.updatedAt, 20);
  assert.deepEqual(entry.history, []);
});

test('vault import overwrite replaces supplied values and keeps password history', () => {
  const entry = {
    title: 'Work account',
    url: 'https://example.com',
    username: 'ada',
    password: 'current-secret',
    totp: 'OLD-TOTP',
    notes: 'Old note',
    updatedAt: 10,
    passwordUpdatedAt: 9,
    history: [],
  };

  const changed = applyImportedFields(
    entry,
    {
      title: 'Imported title',
      url: 'https://example.com',
      username: 'ada',
      password: 'imported-secret',
      totp: 'NEW-TOTP',
      notes: 'New note',
    },
    'overwrite',
    20
  );

  assert.equal(changed, true);
  assert.equal(entry.title, 'Imported title');
  assert.equal(entry.password, 'imported-secret');
  assert.equal(entry.totp, 'NEW-TOTP');
  assert.equal(entry.notes, 'New note');
  assert.equal(entry.passwordUpdatedAt, 20);
  assert.deepEqual(entry.history, [{ password: 'current-secret', at: 9 }]);
});

test('vault import does not erase existing data with empty imported fields', () => {
  const entry = { title: 'Existing', password: 'secret', notes: 'Keep me' };
  assert.equal(
    applyImportedFields(entry, { title: '', password: '', notes: '' }, 'overwrite', 20),
    false
  );
  assert.deepEqual(entry, { title: 'Existing', password: 'secret', notes: 'Keep me' });
});
