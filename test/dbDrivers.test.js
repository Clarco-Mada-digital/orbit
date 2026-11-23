import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDriver, driverUrl, driverInfo, driverStatus } from '../electron/db-drivers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const info = driverInfo('mssql');
const published = path.join(ROOT, 'extensions-dist', 'drivers', info.file);

const fakeFetch = (buf, status = 200) => async () => ({
  ok: status === 200,
  status,
  body: new Blob([buf]).stream(),
});

test('le pilote publié correspond à l’empreinte livrée dans Orbit', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(published)).digest('hex');
  assert.equal(sha, info.sha256);
  assert.equal(driverUrl('https://x.io/orbit/extensions/catalog.json', info.file), `https://x.io/orbit/extensions/drivers/${info.file}`);
});

test('téléchargement : refusé si l’empreinte diffère, accepté et réutilisé sinon', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-drv-'));
  const opts = { dir, catalogUrl: 'https://x.io/extensions/catalog.json', preferBundled: false };
  await assert.rejects(
    loadDriver('mssql', { ...opts, fetch: fakeFetch(Buffer.from('module.exports = 666')) }),
    /empreinte/
  );
  assert.equal(fs.existsSync(path.join(dir, info.file)), false, 'rien n’est écrit si l’empreinte est fausse');
  await assert.rejects(loadDriver('mssql', { ...opts, fetch: fakeFetch(Buffer.alloc(0), 404) }), /404/);
  const mod = await loadDriver('mssql', { ...opts, fetch: fakeFetch(fs.readFileSync(published)) });
  assert.equal(typeof mod.ConnectionPool, 'function');
  assert.deepEqual(driverStatus('mssql', { dir }), { bundled: false, installed: true, size: info.size, version: info.version });
  fs.rmSync(dir, { recursive: true, force: true });
});
