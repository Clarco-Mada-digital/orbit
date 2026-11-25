// Color Picker — extension Chrome pour Orbit
// Pipette de couleur intégrée à la page, lancée depuis la barre d'Orbit (clic
// sur l'extension) ou Alt+C : survolez un élément pour voir sa couleur,
// cliquez pour la copier. Un bandeau reste affiché pendant la pipette, avec
// « Quitter » (ou Échap).
// N'utilise PAS le menu contextuel (ne le remplace ni ne le complète).
//
// Compatibilité Orbit : content script seul, pas de background script.

(() => {
  'use strict';

  // ── Utilitaires de conversion de couleur ──────────────────────────────────

  function rgbToHex(r, g, b) {
    const toHex = (v) => {
      const h = Math.round(v).toString(16);
      return h.length === 1 ? '0' + h : h;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function parseCssColor(cssColor) {
    if (!cssColor || cssColor === 'transparent' || cssColor === 'rgba(0, 0, 0, 0)') {
      return null;
    }
    const rgbMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return rgbToHex(rgbMatch[1], rgbMatch[2], rgbMatch[3]);
    }
    // Couleur nommée (red, blue…) : on la résout via un élément temporaire
    const temp = document.createElement('div');
    temp.style.color = cssColor;
    document.body.appendChild(temp);
    const computed = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);
    const rgbaMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbaMatch) {
      return rgbToHex(rgbaMatch[1], rgbaMatch[2], rgbaMatch[3]);
    }
    return null;
  }

  // Trouve la couleur la plus parlante d'un élément : fond d'abord, sinon texte.
  function colorOfElement(el) {
    if (!el || el.nodeType !== 1) return null;
    try {
      const styles = window.getComputedStyle(el);
      return (
        parseCssColor(styles.backgroundColor) ||
        parseCssColor(styles.color) ||
        parseCssColor(styles.borderColor) ||
        null
      );
    } catch {
      return null;
    }
  }

  // Copie au presse-papiers (avec repli)
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(textarea);
  }

  function showToast(msg) {
    const existing = document.getElementById('__orbit_color_toast__');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.id = '__orbit_color_toast__';
    box.textContent = msg;
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: '2147483647',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      maxWidth: 'min(560px, 90vw)',
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
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2500);
  }

  let picking = false;
  let preview = null; // infobulle de couleur qui suit la souris
  let banner = null; // consigne + « Quitter », visible pendant toute la pipette

  // ── Mode pipette ───────────────────────────────────────────────────────────

  function togglePick() {
    if (picking) endPick();
    else startPick();
  }

  function startPick() {
    picking = true;
    document.documentElement.style.cursor = 'crosshair';
    preview = document.createElement('div');
    Object.assign(preview.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      background: '#111827',
      color: '#f3f4f6',
      border: '1px solid #374151',
      borderRadius: '8px',
      padding: '6px 10px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
      display: 'none',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(preview);
    banner = createBanner();
    document.body.appendChild(banner);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', onPick, true);
    document.addEventListener('keydown', onKey, true);
  }

  // Bandeau persistant : un toast de quelques secondes laissait l'utilisateur
  // en mode pipette sans savoir comment en sortir.
  function createBanner() {
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: '2147483647',
      left: '50%',
      top: '12px',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      maxWidth: 'min(560px, 90vw)',
      background: '#111827',
      color: '#f3f4f6',
      border: '1px solid #374151',
      borderRadius: '10px',
      padding: '6px 6px 6px 12px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      cursor: 'default',
    });
    const text = document.createElement('span');
    text.textContent = '🎨 Cliquez sur un élément pour copier sa couleur';
    const quit = document.createElement('button');
    quit.type = 'button';
    quit.textContent = 'Quitter (Échap)';
    Object.assign(quit.style, {
      border: '1px solid #4b5563',
      borderRadius: '7px',
      background: '#1f2937',
      color: '#f3f4f6',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: '12px',
      padding: '4px 10px',
    });
    box.append(text, quit);
    return box;
  }

  function endPick() {
    if (!picking) return;
    picking = false;
    document.documentElement.style.cursor = '';
    if (preview) {
      preview.remove();
      preview = null;
    }
    if (banner) {
      banner.remove();
      banner = null;
    }
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mousedown', onPick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onMove(e) {
    if (!picking || !preview) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const color = el && !banner?.contains(el) ? colorOfElement(el) : null;
    if (!color) {
      preview.style.display = 'none';
      return;
    }
    preview.textContent = color;
    preview.style.display = 'block';
    let left = e.clientX + 14;
    let top = e.clientY + 14;
    if (left + 120 > window.innerWidth) left = e.clientX - 130;
    if (top + 30 > window.innerHeight) top = e.clientY - 30;
    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
  }

  function onPick(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    // Clic sur le bandeau (« Quitter » ou ailleurs) : on sort sans copier.
    if (el && banner?.contains(el)) {
      endPick();
      return;
    }
    const color = el ? colorOfElement(el) : null;
    endPick();
    if (color) {
      copyToClipboard(color);
      showToast(`🎨 Couleur ${color} copiée dans le presse-papiers`);
    } else {
      showToast('Aucune couleur détectée sur cet élément');
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endPick();
    }
  }

  // ── Raccourci clavier : Alt+C active/désactive la pipette ─────────────────

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      e.stopPropagation();
      togglePick();
    }
  });

  // Ouverture depuis la barre d'Orbit (clic sur l'extension) : Orbit envoie
  // 'orbit:ctx-action' — le même protocole DOM que le menu contextuel — avec
  // l'identifiant déclaré dans `orbit.launcher` du manifeste. Plus de bouton
  // flottant : à plusieurs extensions, ils s'empilaient en bas à droite.
  if (window.self === window.top) {
    document.documentElement.addEventListener('orbit:ctx-action', (e) => {
      if (e.detail?.id === 'colorPicker') togglePick();
    });
  }

  console.log('[color-picker] Color Picker activé (barre d’Orbit, Alt+C)');
})();