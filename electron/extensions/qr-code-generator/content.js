// QR Code Generator — extension Chrome pour Orbit
// Bouton flottant ⊞ + Alt+Q : ouvre un panneau avec le QR code de la page
// (ou de n'importe quel texte saisi). Copie PNG / téléchargement.
// Intègre aussi une entrée « ⊞ QR code de la page » au menu contextuel d'Orbit
// (protocole DOM data-orbit-ctx — s'AJOUTE au menu, ne le remplace pas).
// 100 % local : l'encodeur (qrcode.js) ne fait aucune requête réseau.
// ---------------------------------------------------------------------------

(() => {
  'use strict';

  if (window.top !== window.self) return; // iframes : pas de bouton

  // ── Config (⚙️ page d'options) ─────────────────────────────────────────────

  const DEFAULTS = { scale: 8, dark: '#111827', light: '#ffffff', showFab: false };
  let cfg = { ...DEFAULTS };

  function loadConfig() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['config'], (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.config) cfg = { ...DEFAULTS, ...res.config };
        if (fab) fab.style.display = cfg.showFab ? 'flex' : 'none';
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.config) {
          cfg = { ...DEFAULTS, ...(changes.config.newValue || {}) };
          if (fab) fab.style.display = cfg.showFab ? 'flex' : 'none';
        }
      });
    } catch { /* ignore */ }
  }

  // ── Panneau QR ─────────────────────────────────────────────────────────────

  let panel = null;

  function closePanel() {
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  function openPanel(initialText) {
    closePanel();

    panel = document.createElement('div');
    Object.assign(panel.style, {
      position: 'fixed',
      zIndex: '2147483647',
      top: '14px',
      right: '14px',
      width: '300px',
      background: '#111827',
      border: '1px solid #374151',
      borderRadius: '12px',
      boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#f3f4f6',
      padding: '14px',
      boxSizing: 'border-box',
    });

    const head = document.createElement('div');
    head.textContent = '⊞ QR Code';
    Object.assign(head.style, { fontSize: '13px', fontWeight: '700', marginBottom: '10px' });
    panel.appendChild(head);

    // Zone de texte éditable
    const input = document.createElement('textarea');
    input.value = initialText || location.href;
    input.rows = 2;
    input.spellcheck = false;
    Object.assign(input.style, {
      width: '100%',
      boxSizing: 'border-box',
      background: '#1f2937',
      border: '1px solid #374151',
      borderRadius: '8px',
      padding: '8px 10px',
      color: '#f3f4f6',
      fontSize: '12px',
      fontFamily: 'ui-monospace, monospace',
      resize: 'vertical',
      marginBottom: '10px',
      outline: 'none',
    });
    panel.appendChild(input);

    // Canvas QR
    const canvasWrap = document.createElement('div');
    Object.assign(canvasWrap.style, {
      display: 'flex',
      justifyContent: 'center',
      marginBottom: '10px',
    });
    const canvas = document.createElement('canvas');
    canvas.style.borderRadius = '8px';
    canvas.style.maxWidth = '100%';
    canvasWrap.appendChild(canvas);
    panel.appendChild(canvasWrap);

    const errEl = document.createElement('div');
    Object.assign(errEl.style, {
      color: '#f87171',
      fontSize: '12px',
      marginBottom: '8px',
      display: 'none',
    });
    panel.appendChild(errEl);

    function redraw() {
      const text = input.value.trim();
      errEl.style.display = 'none';
      if (!text) {
        canvas.width = 0;
        return;
      }
      try {
        const qr = window.OrbitQR.generate(text);
        qr.toCanvas(canvas, cfg.scale, cfg.dark, cfg.light);
        canvas.style.width = 'min(100%, 240px)';
        canvas.style.height = 'auto';
      } catch (e) {
        canvas.width = 0;
        errEl.textContent = e && e.message ? e.message : 'Erreur de génération';
        errEl.style.display = 'block';
      }
    }
    input.addEventListener('input', redraw);
    redraw();

    // Boutons d'action
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '6px' });

    const mkBtn = (label, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        flex: '1',
        padding: '7px 10px',
        borderRadius: '8px',
        border: primary ? 'none' : '1px solid #374151',
        background: primary ? '#6366f1' : 'transparent',
        color: primary ? '#fff' : '#9ca3af',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
      });
      return b;
    };

    const copyBtn = mkBtn('Copier l\u2019image', true);
    copyBtn.addEventListener('click', async () => {
      if (!canvas.width) return;
      try {
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('⊞ QR code copié dans le presse-papiers');
      } catch {
        // Repli : téléchargement si le presse-papiers image est refusé
        download();
        toast('Copie refusée — QR code téléchargé à la place');
      }
    });

    const dlBtn = mkBtn('Télécharger PNG');
    dlBtn.addEventListener('click', download);

    const closeBtn = mkBtn('Fermer');
    closeBtn.addEventListener('click', closePanel);

    function download() {
      if (!canvas.width) return;
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'qrcode.png';
      a.click();
      toast('⊞ QR code téléchargé');
    }

    row.appendChild(copyBtn);
    row.appendChild(dlBtn);
    row.appendChild(closeBtn);
    panel.appendChild(row);

    // Échap pour fermer
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
      }
    });

    document.body.appendChild(panel);
    input.focus();
    input.select();
  }

  function toast(msg) {
    const b = document.createElement('div');
    b.textContent = msg;
    Object.assign(b.style, {
      position: 'fixed',
      zIndex: '2147483647',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      background: '#111827',
      color: '#f3f4f6',
      border: '1px solid #374151',
      borderRadius: '10px',
      padding: '10px 14px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
    });
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 2500);
  }

  // ── Bouton flottant ⊞ ──────────────────────────────────────────────────────

  let fab = null;

  function createFab() {
    if (fab) return;
    fab = document.createElement('button');
    fab.textContent = '⊞';
    fab.title = 'QR Code de cette page (Alt+Q)';
    Object.assign(fab.style, {
      position: 'fixed',
      zIndex: '2147483644',
      right: '16px',
      bottom: '16px',
      width: '40px',
      height: '40px',
      padding: '0',
      border: 'none',
      borderRadius: '12px',
      background: '#0ea5e9',
      cursor: 'pointer',
      fontSize: '22px',
      lineHeight: '40px',
      textAlign: 'center',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      display: cfg.showFab ? 'flex' : 'none',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'transform 0.15s',
      color: '#fff',
      fontWeight: '700',
    });
    fab.addEventListener('mouseenter', () => (fab.style.transform = 'scale(1.08)'));
    fab.addEventListener('mouseleave', () => (fab.style.transform = 'scale(1)'));
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (panel) closePanel();
      else openPanel(location.href);
    });
    document.body.appendChild(fab);
  }

  // ── Menu contextuel d'Orbit (protocole DOM — s'ajoute, ne remplace pas) ────

  const CTX_ID = 'qrPage';
  function registerCtx() {
    try {
      // Lire les items existants (autres extensions) et ajouter le nôtre
      let items = [];
      try {
        items = JSON.parse(document.documentElement.getAttribute('data-orbit-ctx') || '[]');
        if (!Array.isArray(items)) items = [];
      } catch { items = []; }
      if (!items.some((i) => i && i.id === CTX_ID)) {
        items.push({ id: CTX_ID, label: '⊞ QR code de la page' });
      }
      document.documentElement.setAttribute('data-orbit-ctx', JSON.stringify(items));
    } catch { /* ignore */ }
  }
  registerCtx();
  document.documentElement.addEventListener('orbit:ctx-refresh', registerCtx);
  document.documentElement.addEventListener('orbit:ctx-action', (e) => {
    try {
      if (e.detail && e.detail.id === CTX_ID) openPanel(location.href);
    } catch { /* ignore */ }
  });

  // Ouverture depuis la barre d'Orbit (clic sur l'extension) : Orbit envoie
  // 'orbit:ctx-action' — le même protocole DOM que le menu contextuel — avec
  // l'identifiant déclaré dans `orbit.launcher` du manifeste. Le bouton
  // flottant devient une option (désactivée) : à plusieurs extensions, ils s'empilaient en bas à droite.
  // L'identifiant est celui du menu contextuel (qrPage), déjà écouté ci-dessus.

  // ── Raccourci clavier : Alt+Q ──────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'q' || e.key === 'Q')) {
      e.preventDefault();
      e.stopPropagation();
      if (panel) closePanel();
      else openPanel(location.href);
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────

  loadConfig();
  createFab();
  console.log('[qr-generator] QR Code Generator actif (bouton ⊞, Alt+Q)');
})();
