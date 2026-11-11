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
      // Un téléchargement dont l'utilisateur a fixé le nombre de connexions ou
      // le débit dans le dialogue garde SON choix : changer un réglage général
      // ne doit pas défaire une décision explicite.
      if (!task.explicitConnections) task.setConnections(this.settings.connections);
      if (!task.explicitRate) task.limiter.set(this.settings.perFileRate);
      task.retries = this.settings.retries;
    }
    this.pump();
    return this.settings;
  }

  add({
    url,
    headers = {},
    rate = null,
    connections = null,
    priority = 0,
    deferred = false,
    directory = '',
    name = '',
    description = '',
  }) {
    const id = `dm-${Date.now()}-${(sequence += 1)}`;
    const chosenConnections = Number.isFinite(connections) ? connections : null;
    const chosenRate = Number.isFinite(rate) ? rate : null;
    const task = new DownloadTask({
      id,
      url,
      headers,
      connections: chosenConnections ?? this.settings.connections,
      rate: chosenRate ?? this.settings.perFileRate,
      retries: this.settings.retries,
      directory,
      name,
      description,
      priority,
      fetchImpl: this.fetchImpl,
      resolveTarget: this.resolveTarget,
      globalLimiter: this.globalLimiter,
      onEvent: (event) => this.handle(task, event),
    });
    task.explicitConnections = chosenConnections !== null;
    task.explicitRate = chosenRate !== null;
    task.deferred = Boolean(deferred);
    this.entries.set(id, task);
    this.queue.push(id);
    this.announce(task, { state: 'queued', event: 'started', receivedBytes: 0, totalBytes: 0 });
    this.pump();
    return { success: true, id };
  }

  // Options modifiables après coup (connexions, débit propre, priorité,
  // description). Elles s'appliquent tout de suite, y compris en transfert.
  setOptions(id, { rate, connections, priority, description } = {}) {
    const task = this.entries.get(id);
    if (!task) return false;
    if (Number.isFinite(rate)) {
      task.explicitRate = true;
      task.setRate(Math.max(0, Math.min(10 * 1024 * 1024, rate)));
    }
    if (Number.isFinite(connections)) {
      task.explicitConnections = true;
      task.setConnections(connections);
    }
    if (Number.isFinite(priority)) task.setPriority(priority);
    if (typeof description === 'string') task.setDescription(description);
    this.announce(task, { state: task.state, event: 'updated' });
    return true;
  }

  // « Télécharger plus tard » : la tâche est dans la file, sans transfert.
  start(id) {
    return this.resume(id);
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

  // La file est ordonnée par priorité (haute d'abord), l'ordre d'ajout
  // tranchant les égalités.
  pump() {
    for (;;) {
      this.queue = this.queue.filter((id) => {
        const queued = this.entries.get(id);
        return (
          queued &&
          !queued.deferred &&
          queued.state !== 'completed' &&
          queued.state !== 'cancelled'
        );
      });
      if (this.running.size >= this.settings.maxConcurrent || this.queue.length === 0) return;
      let pick = 0;
      for (let index = 1; index < this.queue.length; index += 1) {
        const best = this.entries.get(this.queue[pick]);
        const candidate = this.entries.get(this.queue[index]);
        if ((candidate?.priority || 0) > (best?.priority || 0)) pick = index;
      }
      const [id] = this.queue.splice(pick, 1);
      const task = this.entries.get(id);
      if (!task) continue;
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

  // Reprise : la tâche retourne dans la file, qui la relance dans l'ordre des
  // priorités (une tâche déjà préparée reprend à son dernier segment).
  resume(id) {
    const task = this.entries.get(id);
    if (!task) return false;
    if (task.state === 'completed' || task.state === 'cancelled') return false;
    task.deferred = false;
    this.queue = this.queue.filter((queued) => queued !== id);
    this.queue.push(id);
    this.pump();
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
