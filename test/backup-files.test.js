import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  collectBackupFiles,
  writeBackupFiles,
  stageRestore,
  applyPendingRestore,
  pendingRestorePath,
  MAX_BACKUP_FILES,
} from '../electron/backup-files.js';

// Sauvegarde complète : ce qui compte, c'est (1) de ne prendre QUE les
// sessions et les trousseaux, (2) de restituer les octets à l'identique sur
// une autre machine, et (3) de ne JAMAIS écrire ailleurs que dans Partitions/
// et vaults/ — un fichier de sauvegarde n'est pas un script d'installation.

function tempUser() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-bk-'));
}

function seed(dir) {
  const part = path.join(dir, 'Partitions', 'persist%3Awork%3Agmail');
  fs.mkdirSync(path.join(part, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(part, 'Cookies'), 'cookie-data');
  fs.writeFileSync(path.join(part, 'Local Storage', 'leveldb', '000001.ldb'), 'ls-data');
  // Cache : régénérable, doit être IGNORÉ
  fs.mkdirSync(path.join(part, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(part, 'Cache', 'big.bin'), 'x'.repeat(5000));
  // Verrou leveldb : caduc, doit être IGNORE
  fs.writeFileSync(path.join(part, 'Local Storage', 'leveldb', 'LOCK'), 'l');
  // Hors périmètre : ne doit PAS être collecté (sinon on exporterait les codes)
  fs.writeFileSync(path.join(dir, 'security.json'), '{"code":"1234"}');
  // Trousseau (déjà chiffré avec son mot de passe maître)
  fs.mkdirSync(path.join(dir, 'vaults'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vaults', 'boulot.orbv'), 'vault-encrypted');
}

const decodeEntry = (entry) =>
  entry.gz
    ? zlib.gunzipSync(Buffer.from(entry.data, 'base64'))
    : Buffer.from(entry.data, 'base64');

test('collectBackupFiles : sessions + trousseaux, sans cache, LOCK ni fichier hors périmètre', () => {
  const dir = tempUser();
  seed(dir);
  const entries = collectBackupFiles(dir);
  assert.deepEqual(entries.map((e) => e.path).sort(), [
    'Partitions/persist%3Awork%3Agmail/Cookies',
    'Partitions/persist%3Awork%3Agmail/Local Storage/leveldb/000001.ldb',
    'vaults/boulot.orbv',
  ]);
  const cookies = entries.find((e) => e.path.endsWith('/Cookies'));
  assert.equal(decodeEntry(cookies).toString('utf8'), 'cookie-data');
});

test('aller-retour : collecter puis réécrire restitue les octets à l’identique', () => {
  const src = tempUser();
  seed(src);
  const dst = tempUser();
  const entries = collectBackupFiles(src);
  assert.equal(writeBackupFiles(dst, entries), 3);
  assert.equal(
    fs.readFileSync(path.join(dst, 'Partitions', 'persist%3Awork%3Agmail', 'Cookies'), 'utf8'),
    'cookie-data'
  );
  assert.equal(
    fs.readFileSync(path.join(dst, 'vaults', 'boulot.orbv'), 'utf8'),
    'vault-encrypted'
  );
});

test('writeBackupFiles : refuse toute écriture hors Partitions/ et vaults/', () => {
  const dst = tempUser();
  // Traversée de dossier, racine inconnue, et absolu déguisé
  assert.throws(() => writeBackupFiles(dst, [{ path: '../evil.json', data: 'QQ==' }]), /hors périmètre/);
  assert.throws(() => writeBackupFiles(dst, [{ path: 'security.json', data: 'QQ==' }]), /hors périmètre/);
  assert.throws(() => writeBackupFiles(dst, [{ path: 'Partitions/../../evil.txt', data: 'QQ==' }]), /refusé/);
  assert.equal(fs.existsSync(path.join(dst, '..', 'evil.json')), false);
  assert.equal(fs.existsSync(path.join(dst, 'evil.txt')), false);
});

test('stageRestore puis applyPendingRestore : restaure au démarrage suivant et s’efface', () => {
  const dir = tempUser();
  const staged = stageRestore(dir, [
    { path: 'vaults/a.orbv', data: Buffer.from('secret').toString('base64') },
  ]);
  assert.equal(staged.count, 1);
  assert.equal(fs.existsSync(pendingRestorePath(dir)), true, 'étage : le fichier en attente existe');

  const res = applyPendingRestore(dir);
  assert.equal(res.count, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'vaults', 'a.orbv'), 'utf8'), 'secret');
  assert.equal(fs.existsSync(pendingRestorePath(dir)), false, 'consommé une seule fois');

  // Deuxième démarrage : plus rien à faire, sans erreur
  assert.equal(applyPendingRestore(dir).count, 0);
});

test('stageRestore : une entrée invalide ne laisse aucun état en attente', () => {
  const dir = tempUser();
  assert.throws(() =>
    stageRestore(dir, [
      { path: 'vaults/a.orbv', data: 'QQ==' },
      { path: 'evil.txt', data: 'QQ==' },
    ])
  );
  assert.equal(fs.existsSync(pendingRestorePath(dir)), false);
});

test('applyPendingRestore : un fichier corrompu n’empêche pas le démarrage', () => {
  const dir = tempUser();
  fs.writeFileSync(pendingRestorePath(dir), '{pas du json');
  const res = applyPendingRestore(dir);
  assert.equal(res.count, 0);
  assert.ok(res.error, 'la cause est quand même signalée');
  assert.equal(fs.existsSync(pendingRestorePath(dir)), false, 'nettoyé pour ne pas rejouer à chaque lancement');
});

test('garde-fou : au-delà du nombre maximal d’entrées, refus', () => {
  const dir = tempUser();
  const tooMany = new Array(MAX_BACKUP_FILES + 1).fill({ path: 'vaults/x', data: '' });
  assert.throws(() => writeBackupFiles(dir, tooMany), /tooMany/);
});

test('sans Partitions ni vaults (premier lancement) : rien à collecter', () => {
  const dir = tempUser();
  assert.deepEqual(collectBackupFiles(dir), []);
});
