// ---------------------------------------------------------------------------
// Bouton de téléchargement posé SUR la vidéo.
//
// C'est l'effet qu'on connaît des extensions de navigateur : on arrive sur une
// vidéo, une pastille apparaît dans son coin, un clic et c'est téléchargé —
// sans passer par le clic droit ni par un menu.
//
// Preload SUPPLÉMENTAIRE, enregistré par session (voir attachMediaButton dans
// electron/main.js, sur le modèle de electron/adblock.js). Il ne remplace pas
// credentials-preload.cjs : les deux cohabitent sur la même page.
//
// Pourquoi un preload et pas une extension : le réglage qui commande ce bouton
// vit dans les réglages d'Orbit (Téléchargements). Une extension aurait exigé
// un second interrupteur, ailleurs, pour la même chose — et une extension
// désactivée aurait fait mentir le réglage.
//
// Contraintes de ce fichier :
//   • il tourne dans le MONDE ISOLÉ du webview (contextIsolation + sandbox) :
//     les scripts de la page ne peuvent ni l'appeler ni voir ses variables ;
//   • `require` d'un module local est impossible dans un preload sandboxé —
//     la détection est donc recopiée depuis src/lib/mediaDetect.js, qui reste
//     la référence testée. Voir la note là-bas avant de modifier l'une des
//     deux ;
//   • tout vit dans un shadow DOM fermé : la page ne peut pas styler le
//     bouton, et nos styles ne fuient pas dans la page.
// ---------------------------------------------------------------------------
const { ipcRenderer } = require('electron');

// Jamais dans une iframe : le bouton se pose une fois, sur la page.
if (window.top === window.self) {
  // --- Détection (miroir de src/lib/mediaDetect.js) ------------------------
  const KNOWN_HOSTS = [
    'youtube.com', 'youtu.be', 'music.youtube.com',
    'facebook.com', 'fb.watch',
    'instagram.com',
    'tiktok.com',
    'twitter.com', 'x.com',
    'vimeo.com',
    'dailymotion.com',
    'twitch.tv',
    'soundcloud.com',
    'bandcamp.com',
    'reddit.com',
    'bilibili.com',
    'odysee.com',
    'rumble.com',
    'arte.tv',
    'france.tv',
  ];
  const BARREN_PATHS =
    /^\/(|login|signin|signup|register|settings|account|feed|explore|results|search|about|terms|privacy)\/?$/i;

  const knownHost = () => {
    const host = location.hostname.toLowerCase().replace(/^www\./, '');
    return KNOWN_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
  };

  const knownPage = () => {
    if (!knownHost()) return false;
    if (BARREN_PATHS.test(location.pathname || '/') && !/[?&]v=/.test(location.search || '')) {
      return false;
    }
    return true;
  };

  // Vidéos « réelles » : ni fond animé, ni aperçu au survol.
  const realVideos = () => {
    const found = [];
    for (const video of document.querySelectorAll('video')) {
      const duration = Number(video.duration);
      const width = video.videoWidth || video.clientWidth || 0;
      const height = video.videoHeight || video.clientHeight || 0;
      if (Number.isFinite(duration) && duration > 0 && duration < 8) continue;
      if (width > 0 && width < 200) continue;
      if (height > 0 && height < 150) continue;
      found.push(video);
    }
    return found;
  };

  const shouldOffer = () => /^https?:/i.test(location.protocol) && (knownPage() || realVideos().length > 0);

  // --- Réglage ------------------------------------------------------------
  // 'both' | 'overlay' | 'topbar' | 'none' — seuls 'both' et 'overlay'
  // affichent quelque chose ici. Inconnu = 'both' (défaut), jamais le silence.
  let surface = 'both';
  const overlayAllowed = () => surface === 'both' || surface === 'overlay';

  // --- Interface ----------------------------------------------------------
  const HOST_ID = '__orbit_media_button__';
  let host = null;
  let shadow = null;
  let busy = false;

  function build() {
    if (host) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .wrap {
        position: fixed; right: 18px; top: 84px; z-index: 2147483646;
        display: flex; flex-direction: column; gap: 6px;
        font: 600 12px/1 system-ui, -apple-system, sans-serif;
        opacity: .35; transition: opacity .18s ease;
      }
      /* Discret au repos, franc au survol : un bouton posé sur une vidéo ne
         doit pas disputer l'attention au contenu qu'on est venu regarder. */
      .wrap:hover, .wrap:focus-within { opacity: 1; }
      button {
        display: flex; align-items: center; gap: 7px;
        min-height: 34px; padding: 8px 12px;
        border: 1px solid #3f3f46; border-radius: 10px;
        background: #18181bee; color: #f4f4f5;
        box-shadow: 0 6px 20px #0007; font: inherit; cursor: pointer;
        -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      }
      button:hover { border-color: #818cf8; background: #27272aee; }
      button:disabled { cursor: progress; opacity: .6; }
      .audio { font-weight: 500; opacity: .9; }
      .note {
        max-width: 230px; padding: 7px 10px;
        border: 1px solid #3f3f46; border-radius: 9px;
        background: #18181bee; color: #a1a1aa;
        font-weight: 500; line-height: 1.35;
      }
      .note[data-kind="error"] { color: #fca5a5; border-color: #7f1d1d; }
      .note[data-kind="ok"] { color: #86efac; border-color: #14532d; }
    `;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const video = document.createElement('button');
    video.type = 'button';
    video.innerHTML = '<span aria-hidden="true">⬇</span><span>Télécharger la vidéo</span>';
    const audio = document.createElement('button');
    audio.type = 'button';
    audio.className = 'audio';
    audio.innerHTML = '<span aria-hidden="true">♪</span><span>Audio seulement</span>';

    const note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.className = 'note';
    note.hidden = true;

    const say = (message, kind = '') => {
      note.textContent = message;
      note.dataset.kind = kind;
      note.hidden = !message;
    };

    const ask = async (mode) => {
      if (busy) return;
      busy = true;
      video.disabled = true;
      audio.disabled = true;
      say('Préparation…');
      try {
        // Le processus principal reçoit la session de CETTE page : c'est de là
        // que viennent les cookies qui débloquent Facebook et les vidéos
        // réservées (voir startMediaDownload dans electron/main.js).
        const res = await ipcRenderer.invoke('media:download', { url: location.href, mode });
        if (res && res.success === false) {
          say(res.error === 'destination-dialog-open'
            ? 'Une destination est déjà demandée.'
            : 'Téléchargement impossible sur cette page.', 'error');
        } else {
          say('Ajouté aux téléchargements d’Orbit.', 'ok');
        }
      } catch (error) {
        say(`Échec : ${error && error.message ? error.message : error}`, 'error');
      } finally {
        busy = false;
        video.disabled = false;
        audio.disabled = false;
        setTimeout(() => say(''), 4000);
      }
    };

    video.addEventListener('click', () => ask('video'));
    audio.addEventListener('click', () => ask('audio'));

    wrap.append(video, audio, note);
    shadow.append(style, wrap);
  }

  function show() {
    build();
    const root = document.body || document.documentElement;
    if (root && host.parentNode !== root) root.appendChild(host);
  }

  function hide() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  function refresh() {
    if (overlayAllowed() && shouldOffer()) show();
    else hide();
  }

  // Les pages de vidéo sont presque toutes des applications d'une seule page :
  // passer d'une vidéo à l'autre ne recharge rien. Sans ces deux mouchards, le
  // bouton resterait figé sur l'état de la première page ouverte.
  let timer = null;
  const later = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 400);
    if (timer.unref) timer.unref();
  };

  function watch() {
    refresh();
    // Navigation interne (history.pushState) : il n'y a pas d'événement
    // standard, on surveille donc l'URL.
    let seen = location.href;
    setInterval(() => {
      if (location.href !== seen) {
        seen = location.href;
        later();
      }
    }, 1000);
    window.addEventListener('popstate', later);
    // Une vidéo ajoutée après coup (lecteur chargé en différé)
    document.addEventListener('loadedmetadata', later, true);
    document.addEventListener('play', later, true);
  }

  const boot = () => {
    ipcRenderer
      .invoke('media:buttonSurface')
      .then((value) => {
        if (typeof value === 'string') surface = value;
      })
      .catch(() => {
        /* réglage illisible : on garde le défaut */
      })
      .finally(watch);
  };

  // Le réglage peut changer pendant que la page est ouverte : on applique tout
  // de suite, sans attendre un rechargement.
  ipcRenderer.on('media:buttonSurfaceChanged', (_event, value) => {
    if (typeof value === 'string') surface = value;
    refresh();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
