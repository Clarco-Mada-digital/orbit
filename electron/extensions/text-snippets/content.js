// Text Snippets — extension Chrome pour Orbit
//
// Tapez une abréviation précédée de « ; » (ex. ;email, ;addr, ;sig) puis une
// TOUCHE DE FIN : Tab, Entrée, espace ou ponctuation. L'abréviation est alors
// remplacée par le texte complet. Rien ne se déclenche pendant la frappe.
//
// Pourquoi pas d'expansion immédiate : avec deux abréviations qui commencent
// pareil (« tel » et « telpro »), celle qui est reconnue à la dernière lettre
// gagnait toujours — « tel » remplaçait le texte avant qu'on ait pu finir de
// taper « telpro ». En attendant Tab (ou un séparateur), c'est la chaîne
// complète avant le caret qui est comparée : la plus longue gagne, jamais
// l'ambiguîté.
//
// Champs protégés : un champ de mot de passe (ou qui s'annonce comme tel) est
// ignoré par défaut — les snippets iraient s'y écrire en clair. Les champs
// email / identifiant restent, eux, parfaitement utilisables.
//
// Les snippets sont définis dans la page d'options (⚙️ de l'extension) et
// stockés dans chrome.storage.local — lus par ce content script. Ils survivent
// aux mises à jour de l'extension (Orbit la réinstalle dans un dossier stable,
// donc avec le même ID).
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

  // Un champ de mot de passe au sens large : type=password, mais aussi les
  // champs tapés en « text » que les sites nomment password, pwd,
  // mot_de_passe, confirme_mot_de_passe, new-password… Un champ dont le TYPE est
  // email / tel / url / search n'est jamais traité comme un mot de passe, même
  // si son nom contient « confirm » (ex. « confirm_email »).
  const PASSWORD_HINTS = /(pass(word)?|pwd|mot.?de.?passe)/i;
  const EXPLICIT_TYPES = ['email', 'tel', 'url', 'search', 'number', 'date'];

  function isPasswordLike(el) {
    try {
      const tag = (el.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') return false;
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'password') return true;
      if (EXPLICIT_TYPES.includes(type)) return false;
      if (tag === 'textarea') return false;
      const hints = ['name', 'id', 'autocomplete', 'aria-label', 'placeholder']
        .map((attr) => el.getAttribute(attr) || '')
        .join(' ');
      return PASSWORD_HINTS.test(hints);
    } catch {
      return false;
    }
  }

  function isEditable(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') {
      if (isPasswordLike(el) && !allowPasswordFields) return false;
      return !(el.readOnly || el.disabled);
    }
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      const supported = ['text', 'email', 'tel', 'url', 'search', 'number', 'date', 'password', ''];
      if (!supported.includes(t)) return false;
      if (isPasswordLike(el) && !allowPasswordFields) return false;
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

  // Une abréviation se termine par une touche de fin : Tab, Entrée, espace ou
  // ponctuation. C'est le seul déclencheur — d'où l'absence totale d'expansion
  // pendant la frappe.
  const SEPARATORS = /^[ \t\n\r.,;:!?()[\]{}"'«»\-–—/]$/;

  function matchingSnippet(before) {
    if (!before) return null;
    const lastTrigger = before.lastIndexOf(trigger);
    if (lastTrigger === -1) return null;
    const abbr = before.slice(lastTrigger + trigger.length);
    if (!abbr || abbr.length > 64) return null;
    return Object.keys(snippets).find((key) => key.toLowerCase() === abbr.toLowerCase()) || null;
  }

  // Aucune expansion pendant la frappe : c'est la touche de fin (Tab, Entrée,
  // espace, ponctuation) qui déclenche, et seulement si la chaîne complète
  // avant le caret correspond à une abréviation connue.
  document.addEventListener('keydown', (e) => {
    if (!enabled || e.isComposing || e.keyCode === 229) return;
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

    // Entrée et Tab servent aussi à valider des formulaires : on remplace
    // AVANT que la touche n'agisse, et on empêche son action par défaut.
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
    if (expandAtCaret(el, match)) flash(el);
    // Le séparateur est réinséré après le texte (ou après l'abréviation
    // laissée telle quelle si le remplacement n'a pas pu se faire).
    insertAfterCaret(el, e.key);
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
          b.textContent = `⚡ Text Snippets : tapez ${trigger}email, ${trigger}tel, ${trigger}addr… puis Tab`;
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

  console.log('[text-snippets] Text Snippets actif (tapez ' + trigger + 'email puis Tab…)');
})();
