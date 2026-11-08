import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sealArchive,
  openArchive,
  isArchive,
  ARCHIVE_FORMAT,
} from '../electron/vault-archive.js';

const payload = {
  entries: [
    {
      id: 'e_1',
      title: 'Banque',
      url: 'https://banque.example',
      // Volontairement LONG et distinctif. Avec « ada », le test « aucun
      // secret en clair » échouait une fois sur cinquante : trois caractères
      // se retrouvent par hasard dans le base64 d'une enveloppe chiffrée
      // (mesuré : 2,1 % des scellements). Un identifiant court ne peut pas se
      // distinguer du bruit, donc l'assertion ne voulait rien dire.
      username: 'ada.lovelace@banque.example',
      password: 'correct horse battery staple',
      totp: 'JBSWY3DPEHPK3PXP',
      notes: 'coffre',
      category: 'finance',
      favorite: true,
      history: [{ password: 'ancien', at: 1 }],
    },
  ],
  categories: [{ id: 'finance', name: 'Banque', color: '#f59e0b' }],
};

test('archive roundtrip restores the whole payload', () => {
  const envelope = sealArchive({ passphrase: 'phrase-de-passe', payload, meta: { vaultName: 'Perso' } });
  assert.equal(isArchive(envelope), true);
  assert.equal(envelope.format, ARCHIVE_FORMAT);
  assert.equal(envelope.vaultName, 'Perso');
  assert.equal(envelope.entryCount, 1);

  const opened = openArchive({ passphrase: 'phrase-de-passe', envelope });
  assert.deepEqual(opened, payload);
});

test('archive keeps no secret in clear text', () => {
  const envelope = sealArchive({ passphrase: 'phrase-de-passe', payload });
  const serialized = JSON.stringify(envelope);
  assert.ok(!serialized.includes('correct horse battery staple'));
  assert.ok(!serialized.includes('JBSWY3DPEHPK3PXP'));
  assert.ok(!serialized.includes('ada.lovelace@banque.example'));
  assert.ok(!serialized.includes('phrase-de-passe'));
});

test('archive refuses a wrong passphrase', () => {
  const envelope = sealArchive({ passphrase: 'phrase-de-passe', payload });
  assert.throws(
    () => openArchive({ passphrase: 'phrase-de-passé', envelope }),
    (err) => err.code === 'bad-passphrase'
  );
});

test('archive detects tampering (GCM authentication)', () => {
  const envelope = sealArchive({ passphrase: 'phrase-de-passe', payload });
  const data = Buffer.from(envelope.data, 'base64');
  data[0] ^= 0xff;
  assert.throws(
    () => openArchive({ passphrase: 'phrase-de-passe', envelope: { ...envelope, data: data.toString('base64') } }),
    (err) => err.code === 'bad-passphrase'
  );
});

test('archive rejects a header swapped from another archive', () => {
  const a = sealArchive({ passphrase: 'phrase-de-passe', payload });
  // Même phrase de passe mais sel différent : le contenu de B ne doit pas
  // s'ouvrir sous l'en-tête de A, dont l'AAD et le sel diffèrent.
  const b = sealArchive({ passphrase: 'phrase-de-passe', payload });
  assert.throws(
    () => openArchive({ passphrase: 'phrase-de-passe', envelope: { ...a, data: b.data, tag: b.tag, iv: b.iv } }),
    (err) => err.code === 'bad-passphrase'
  );
});

test('archive refuses a short passphrase instead of writing a weak file', () => {
  assert.throws(
    () => sealArchive({ passphrase: 'court', payload }),
    (err) => err.code === 'weak-passphrase'
  );
});

test('archive refuses files that are not archives', () => {
  assert.equal(isArchive({ hello: 'world' }), false);
  assert.throws(
    () => openArchive({ passphrase: 'phrase-de-passe', envelope: { hello: 'world' } }),
    (err) => err.code === 'not-an-archive'
  );
});

test('archive refuses a future format version', () => {
  const envelope = sealArchive({ passphrase: 'phrase-de-passe', payload });
  assert.throws(
    () => openArchive({ passphrase: 'phrase-de-passe', envelope: { ...envelope, v: 99 } }),
    (err) => err.code === 'unsupported-version'
  );
});
