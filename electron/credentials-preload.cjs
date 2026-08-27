// ---------------------------------------------------------------------------
// Preload injecté dans chaque <webview> (page d'app embarquée).
//
// Gestion des identifiants, DEUX sources fusionnées côté processus principal :
//   • KeePassXC (pont natif, pour qui l'utilise déjà) ;
//   • le coffre-fort intégré d'Orbit (trousseaux chiffrés).
// La page ne connaît qu'un seul canal — `credentials:*` — et affiche une seule
// liste de comptes, chacun étiqueté par sa provenance.
//
// Ce que fait ce script :
//   - au FOCUS sur un champ de connexion → remplissage automatique
//   - si PLUSIEURS comptes existent pour le site → liste de choix affichée à
//     côté du champ : un clic remplit le compte choisi
//   - pages à un champ à la fois (ex. Gmail : identifiant puis mot de passe) :
//     le compte choisi est mémorisé (sessionStorage) et le mot de passe se
//     remplit automatiquement sur l'étape suivante
//   - un bouton « 🔑 » apparaît à côté du champ → clic = remplir / choisir
//   - sur un formulaire d'INSCRIPTION (deux champs mot de passe) → proposition
//     de générer un mot de passe fort
//   - après une CONNEXION ou une INSCRIPTION réussie → proposition d'enregistrer
//     l'identifiant dans un trousseau ouvert (« Enregistrer » / « Jamais ici »)
//
// Notes de sécurité : ce script tourne dans le monde isolé du webview
// (contextIsolation) — les scripts de la page ne peuvent PAS l'appeler ni
// accéder à ipcRenderer. Il ne demande que les identifiants de l'URL réelle
// de la page (window.location.href), jamais une URL arbitraire. Les mots de
// passe transitent uniquement du principal vers le champ à remplir ; rien
// n'est conservé dans la page au-delà du remplissage.
// ---------------------------------------------------------------------------
const { ipcRenderer } = require('electron');

// NB : ce preload ne touche plus à l'identité du navigateur. Elle est fixée
// une fois pour toutes dans main.js (CHROME_UA), et toute retouche
// supplémentaire — navigator.userAgent, navigator.userAgentData, en-têtes
// Sec-CH-UA — s'est révélée contre-productive : réécrire userAgentData pour
// y annoncer « Google Chrome » fait refuser la connexion par Google.

const PASSWORD_SELECTOR = 'input[type="password"]';
// Mémorise le compte choisi (page identifiant → page mot de passe, Gmail…)
const STORAGE_KEY = '__orbit_cred_selected_login__';

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
let autoFilled = false; // remplissage automatique déjà fait sur cette page ?

// Le remplissage AUTOMATIQUE n'a lieu qu'après une vraie interaction de
// l'utilisateur avec la page. Sans ça, une page peut appeler `.focus()` sur un
// champ dès le chargement et récolter l'identifiant sans que personne n'ait
// rien fait. Le clic sur 🔑 reste possible à tout moment : c'est un geste
// explicite, il n'a pas besoin de cette garantie.
let userInteracted = false;
const markInteraction = (e) => {
  if (e && e.isTrusted) userInteracted = true;
};
document.addEventListener('pointerdown', markInteraction, true);
document.addEventListener('keydown', markInteraction, true);

// Signale à Orbit qu'on vient de cliquer DANS la page. Un <webview> a son
// propre processus de rendu : ses événements souris n'atteignent jamais le
// document de l'interface. Sans ce relais, un menu ou un panneau ouvert dans
// Orbit ne peut pas savoir qu'on a cliqué ailleurs — il restait donc affiché
// tant qu'on ne cliquait pas sur l'interface elle-même.
let lastPing = 0;
document.addEventListener(
  'pointerdown',
  () => {
    // Un clic humain est rare ; la limite évite juste qu'une page qui simule
    // des clics en rafale n'inonde le canal.
    const now = Date.now();
    if (now - lastPing < 120) return;
    lastPing = now;
    try {
      ipcRenderer.send('guest:interact');
    } catch {
      /* ignore */
    }
  },
  true
);
let currentFields = null; // { user, pass } du formulaire focalisé

// Un champ contient-il déjà une saisie de l'utilisateur ? On ne l'écrase
// JAMAIS automatiquement — sinon impossible de saisir un autre compte à la
// main (le remplissage auto reprenait le dessus à chaque focus).
function hasUserInput(fields) {
  return Boolean((fields.user && fields.user.value) || (fields.pass && fields.pass.value));
}
let keyBtn = null;
let hintEl = null;
let hintTimer = null;
let btnTimer = null;
let pickerEl = null;
let pickerOpenedAt = 0; // anti-course : clic qui a ouvert le sélecteur

// ---------------------------------------------------------------------------
// Détection des champs
// ---------------------------------------------------------------------------
// Un champ RÉELLEMENT visible. `offsetParent !== null` ne suffit pas : un champ
// de 1 px, ou repoussé hors de l'écran, le satisfait. C'est exactement ce
// qu'utilise un piège à remplissage automatique — une page (ou un script
// injecté via une faille XSS du site) pose un champ mot de passe invisible, lui
// donne le focus, et relit sa valeur une fois rempli.
function reallyVisible(el) {
  if (!el || el.disabled || el.readOnly || el.type === 'hidden') return false;
  if (el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 40 || r.height < 10) return false;
  // Hors de la fenêtre (marges larges : un champ peut être légitimement
  // au-dessus de la zone visible si la page est défilée).
  if (r.bottom < -400 || r.top > window.innerHeight + 400) return false;
  if (r.right < -400 || r.left > window.innerWidth + 400) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.opacity === '0') return false;
  return true;
}

function findFields() {
  const pass = Array.from(document.querySelectorAll(PASSWORD_SELECTOR)).find(reallyVisible) || null;
  const inputs = Array.from(document.querySelectorAll('input'));
  const visible = reallyVisible;

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
  keyBtn.title = 'Identifiants Orbit — remplir ou choisir un compte';
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
    // Provenance : deux sources cohabitent (KeePassXC et les trousseaux
    // intégrés). Sans étiquette, impossible de savoir où l'on va corriger un
    // mot de passe quand deux comptes portent le même nom.
    const origin = document.createElement('div');
    origin.textContent = entry.source === 'vault' ? entry.vaultName || 'Trousseau' : 'KeePassXC';
    Object.assign(origin.style, {
      fontSize: '10px',
      color: '#6b7280',
      marginTop: '2px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    });
    row.appendChild(name);
    row.appendChild(login);
    row.appendChild(origin);
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

  // Remplissage AUTOMATIQUE (focus) : ne jamais s'imposer.
  //   • si l'utilisateur a déjà saisi quelque chose → on ne touche à rien
  //     (il est en train de taper un autre compte), on montre juste le 🔑 ;
  //   • une seule tentative auto par page → après avoir effacé un champ, le
  //     focus ne le re-remplit plus tout seul.
  // Le clic sur 🔑 (manual = true) passe outre : c'est une action explicite.
  if (!manual && (autoFilled || hasUserInput(fields) || !userInteracted)) {
    showKeyBtn(fields.pass || fields.user);
    return;
  }

  busy = true;
  const anchor = fields.pass || fields.user;
  try {
    const res = await ipcRenderer.invoke('credentials:getLogins', {
      url: window.location.href,
    });
    dbg('focus sur champ login → getLogins:', res && res.success ? res.count + ' entrées' : JSON.stringify(res));

    if (res && res.success && res.entries && res.entries.length > 0) {
      const entries = res.entries;
      if (entries.length === 1) {
        // Un seul compte → remplissage direct
        fillEntry(fields, entries[0]);
        if (!manual) autoFilled = true;
        removeKeyBtn();
      } else {
        // Plusieurs comptes → on mémorise le choix fait sur l'étape précédente
        // (Gmail) : si on est sur la page mot de passe et que le compte choisi
        // correspond, on remplit sans redemander.
        const stored = getStoredLogin();
        const preferred = stored ? entries.find((e) => e.login === stored) : null;
        if (fields.pass && !fields.user && preferred) {
          fillEntry(fields, preferred);
          if (!manual) autoFilled = true;
        } else {
          dbg('plusieurs comptes → sélecteur affiché (' + entries.length + ')');
          showPicker(entries, fields, fields.pass || fields.user);
        }
      }
    } else if (res && res.disabled) {
      // L'utilisateur a coupé les propositions d'identifiants : on s'efface
      // complètement plutôt que d'annoncer une absence d'entrée.
      removeKeyBtn();
    } else if (res && res.success) {
      // Rien trouvé : la raison la plus fréquente est un trousseau encore
      // fermé — on le dit, plutôt que de laisser croire à une absence d'entrée.
      if (res.lockedVaults > 0 && res.openVaults === 0) {
        showHint('Trousseau verrouillé — ouvrez-le dans Orbit (Réglages → Mots de passe)', anchor);
      } else if (res.keepassError) {
        showHint('KeePassXC : ' + res.keepassError, anchor);
      } else {
        showHint("Aucun identifiant enregistré pour ce site", anchor);
      }
    } else if (res && res.error) {
      showHint('Identifiants : ' + res.error, anchor);
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

// Rattrapage du champ DÉJÀ focalisé.
//
// Beaucoup de pages de connexion donnent elles-mêmes le focus au champ
// identifiant au chargement (autofocus, ou focus posé par leur script). Ce
// `focusin`-là arrive avant que l'utilisateur ait touché à quoi que ce soit :
// le remplissage automatique le refuse, à raison (un champ focalisé tout seul
// puis relu est le piège classique à récolte d'identifiants).
//
// Mais `focusin` ne se redéclenche pas sur un champ qui a déjà le focus. Le
// clic de l'utilisateur ne relançait donc plus rien : ni proposition
// KeePassXC, ni sélecteur de comptes. On rejoue la tentative sur ce clic —
// qui est, lui, une interaction réelle.
document.addEventListener(
  'pointerdown',
  (event) => {
    if (!event.isTrusted || pickerEl) return;
    const target = event.target;
    if (!target || target.nodeType !== 1 || target !== document.activeElement) return;
    const fields = findFields();
    if (!fields) return;
    if (target !== fields.pass && target !== fields.user) return;
    currentFields = fields;
    showKeyBtn(fields.pass || fields.user);
    doFill(fields, false);
  },
  true
);

// ---------------------------------------------------------------------------
// Panneau flottant réutilisable (proposition d'enregistrement, générateur)
// ---------------------------------------------------------------------------
// Les pages embarquées imposent leur propre CSS : tous les styles sont donc
// posés en ligne, et le z-index est au maximum. On n'utilise pas de Shadow DOM
// pour rester compatible avec les pages qui réécrivent `attachShadow`.
let panelEl = null;

function removePanel() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
}

function createPanel({ title, subtitle }) {
  removePanel();
  panelEl = document.createElement('div');
  Object.assign(panelEl.style, {
    position: 'fixed',
    top: '14px',
    right: '14px',
    zIndex: '2147483647',
    width: '320px',
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
  head.textContent = title;
  Object.assign(head.style, { fontSize: '13px', fontWeight: '700', marginBottom: '2px' });
  panelEl.appendChild(head);

  if (subtitle) {
    const sub = document.createElement('div');
    sub.textContent = subtitle;
    Object.assign(sub.style, {
      fontSize: '12px',
      color: '#9ca3af',
      marginBottom: '10px',
      wordBreak: 'break-all',
    });
    panelEl.appendChild(sub);
  }

  document.body.appendChild(panelEl);
  return panelEl;
}

function makeButton(label, kind) {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    flex: kind === 'primary' ? '1' : '0 0 auto',
    padding: '7px 12px',
    borderRadius: '8px',
    border: kind === 'primary' ? 'none' : '1px solid #374151',
    background: kind === 'primary' ? '#6366f1' : 'transparent',
    color: kind === 'primary' ? '#fff' : '#9ca3af',
    fontSize: '12px',
    fontWeight: '600',
    fontFamily: 'inherit',
    cursor: 'pointer',
  });
  return b;
}

// ---------------------------------------------------------------------------
// Proposition d'enregistrement après une connexion / inscription
// ---------------------------------------------------------------------------
function showSavePanel(pending, offer) {
  const panel = createPanel({
    title: offer.update ? 'Mettre à jour ce mot de passe ?' : 'Enregistrer ce mot de passe ?',
    subtitle: `${pending.login || 'sans identifiant'} — ${location.hostname}`,
  });

  // Choix du trousseau : masqué s'il n'y en a qu'un d'ouvert (pas de question
  // inutile), affiché dès qu'il y a un arbitrage à faire (Boulot / Perso).
  let vaultId = offer.vaultId || offer.vaults[0]?.id;
  if (offer.vaults.length > 1) {
    const select = document.createElement('select');
    Object.assign(select.style, {
      width: '100%',
      padding: '7px 8px',
      marginBottom: '10px',
      borderRadius: '8px',
      background: '#1f2937',
      border: '1px solid #374151',
      color: '#f3f4f6',
      fontSize: '12px',
      fontFamily: 'inherit',
    });
    offer.vaults.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.icon || '🔐'}  ${v.name}`;
      if (v.id === vaultId) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      vaultId = select.value;
    });
    panel.appendChild(select);
  }

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '6px', alignItems: 'center' });

  const save = makeButton(offer.update ? 'Mettre à jour' : 'Enregistrer', 'primary');
  save.addEventListener('click', async () => {
    save.disabled = true;
    save.textContent = '…';
    const res = await ipcRenderer.invoke('credentials:save', {
      vaultId,
      // Mise à jour d'un compte connu : on réécrit l'entrée existante plutôt
      // que d'en créer une seconde avec le même identifiant.
      entryId: offer.update ? offer.entryId : null,
      title: document.title || location.hostname,
    });
    removePanel();
    if (!res || res.success === false) {
      showHint("Enregistrement impossible (trousseau verrouillé ?)", document.body);
    }
  });

  const never = makeButton('Jamais ici', 'ghost');
  never.title = "Ne plus proposer d'enregistrer un mot de passe pour ce site";
  never.addEventListener('click', () => {
    ipcRenderer.invoke('credentials:ignore', { url: location.href });
    removePanel();
  });

  const close = makeButton('✕', 'ghost');
  close.title = 'Pas maintenant';
  close.addEventListener('click', removePanel);

  row.appendChild(save);
  row.appendChild(never);
  row.appendChild(close);
  panel.appendChild(row);

  // Disparaît tout seul : un panneau oublié dans un coin finit par gêner.
  setTimeout(() => {
    if (panelEl === panel) removePanel();
  }, 45000);
}

async function maybeOfferSave(pending) {
  if (!pending) return;
  // Aucun paramètre : le processus principal se fonde sur la soumission qu'il
  // a lui-même mise de côté. Le mot de passe n'est jamais redescendu ici.
  const offer = await ipcRenderer.invoke('credentials:shouldOffer');
  if (!offer || !offer.offer) {
    dbg('pas de proposition d\'enregistrement:', (offer && offer.reason) || 'inconnu');
    return;
  }
  showSavePanel(pending, offer);
}

// Capture de la soumission. Trois déclencheurs, parce qu'un seul ne suffit
// jamais : `submit` (formulaire classique), le clic sur le bouton d'envoi
// (formulaires pilotés en JavaScript, qui n'émettent pas `submit`), et la
// touche Entrée dans le champ mot de passe.
function snapshotCredentials() {
  const pass = Array.from(document.querySelectorAll(PASSWORD_SELECTOR)).find(reallyVisible);
  if (!pass || !pass.value) return null;
  const fields = findFields();
  // L'identifiant peut avoir été saisi à l'étape précédente (Gmail) : on
  // retombe alors sur le compte mémorisé pour cette session.
  const login = (fields && fields.user && fields.user.value) || getStoredLogin() || '';
  // L'URL n'est pas transmise : le processus principal la lit sur le
  // webContents émetteur, une page ne peut donc pas se faire passer pour une
  // autre.
  return { login, password: pass.value };
}

function captureSubmit() {
  const snap = snapshotCredentials();
  if (!snap) return;
  // Mise de côté côté processus principal : si la page navigue (cas normal
  // d'une connexion réussie), c'est la page suivante qui reprendra le relais.
  ipcRenderer.invoke('credentials:stashPending', snap);

  // Pas de navigation (application monopage) : au bout de 2,5 s, si le champ
  // mot de passe a disparu, la connexion a réussi — on propose.
  setTimeout(async () => {
    // Même critère de visibilité : un champ mot de passe caché ne doit pas
    // faire croire qu'on est encore sur le formulaire de connexion.
    const stillThere = Array.from(document.querySelectorAll(PASSWORD_SELECTOR)).find(reallyVisible);
    if (stillThere) return; // toujours sur le formulaire
    const pending = await ipcRenderer.invoke('credentials:takePending');
    if (pending && pending.success) maybeOfferSave(pending);
  }, 2500);
}

document.addEventListener('submit', captureSubmit, true);
document.addEventListener(
  'click',
  (e) => {
    const el = e.target && e.target.closest ? e.target.closest('button, input[type="submit"], [role="button"]') : null;
    if (!el) return;
    if (el.type === 'button' && !/(login|log in|sign|connexion|connecter|continue|suivant|next|submit)/i.test(el.textContent || el.value || '')) return;
    captureSubmit();
  },
  true
);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t && t.matches && t.matches(PASSWORD_SELECTOR)) captureSubmit();
  },
  true
);

// Au chargement d'une page : y a-t-il une soumission en attente venue de la
// page précédente ? Si oui, la connexion a abouti → on propose d'enregistrer.
async function checkPendingOnLoad() {
  try {
    const pending = await ipcRenderer.invoke('credentials:takePending');
    if (!pending || !pending.success) return;
    // Toujours un formulaire de connexion visible = la connexion a échoué
    // (mauvais mot de passe, 2FA refusée) : on n'enregistre surtout pas.
    const pass = Array.from(document.querySelectorAll(PASSWORD_SELECTOR)).find(reallyVisible);
    if (pass) return;
    maybeOfferSave(pending);
  } catch {
    /* jamais bloquant */
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(checkPendingOnLoad, 900);
} else {
  window.addEventListener('DOMContentLoaded', () => setTimeout(checkPendingOnLoad, 900));
}

// ---------------------------------------------------------------------------
// Générateur de mot de passe sur les formulaires d'inscription
// ---------------------------------------------------------------------------
// Deux champs mot de passe visibles (« mot de passe » + « confirmation ») =
// inscription ou changement de mot de passe. C'est le seul moment où proposer
// un mot de passe fort a du sens ; le proposer sur une page de connexion
// n'aurait aucun intérêt.
function isSignupForm() {
  const passes = Array.from(document.querySelectorAll(PASSWORD_SELECTOR)).filter(reallyVisible);
  if (passes.length >= 2) return passes;
  const only = passes[0];
  if (only && /new-password/.test(only.autocomplete || '')) return passes;
  return null;
}

let generatorShownFor = null;

async function offerGenerator(field) {
  const passes = isSignupForm();
  if (!passes || generatorShownFor === location.href) return;
  generatorShownFor = location.href;

  const res = await ipcRenderer.invoke('credentials:generate', { length: 20, symbols: true });
  if (!res || !res.password) return;

  const panel = createPanel({
    title: 'Mot de passe fort suggéré',
    subtitle: 'Généré sur votre machine, jamais transmis.',
  });

  const value = document.createElement('div');
  value.textContent = res.password;
  Object.assign(value.style, {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    padding: '8px 10px',
    marginBottom: '10px',
    wordBreak: 'break-all',
    userSelect: 'all',
  });
  panel.appendChild(value);

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '6px' });

  const use = makeButton('Utiliser', 'primary');
  use.addEventListener('click', () => {
    // Remplit les DEUX champs : le champ de confirmation aussi, sinon le
    // formulaire refuse la validation.
    passes.forEach((p) => {
      setValue(p, res.password);
      highlight(p);
    });
    removePanel();
    // Le mot de passe sera proposé à l'enregistrement à la soumission —
    // c'est le même chemin que pour une connexion normale.
  });

  const dismiss = makeButton('Non merci', 'ghost');
  dismiss.addEventListener('click', removePanel);

  row.appendChild(use);
  row.appendChild(dismiss);
  panel.appendChild(row);

  setTimeout(() => {
    if (panelEl === panel) removePanel();
  }, 30000);
  void field;
}

document.addEventListener(
  'focusin',
  (e) => {
    const t = e.target;
    if (t && t.matches && t.matches(PASSWORD_SELECTOR)) offerGenerator(t);
  },
  true
);
