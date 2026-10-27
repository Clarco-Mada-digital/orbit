// Text Snippets — extension Chrome pour Orbit
// Tapez une abréviation précédée de « ; » (ex. ;email, ;addr, ;sig) dans un
// champ de texte ; elle est remplacée par le texte complet dès sa dernière
// lettre. Les séparateurs restent pris en charge pour les expansions classiques.
//
// Les snippets sont définis dans la page d'options (⚙️ de l'extension) et
// stockés dans chrome.storage.local — lus par ce content script.
//
// Par défaut : ;email, ;tel, ;addr, ;sig (signature mail). Totalement local,
// aucune requête réseau.
// ---------------------------------------------------------------------------

(() => {
  'use strict';

  // ── Snippets (stockage chrome.storage.local, défauts intégrés) ─────────────

  const DEFAULT_SNIPPETS = {
    email: 'prenom.nom@example.com',
    tel: '+33 6 12 34 56 78',
    addr: '12 rue des Lilas, 75011 Paris',
    sig: 'Cordialement,\nPrénom Nom\n—\nSociété · +33 6 12 34 56 78',
  };

  let snippets = { ...DEFAULT_SNIPPETS };
  let trigger = ';';
  let enabled = true;
  let allowPasswordFields = false;

  function loadConfig() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['snippets', 'trigger', 'enabled', 'allowPasswordFields'], (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.snippets && typeof res.snippets === 'object') {
          snippets = { ...DEFAULT_SNIPPETS, ...res.snippets };
        }
        if (typeof res.trigger === 'string' && res.trigger.length === 1) {
          trigger = res.trigger;
        }
        if (typeof res.enabled === 'boolean') enabled = res.enabled;
        if (typeof res.allowPasswordFields === 'boolean') allowPasswordFields = res.allowPasswordFields;
      });
      // Suivre les changements faits dans la page d'options sans recharger
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.snippets) snippets = { ...DEFAULT_SNIPPETS, ...(changes.snippets.newValue || {}) };
        if (changes.trigger && typeof changes.trigger.newValue === 'string' && changes.trigger.newValue.length === 1) {
          trigger = changes.trigger.newValue;
        }
        if (changes.enabled && typeof changes.enabled.newValue === 'boolean') enabled = changes.enabled.newValue;
        if (changes.allowPasswordFields && typeof changes.allowPasswordFields.newValue === 'boolean') {
          allowPasswordFields = changes.allowPasswordFields.newValue;
        }
      });
    } catch {
      /* ignore */
    }
  }
  loadConfig();

  // ── Détection des champs éditables ─────────────────────────────────────────

  function isEditable(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return !(el.readOnly || el.disabled);
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'password' && !allowPasswordFields) return false;
      if (!['text', 'email', 'tel', 'url', 'search', 'number', 'date', ''].includes(t) &&
          !(t === 'password' && allowPasswordFields)) return false;
      return !(el.readOnly || el.disabled);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function editableTarget(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (isEditable(node)) return node;
      if (node?.nodeType === Node.ELEMENT_NODE && typeof node.closest === 'function') {
        const editable = node.closest('[contenteditable="true"], [contenteditable=""]');
        if (isEditable(editable)) return editable;
      }
    }
    return null;
  }

  // ── Remplacement de texte (compatible React/Vue : setter natif + événements)

  function setValue(el, value) {
    try { el.focus(); } catch { /* ignore */ }
    try {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : null;
      if (proto) {
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
      } else if (el.isContentEditable) {
        el.textContent = value;
      }
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      /* ignore */
    }
  }

  // Remplace la plus longue chaîne qui se termine au caret par la valeur du
  // snippet. Renvoie true si un remplacement a eu lieu.
  function expandAtCaret(el, abbr) {
    try {
      const needle = trigger + abbr;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (start === null || start !== end) return false; // sélection active : on n'expand pas
        const before = el.value.slice(0, start);
        if (!before.toLowerCase().endsWith(needle.toLowerCase())) return false;
        const newPos = start - needle.length + snippets[abbr].length;
        const next = el.value.slice(0, start - needle.length) + snippets[abbr] + el.value.slice(start);
        setValue(el, next);
        try { el.setSelectionRange(newPos, newPos); } catch { /* ignore */ }
        return true;
      }
      if (el.isContentEditable) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
        const node = sel.anchorNode;
        if (!node || node.nodeType !== Node.TEXT_NODE) return false;
        const text = node.textContent;
        const caret = sel.anchorOffset;
        const before = text.slice(0, caret);
        if (!before.toLowerCase().endsWith(needle.toLowerCase())) return false;
        node.textContent = before.slice(0, caret - needle.length) + snippets[abbr] + text.slice(caret);
        try {
          const r = document.createRange();
          r.setStart(node, caret - needle.length + snippets[abbr].length);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        } catch { /* ignore */ }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  // ── Écouteur de frappe ─────────────────────────────────────────────────────

  // Les séparateurs terminent aussi une abréviation si l'expansion immédiate
  // n'a pas déjà eu lieu (par exemple après un collage).
  const SEPARATORS = /^[ \t\n\r.,;:!?()[\]{}"'«»\-–—/]$/;
  let expanding = false;

  function typedTextBeforeCaret(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === null || start !== end) return null;
      return el.value.slice(0, start);
    }
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
      const node = sel.anchorNode;
      if (!node || node.nodeType !== Node.TEXT_NODE) return null;
      return node.textContent.slice(0, sel.anchorOffset);
    }
    return null;
  }

  function matchingSnippet(before) {
    if (!before) return null;
    const lastTrigger = before.lastIndexOf(trigger);
    if (lastTrigger === -1) return null;
    const abbr = before.slice(lastTrigger + trigger.length);
    if (!abbr || abbr.length > 64) return null;
    return Object.keys(snippets).find((key) => key.toLowerCase() === abbr.toLowerCase()) || null;
  }

  // L'expansion à l'événement input couvre aussi les champs des modales et
  // composants contrôlés qui ne transmettent pas les événements clavier
  // habituels au document. Elle agit dès la dernière lettre de l'abréviation.
  document.addEventListener('input', (e) => {
    if (!enabled || expanding || e.isComposing) return;
    const el = editableTarget(e);
    if (!el) return;
    const match = matchingSnippet(typedTextBeforeCaret(el));
    if (!match) return;
    expanding = true;
    try {
      if (expandAtCaret(el, match)) flash(el);
    } finally {
      expanding = false;
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!enabled || expanding || e.isComposing || e.keyCode === 229) return;
    const el = editableTarget(e);
    if (!el) return;

    const isSep =
      e.key === ' ' ||
      e.key === 'Enter' ||
      e.key === 'Tab' ||
      (e.key.length === 1 && SEPARATORS.test(e.key));

    if (!isSep) return;

    // Récupérer le texte juste avant le caret
    let before = null;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === null || start !== end) return;
      before = el.value.slice(0, start);
    } else if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
      const node = sel.anchorNode;
      if (!node || node.nodeType !== Node.TEXT_NODE) return;
      before = node.textContent.slice(0, sel.anchorOffset);
    }
    if (!before) return;

    const match = matchingSnippet(before);
    if (!match) return;

    // On laisse le séparateur se saisir puis on remplace la partie abréviation
    // (le caret est déjà après le séparateur — on l'inclut dans le remplacement
    // pour le réduire à rien, sauf Entrée/Tab qui servent aussi à valider des
    // formulaires : dans ce cas on remplace avant que la touche n'agisse).
    if (e.key === 'Enter' || e.key === 'Tab') {
      // Empêcher l'action par défaut (soumission / navigation) : l'expansion
      // prime, comme dans les vrais expanders (TextExpander, espanso…).
      e.preventDefault();
      e.stopPropagation();
      if (expandAtCaret(el, match)) {
        flash(el);
      }
      return;
    }

    // Espace / ponctuation : on remplace l'abréviation SANS le séparateur.
    // Laisser la touche agir puis retirer l'abréviation ne marche pas fiable
    // (React re-renders) — on annule, on expand, puis on insère le séparateur.
    e.preventDefault();
    e.stopPropagation();
    if (expandAtCaret(el, match)) {
      flash(el);
      // Réinsérer le séparateur après le texte
      insertAfterCaret(el, e.key);
    } else {
      // Pas expandé : remettre le caractère tapé
      insertAfterCaret(el, e.key);
    }
  }, true);

  function insertAfterCaret(el, ch) {
    try {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const pos = el.selectionStart ?? el.value.length;
        const next = el.value.slice(0, pos) + ch + el.value.slice(pos);
        setValue(el, next);
        try { el.setSelectionRange(pos + ch.length, pos + ch.length); } catch { /* ignore */ }
      } else if (el.isContentEditable) {
        document.execCommand('insertText', false, ch);
      }
    } catch {
      /* ignore */
    }
  }

  // Petit flash visuel pour confirmer l'expansion
  function flash(el) {
    try {
      el.style.transition = 'background 0.6s ease';
      el.style.background = 'rgba(16,185,129,0.18)';
      setTimeout(() => { el.style.background = ''; }, 700);
    } catch { /* ignore */ }
  }

  // Infobulle d'aide une fois par page : « tapez ;email… » quand on focus un champ
  let hintShown = false;
  document.addEventListener(
    'focusin',
    (e) => {
      if (hintShown || !enabled || !isEditable(e.target)) return;
      hintShown = true;
      setTimeout(() => {
        try {
          const b = document.createElement('div');
          b.textContent = `⚡ Text Snippets : tapez ${trigger}email, ${trigger}tel, ${trigger}addr…`;
          Object.assign(b.style, {
            position: 'fixed',
            zIndex: '2147483647',
            left: '50%',
            bottom: '60px',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: '#f3f4f6',
            border: '1px solid #374151',
            borderRadius: '10px',
            padding: '8px 12px',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          });
          document.body.appendChild(b);
          setTimeout(() => b.remove(), 5000);
        } catch { /* ignore */ }
      }, 800);
    },
    true
  );

  console.log('[text-snippets] Text Snippets actif (tapez ' + trigger + 'email, ' + trigger + 'sig…)');
})();
