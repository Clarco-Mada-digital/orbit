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
  try {
    const u = new URL(url);
    $('host').innerHTML = `${u.protocol === 'https:' ? '<span class="lock">🔒</span>' : ''}${u.host}`;
  } catch {
    $('host').textContent = '';
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
$('maximize').onclick = () => window.orbitPopup.maximize();
$('close').onclick = () => window.orbitPopup.close();

// Échap ferme la fenêtre — réflexe attendu d'une boîte de dialogue
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.orbitPopup.close();
});
