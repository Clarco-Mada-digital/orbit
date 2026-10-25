(() => {
  'use strict';

  const STORAGE_KEY = 'orbitWebClips';
  const list = document.getElementById('clip-list');
  const search = document.getElementById('search');
  const status = document.getElementById('status');
  let clips = [];

  function getClips() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(Array.isArray(result?.[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
      });
    });
  }

  function setClips(next) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  function markdownFor(clip) {
    const source = String(clip.url || '').replace(/[()\\]/g, '\\$&');
    const title = String(clip.title || 'Capture web').replace(/[\r\n]+/g, ' ').trim();
    const date = new Date(clip.createdAt).toLocaleString();
    const body = clip.selection
      ? String(clip.content || '').split('\n').map((line) => `> ${line}`).join('\n')
      : String(clip.content || '');
    return `# ${title}\n\n> Source : [${source}](${source})\n> Capturé le ${date}\n\n---\n\n${body}\n`;
  }

  function safeFilename(title) {
    const base = String(title || 'capture')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70);
    return `${base || 'capture'}.md`;
  }

  function downloadMarkdown(content, filename) {
    const blobUrl = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }

  function button(label, action, className = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.className = className;
    element.addEventListener('click', action);
    return element;
  }

  function render() {
    list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = clips.filter((clip) =>
      [clip.title, clip.url, clip.content].some((value) =>
        String(value || '').toLocaleLowerCase().includes(query)
      )
    );

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = clips.length
        ? 'Aucune capture ne correspond à cette recherche.'
        : 'Aucune capture pour le moment. Utilisez le bouton du Web Clipper dans une page.';
      list.appendChild(empty);
      return;
    }

    for (const clip of filtered) {
      const card = document.createElement('article');
      const heading = document.createElement('div');
      heading.className = 'clip-head';
      const details = document.createElement('div');
      const title = document.createElement('h2');
      title.textContent = clip.title || 'Capture web';
      const url = document.createElement('a');
      url.className = 'clip-url';
      url.href = clip.url;
      url.target = '_blank';
      url.rel = 'noopener noreferrer';
      url.textContent = clip.url;
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = clip.selection ? 'Sélection' : 'Page';
      details.append(title, url, kind);
      const time = document.createElement('time');
      time.dateTime = new Date(clip.createdAt).toISOString();
      time.textContent = new Date(clip.createdAt).toLocaleString();
      heading.append(details, time);

      const preview = document.createElement('pre');
      preview.textContent = clip.content || '';
      const actions = document.createElement('div');
      actions.className = 'clip-actions';
      actions.append(
        button('Exporter .md', () => downloadMarkdown(markdownFor(clip), safeFilename(clip.title)), 'primary'),
        button('Supprimer', async () => {
          try {
            const next = clips.filter((item) => item.id !== clip.id);
            await setClips(next);
            clips = next;
            status.textContent = 'Capture supprimée.';
            render();
          } catch (error) {
            status.textContent = `Suppression impossible : ${error.message}`;
          }
        }, 'danger')
      );
      card.append(heading, preview, actions);
      list.appendChild(card);
    }
  }

  async function load() {
    try {
      clips = (await getClips())
        .filter((clip) =>
          clip &&
          typeof clip.id === 'string' &&
          typeof clip.content === 'string' &&
          Number.isFinite(Number(clip.createdAt)) &&
          /^https?:\/\//i.test(clip.url || '')
        )
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
      status.textContent = `${clips.length} capture${clips.length === 1 ? '' : 's'}`;
      render();
    } catch (error) {
      status.textContent = `Lecture des captures impossible : ${error.message}`;
    }
  }

  search.addEventListener('input', render);
  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('export-all').addEventListener('click', () => {
    if (!clips.length) {
      status.textContent = 'Aucune capture à exporter.';
      return;
    }
    const content = clips.map(markdownFor).join('\n---\n\n');
    downloadMarkdown(content, 'orbit-captures.md');
    status.textContent = 'Toutes les captures ont été exportées.';
  });
  document.getElementById('clear-all').addEventListener('click', async () => {
    if (!clips.length || !window.confirm(`Supprimer les ${clips.length} capture(s) ? Cette action est définitive.`)) return;
    try {
      await setClips([]);
      clips = [];
      status.textContent = 'Toutes les captures ont été supprimées.';
      render();
    } catch (error) {
      status.textContent = `Suppression impossible : ${error.message}`;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) load();
  });
  load();
})();
