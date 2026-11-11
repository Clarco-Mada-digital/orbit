import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DownloadManager } from '../electron/download/manager.js';

// ---------------------------------------------------------------------------
// File d'attente du moteur accéléré : ce que le dialogue « Nouveau
// téléchargement » promet vraiment — un fichier « plus tard » qui ne démarre
// pas, une priorité qui passe devant, un débit propre qui survit aux réglages
// généraux, et un nom/dossier choisis qui arrivent jusqu'au disque.
// ---------------------------------------------------------------------------

function sampleBytes(size) {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) buffer[i] = (i * 13 + 7) & 0xff;
  return buffer;
}

// Serveur minimal qui honore le Range et note l'ordre des requêtes reçues.
function recordingServer(data, { delayFirstMs = 0 } = {}) {
  const hits = [];
  const handler = (req, res) => {
    const range = req.headers.range || '';
    const name = new URL(req.url, 'http://127.0.0.1').pathname;
    if (range && range !== 'bytes=0-0') hits.push(name);
    const serve = () => {
      if (range === 'bytes=0-0') {
        res.writeHead(206, {
          'content-range': `bytes 0-0/${data.length}`,
          'content-length': 1,
          'accept-ranges': 'bytes',
        });
        res.end(data.subarray(0, 1));
        return;
      }
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${data.length}`,
        'content-length': end - start + 1,
        'accept-ranges': 'bytes',
      });
      res.end(data.subarray(start, end + 1));
    };
    const firstHeavy = delayFirstMs > 0 && hits.length === 1 && name.endsWith('premier.bin');
    if (firstHeavy) setTimeout(serve, delayFirstMs);
    else serve();
  };
  return { handler, hits };
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function makeManager(dir, events, settings = {}) {
  const manager = new DownloadManager({
    fetchImpl: fetch,
    resolveTarget: async ({ url, name, directory, filename }) => {
      const target = name || filename || path.basename(new URL(url).pathname);
      return { filePath: path.join(directory || dir, target) };
    },
    onEvent: (event) => events.push(event),
  });
  manager.setSettings({ connections: 2, maxConcurrent: 2, globalRate: 0, perFileRate: 0, retries: 1 });
  if (Object.keys(settings).length) manager.setSettings(settings);
  return manager;
}

async function waitFor(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('délai dépassé en attendant l’état attendu');
}

test('« plus tard » : la tâche attend, ne touche pas le réseau, puis démarre sur demande', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dlq-'));
  const data = sampleBytes(128 * 1024);
  const { handler, hits } = recordingServer(data);
  try {
    await withServer(handler, async (base) => {
      const events = [];
      const manager = await makeManager(dir, events);
      const { id } = manager.add({ url: `${base}/tard.bin`, deferred: true });

      assert.equal(events.at(-1).state, 'queued');
      assert.equal(events.at(-1).deferred, true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(hits.length, 0, 'aucune requête ne doit partir avant le démarrage');

      manager.start(id);
      await waitFor(() => events.some((event) => event.state === 'completed'));
      const written = await fsp.readFile(path.join(dir, 'tard.bin'));
      assert.ok(written.equals(data));
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('priorité haute : elle passe devant les téléchargements déjà en file', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dlq-'));
  const data = sampleBytes(96 * 1024);
  // Le premier fichier est servi lentement : les deux autres ont le temps
  // d'arriver dans la file avant lui.
  const { handler, hits } = recordingServer(data, { delayFirstMs: 250 });
  try {
    await withServer(handler, async (base) => {
      const events = [];
      const manager = await makeManager(dir, events, { maxConcurrent: 1 });
      manager.add({ url: `${base}/premier.bin` });
      manager.add({ url: `${base}/basse.bin`, priority: -1 });
      manager.add({ url: `${base}/haute.bin`, priority: 1 });

      await waitFor(() => events.filter((event) => event.state === 'completed').length === 3);
      const order = hits.filter((name) => name !== '/premier.bin');
      assert.deepEqual(order.slice(0, 2), ['/haute.bin', '/basse.bin']);
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('un débit propre au fichier survit à un changement de réglage général', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dlq-'));
  const data = sampleBytes(1024);
  const { handler } = recordingServer(data);
  try {
    await withServer(handler, async (base) => {
      const events = [];
      const manager = await makeManager(dir, events);
      const { id } = manager.add({ url: `${base}/propre.bin`, rate: 64 * 1024 });
      const task = manager.entries.get(id);
      assert.equal(task.limiter.get(), 64 * 1024);

      manager.setSettings({ perFileRate: 512 * 1024 });
      assert.equal(task.limiter.get(), 64 * 1024, 'le choix explicite ne doit pas être écrasé');

      manager.setOptions(id, { rate: 128 * 1024 });
      assert.equal(task.limiter.get(), 128 * 1024);
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('nom et dossier choisis : ils arrivent jusqu’au fichier écrit', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dlq-'));
  const sub = path.join(dir, 'Vidéos');
  await fsp.mkdir(sub, { recursive: true });
  const data = sampleBytes(64 * 1024);
  const { handler } = recordingServer(data);
  try {
    await withServer(handler, async (base) => {
      const events = [];
      const manager = await makeManager(dir, events);
      manager.add({ url: `${base}/telechargement`, directory: sub, name: 'Ma vidéo.mp4' });
      await waitFor(() => events.some((event) => event.state === 'completed'));
      const last = events.at(-1);
      assert.equal(last.filename, 'Ma vidéo.mp4');
      assert.ok(await fsp.stat(path.join(sub, 'Ma vidéo.mp4')));
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
