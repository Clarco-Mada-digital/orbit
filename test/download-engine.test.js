import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DownloadTask,
  filenameFromUrl,
  parseContentDisposition,
  sanitizeFilename,
} from '../electron/download/engine.js';

// Fichier de test déterministe : un octet différent toutes les 251 positions,
// pour qu'un décalage mal écrit se voie tout de suite.
function sampleBytes(size) {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) buffer[i] = (i * 7 + (i % 251)) & 0xff;
  return buffer;
}

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}/fichier.bin`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function rangeServer(data, { honorRanges = true, dropAfter = 0, etag = '"v1"' } = {}) {
  const seen = [];
  let drops = 0;
  const handler = (req, res) => {
    const range = req.headers.range || '';
    seen.push(range);
    const isProbe = range === 'bytes=0-0';
    if (honorRanges && range && !isProbe) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
      if (start >= data.length) {
        res.writeHead(416, { 'content-range': `bytes */${data.length}` });
        res.end();
        return;
      }
      const body = data.subarray(start, end + 1);
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${data.length}`,
        'content-length': body.length,
        'accept-ranges': 'bytes',
        etag,
      });
      if (dropAfter > 0 && drops === 0) {
        drops += 1;
        res.write(body.subarray(0, Math.min(dropAfter, body.length)));
        // Coupure brutale : c'est ce que fait un Wi-Fi qui lâche.
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      res.end(body);
      return;
    }
    if (isProbe && honorRanges) {
      res.writeHead(206, {
        'content-range': `bytes 0-0/${data.length}`,
        'content-length': 1,
        'accept-ranges': 'bytes',
        etag,
      });
      res.end(data.subarray(0, 1));
      return;
    }
    res.writeHead(200, {
      'content-length': data.length,
      ...(honorRanges ? { 'accept-ranges': 'bytes' } : {}),
      etag,
    });
    res.end(data);
  };
  return { handler, seen };
}

async function makeTask(target, options = {}) {
  const events = [];
  const task = new DownloadTask({
    id: 'test-1',
    url: options.url,
    connections: options.connections ?? 3,
    retries: options.retries ?? 2,
    rate: options.rate ?? 0,
    fetchImpl: fetch,
    resolveTarget: async () => ({ filePath: target }),
    onEvent: (event) => events.push(event),
  });
  return { task, events };
}

test('noms de fichiers : Content-Disposition (RFC 5987), URL et caractères interdits', () => {
  assert.equal(
    parseContentDisposition("attachment; filename*=UTF-8''rapport%20final.pdf"),
    'rapport final.pdf'
  );
  assert.equal(parseContentDisposition('attachment; filename="archive.zip"'), 'archive.zip');
  assert.equal(parseContentDisposition('inline'), '');
  assert.equal(filenameFromUrl('https://exemple.test/dossiers/vid%C3%A9o.mp4?x=1'), 'vidéo.mp4');
  assert.equal(sanitizeFilename('a/b\\c:d*e?.txt'), 'c_d_e_.txt');
  assert.equal(sanitizeFilename('con.txt'), '_con.txt');
});

test('téléchargement accéléré : plusieurs connexions, fichier identique à la source', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dl-'));
  const data = sampleBytes(2 * 1024 * 1024);
  const { handler, seen } = rangeServer(data);
  try {
    await withServer(handler, async (url) => {
      const target = path.join(dir, 'fichier.bin');
      const { task, events } = await makeTask(target, { url, connections: 4 });
      await task.start();

      const last = events.at(-1);
      assert.equal(last.state, 'completed', last.error);
      assert.equal(task.state, 'completed');
      const written = await fsp.readFile(target);
      assert.equal(written.length, data.length);
      assert.ok(written.equals(data), 'le fichier écrit doit être identique à la source');

      // Le probe (0-0) plus au moins une requête par part : on a bien découpé.
      const dataRanges = seen.filter((value) => value && value !== 'bytes=0-0');
      assert.ok(dataRanges.length >= 2, `requêtes Range: ${dataRanges.join(', ')}`);
      // Plusieurs parts réellement en parallèle sur des octets différents.
      const starts = new Set(dataRanges.map((value) => Number(/bytes=(\d+)-/.exec(value)[1])));
      assert.ok(starts.size >= 2, `départs de Range: ${[...starts].join(', ')}`);
      // Aucun fichier de travail ne doit rester.
      assert.equal(fs.existsSync(`${target}.orbitpart`), false);
      assert.equal(fs.existsSync(`${target}.orbitdl`), false);
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('une connexion qui lâche est réessayée sans repartir de zéro', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dl-'));
  const data = sampleBytes(1024 * 1024);
  const { handler, seen } = rangeServer(data, { dropAfter: 96 * 1024 });
  try {
    await withServer(handler, async (url) => {
      const target = path.join(dir, 'fichier.bin');
      // Un seul réessai : la coupure est absorbée par le worker.
      const { task, events } = await makeTask(target, { url, connections: 1, retries: 2 });
      await task.start();

      assert.equal(events.at(-1).state, 'completed', events.at(-1).error);
      const written = await fsp.readFile(target);
      assert.ok(written.equals(data));
      // Après la coupure, la reprise repart d'un décalage > 0 : aucun octet
      // déjà écrit n'est redemandé depuis le début.
      const restarted = seen
        .filter((value) => value && value !== 'bytes=0-0')
        .map((value) => Number(/bytes=(\d+)-/.exec(value)[1]));
      assert.ok(restarted.some((start) => start > 0), `départs: ${restarted.join(', ')}`);
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('pause puis reprise : le transfert reprend au bon octet', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dl-'));
  const data = sampleBytes(1024 * 1024);
  // Serveur lent : 16 Ko par 25 ms ≈ 640 Ko/s, le temps de mettre en pause.
  let slow = true;
  const handler = (req, res) => {
    const range = req.headers.range || '';
    const isProbe = range === 'bytes=0-0';
    if (isProbe) {
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
    if (!slow) {
      res.writeHead(206, {
        'content-range': `bytes ${start}-${end}/${data.length}`,
        'content-length': end - start + 1,
        'accept-ranges': 'bytes',
      });
      res.end(data.subarray(start, end + 1));
      return;
    }
    res.writeHead(206, {
      'content-range': `bytes ${start}-${end}/${data.length}`,
      'accept-ranges': 'bytes',
    });
    let position = start;
    const tick = () => {
      if (res.destroyed || position > end) {
        res.end();
        return;
      }
      const chunk = data.subarray(position, Math.min(position + 16 * 1024, end + 1));
      position += chunk.length;
      res.write(chunk);
      setTimeout(tick, 25);
    };
    tick();
  };

  try {
    await withServer(handler, async (url) => {
      const target = path.join(dir, 'fichier.bin');
      const { task } = await makeTask(target, { url, connections: 2, retries: 1 });
      const started = task.start();
      // Attend que quelques octets soient arrivés avant de suspendre.
      const deadline = Date.now() + 4000;
      while (task.downloaded < 64 * 1024 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.ok(task.downloaded > 0, 'des octets doivent être arrivés avant la pause');
      await task.pause();
      assert.equal(task.state, 'paused');
      const receivedAtPause = task.downloaded;
      assert.ok(receivedAtPause > 0);
      assert.ok(fs.existsSync(`${target}.orbitpart`), 'le fichier partiel doit rester');
      assert.ok(fs.existsSync(`${target}.orbitdl`), 'l’état de reprise doit rester');

      slow = false;
      await task.resume();
      await started.catch(() => {});
      assert.equal(task.state, 'completed', task.error);
      const written = await fsp.readFile(target);
      assert.ok(written.equals(data), 'le fichier repris doit être identique à la source');
      assert.equal(fs.existsSync(`${target}.orbitdl`), false);
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('serveur sans Range : repli en flux simple, fichier complet quand même', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dl-'));
  const data = sampleBytes(768 * 1024);
  const { handler } = rangeServer(data, { honorRanges: false });
  try {
    await withServer(handler, async (url) => {
      const target = path.join(dir, 'fichier.bin');
      const { task } = await makeTask(target, { url, connections: 8 });
      await task.start();
      assert.equal(task.state, 'completed', task.error);
      assert.equal(task.segmented, false);
      const written = await fsp.readFile(target);
      assert.ok(written.equals(data));
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('serveur qui ignore le Range en cours de route : on bascule en flux simple', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dl-'));
  const data = sampleBytes(1024 * 1024);
  const handler = (req, res) => {
    const range = req.headers.range || '';
    if (range === 'bytes=0-0') {
      res.writeHead(206, {
        'content-range': `bytes 0-0/${data.length}`,
        'content-length': 1,
        'accept-ranges': 'bytes',
      });
      res.end(data.subarray(0, 1));
      return;
    }
    // Il annonce le Range mais sert tout le fichier : exactement ce que fait un
    // CDN mal configuré.
    res.writeHead(200, { 'content-length': data.length, 'accept-ranges': 'bytes' });
    res.end(data);
  };
  try {
    await withServer(handler, async (url) => {
      const target = path.join(dir, 'fichier.bin');
      const { task } = await makeTask(target, { url, connections: 3, retries: 0 });
      await task.start();
      assert.equal(task.state, 'completed', task.error);
      const written = await fsp.readFile(target);
      assert.ok(written.equals(data));
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('un lien de page est refusé plutôt qu’enregistré sous un nom sans titre', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dl-'));
  const server = http.createServer((_req, res) => {
    const body = '<html><head><title>Une vidéo</title></head><body>…</body></html>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const target = path.join(dir, 'watch');
    const { task, events } = await makeTask(target, { url: `http://127.0.0.1:${port}/watch` });
    await task.start();
    assert.equal(task.state, 'interrupted');
    assert.match(events.at(-1).error, /page web/);
    assert.equal(fs.existsSync(target), false);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('la limite de débit ralentit réellement le téléchargement', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'orbit-dl-'));
  const data = sampleBytes(256 * 1024);
  const { handler } = rangeServer(data);
  try {
    await withServer(handler, async (url) => {
      const target = path.join(dir, 'fichier.bin');
      const { task } = await makeTask(target, {
        url,
        connections: 1,
        rate: 128 * 1024, // 128 Ko/s pour 256 Ko → ~2 s
      });
      const started = Date.now();
      await task.start();
      const seconds = (Date.now() - started) / 1000;
      assert.equal(task.state, 'completed', task.error);
      assert.ok(seconds >= 1.4, `${seconds.toFixed(2)} s — la limite n’a pas été appliquée`);
      const written = await fsp.readFile(target);
      assert.ok(written.equals(data));
    });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
