(() => {
  'use strict';

  if (window.top !== window.self || document.getElementById('__orbit_web_clipper__')) return;

  const MAX_CAPTURE_LENGTH = 30_000;
  const STORAGE_KEY = 'orbitWebClips';
  const host = document.createElement('div');
  host.id = '__orbit_web_clipper__';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      width: min(340px, calc(100vw - 36px)); padding: 16px;
      border: 1px solid #3f3f46; border-radius: 16px; background: #18181b;
      color: #f4f4f5; box-shadow: 0 16px 48px #0008;
      font: 13px/1.45 system-ui, sans-serif;
    }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    h2 { margin: 0; font-size: 15px; }
    .close { padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: #a1a1aa; font: 14px/1 system-ui, sans-serif; cursor: pointer; }
    .close:hover { background: #27272a; color: #f4f4f5; }
    .panel:focus { outline: none; }
    .title { margin: 10px 0 14px; overflow: hidden; color: #a1a1aa; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button.action { min-height: 38px; padding: 8px 10px; border: 1px solid #3f3f46; border-radius: 9px; background: #27272a; color: #f4f4f5; font: inherit; cursor: pointer; }
    button.action:hover { border-color: #818cf8; background: #312e81; }
    button.action:disabled { cursor: not-allowed; opacity: .5; }
    .library { grid-column: 1 / -1; color: #c4b5fd !important; }
    .status { min-height: 18px; margin: 10px 0 0; color: #a1a1aa; overflow-wrap: anywhere; }
    .status[data-kind="error"] { color: #fca5a5; }
    .status[data-kind="success"] { color: #86efac; }
  `;
  shadow.appendChild(style);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Web Clipper');

  const header = document.createElement('div');
  header.className = 'header';
  const heading = document.createElement('h2');
  heading.textContent = 'Web Clipper';
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = '✕';
  close.title = 'Fermer (Échap)';
  close.setAttribute('aria-label', 'Fermer');
  close.addEventListener('click', () => { panel.hidden = true; });
  // Échap ferme le panneau quand le focus y est (il le prend à l'ouverture) :
  // la touche reste à la page le reste du temps.
  panel.tabIndex = -1;
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    panel.hidden = true;
  });
  header.append(heading, close);

  const title = document.createElement('p');
  title.className = 'title';
  title.textContent = document.title || location.hostname;
  title.title = title.textContent;

  const actions = document.createElement('div');
  actions.className = 'actions';
  const selectedButton = document.createElement('button');
  selectedButton.className = 'action';
  selectedButton.type = 'button';
  selectedButton.textContent = 'Capturer la sélection';
  const pageButton = document.createElement('button');
  pageButton.className = 'action';
  pageButton.type = 'button';
  pageButton.textContent = 'Capturer la page';
  const libraryButton = document.createElement('button');
  libraryButton.className = 'action library';
  libraryButton.type = 'button';
  libraryButton.textContent = 'Ouvrir mes captures';
  actions.append(selectedButton, pageButton, libraryButton);

  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  panel.append(header, title, actions, status);
  shadow.append(panel);
  (document.body || document.documentElement).appendChild(host);

  function readClips() {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(Array.isArray(result?.[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function saveClips(clips) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: clips }, () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function mainContent() {
    for (const selector of ['article', 'main', '[role="main"]']) {
      const candidate = document.querySelector(selector);
      if (candidate && candidate.innerText?.trim()) return candidate;
    }
    return document.body;
  }

  function markdownText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, MAX_CAPTURE_LENGTH);
  }

  function report(message, kind = '') {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  async function capture(selectionOnly) {
    const selection = window.getSelection()?.toString().trim() || '';
    if (selectionOnly && !selection) {
      report('Sélectionne d’abord un passage sur la page.', 'error');
      return;
    }
    selectedButton.disabled = true;
    pageButton.disabled = true;
    try {
      const content = markdownText(selectionOnly ? selection : mainContent()?.innerText || '');
      if (!content) {
        report('Aucun texte lisible à capturer sur cette page.', 'error');
        return;
      }
      const clip = {
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: (document.title || location.hostname).slice(0, 300),
        url: location.href.slice(0, 4000),
        content,
        selection: selectionOnly,
        createdAt: Date.now(),
      };
      const clips = await readClips();
      const next = [clip, ...clips.filter((item) => item?.id !== clip.id)];
      while (JSON.stringify(next).length > 1_500_000) next.pop();
      await saveClips(next);
      report(selectionOnly ? 'Sélection sauvegardée sur cet appareil.' : 'Contenu de la page sauvegardé sur cet appareil.', 'success');
    } catch (error) {
      console.error('[Orbit Web Clipper] capture impossible:', error);
      report(`Impossible de sauvegarder la capture : ${error.message || error}`, 'error');
    } finally {
      selectedButton.disabled = false;
      pageButton.disabled = false;
    }
  }

  // Ouverture depuis la barre d'Orbit (clic sur l'extension) : Orbit envoie
  // 'orbit:ctx-action' — le même protocole DOM que le menu contextuel — avec
  // l'identifiant déclaré dans `orbit.launcher` du manifeste. Plus de bouton
  // flottant : à plusieurs extensions, ils s'empilaient en bas à droite.
  document.documentElement.addEventListener('orbit:ctx-action', (e) => {
    if (e.detail?.id !== 'webClipper') return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      report('');
      panel.focus({ preventScroll: true });
    }
  });
  selectedButton.addEventListener('click', () => capture(true));
  pageButton.addEventListener('click', () => capture(false));
  libraryButton.addEventListener('click', () => {
    try {
      chrome.runtime.openOptionsPage();
    } catch (error) {
      console.error('[Orbit Web Clipper] ouverture de la bibliothèque impossible:', error);
      report('Impossible d’ouvrir la bibliothèque des captures.', 'error');
    }
  });
})();
