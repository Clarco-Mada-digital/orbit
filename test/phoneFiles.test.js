import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneFsPathValid, shQuote, phoneParentPath, parsePhoneListing, formatPhoneSize } from '../src/lib/phone.js';

test('chemins du téléphone : stockage partagé seulement, jamais « .. »', () => {
  assert.equal(phoneFsPathValid('/sdcard/Download'), true);
  assert.equal(phoneFsPathValid('/storage/emulated/0/DCIM'), true);
  assert.equal(phoneFsPathValid('/data/data'), false);
  assert.equal(phoneFsPathValid('/sdcard/../data'), false);
  assert.equal(phoneFsPathValid('/sdcard/a\nrm -rf /'), false);
  assert.equal(phoneFsPathValid('/sdcardx'), false);
});

test('apostrophes : rien n’est interprété par le shell', () => {
  assert.equal(shQuote("l'été $(rm) `x`"), `'l'\\''été $(rm) \`x\`'`);
});

test('parent et listing (noms avec espaces, |, accents ; dossiers d’abord)', () => {
  assert.equal(phoneParentPath('/sdcard/DCIM/Camera'), '/sdcard/DCIM');
  assert.equal(phoneParentPath('/sdcard'), null);
  const out = [
    'regular file|5378433|1742035601|/sdcard/Download/rapport final.pdf',
    'directory|3488|1792063980|/sdcard/Download/Été 2026',
    'regular file|12|1700000000|/sdcard/Download/a|b.txt',
    'symbolic link|9|1700000000|/sdcard/Download/lien',
    'regular empty file|0|1700000000|/sdcard/Download/.cache',
    'stat: bruit',
  ].join('\n');
  const list = parsePhoneListing(out, '/sdcard/Download/');
  assert.deepEqual(list.map((e) => e.name), ['Été 2026', '.cache', 'a|b.txt', 'rapport final.pdf']);
  assert.equal(list[0].dir, true);
  assert.equal(list[1].hidden, true);
  assert.equal(list[3].size, 5378433);
  assert.equal(list[3].mtime, 1742035601000);
  assert.equal(formatPhoneSize(5378433), '5,1 Mo');
  assert.equal(formatPhoneSize(512), '512 o');
});
