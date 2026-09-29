// Logique de la fenêtre secondaire stylée (voir popup.html). Le <webview> est
// créé ici — et non dans le HTML — pour lui passer la partition de l'app
// d'origine : c'est ce qui fait que la connexion aboutit (mêmes cookies).
const cfg = window.orbitPopup.config;

// Thème + couleur d'accent hérités de la fenêtre principale
if (cfg.theme === 'light') document.body.classList.add('light');
if (cfg.accent) document.documentElement.style.setProperty('--accent', cfg.accent);

const view = document.createElement('webview');
view.setAttribute('src', cfg.url);
if (cfg.partition) view.setAttribute('partition', cfg.partition);
view.setAttribute('allowpopups', '');
document.querySelector('.body').appendChild(view);

const $ = (id) => document.getElementById(id);
const progress = $('progress');

const setProgress = (pct) => {
  progress.style.opacity = pct >= 100 || pct <= 0 ? '0' : '1';
  progress.style.width = `${pct}%`;
};

const refreshNav = () => {
  $('back').disabled = !view.canGoBack();
  $('forward').disabled = !view.canGoForward();
};

const showUrl = (url) => {
  const host = $('host');
  host.textContent = ''; // repart à vide (aucune insertion HTML)
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') {
      const lock = document.createElement('span');
      lock.className = 'lock';
      lock.textContent = '🔒';
      host.appendChild(lock);
    }
    // textContent : le nom d'hôte est inséré comme TEXTE, jamais interprété.
    host.appendChild(document.createTextNode(u.host));
  } catch {
    /* URL invalide : on laisse vide */
  }
};

view.addEventListener('did-start-loading', () => setProgress(35));
view.addEventListener('did-stop-loading', () => {
  setProgress(100);
  refreshNav();
  setTimeout(() => setProgress(0), 350);
});
view.addEventListener('page-title-updated', (e) => {
  $('title').textContent = e.title || '';
});
view.addEventListener('page-favicon-updated', (e) => {
  if (e.favicons && e.favicons[0]) $('favicon').src = e.favicons[0];
});
view.addEventListener('did-navigate', (e) => {
  showUrl(e.url);
  refreshNav();
});
view.addEventListener('did-navigate-in-page', (e) => {
  showUrl(e.url);
  refreshNav();
});
// Beaucoup de flux de connexion ferment leur fenêtre eux-mêmes (window.close
// après l'OAuth) : on suit ce signal, sinon une fenêtre vide resterait ouverte.
view.addEventListener('close', () => window.orbitPopup.close());

showUrl(cfg.url);

$('back').onclick = () => view.canGoBack() && view.goBack();
$('forward').onclick = () => view.canGoForward() && view.goForward();
$('reload').onclick = () => view.reload();
$('external').onclick = () => window.orbitPopup.openExternal(view.getURL() || cfg.url);
$('minimize').onclick = () => window.orbitPopup.minimize();
$('close').onclick = () => window.orbitPopup.close();

// Agrandir/restaurer. On reflète l'état sur <body> : agrandie, la fenêtre ne
// se redimensionne plus au bord, donc les poignées s'effacent (sinon le
// curseur promettrait un geste sans effet).
const toggleMaximize = async () => {
  const res = await window.orbitPopup.maximize();
  document.body.classList.toggle('maximized', Boolean(res?.maximized));
};
$('maximize').onclick = toggleMaximize;

// Échap ferme la fenêtre — réflexe attendu d'une boîte de dialogue
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.orbitPopup.close();
});

// ---------------------------------------------------------------------------
// Redimensionnement manuel
//
// La fenêtre est `frame: false` + `transparent: true` : le système ne lui donne
// aucune bordure redimensionnable (très net sous Linux/X11), elle restait donc
// figée à 920×720. On implémente les huit poignées nous-mêmes.
//
// On raisonne en coordonnées ÉCRAN (screenX/screenY) et non client : pendant le
// glissement la fenêtre bouge sous le curseur, donc un delta calculé en
// coordonnées client se mordrait la queue et la fenêtre tremblerait.
// ---------------------------------------------------------------------------
let rz = null;

const onResizeMove = (e) => {
  if (!rz) return;
  const dx = e.screenX - rz.startX;
  const dy = e.screenY - rz.startY;
  const b = { ...rz.bounds };

  // Un bord « ouest »/« nord » déplace l'origine ET change la taille ; un bord
  // « est »/« sud » ne change que la taille.
  if (rz.dir.includes('w')) {
    b.x = rz.bounds.x + dx;
    b.width = rz.bounds.width - dx;
  }
  if (rz.dir.includes('e')) b.width = rz.bounds.width + dx;
  if (rz.dir.includes('n')) {
    b.y = rz.bounds.y + dy;
    b.height = rz.bounds.height - dy;
  }
  if (rz.dir.includes('s')) b.height = rz.bounds.height + dy;

  // On s'arrête au minimum côté rendu AUSSI : le processus principal borne
  // déjà la taille, mais sans borner l'origine ici la fenêtre « glisserait »
  // latéralement une fois la largeur minimale atteinte.
  if (b.width < MIN_W) {
    if (rz.dir.includes('w')) b.x = rz.bounds.x + rz.bounds.width - MIN_W;
    b.width = MIN_W;
  }
  if (b.height < MIN_H) {
    if (rz.dir.includes('n')) b.y = rz.bounds.y + rz.bounds.height - MIN_H;
    b.height = MIN_H;
  }

  window.orbitPopup.setBounds(b);
};

const endResize = () => {
  if (!rz) return;
  rz = null;
  document.body.classList.remove('resizing');
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', endResize);
};

// Doivent correspondre aux `minWidth`/`minHeight` de createOrbitPopup().
const MIN_W = 420;
const MIN_H = 360;

document.querySelectorAll('.rz').forEach((handle) => {
  handle.addEventListener('mousedown', async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const bounds = await window.orbitPopup.getBounds();
    if (!bounds) return;
    rz = { dir: handle.dataset.rz, startX: e.screenX, startY: e.screenY, bounds };
    // Le voile passe devant le <webview> : sans lui, dès que le curseur entre
    // dans la page invitée, mousemove/mouseup ne nous parviennent plus et le
    // redimensionnement reste « collé » au curseur.
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', endResize);
  });
});

// Double-clic sur l'en-tête : agrandir/restaurer, comme toute fenêtre.
document.querySelector('header').addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return;
  toggleMaximize();
});
