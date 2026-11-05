#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Captures d'écran de la documentation, PILOTÉES.
//
// Les illustrations d'un guide vieillissent encore plus vite que son texte :
// un bouton déplacé, une couleur changée, et l'image ment. Ce script les
// REGÉNÈRE : il lance Orbit sur un profil vierge, met l'interface dans l'état
// voulu, photographie, et recommence.
//
// Il parle à l'application par le protocole DevTools (CDP), avec le WebSocket
// natif de Node — aucune dépendance ajoutée. Le profil est jeté à chaque
// exécution : les captures ne montrent jamais les données de quelqu'un.
//
// Usage :
//   npm run docs:shots              (toutes les captures)
//   node scripts/capture-docs.js nom-de-capture …
//
// Prérequis : le serveur de développement (`npm run dev`) doit tourner, ou
// bien laisser ce script le démarrer lui-même.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'images');
const PORT = 9222;
const DEV_URL = 'http://localhost:5173/';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Client CDP minimal -----------------------------------------------------

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP: ${method} sans réponse`));
      }, 20000);
    });
  }

  // `awaitPromise` : une expression asynchrone (clic puis attente du rendu)
  // doit être terminée avant qu'on photographie.
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'erreur dans la page');
    }
    return result.result?.value;
  }

  // Gestes souris RÉELS (et non des `click()` synthétiques) : c'est le seul
  // moyen d'exercer le dessin sur la toile, qui n'écoute que des événements de
  // pointeur.
  async mouse(type, x, y, buttons = 1) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      buttons: type === 'mouseMoved' && !buttons ? 0 : buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'mouse',
    });
  }

  async clickAt(x, y) {
    await this.mouse('mouseMoved', x, y, 0);
    await this.mouse('mousePressed', x, y);
    await this.mouse('mouseReleased', x, y);
    await sleep(120);
  }

  async drag(from, to, steps = 10) {
    await this.mouse('mouseMoved', from.x, from.y, 0);
    await this.mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= steps; i += 1) {
      await this.mouse(
        'mouseMoved',
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps
      );
    }
    await this.mouse('mouseReleased', to.x, to.y);
    await sleep(120);
  }

  // Rectangle d'un élément, dans les coordonnées de la fenêtre.
  async rectOf(selector) {
    return this.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
  }

  async shot(file, clip) {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = { ...clip, scale: 1 };
    const { data } = await this.send('Page.captureScreenshot', params);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return fs.statSync(file).size;
  }
}

async function findTarget() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await response.json();
  // La fenêtre principale : une « page » servie par le serveur de
  // développement. Les webviews et les DevTools portent d'autres URL — s'y
  // connecter donnerait des captures vides.
  return targets.find((target) => target.type === 'page' && target.url.startsWith(DEV_URL));
}

async function connect() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const target = await findTarget();
      if (target) {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true });
          socket.addEventListener('error', reject, { once: true });
        });
        return new Cdp(socket);
      }
    } catch {
      /* l'application n'est pas encore prête */
    }
    await sleep(500);
  }
  throw new Error(`Aucune fenêtre Orbit sur le port ${PORT}. Lancez l'application avec --remote-debugging-port=${PORT}.`);
}

// --- Aides de mise en scène -------------------------------------------------

// Clic par SÉLECTEUR, exécuté dans la page : plus robuste qu'un clic par
// coordonnées, qui dépend de la taille de la fenêtre et du thème.
const clickJs = (selector) => `(() => {
  const node = document.querySelector(${JSON.stringify(selector)});
  if (!node) throw new Error('introuvable : ' + ${JSON.stringify(selector)});
  node.click();
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;

// Clic par TEXTE visible (titre, aria-label ou contenu) : les boutons d'Orbit
// sont identifiés par leur libellé, pas par des identifiants techniques.
const clickTextJs = (text, tag = 'button') => `(() => {
  const needle = ${JSON.stringify(text.toLowerCase())};
  const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})];
  const node = nodes.find((n) => {
    const label = (n.getAttribute('aria-label') || n.getAttribute('title') || n.textContent || '').toLowerCase();
    return label.includes(needle);
  });
  if (!node) throw new Error('bouton introuvable : ' + needle);
  node.click();
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;

// --- Les captures -----------------------------------------------------------
//
// Chaque entrée met l'interface dans un état, puis photographie. L'ordre
// compte : certaines partent de l'état laissée par la précédente.

const SHOTS = [
  {
    name: 'accueil-bienvenue',
    title: 'Écran de bienvenue au premier démarrage',
    async run(cdp) {
      await cdp.evaluate(clickTextJs('Commencer')).catch(() => {});
      await sleep(600);
      return null; // capture pleine fenêtre
    },
    before: async (cdp) => {
      await sleep(400);
      await cdp.shot(path.join(OUT, 'orbit-bienvenue.png'));
    },
  },
  {
    name: 'editeur-annotation',
    title: 'Éditeur d’annotation : étapes numérotées, flèche, masquage',
    async run(cdp) {
      // Capture RÉELLE de l'interface d'Orbit par Orbit : l'aperçu qui s'ouvre
      // ensuite est exactement celui que voit l'utilisateur.
      await cdp.evaluate(
        `window.dispatchEvent(new CustomEvent('orbit:screenshot-open', { detail: { source: 'orbit' } }))`
      );
      await sleep(600);
      await cdp.evaluate(clickTextJs('Zone visible'));
      await sleep(2500);

      const canvas = await cdp.rectOf('canvas[role="img"]');
      if (!canvas) throw new Error('éditeur de capture non ouvert');

      // Trois étapes numérotées, posées comme le ferait un utilisateur.
      await cdp.evaluate(clickTextJs('Étape numérotée'));
      await cdp.clickAt(canvas.x + canvas.width * 0.22, canvas.y + canvas.height * 0.3);
      await cdp.clickAt(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.52);
      await cdp.clickAt(canvas.x + canvas.width * 0.76, canvas.y + canvas.height * 0.33);

      // Une flèche, dans une autre couleur.
      await cdp.evaluate(clickTextJs('Couleur #f59e0b'));
      await cdp.evaluate(clickTextJs('Flèche'));
      await cdp.drag(
        { x: canvas.x + canvas.width * 0.3, y: canvas.y + canvas.height * 0.72 },
        { x: canvas.x + canvas.width * 0.47, y: canvas.y + canvas.height * 0.57 }
      );

      // Une zone masquée.
      await cdp.evaluate(clickTextJs('Masquer (pixelliser)'));
      await cdp.drag(
        { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.72 },
        { x: canvas.x + canvas.width * 0.85, y: canvas.y + canvas.height * 0.8 }
      );
      await sleep(400);
      return cdp.rectOf('[role="dialog"][aria-modal="true"]');
    },
    file: 'orbit-editeur-annotation.png',
  },
  {
    name: 'espaces-de-travail',
    title: 'Menu des espaces de travail',
    async run(cdp) {
      // Fermer l'aperçu de capture resté ouvert.
      await cdp.evaluate(
        `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); })()`
      );
      await sleep(600);
      await cdp.evaluate(clickTextJs('Espaces de travail'));
      await sleep(500);
      return cdp.rectOf('[class*="w-64"]');
    },
    file: 'orbit-espaces-travail.png',
  },
];

// --- Entrée -----------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const shot of SHOTS) {
    if (wanted.length && !wanted.includes(shot.name)) continue;
    try {
      if (shot.before) await shot.before(cdp);
      const clip = await shot.run(cdp);
      if (shot.file) {
        const size = await cdp.shot(path.join(OUT, shot.file), clip || undefined);
        console.log(`✔ ${shot.file} (${Math.round(size / 1024)} Ko) — ${shot.title}`);
      } else {
        console.log(`✔ ${shot.name} — ${shot.title}`);
      }
    } catch (err) {
      console.error(`✖ ${shot.name} : ${err.message}`);
    }
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('capture-docs.js')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

export { Cdp, connect, clickJs, clickTextJs, sleep, OUT, ROOT, PORT, DEV_URL, spawn };
