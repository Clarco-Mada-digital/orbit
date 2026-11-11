// ---------------------------------------------------------------------------
// File d'attente des téléchargements pilotés par le moteur accéléré.
//
// Trois choses que le navigateur ne sait pas faire et qu'on veut ici :
//   • N transferts simultanés au maximum, les autres attendent leur tour ;
//   • un plafond de débit GLOBAL partagé par tout ce qui télécharge ;
//   • des réglages qui s'appliquent à chaud (connexions, débit, réessais).
//
// Les événements sortent dans la même forme que ceux du téléchargement natif
// d'Electron (voir setupDownloads dans main.js), plus `connections`, `retries`
// et l'état `queued` : l'interface n'a qu'un seul format à connaître.
// ---------------------------------------------------------------------------

import { DownloadTask } from './engine.js';
import { Limiter } from './limiter.js';

let sequence = 0;

export class DownloadManager {
  constructor({ fetchImpl, resolveTarget, onEvent }) {
    this.fetchImpl = fetchImpl;
    this.resolveTarget = resolveTarget;
    this.onEvent = onEvent;
    this.entries = new Map(); // id -> task
    this.queue = []; // ids en attente
    this.running = new Set(); // ids en cours
    this.settings = {
      connections: 8,
      maxConcurrent: 3,
      globalRate: 0,
      perFileRate: 0,
      retries: 3,
    };
    this.globalLimiter = new Limiter(0);
  }

  setSettings(next = {}) {
    const clamp = (value, min, max, fallback) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.round(n)));
    };
    this.settings = {
      connections: clamp(next.connections, 1, 16, this.settings.connections),
      maxConcurrent: clamp(next.maxConcurrent, 1, 10, this.settings.maxConcurrent),
      globalRate: clamp(next.globalRate, 0, 10 * 1024 * 1024, this.settings.globalRate),
      perFileRate: clamp(next.perFileRate, 0, 10 * 1024 * 1024, this.settings.perFileRate),
      retries: clamp(next.retries, 0, 10, this.settings.retries),
    };
    this.globalLimiter.set(this.settings.globalRate);
    for (const task of this.entries.values()) {
      task.setConnections(this.settings.connections);
      task.limiter.set(this.settings.perFileRate);
      task.retries = this.settings.retries;
    }
    this.pump();
    return this.settings;
  }

  add({ url, headers = {}, rate = null }) {
    const id = `dm-${Date.now()}-${(sequence += 1)}`;
    const task = new DownloadTask({
      id,
      url,
      headers,
      connections: this.settings.connections,
      rate: rate === null ? this.settings.perFileRate : rate,
      retries: this.settings.retries,
      fetchImpl: this.fetchImpl,
      resolveTarget: this.resolveTarget,
      globalLimiter: this.globalLimiter,
      onEvent: (event) => this.handle(task, event),
    });
    this.entries.set(id, task);
    this.queue.push(id);
    this.announce(task, { state: 'queued', event: 'started', receivedBytes: 0, totalBytes: 0 });
    this.pump();
    return { success: true, id };
  }

  handle(task, event) {
    const terminal =
      event.state === 'completed' ||
      event.state === 'interrupted' ||
      event.state === 'cancelled' ||
      event.state === 'paused';
    this.onEvent(event);
    if (terminal && this.running.has(task.id)) {
      this.running.delete(task.id);
      this.queue = this.queue.filter((id) => id !== task.id);
      if (event.state === 'paused') {
        // Une tâche en pause reste connue, mais elle n'est plus en file.
      }
      this.pump();
    }
    // Une tâche terminée ne doit pas rester dans la file même si elle n'y était
    // plus : on purge par sécurité.
    if (terminal) this.queue = this.queue.filter((id) => id !== task.id);
  }

  announce(task, extra) {
    this.onEvent(task.snapshot({ ...extra, connections: 0 }));
  }

  pump() {
    while (this.running.size < this.settings.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift();
      const task = this.entries.get(id);
      if (!task || task.state === 'completed' || task.state === 'cancelled') continue;
      if (task.state === 'paused') continue;
      this.running.add(id);
      task.start().catch((error) => {
        console.error('[orbit] téléchargement accéléré interrompu:', error.message);
      });
    }
  }

  pause(id) {
    const task = this.entries.get(id);
    if (!task) return false;
    this.queue = this.queue.filter((queued) => queued !== id);
    task.pause().catch(() => {});
    return true;
  }

  resume(id) {
    const task = this.entries.get(id);
    if (!task) return false;
    if (task.state === 'completed' || task.state === 'cancelled') return false;
    if (!this.queue.includes(id) && !this.running.has(id)) this.queue.push(id);
    if (!task.prepared) {
      // Tâche jamais démarrée : start() fera la reconnaissance.
      this.pump();
      return true;
    }
    task.resume().catch(() => {});
    return true;
  }

  cancel(id) {
    const task = this.entries.get(id);
    if (!task) return false;
    this.queue = this.queue.filter((queued) => queued !== id);
    task.cancel().catch(() => {});
    return true;
  }

  remove(id) {
    const task = this.entries.get(id);
    if (!task) return false;
    if (this.running.has(id)) return false;
    this.queue = this.queue.filter((queued) => queued !== id);
    this.entries.delete(id);
    return true;
  }

  has(id) {
    return this.entries.has(id);
  }

  runningCount() {
    return this.running.size;
  }

  // « Mettre la machine en veille n'interrompt pas un téléchargement » : le
  // blocage de mise en veille doit savoir qu'il y a du travail en cours.
  hasActive() {
    return this.running.size > 0;
  }

  async stopAll() {
    this.queue = [];
    const tasks = [...this.running].map((id) => this.entries.get(id)).filter(Boolean);
    await Promise.allSettled(tasks.map((task) => task.pause()));
    this.running.clear();
  }
}
