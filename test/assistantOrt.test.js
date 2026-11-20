import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import {
  findOrtAssets,
  isOrtAsset,
  ortAssetDirectory,
  ortAssetType,
  serveOrtAsset,
} from '../electron/assistant-ort.js';

// Le runtime WASM d'ONNX Runtime, en version empaquetée, ne peut pas être lu
// depuis `file://` : Chromium refuse `fetch()` comme l'import de module sur ce
// schéma, d'où « no available backend found. ERR: [wasm] [object Event] ». Ces
// helpers décident QUELS fichiers sont servis par le serveur de boucle locale —
// ils doivent donc être stricts : noms découverts, jamais devinés.

function tempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-ort-'));
  for (const name of files) fs.writeFileSync(path.join(dir, name), 'x');
  return dir;
}

test('findOrtAssets : trouve le wasm et son usine, quels que soient les hachages', () => {
  const dir = tempDir([
    'index-DVEdCY_o.js',
    'ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm',
    'ort-wasm-simd-threaded.asyncify-DXIbolS2.mjs',
  ]);
  assert.deepEqual(findOrtAssets(dir), {
    wasm: 'ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm',
    mjs: 'ort-wasm-simd-threaded.asyncify-DXIbolS2.mjs',
  });
});

test('findOrtAssets : dossier absent, ou paire incomplète → null', () => {
  assert.equal(findOrtAssets(path.join(os.tmpdir(), 'orbit-ort-inexistant')), null);
  assert.equal(findOrtAssets(tempDir(['ort-wasm-threaded.wasm'])), null);
  assert.equal(findOrtAssets(tempDir(['ort-wasm-threaded.mjs'])), null);
});

test('isOrtAsset : liste blanche des deux noms, rien d’autre', () => {
  const assets = { wasm: 'ort-wasm-a.wasm', mjs: 'ort-wasm-a.mjs' };
  assert.equal(isOrtAsset('ort-wasm-a.wasm', assets), true);
  assert.equal(isOrtAsset('ort-wasm-a.mjs', assets), true);
  // Remontée de répertoire, autre fichier du dossier produit, nom vide.
  assert.equal(isOrtAsset('../electron/main.js', assets), false);
  assert.equal(isOrtAsset('main-abc.js', assets), false);
  assert.equal(isOrtAsset('', assets), false);
  assert.equal(isOrtAsset('ort-wasm-a.wasm', null), false);
});

test('ortAssetType : le wasm doit être servi en application/wasm', () => {
  // Un type erroné fait échouer `WebAssembly.instantiateStreaming` : le moteur
  // retombe alors sur une lecture complète, ou échoue.
  assert.equal(ortAssetType('ort-wasm-a.wasm'), 'application/wasm');
  assert.match(ortAssetType('ort-wasm-a.mjs'), /^text\/javascript/);
  assert.equal(ortAssetType('autre.bin'), 'application/octet-stream');
});

test('ortAssetDirectory : pointe sur dist/assets, à côté du dossier electron', () => {
  assert.equal(
    ortAssetDirectory(path.join('projet', 'electron')),
    path.join('projet', 'dist', 'assets')
  );
});

// Vérification de bout en bout du service HTTP : c'est lui qui remplace le
// `fetch()` interdit sur `file://`. On l'interroge comme le fera Chromium.
async function withServer(directory, run) {
  const server = createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.replace(/^\/ort\//, '');
    serveOrtAsset(decodeURIComponent(name), directory, request, response, {
      'Access-Control-Allow-Origin': request.headers.origin || '',
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('serveOrtAsset : le wasm arrive complet, en application/wasm, avec CORS', async () => {
  const dir = tempDir(['ort-wasm-a.wasm']);
  fs.writeFileSync(path.join(dir, 'ort-wasm-a.wasm'), Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  fs.writeFileSync(path.join(dir, 'ort-wasm-a.mjs'), 'export default 1;');

  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/ort/ort-wasm-a.wasm`, {
      headers: { Origin: 'null' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/wasm');
    // L'origine d'une page `file://` est « null » : sans cet en-tête, Chromium
    // rejette la réponse.
    assert.equal(res.headers.get('access-control-allow-origin'), 'null');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0x00, 0x61, 0x73, 0x6d]);

    const mjs = await fetch(`${base}/ort/ort-wasm-a.mjs`);
    assert.equal(mjs.status, 200);
    assert.match(mjs.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await mjs.text(), 'export default 1;');
  });
});

test('serveOrtAsset : tout ce qui n’est pas le runtime est refusé', async () => {
  const dir = tempDir(['ort-wasm-a.wasm', 'ort-wasm-a.mjs', 'main-abc.js', 'secret.txt']);
  await withServer(dir, async (base) => {
    for (const name of [
      'main-abc.js',
      'secret.txt',
      '..%2Felectron%2Fmain.js',
      'ort-wasm-b.wasm',
    ]) {
      const res = await fetch(`${base}/ort/${name}`);
      assert.equal(res.status, 404, `${name} ne devrait pas être servi`);
    }
  });
});

test('serveOrtAsset : HEAD annonce la taille sans le corps', async () => {
  const dir = tempDir(['ort-wasm-a.wasm', 'ort-wasm-a.mjs']);
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/ort/ort-wasm-a.wasm`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/wasm');
    assert.equal(Number(res.headers.get('content-length')), 1);
  });
});
