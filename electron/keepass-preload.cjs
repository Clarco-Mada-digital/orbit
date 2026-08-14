// ---------------------------------------------------------------------------
// Preload injecté dans chaque <webview> (page d'app embarquée).
//
// Remplissage automatique des identifiants depuis KeePassXC :
//   - au FOCUS sur un champ de connexion → remplissage automatique
//   - si PLUSIEURS comptes existent pour le site → liste de choix affichée à
//     côté du champ (comme les gestionnaires de mots de passe) : un clic
//     remplit le compte choisi — plus jamais de remplissage « au hasard »
//   - pages à un champ à la fois (ex. Gmail : identifiant puis mot de passe) :
//     le compte choisi est mémorisé (sessionStorage) et le mot de passe se
//     remplit automatiquement sur l'étape suivante
//   - un bouton « 🔑 » apparaît à côté du champ → clic = remplir / choisir
//   - si KeePassXC n'a aucun identifiant pour ce site, un petit badge
//     discret explique pourquoi (au lieu de « rien ne se passe »)
//
// Notes de sécurité : ce script tourne dans le monde isolé du webview
// (contextIsolation) — les scripts de la page ne peuvent PAS l'appeler ni
// accéder à ipcRenderer. Il ne demande que les identifiants de l'URL réelle
// de la page (window.location.href), jamais une URL arbitraire.
// ---------------------------------------------------------------------------
const { ipcRenderer } = require('electron');

const PASSWORD_SELECTOR = 'input[type="password"]';
// Mémorise le compte choisi (page identifiant → page mot de passe, Gmail…)
const STORAGE_KEY = '__orbit_kp_selected_login__';

// Canal de diagnostic : les logs remontent au main process (visibles dans le
// terminal de `npm run electron:dev`) — utiles pour vérifier que le preload
// tourne bien dans chaque webview.
const dbg = (...args) => {
  try {
    ipcRenderer.send('keepass:dbg', args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a).slice(0, 150))).join(' '));
  } catch { /* ignore */ }
};
dbg('preload chargé dans ' + window.location.href.slice(0, 80));

let busy = false;
let currentFields = null; // { user, pass } du formulaire focalisé
let keyBtn = null;
let hintEl = null;
let hintTimer = null;
let btnTimer = null;
let pickerEl = null;
let pickerOpenedAt = 0; // anti-course : clic qui a ouvert le sélecteur

// ---------------------------------------------------------------------------
// Détection des champs
// ---------------------------------------------------------------------------
function findFields() {
  const pass = document.querySelector(PASSWORD_SELECTOR);
  const inputs = Array.from(document.querySelectorAll('input'));
  const visible = (el) =>
    el && !el.disabled && el.type !== 'hidden' && el.offsetParent !== null;

  const hints = (el) =>
    `${el.name || ''} ${el.id || ''} ${el.autocomplete || ''} ${el.getAttribute('placeholder') || ''}`;
  const loginHint = /(user|login|mail|account|identifier|email)/i;

  let user = null;
  if (pass) {
    // Formulaire classique : identifiant + mot de passe
    user =
      inputs.find(
        (i) =>
          visible(i) &&
          i !== pass &&
          /^(text|email|tel)$/.test(i.type || '') &&
          loginHint.test(hints(i))
      ) ||
      inputs.find(
        (i) =>
          visible(i) &&
          i !== pass &&
          (i.type === 'text' || i.type === 'email') &&
          i.autocomplete === 'username'
      ) ||
      inputs.find((i) => visible(i) && i !== pass && (i.type === 'text' || i.type === 'email'));
  } else {
    // Pas encore de champ mot de passe (ex. Gmail : identifiant d'abord) :
    // on ne cible que des champs « identifiant » explicites pour éviter de
    // s'accrocher à n'importe quel champ email de la page (ex. champ « À »).
    user =
      inputs.find((i) => visible(i) && i.type === 'email' && loginHint.test(hints(i))) ||
      inputs.find(
        (i) =>
          visible(i) &&
          (i.type === 'email' || i.type === 'text') &&
          (i.autocomplete === 'username' || i.autocomplete === 'email')
      );
  }

  return user || pass ? { user, pass } : null;
}

// ---------------------------------------------------------------------------
// Remplissage
// ---------------------------------------------------------------------------
function setValue(el, value) {
  if (!el) return;
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function highlight(el) {
  if (!el) return;
  const prev = el.style.outline;
  el.style.outline = '2px solid #10b981';
  el.style.outlineOffset = '1px';
  setTimeout(() => {
    el.style.outline = prev;
  }, 1800);
}

// Remplit le formulaire avec le compte choisi et mémorise le choix (pour les
// pages à plusieurs étapes comme Gmail).
function fillEntry(fields, entry) {
  if (fields.user && entry.login) {
    setValue(fields.user, entry.login);
    highlight(fields.user);
  }
  if (fields.pass && entry.password) {
    setValue(fields.pass, entry.password);
    highlight(fields.pass);
  }
  if (entry.login) {
    try {
      sessionStorage.setItem(STORAGE_KEY, entry.login);
    } catch { /* ignore */ }
  }
  removeKeyBtn();
  removePicker();
}

function getStoredLogin() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Indicateurs visuels (bouton 🔑 + badge d'info + sélecteur de compte)
// ---------------------------------------------------------------------------
function removeKeyBtn() {
  if (keyBtn) {
    keyBtn.remove();
    keyBtn = null;
  }
  clearTimeout(btnTimer);
}

function showKeyBtn(anchor) {
  removeKeyBtn();
  if (!anchor) return;
  keyBtn = document.createElement('button');
  keyBtn.textContent = '🔑';
  keyBtn.title = 'Remplir avec KeePassXC';
  Object.assign(keyBtn.style, {
    position: 'fixed',
    zIndex: '2147483647',
    width: '26px',
    height: '26px',
    padding: '0',
    border: 'none',
    borderRadius: '7px',
    background: '#6366f1',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: '26px',
    textAlign: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    display: 'block',
  });
  keyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    doFill(currentFields, true);
  });
  document.body.appendChild(keyBtn);
  positionKeyBtn(anchor);
  // Disparaît au bout d'un moment si l'utilisateur ne fait rien
  btnTimer = setTimeout(removeKeyBtn, 8000);
  return keyBtn;
}

function positionKeyBtn(anchor) {
  if (!keyBtn || !anchor) return;
  try {
    const rect = anchor.getBoundingClientRect();
    let left = rect.right + 5;
    if (left + 30 > window.innerWidth) left = Math.max(4, rect.left - 31);
    const top = Math.max(4, rect.top + rect.height / 2 - 13);
    keyBtn.style.left = left + 'px';
    keyBtn.style.top = top + 'px';
  } catch {
    /* ignore */
  }
}

function showHint(message, anchorEl) {
  try {
    if (hintEl) hintEl.remove();
    hintEl = document.createElement('div');
    hintEl.textContent = '🔑 ' + message;
    Object.assign(hintEl.style, {
      position: 'fixed',
      zIndex: '2147483646',
      background: '#1f2937',
      color: '#f3f4f6',
      fontSize: '12px',
      fontFamily: 'system-ui, sans-serif',
      padding: '6px 10px',
      borderRadius: '6px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      maxWidth: '60vw',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    document.body.appendChild(hintEl);
    const rect = anchorEl ? anchorEl.getBoundingClientRect() : null;
    hintEl.style.left =
      (rect ? Math.max(4, Math.min(rect.left, window.innerWidth - hintEl.offsetWidth - 8)) : 8) + 'px';
    hintEl.style.top = (rect ? rect.bottom + 6 : 8) + 'px';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (hintEl) hintEl.remove();
      hintEl = null;
    }, 4500);
  } catch {
    /* jamais bloquant */
  }
}

// Sélecteur de compte : liste déroulante affichée près du champ quand
// plusieurs identifiants existent pour le site.
function showPicker(entries, fields, anchor) {
  removePicker();
  removeKeyBtn();
  if (!anchor || !entries || entries.length === 0) return;

  pickerEl = document.createElement('div');
  Object.assign(pickerEl.style, {
    position: 'fixed',
    zIndex: '2147483647',
    width: '260px',
    maxHeight: '320px',
    overflowY: 'auto',
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
    fontFamily: 'system-ui, sans-serif',
    padding: '4px',
  });

  const title = document.createElement('div');
  title.textContent = '🔑 Choisir un compte';
  Object.assign(title.style, {
    padding: '6px 10px 8px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#9ca3af',
    borderBottom: '1px solid #1f2937',
    marginBottom: '4px',
  });
  pickerEl.appendChild(title);

  entries.forEach((entry) => {
    const row = document.createElement('button');
    Object.assign(row.style, {
      display: 'block',
      width: '100%',
      textAlign: 'left',
      background: 'transparent',
      border: 'none',
      borderRadius: '8px',
      padding: '8px 10px',
      cursor: 'pointer',
      fontFamily: 'inherit',
    });
    row.addEventListener('mouseenter', () => {
      row.style.background = '#1f2937';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent';
    });
    const name = document.createElement('div');
    name.textContent = entry.name || entry.login || 'Compte';
    Object.assign(name.style, {
      fontSize: '13px',
      fontWeight: '600',
      color: '#f3f4f6',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    const login = document.createElement('div');
    login.textContent = entry.login || '';
    Object.assign(login.style, {
      fontSize: '11px',
      color: '#9ca3af',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    row.appendChild(name);
    row.appendChild(login);
    row.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fillEntry(fields, entry);
    });
    pickerEl.appendChild(row);
  });

  document.body.appendChild(pickerEl);

  const rect = anchor.getBoundingClientRect();
  const maxH = Math.min(320, window.innerHeight - rect.bottom - 16);
  pickerEl.style.maxHeight = Math.max(140, maxH) + 'px';
  let left = Math.max(4, Math.min(rect.left, window.innerWidth - 268));
  let top = rect.bottom + 6;
  if (top + 160 > window.innerHeight) top = Math.max(4, rect.top - 166);
  pickerEl.style.left = left + 'px';
  pickerEl.style.top = top + 'px';

  // Horodatage : les clics qui déclenchent l'ouverture (course mousedown/click)
  // arrivent APRÈS l'affichage du sélecteur et ne doivent pas le fermer.
  pickerOpenedAt = Date.now();

  // Fermeture : clic ailleurs (après la période de grâce) ou Échap
  const onDocClick = (e) => {
    if (!pickerEl) return;
    if (pickerEl.contains(e.target)) return;
    if (Date.now() - pickerOpenedAt < 400) return; // laisse le temps de cliquer
    removePicker();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') removePicker();
  };
  pickerEl._cleanup = () => {
    document.removeEventListener('click', onDocClick, { capture: true });
    document.removeEventListener('keydown', onKey, { capture: true });
  };
  setTimeout(() => {
    if (!pickerEl) return;
    document.addEventListener('click', onDocClick, { capture: true });
    document.addEventListener('keydown', onKey, { capture: true });
  }, 0);
}

function removePicker() {
  if (pickerEl) {
    if (typeof pickerEl._cleanup === 'function') pickerEl._cleanup();
    pickerEl.remove();
    pickerEl = null;
  }
}

// ---------------------------------------------------------------------------
// Logique de remplissage
// ---------------------------------------------------------------------------
async function doFill(fields, manual) {
  if (busy || !fields) return;
  busy = true;
  try {
    const res = await ipcRenderer.invoke('keepass:getLogins', {
      url: window.location.href,
    });
    dbg('focus sur champ login → getLogins:', res && res.success ? res.count + ' entrées' : JSON.stringify(res));

    if (res && res.success && res.entries && res.entries.length > 0) {
      const entries = res.entries;
      if (entries.length === 1) {
        // Un seul compte → remplissage direct
        fillEntry(fields, entries[0]);
        removeKeyBtn();
      } else {
        // Plusieurs comptes → on mémorise le choix fait sur l'étape précédente
        // (Gmail) : si on est sur la page mot de passe et que le compte choisi
        // correspond, on remplit sans redemander.
        const stored = getStoredLogin();
        const preferred = stored ? entries.find((e) => e.login === stored) : null;
        if (fields.pass && !fields.user && preferred) {
          fillEntry(fields, preferred);
        } else {
          dbg('plusieurs comptes → sélecteur affiché (' + entries.length + ')');
          showPicker(entries, fields, fields.pass || fields.user);
        }
      }
    } else if (res && res.success) {
      showHint("Aucun identifiant pour ce site dans KeePassXC (vérifiez l'URL de l'entrée)", fields.pass || fields.user);
    } else if (res && res.error === 'not-associated') {
      showHint("Associez d'abord Orbit à KeePassXC (Paramètres → KeePassXC)", fields.pass || fields.user);
    } else if (res && res.error && res.error !== 'disabled') {
      showHint('KeePassXC : ' + res.error, fields.pass || fields.user);
    }
  } catch {
    // silencieux : ne jamais perturber la page de l'app
  } finally {
    setTimeout(() => {
      busy = false;
    }, 700);
  }
}

function maybeFill(event) {
  const target = event.target;
  if (!target || typeof target.matches !== 'function') return;

  const fields = findFields();
  if (!fields) return;
  if (target !== fields.pass && target !== fields.user) return;

  currentFields = fields;
  // Bouton 🔑 visible à côté du champ (action explicite)
  showKeyBtn(fields.pass || fields.user);
  // Remplissage automatique au focus (ou sélecteur si plusieurs comptes)
  doFill(fields, false);

  // Repositionne le bouton si la page défile
  const onScroll = () => positionKeyBtn(fields.pass || fields.user);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  setTimeout(() => document.removeEventListener('scroll', onScroll, { capture: true }), 8000);
}

function onBlur() {
  setTimeout(() => {
    // Cache le bouton si aucun champ du formulaire n'est plus focalisé
    const active = document.activeElement;
    if (!active || (active !== currentFields?.pass && active !== currentFields?.user)) {
      removeKeyBtn();
    }
  }, 150);
}

document.addEventListener('focusin', maybeFill, true);
document.addEventListener('focusout', onBlur, true);
