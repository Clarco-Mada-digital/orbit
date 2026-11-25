// Sticky Notes — extension Chrome pour Orbit
// Ouvert depuis la barre d'Orbit (clic sur l'extension) ou Alt+N : un
// bloc-notes collé au DOMAINE courant
// (mail.google.com → note dédiée). Les notes sont stockées dans
// chrome.storage.local (clé = domaine) et se rouvrent automatiquement à
// chaque visite du site si elles étaient ouvertes.
//
// Options (⚙️) : opacité, taille, position, ouverture automatique, export.
// Totalement local, aucune requête réseau.
// ---------------------------------------------------------------------------

(() => {
  'use strict';

  if (window.top !== window.self) return; // iframe : pas de notes (une seule par page)

  // ── État & stockage ────────────────────────────────────────────────────────

  const DEFAULTS = {
    opacity: 0.95,      // 0.5 → 1
    width: 300,         // px
    height: 260,        // px
    autoOpen: true,     // rouvrir au retour sur le site
    fontSize: 13,       // px
  };

  let cfg = { ...DEFAULTS };
  let domain = 'unknown';
  let noteText = '';
  let openState = false;

  try {
    domain = location.hostname || 'unknown';
  } catch { /* ignore */ }

  const noteKey = `notes:${domain}`;

  function loadAll() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['config', noteKey, 'openTabs'], (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.config) cfg = { ...DEFAULTS, ...res.config };
        if (res && typeof res[noteKey] === 'string') noteText = res[noteKey];
        if (res && res.openTabs && typeof res.openTabs === 'object') {
          openState = !!res.openTabs[domain];
        }
        applyCfg();
        if (openState && cfg.autoOpen) openPanel();
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.config) {
          cfg = { ...DEFAULTS, ...(changes.config.newValue || {}) };
          applyCfg();
        }
        if (changes[noteKey] && document.activeElement !== textarea) {
          noteText = changes[noteKey].newValue || '';
          if (textarea) textarea.value = noteText;
        }
      });
    } catch { /* ignore */ }
  }

  function saveNote() {
    try {
      chrome.storage.local.set({ [noteKey]: noteText });
    } catch { /* ignore */ }
  }

  function saveOpenState() {
    try {
      chrome.storage.local.get(['openTabs'], (res) => {
        const tabs = (res && res.openTabs) || {};
        if (openState) tabs[domain] = true;
        else delete tabs[domain];
        chrome.storage.local.set({ openTabs: tabs });
      });
    } catch { /* ignore */ }
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  let panel = null;
  let textarea = null;
  let statusEl = null;
  let statusTimer = null;

  function applyCfg() {
    if (panel) {
      panel.style.opacity = String(cfg.opacity);
      panel.style.width = cfg.width + 'px';
      panel.style.height = cfg.height + 'px';
    }
    if (textarea) textarea.style.fontSize = cfg.fontSize + 'px';
  }

  function openPanel() {
    if (panel) return;

    panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '2147483646',
      right: '16px',
      bottom: '16px',
      width: cfg.width + 'px',
      height: cfg.height + 'px',
      background: '#fef9c3', // jaune post-it
      color: '#713f12',
      borderRadius: '12px',
      boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      opacity: String(cfg.opacity),
      border: '1px solid #fbbf24',
    });

    // Barre de titre (glisser pour déplacer) + bouton de fermeture : sans
    // lui, il fallait repasser par le menu des extensions pour fermer.
    const title = document.createElement('div');
    Object.assign(title.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 4px 4px 10px',
      fontSize: '12px',
      fontWeight: '700',
      background: '#fde68a',
      cursor: 'move',
      userSelect: 'none',
      flexShrink: '0',
    });
    const titleText = document.createElement('span');
    titleText.textContent = `📝 ${domain}`;
    Object.assign(titleText.style, {
      flex: '1',
      minWidth: '0',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Fermer (Échap)';
    closeBtn.setAttribute('aria-label', 'Fermer');
    Object.assign(closeBtn.style, {
      border: 'none',
      background: 'transparent',
      color: '#92400e',
      cursor: 'pointer',
      fontSize: '13px',
      lineHeight: '1',
      padding: '4px 7px',
      borderRadius: '6px',
      flexShrink: '0',
    });
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = '#fcd34d'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; });
    // Le clic sur ✕ ne doit pas démarrer un déplacement du panneau.
    closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', closePanel);
    title.append(titleText, closeBtn);
    panel.appendChild(title);

    // Zone de texte
    textarea = document.createElement('textarea');
    textarea.value = noteText;
    textarea.placeholder = 'Notes pour ce site… (ex. identifiants de test, TODO, rappels)';
    Object.assign(textarea.style, {
      flex: '1',
      border: 'none',
      outline: 'none',
      resize: 'none',
      padding: '10px',
      background: 'transparent',
      color: '#713f12',
      fontSize: cfg.fontSize + 'px',
      fontFamily: 'inherit',
      lineHeight: '1.5',
    });
    let saveTimer = null;
    textarea.addEventListener('input', () => {
      noteText = textarea.value;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveNote();
        flashStatus('enregistré');
      }, 500);
    });
    // Échap dans la note la ferme (elle est enregistrée au passage).
    textarea.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    });
    panel.appendChild(textarea);

    // Pied : statut + effacer
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 10px',
      borderTop: '1px solid #fbbf24',
      fontSize: '11px',
      flexShrink: '0',
    });
    statusEl = document.createElement('span');
    statusEl.textContent = 'local · ce site uniquement';
    statusEl.style.opacity = '0.7';
    footer.appendChild(statusEl);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Effacer';
    Object.assign(clearBtn.style, {
      border: 'none',
      background: 'transparent',
      color: '#b45309',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: '600',
      padding: '2px 6px',
    });
    clearBtn.addEventListener('click', () => {
      if (!confirm('Effacer la note de ce site ?')) return;
      noteText = '';
      textarea.value = '';
      saveNote();
      flashStatus('effacée');
    });
    footer.appendChild(clearBtn);
    panel.appendChild(footer);

    document.body.appendChild(panel);
    openState = true;
    saveOpenState();

    // Drag par la barre de titre
    makeDraggable(panel, title);
  }

  function closePanel() {
    if (!panel) return;
    saveNote();
    panel.remove();
    panel = null;
    textarea = null;
    openState = false;
    saveOpenState();
  }

  function flashStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (statusEl) statusEl.textContent = 'local · ce site uniquement';
    }, 1500);
  }

  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    const down = (e) => {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = ox + 'px';
      el.style.top = oy + 'px';
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      el.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
      el.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
    };
    const up = () => {
      dragging = false;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    handle.addEventListener('mousedown', down);
  }

  // Ouverture depuis la barre d'Orbit (clic sur l'extension) : Orbit envoie
  // 'orbit:ctx-action' — le même protocole DOM que le menu contextuel — avec
  // l'identifiant déclaré dans `orbit.launcher` du manifeste. Plus de bouton
  // flottant : à plusieurs extensions, ils s'empilaient en bas à droite.
  document.documentElement.addEventListener('orbit:ctx-action', (e) => {
    if (e.detail?.id !== 'stickyNotes') return;
    if (panel) closePanel();
    else {
      openPanel();
      textarea?.focus();
    }
  });

  // Raccourci clavier : Alt+N
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      e.stopPropagation();
      if (panel) closePanel();
      else {
        openPanel();
        textarea?.focus();
      }
    }
  });

  loadAll();
  console.log('[sticky-notes] Sticky Notes actif (barre d’Orbit, Alt+N)');
})();
