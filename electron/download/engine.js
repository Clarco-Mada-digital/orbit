// ---------------------------------------------------------------------------
// Moteur de téléchargement accéléré.
//
// Le navigateur (et donc Orbit jusqu'ici) télécharge un fichier sur UNE seule
// connexion, sans moyen de la limiter, sans reprise après un redémarrage et
// sans contrôle du nombre de transferts simultanés. Ce module fait ce que fait
// un vrai gestionnaire (Mister Download Manager) :
//
//   • plusieurs connexions HTTP Range en parallèle sur le MÊME fichier ;
//   • un planificateur qui recoupe en deux la plus grosse part restante dès
//     qu'une connexion se libère (voir planner.js) — la vitesse ne s'écroule
//     pas quand une connexion traîne ;
//   • une reprise exacte : chaque part écrit ses octets à son décalage dans
//     `<fichier>.orbitpart`, et `<fichier>.orbitdl` retient la table des
//     segments, la taille et les validateurs (ETag / Last-Modified). Un
//     redémarrage repart de là au lieu de tout reprendre ;
//   • un limiteur de débit par fichier et un global (voir limiter.js) ;
//   • des réessais avec attente croissante quand le réseau lâche ;
//   • repli automatique en flux simple quand le serveur ignore le Range.
//
// Le fichier n'apparaît sous son vrai nom qu'une fois complet : on renomme
// `<fichier>.orbitpart` à la fin. Un fichier à moitié écrit ne reste donc
// jamais là où l'utilisateur le croirait fini.
// ---------------------------------------------------------------------------

import fsp from 'node:fs/promises';
import path from 'node:path';

import { Limiter } from './limiter.js';
import { Planner } from './planner.js';

// Une part de moins de 512 Ko ne vaut pas l'ouverture d'une connexion.
export const MIN_SPLIT_BYTES = 512 * 1024;
export const MAX_CONNECTIONS = 16;
const PROGRESS_INTERVAL_MS = 250;
const STATE_INTERVAL_MS = 2000;
const PROBE_TIMEOUT_MS = 30_000;
const SPEED_WINDOW_MS = 1500;

function taggedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError() {
  return taggedError('aborted', 'ABORTED');
}

// « attachment; filename="rapport final.pdf"; filename*=UTF-8''rapport%20final.pdf »
export function parseContentDisposition(header) {
  if (!header || typeof header !== 'string') return '';
  // RFC 5987 d'abord : c'est la forme qui porte l'encodage et les accents.
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (extended) {
    const raw = extended[1].trim().replace(/^["']|["']$/g, '');
    const parts = raw.split("''");
    const encoded = parts.length === 2 ? parts[1] : raw;
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* valeur mal encodée : on tente la forme simple plus bas */
    }
  }
  const simple = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(header);
  if (simple) return (simple[2] ?? simple[3] ?? '').trim();
  return '';
}

export function filenameFromUrl(value) {
  try {
    const url = new URL(value);
    const last = url.pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

// Nom de fichier sûr : ni séparateur de chemin, ni caractère interdit par
// Windows, ni nom réservé. On garde les accents (les trois systèmes les
// acceptent) mais rien qui puisse sortir du dossier choisi.
export function sanitizeFilename(name) {
  // Filtre caractère par caractère plutôt qu'une expression régulière : la
  // plage de contrôle n'est pas exprimable sans casser la règle eslint
  // `no-control-regex`, et un nom de fichier vient du réseau.
  const forbidden = '<>:"|?*';
  const stripped = [...String(name || '')]
    .map((character) =>
      character.codePointAt(0) < 0x20 || forbidden.includes(character) ? '_' : character
    )
    .join('');
  const base = stripped
    .split(/[/\\]/)
    .pop()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!base) return '';
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  const safe = reserved.test(base) ? `_${base}` : base;
  return safe.slice(0, 180);
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

export class DownloadTask {
  constructor({
    id,
    url,
    headers = {},
    connections = 8,
    rate = 0,
    retries = 3,
    // Choix faits par l'utilisateur pour CE téléchargement (voir le dialogue
    // « Nouveau téléchargement »). Vides = on suit les réglages généraux.
    directory = '',
    name = '',
    description = '',
    priority = 0,
    fetchImpl,
    resolveTarget,
    globalLimiter = null,
    onEvent = () => {},
  }) {
    this.id = id;
    this.url = url;
    this.directory = directory;
    this.wantedName = name;
    this.description = description;
    this.priority = priority;
    // Une tâche « plus tard » attend dans la file sans démarrer d'elle-même.
    this.deferred = false;
    this.requestHeaders = { ...headers };
    this.connections = Math.max(1, Math.min(MAX_CONNECTIONS, Number(connections) || 8));
    this.retries = Math.max(0, Math.min(10, Number(retries) || 0));
    this.fetchImpl = fetchImpl;
    this.resolveTarget = resolveTarget;
    this.globalLimiter = globalLimiter;
    this.onEvent = onEvent;
    this.limiter = new Limiter(rate);

    this.state = 'queued';
    this.prepared = false;
    this.segmented = false;
    this.downloaded = 0;
    this.totalBytes = 0;
    this.retriesDone = 0;
    this.error = '';
    this.filename = '';
    this.savePath = '';
    this.partPath = '';
    this.statePath = '';
    this.fileHandle = null;
    this.planner = null;
    this.inflight = new Set();
    this.stopping = false;
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.runPromise = null;
    this.lastEmit = 0;
    this.lastSave = 0;
    this.samples = [];
  }

  // --- état exposé -------------------------------------------------------

  snapshot(extra = {}) {
    return {
      id: this.id,
      kind: 'file',
      url: this.url,
      filename: this.filename || 'Téléchargement',
      savePath: this.savePath,
      description: this.description,
      priority: this.priority,
      deferred: this.deferred,
      connectionsLimit: this.connections,
      rateLimit: this.limiter.get(),
      state: this.state,
      receivedBytes: this.downloaded,
      totalBytes: this.totalBytes,
      speedBytesPerSecond: this.speed(),
      etaSeconds: this.eta(),
      connections: this.connectionsInUse(),
      retries: this.retriesDone,
      error: this.error,
      canPause: true,
      ...extra,
    };
  }

  speed() {
    const now = Date.now();
    const oldest = this.samples[0];
    if (!oldest) return 0;
    const seconds = (now - oldest.t) / 1000;
    if (seconds <= 0.2) return 0;
    return Math.max(0, Math.round((this.downloaded - oldest.bytes) / seconds));
  }

  eta() {
    if (this.totalBytes <= 0) return 0;
    const speed = this.speed();
    if (speed <= 0) return 0;
    return Math.max(0, Math.round((this.totalBytes - this.downloaded) / speed));
  }

  connectionsInUse() {
    if (!this.segmented) return this.state === 'progressing' ? 1 : 0;
    return this.planner ? this.planner.receivingWorkers() : 0;
  }

  emit(extra = {}) {
    this.lastEmit = Date.now();
    this.onEvent(this.snapshot(extra));
  }

  emitThrottled() {
    const now = Date.now();
    if (now - this.lastEmit < PROGRESS_INTERVAL_MS) return;
    // Échantillon d'il y a ~1,5 s : une vitesse instantanée saute dans tous les
    // sens, une moyenne glissante reste lisible.
    this.samples.push({ t: now, bytes: this.downloaded });
    while (this.samples.length > 2 && now - this.samples[0].t > SPEED_WINDOW_MS) {
      this.samples.shift();
    }
    this.emit({ state: 'progressing' });
    if (this.segmented && now - this.lastSave >= STATE_INTERVAL_MS) {
      this.lastSave = now;
      this.saveState().catch(() => {});
    }
  }

  addBytes(n) {
    if (n <= 0) return;
    this.downloaded += n;
    this.emitThrottled();
  }

  // --- cycle de vie ------------------------------------------------------

  start() {
    if (this.runPromise) return this.runPromise;
    this.stopping = false;
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.error = '';
    this.runPromise = this.execute().finally(() => {
      this.runPromise = null;
    });
    return this.runPromise;
  }

  async execute() {
    try {
      if (!this.prepared) await this.prepare();
      await this.openFile();
      this.state = 'progressing';
      this.samples = [{ t: Date.now(), bytes: this.downloaded }];
      this.emit({ state: 'progressing', event: 'started' });

      if (this.segmented) {
        try {
          await this.runWorkers();
        } catch (error) {
          if (error.code !== 'RANGE_IGNORED') throw error;
          // Le serveur a répondu 200 à une requête Range : tout ce qui a été
          // réparti est bon à jeter, on repart en flux simple.
          await this.abortAll();
          await this.resetSingle();
          await this.runSingle();
        }
      } else {
        await this.runSingle();
      }

      await this.finish();
    } catch (error) {
      if (this.pauseRequested) {
        await this.saveState().catch(() => {});
        this.state = 'paused';
        this.emit({ state: 'paused', event: 'updated' });
        return;
      }
      if (this.cancelRequested || error.code === 'CANCELLED') {
        this.state = 'cancelled';
        // Le fichier partiel a pu être créé pendant l'annulation (boîte de
        // dialogue encore ouverte) : on nettoie ce qui existe.
        await this.discardFiles().catch(() => {});
        this.emit({ state: 'cancelled', event: 'done' });
        return;
      }
      this.error = String(error.message || error);
      await this.saveState().catch(() => {});
      this.state = 'interrupted';
      this.emit({ state: 'interrupted', event: 'done', error: this.error });
    } finally {
      await this.closeFile();
    }
  }

  async pause() {
    this.pauseRequested = true;
    this.stopping = true;
    await this.abortAll();
    if (this.runPromise) await this.runPromise.catch(() => {});
    await this.closeFile();
    await this.saveState().catch(() => {});
    if (this.state === 'queued') {
      this.state = 'paused';
      this.emit({ state: 'paused', event: 'updated' });
    }
  }

  async resume() {
    if (this.state === 'completed' || this.state === 'cancelled') return;
    this.pauseRequested = false;
    this.stopping = false;
    await this.start();
  }

  async cancel() {
    this.cancelRequested = true;
    this.stopping = true;
    await this.abortAll();
    if (this.runPromise) await this.runPromise.catch(() => {});
    await this.closeFile();
    await this.discardFiles();
    this.state = 'cancelled';
    this.emit({ state: 'cancelled', event: 'done' });
  }

  setRate(rate) {
    this.limiter.set(rate);
  }

  setConnections(value) {
    const next = Math.max(1, Math.min(MAX_CONNECTIONS, Number(value) || 8));
    if (next !== this.connections) this.connections = next;
  }

  setPriority(value) {
    this.priority = Math.max(-1, Math.min(1, Math.round(Number(value) || 0)));
  }

  setDescription(value) {
    this.description = String(value || '').slice(0, 200);
  }

  // --- préparation -------------------------------------------------------

  async prepare() {
    const probe = await this.probe();
    this.finalUrl = probe.finalUrl;
    this.totalBytes = probe.totalBytes;
    this.probeInfo = probe;
    this.segmented = probe.acceptRanges && probe.totalBytes > 0;

    const target = await this.resolveTarget({
      id: this.id,
      url: this.url,
      filename: probe.filename || 'telechargement',
      totalBytes: probe.totalBytes,
      suggestedName: probe.filename,
      directory: this.directory,
      name: this.wantedName,
    });
    // Le nom affiché est le nom RÉEL sur le disque : si l'utilisateur a choisi
    // un autre nom dans le dialogue, c'est celui-là qui compte.
    this.filename = path.basename(target.filePath || '') || probe.filename || 'telechargement';
    this.savePath = target.filePath;
    this.partPath = `${target.filePath}.orbitpart`;
    this.statePath = `${target.filePath}.orbitdl`;

    if (this.segmented) {
      const resumed = await this.loadState();
      if (resumed) {
        this.planner = resumed;
        this.downloaded = resumed.downloaded();
      } else {
        this.planner = new Planner(this.totalBytes, MIN_SPLIT_BYTES);
      }
      await this.preparePartFile(Boolean(resumed));
    }
    this.prepared = true;
  }

  async probe() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    timer.unref?.();
    let response;
    try {
      response = await this.fetchImpl(this.url, {
        headers: { ...this.requestHeaders, Range: 'bytes=0-0', 'Accept-Encoding': 'identity' },
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw taggedError('Le serveur ne répond pas.', 'TIMEOUT');
      throw taggedError(`Connexion impossible : ${error.message || error}`, 'NETWORK');
    } finally {
      clearTimeout(timer);
    }

    const status = response.status;
    await response.body?.cancel().catch(() => {});
    if (status === 401 || status === 403) {
      throw taggedError('Le serveur refuse l’accès à ce fichier (401/403).', 'HTTP');
    }
    if (status === 404 || status === 410) {
      throw taggedError('Fichier introuvable sur le serveur (404).', 'HTTP');
    }
    if (!response.ok && status !== 206) {
      throw taggedError(`Le serveur a répondu ${status}.`, 'HTTP');
    }

    // Une adresse de PAGE (« youtube.com/watch?v=… ») ne porte aucun nom de
    // fichier : sans cette garde on enregistrait le HTML sous le nom du dernier
    // segment de l'adresse, donc sans le titre de la vidéo. Mieux vaut le dire
    // et laisser l'utilisateur passer par le téléchargement vidéo.
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const addressName = filenameFromUrl(response.url || this.url);
    if (contentType.includes('text/html') && !/\.[a-z0-9]{1,8}$/i.test(addressName)) {
      throw taggedError(
        'Ce lien renvoie une page web, pas un fichier. Utilisez « Vidéo » ou « Audio » pour enregistrer son contenu.',
        'PAGE'
      );
    }

    const contentRange = response.headers.get('content-range') || '';
    const rangeTotal = /\/(\d+)\s*$/.exec(contentRange);
    let totalBytes = 0;
    if (status === 206 && rangeTotal) totalBytes = Number(rangeTotal[1]) || 0;
    else if (status === 200) totalBytes = Number(response.headers.get('content-length')) || 0;
    else if (rangeTotal) totalBytes = Number(rangeTotal[1]) || 0;

    const length = Number(response.headers.get('content-length')) || 0;
    const acceptRanges =
      status === 206 || /bytes/i.test(response.headers.get('accept-ranges') || '');
    // Un serveur qui répond 206 mais annonce 1 octet de contenu (sa réponse à
    // « bytes=0-0 ») a bien donné la taille totale dans Content-Range.
    const filename =
      sanitizeFilename(parseContentDisposition(response.headers.get('content-disposition'))) ||
      sanitizeFilename(filenameFromUrl(response.url || this.url)) ||
      'telechargement';

    return {
      status,
      finalUrl: response.url || this.url,
      totalBytes,
      declaredLength: length,
      acceptRanges: acceptRanges && totalBytes > 0,
      etag: response.headers.get('etag') || '',
      lastModified: response.headers.get('last-modified') || '',
      filename,
    };
  }

  async preparePartFile(resuming) {
    let size = -1;
    try {
      size = (await fsp.stat(this.partPath)).size;
    } catch {
      size = -1;
    }
    if (resuming && size === this.totalBytes) return;
    const handle = await fsp.open(this.partPath, 'w');
    await handle.truncate(this.totalBytes);
    await handle.close();
    if (resuming) {
      // Le fichier partiel ne correspond plus à l'état : on repart de zéro.
      this.planner = new Planner(this.totalBytes, MIN_SPLIT_BYTES);
      this.downloaded = 0;
    }
  }

  async openFile() {
    if (this.fileHandle) return;
    if (this.segmented) {
      this.fileHandle = await fsp.open(this.partPath, 'r+').catch(() => fsp.open(this.partPath, 'w+'));
      const stat = await this.fileHandle.stat();
      if (stat.size !== this.totalBytes) await this.fileHandle.truncate(this.totalBytes);
      return;
    }
    this.fileHandle = await fsp.open(this.partPath, 'w+');
  }

  async closeFile() {
    const handle = this.fileHandle;
    this.fileHandle = null;
    if (!handle) return;
    try {
      await handle.close();
    } catch {
      /* déjà fermé */
    }
  }

  // --- état sur disque ---------------------------------------------------

  async loadState() {
    if (!this.statePath || this.totalBytes <= 0) return null;
    try {
      const saved = JSON.parse(await fsp.readFile(this.statePath, 'utf8'));
      if (saved?.v !== 1) return null;
      if (Number(saved.totalBytes) !== this.totalBytes) return null;
      if (saved.etag && this.probeInfo?.etag && saved.etag !== this.probeInfo.etag) return null;
      const planner = Planner.resume(this.totalBytes, MIN_SPLIT_BYTES, saved.segments);
      if (!planner) return null;
      // Le fichier partiel doit exister, sinon la table ne veut rien dire.
      await fsp.access(this.partPath);
      return planner;
    } catch {
      return null;
    }
  }

  async saveState() {
    if (!this.segmented || !this.statePath || !this.planner) return;
    const payload = {
      v: 1,
      url: this.url,
      finalUrl: this.finalUrl,
      totalBytes: this.totalBytes,
      etag: this.probeInfo?.etag || '',
      lastModified: this.probeInfo?.lastModified || '',
      segments: this.planner.save(),
      at: Date.now(),
    };
    const temporary = `${this.statePath}.tmp`;
    try {
      await fsp.writeFile(temporary, JSON.stringify(payload));
      await fsp.rename(temporary, this.statePath);
    } catch (error) {
      console.error('[orbit] écriture de l’état du téléchargement échouée:', error.message);
    }
  }

  async discardFiles() {
    if (!this.partPath) return;
    await fsp.rm(this.partPath, { force: true }).catch(() => {});
    await fsp.rm(this.statePath, { force: true }).catch(() => {});
  }

  // --- transfert ---------------------------------------------------------

  abortAll() {
    for (const controller of [...this.inflight]) {
      try {
        controller.abort();
      } catch {
        /* déjà terminé */
      }
    }
    this.inflight.clear();
    return Promise.resolve();
  }

  async throttle(n) {
    if (this.limiter.get()) await this.limiter.acquire(n);
    if (this.globalLimiter?.get()) await this.globalLimiter.acquire(n);
  }

  workerCount() {
    if (!this.segmented) return 1;
    const bySize = Math.max(1, Math.ceil(this.totalBytes / MIN_SPLIT_BYTES));
    return Math.min(this.connections, bySize);
  }

  async runWorkers() {
    const count = this.workerCount();
    const workers = [];
    for (let w = 0; w < count; w += 1) workers.push(this.worker(w));
    const results = await Promise.allSettled(workers);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
      await this.abortAll();
      throw failure.reason;
    }
    if (this.stopping) throw abortError();
  }

  async worker(w) {
    let after = null;
    let failures = 0;
    while (!this.stopping) {
      const assignment = this.planner.assign(w, after);
      if (!assignment) return;
      try {
        after = await this.runAssignment(w, assignment);
        failures = 0;
        this.retriesDone = 0;
      } catch (error) {
        this.planner.release(w);
        if (this.stopping) return;
        if (error.code === 'ABORTED') return;
        if (error.code === 'RANGE_IGNORED') throw error;
        failures += 1;
        this.retriesDone = failures;
        if (failures > this.retries) throw error;
        this.emit({
          state: 'progressing',
          error: `Nouvelle tentative (${failures}/${this.retries})…`,
        });
        await sleep(Math.min(8000, 400 * 2 ** failures));
        after = null;
      }
    }
  }

  async runAssignment(w, assignment) {
    const controller = new AbortController();
    this.inflight.add(controller);
    const headers = { ...this.requestHeaders, 'Accept-Encoding': 'identity' };
    if (this.segmented) headers.Range = `bytes=${assignment.from}-${assignment.to - 1}`;

    let response;
    try {
      response = await this.fetchImpl(this.finalUrl, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      this.inflight.delete(controller);
      if (error?.name === 'AbortError' || this.stopping) throw abortError();
      throw taggedError(`Connexion interrompue : ${error.message || error}`, 'NETWORK');
    }

    // Le serveur ignore le Range : il renvoie tout le fichier depuis zéro.
    if (this.segmented && response.status === 200 && assignment.from > 0) {
      this.inflight.delete(controller);
      await response.body?.cancel().catch(() => {});
      throw taggedError('range-ignored', 'RANGE_IGNORED');
    }
    if (!response.ok || !response.body) {
      this.inflight.delete(controller);
      throw taggedError(`Le serveur a répondu ${response.status}.`, 'HTTP');
    }

    const reader = response.body.getReader();
    let pos = assignment.from;
    try {
      for (;;) {
        if (this.stopping) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
        let offset = 0;
        while (offset < buffer.length) {
          const room = this.segmented ? this.planner.room(w, pos) : buffer.length - offset;
          if (this.segmented && room === null) throw abortError();
          if (room === 0) break;
          const wanted = Math.min(room, buffer.length - offset);
          let granted = wanted;
          if (this.segmented) {
            const claim = this.planner.claim(w, pos, wanted);
            if (!claim) throw abortError();
            granted = Math.min(claim.granted, wanted);
          }
          if (granted <= 0) break;
          await this.write(buffer, offset, granted, pos);
          pos += granted;
          offset += granted;
          this.addBytes(granted);
          await this.throttle(granted);
        }
        if (this.segmented && this.planner.room(w, pos) === 0) break;
      }
    } catch (error) {
      // Les octets déjà écrits sont SUR LE DISQUE : on les confirme avant de
      // relancer, sinon le réessai (ou la reprise après une pause) redemande
      // depuis le début de la part — tout le bénéfice du Range disparaît.
      if (this.segmented && pos > assignment.from) this.planner.commit(w, pos);
      if (error?.name === 'AbortError') throw abortError();
      throw error;
    } finally {
      this.inflight.delete(controller);
      reader.cancel?.().catch?.(() => {});
    }

    if (!this.segmented) return pos;
    const end = this.planner.commit(w, pos);
    return end ?? pos;
  }

  write(buffer, offset, length, position) {
    return this.fileHandle.write(buffer, offset, length, position);
  }

  // Flux simple : aucun Range, donc aucune reprise possible. On réessaie depuis
  // le début, ce qui reste mieux que d'abandonner.
  async runSingle() {
    let failures = 0;
    for (;;) {
      try {
        await this.singleAttempt();
        return;
      } catch (error) {
        if (this.stopping) throw abortError();
        failures += 1;
        this.retriesDone = failures;
        if (failures > this.retries) throw error;
        this.emit({
          state: 'progressing',
          error: `Nouvelle tentative (${failures}/${this.retries})…`,
        });
        await sleep(Math.min(8000, 400 * 2 ** failures));
        await this.resetStream();
      }
    }
  }

  async resetStream() {
    this.downloaded = 0;
    if (this.fileHandle) await this.fileHandle.truncate(0);
    this.samples = [{ t: Date.now(), bytes: 0 }];
    this.emit({ state: 'progressing' });
  }

  async resetSingle() {
    this.segmented = false;
    this.planner = null;
    this.downloaded = 0;
    await this.resetStream();
  }

  async singleAttempt() {
    const controller = new AbortController();
    this.inflight.add(controller);
    const headers = { ...this.requestHeaders, 'Accept-Encoding': 'identity' };
    let response;
    try {
      response = await this.fetchImpl(this.finalUrl, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (error) {
      this.inflight.delete(controller);
      if (error?.name === 'AbortError' || this.stopping) throw abortError();
      throw taggedError(`Connexion interrompue : ${error.message || error}`, 'NETWORK');
    }
    if (!response.ok || !response.body) {
      this.inflight.delete(controller);
      throw taggedError(`Le serveur a répondu ${response.status}.`, 'HTTP');
    }
    if (!this.totalBytes) {
      const length = Number(response.headers.get('content-length')) || 0;
      if (length > 0) this.totalBytes = length;
    }
    const reader = response.body.getReader();
    let pos = 0;
    try {
      for (;;) {
        if (this.stopping) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
        await this.write(buffer, 0, buffer.length, pos);
        pos += buffer.length;
        this.addBytes(buffer.length);
        await this.throttle(buffer.length);
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw abortError();
      throw error;
    } finally {
      this.inflight.delete(controller);
      reader.cancel?.().catch?.(() => {});
    }
  }

  // --- fin ---------------------------------------------------------------

  async finish() {
    if (this.stopping) throw abortError();
    const complete = this.segmented
      ? this.planner.isComplete()
      : this.totalBytes > 0
        ? this.downloaded === this.totalBytes
        : true;
    if (!complete) {
      throw taggedError(
        `Transfert incomplet (${this.downloaded} / ${this.totalBytes} octets).`,
        'INCOMPLETE'
      );
    }
    await this.closeFile();
    await fsp.rename(this.partPath, this.savePath).catch(async (error) => {
      // Windows refuse parfois le renommage si l'antivirus tient le fichier :
      // une copie fait le même travail.
      if (error.code !== 'EPERM' && error.code !== 'EXDEV') throw error;
      await fsp.copyFile(this.partPath, this.savePath);
      await fsp.rm(this.partPath, { force: true }).catch(() => {});
    });
    await fsp.rm(this.statePath, { force: true }).catch(() => {});
    this.state = 'completed';
    this.downloaded = this.totalBytes || this.downloaded;
    this.error = '';
    this.emit({ state: 'completed', event: 'done', receivedBytes: this.downloaded });
  }
}
