import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  copyExtensionStorage,
  discardDirectory,
  extensionDirSlug,
  extensionStoragePath,
  pruneStaleInstallDirs,
  replaceExtensionDir,
} from '../electron/extension-files.js';

// Ce que ces tests protègent : les réglages d'une extension (snippets, notes,
// préférences rangés dans `chrome.storage.local`) ne doivent pas disparaître
// parce qu'une mise à jour a changé le dossier — et donc l'ID — de l'extension.

async function tempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-ext-'));
}

test('un nom d’extension donne un dossier stable, sans accent ni espace', () => {
  assert.equal(extensionDirSlug('Text Snippets'), 'text-snippets');
  assert.equal(extensionDirSlug('  Téléphone Orbit  '), 'telephone-orbit');
  assert.equal(extensionDirSlug('Color_Picker.2'), 'color_picker.2');
  assert.equal(extensionDirSlug(''), 'extension');
  assert.equal(extensionDirSlug('///'), 'extension');
  // Deux versions du même nom tombent bien dans le même dossier.
  assert.equal(extensionDirSlug('Text Snippets'), extensionDirSlug('text  snippets'));
});

test('une mise à jour remplace le dossier sans perdre l’ancienne version', async () => {
  const root = await tempDir();
  try {
    const target = path.join(root, 'zip-text-snippets');
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, 'version.txt'), '1.2.0');

    const staged = path.join(root, 'zip-temp-123');
    await fsp.mkdir(staged, { recursive: true });
    await fsp.writeFile(path.join(staged, 'version.txt'), '1.3.0');

    const backup = replaceExtensionDir(staged, target);

    assert.equal(await fsp.readFile(path.join(target, 'version.txt'), 'utf8'), '1.3.0');
    assert.equal(fs.existsSync(staged), false);
    assert.ok(backup && fs.existsSync(path.join(backup, 'version.txt')));
    assert.equal(await fsp.readFile(path.join(backup, 'version.txt'), 'utf8'), '1.2.0');

    discardDirectory(backup);
    assert.equal(fs.existsSync(backup), false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('un remplacement impossible laisse l’ancienne version en place', async () => {
  const root = await tempDir();
  try {
    const target = path.join(root, 'zip-orbit-phone');
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, 'manifest.json'), '{}');

    assert.throws(() => replaceExtensionDir(path.join(root, 'inexistant'), target));

    assert.equal(fs.existsSync(path.join(target, 'manifest.json')), true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('les réglages de l’ancien ID sont repris par le nouvel ID', async () => {
  const root = await tempDir();
  try {
    const profile = path.join(root, 'Default');
    const from = extensionStoragePath(profile, 'aaaa');
    await fsp.mkdir(from, { recursive: true });
    await fsp.writeFile(path.join(from, '000003.log'), 'snippets');

    const copied = copyExtensionStorage({ storagePaths: [profile], fromId: 'aaaa', toId: 'bbbb' });

    assert.equal(copied, 1);
    assert.equal(
      await fsp.readFile(path.join(extensionStoragePath(profile, 'bbbb'), '000003.log'), 'utf8'),
      'snippets'
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('une migration n’écrase jamais un stockage déjà rempli, mais remplit un dossier vide', async () => {
  const root = await tempDir();
  try {
    const profile = path.join(root, 'Partitions', 'work');
    const from = extensionStoragePath(profile, 'ancien');
    await fsp.mkdir(from, { recursive: true });
    await fsp.writeFile(path.join(from, 'donnees'), 'anciennes');

    // Dossier de destination vide, créé par Chromium au chargement.
    const to = extensionStoragePath(profile, 'nouveau');
    await fsp.mkdir(to, { recursive: true });
    assert.equal(copyExtensionStorage({ storagePaths: [profile], fromId: 'ancien', toId: 'nouveau' }), 1);
    assert.equal(await fsp.readFile(path.join(to, 'donnees'), 'utf8'), 'anciennes');

    // Destination déjà remplie : on n'y touche pas.
    await fsp.writeFile(path.join(to, 'donnees'), 'récentes');
    assert.equal(copyExtensionStorage({ storagePaths: [profile], fromId: 'ancien', toId: 'nouveau' }), 0);
    assert.equal(await fsp.readFile(path.join(to, 'donnees'), 'utf8'), 'récentes');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('les extractions temporaires des anciennes versions sont nettoyées', async () => {
  const root = await tempDir();
  try {
    const stale = path.join(root, 'zip-temp-1700000000000');
    const current = path.join(root, 'zip-temp-1800000000000');
    const keep = path.join(root, 'zip-text-snippets');
    for (const dir of [stale, current, keep]) {
      await fsp.mkdir(dir, { recursive: true });
    }

    const removed = pruneStaleInstallDirs(root, { keep: [current] });

    assert.equal(removed, 1);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(current), true, 'le dossier en cours d’usage est conservé');
    assert.equal(fs.existsSync(keep), true, 'les dossiers stables ne sont pas touchés');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
