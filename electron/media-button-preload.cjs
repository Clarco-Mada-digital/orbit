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
  // Une seule pastille posée SUR la vidéo, qui déplie deux choix au clic.
  // Avant : une colonne de deux boutons fixes en haut à droite de la PAGE,
  // toujours affichée et cliquable — elle recouvrait le contenu et interceptait
  // les clics destinés à la page. Ici la pastille tient dans un coin de l'image,
  // reste discrète au repos, et la couche qui la porte laisse passer les clics
  // (`pointer-events: none`) sauf sur ses propres commandes.
  const HOST_ID = '__orbit_media_button__';
  const PILL_SIZE = 30;
  let host = null;
  let shadow = null;
  let wrap = null;
  let pill = null;
  let menu = null;
  let note = null;
  let busy = false;
  let opened = false;

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
        position: fixed; z-index: 2147483646;
        pointer-events: none;
        font: 600 12px/1 system-ui, -apple-system, sans-serif;
      }
      /* La pastille : 30 px, à demi effacée au repos. Un décor sur une vidéo
         ne doit pas disputer l'attention au contenu qu'on est venu regarder. */
      .pill {
        pointer-events: auto;
        display: grid; place-items: center;
        width: ${PILL_SIZE}px; height: ${PILL_SIZE}px;
        padding: 0; border-radius: 50%;
        border: 1px solid #52525bcc;
        background: #18181bcc; color: #f4f4f5;
        box-shadow: 0 2px 10px #0006;
        font: inherit; cursor: pointer; opacity: .5;
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
        transition: opacity .15s ease, transform .15s ease, border-color .15s ease;
      }
      .pill:hover, .pill:focus-visible, .pill[aria-expanded="true"] {
        opacity: 1; transform: scale(1.06); border-color: #818cf8;
      }
      .pill:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
      .pill svg { width: 15px; height: 15px; }
      .menu {
        position: absolute; top: calc(100% + 6px); right: 0;
        display: none; min-width: 176px; padding: 4px;
        border: 1px solid #3f3f46; border-radius: 10px;
        background: #18181bf2; color: #f4f4f5;
        box-shadow: 0 10px 28px #0008;
        -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      }
      .menu[data-open="true"] { display: block; }
      .menu button {
        pointer-events: auto;
        display: flex; align-items: center; gap: 8px; width: 100%;
        min-height: 30px; padding: 7px 9px;
        border: 0; border-radius: 7px; background: transparent;
        color: inherit; font: inherit; text-align: left; cursor: pointer;
      }
      .menu button:hover, .menu button:focus-visible { background: #ffffff14; }
      .menu button:focus-visible { outline: 2px solid #818cf8; outline-offset: -2px; }
      .menu button:disabled { cursor: progress; opacity: .55; }
      .menu .hint { opacity: .55; font-weight: 500; }
      .note {
        pointer-events: none;
        position: absolute; top: calc(100% + 6px); right: 0;
        max-width: 230px; margin: 0; padding: 6px 9px;
        border: 1px solid #3f3f46; border-radius: 8px;
        background: #18181bf2; color: #a1a1aa;
        font-weight: 500; line-height: 1.35;
      }
      .note[data-kind="error"] { color: #fca5a5; border-color: #7f1d1d; }
      .note[data-kind="ok"] { color: #86efac; border-color: #14532d; }
    `;

    wrap = document.createElement('div');
    wrap.className = 'wrap';

    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.setAttribute('aria-label', 'Télécharger le média');
    pill.setAttribute('aria-haspopup', 'menu');
    pill.setAttribute('aria-expanded', 'false');
    pill.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 4v10" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M5 19h14" /></svg>';

    menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.dataset.open = 'false';

    const video = document.createElement('button');
    video.type = 'button';
    video.setAttribute('role', 'menuitem');
    video.innerHTML = '<span aria-hidden="true">⬇</span><span>Vidéo</span>';
    const audio = document.createElement('button');
    audio.type = 'button';
    audio.setAttribute('role', 'menuitem');
    audio.innerHTML = '<span aria-hidden="true">♪</span><span>Audio seulement</span><span class="hint">mp3</span>';

    note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.className = 'note';
    note.hidden = true;

    const setOpen = (value) => {
      opened = value;
      menu.dataset.open = value ? 'true' : 'false';
      pill.setAttribute('aria-expanded', value ? 'true' : 'false');
      if (value) note.hidden = true;
    };

    const say = (message, kind = '') => {
      note.textContent = message;
      note.dataset.kind = kind;
      note.hidden = !message;
    };

    const ask = async (mode) => {
      if (busy) return;
      setOpen(false);
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

    pill.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(!opened);
      if (opened) video.focus();
    });
    // Un clic ailleurs referme le menu : la page garde son comportement
    // habituel, on ne prend jamais le clic pour nous.
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!opened) return;
        if (event.composedPath().includes(host)) return;
        setOpen(false);
      },
      true,
    );
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && opened) {
        setOpen(false);
        pill.focus();
      }
    });

    menu.append(video, audio);
    wrap.append(pill, menu, note);
    shadow.append(style, wrap);
  }

  // La pastille se pose dans le coin SUPÉRIEUR DROIT de la vidéo : en bas, elle
  // couvrirait les barres de contrôle du lecteur (pleine largeur) ; en haut à
  // droite de l'image, elle ne dispute sa place à aucun bouton de lecture.
  // Sans vidéo repérable, elle se range dans le coin de la fenêtre.
  const place = () => {
    if (!wrap) return;
    const video = realVideos().find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 200 && rect.height >= 120;
    });
    if (!video) {
      wrap.style.left = 'auto';
      wrap.style.top = '84px';
      wrap.style.right = '18px';
      return;
    }
    const rect = video.getBoundingClientRect();
    const inset = 10;
    wrap.style.right = 'auto';
    wrap.style.left = `${Math.round(
      Math.min(window.innerWidth - PILL_SIZE - 4, Math.max(4, rect.right - PILL_SIZE - inset)),
    )}px`;
    wrap.style.top = `${Math.round(Math.min(window.innerHeight - PILL_SIZE - 4, Math.max(4, rect.top + inset)))}px`;
  };

  // Le déplacement de la vidéo (défilement, redimensionnement) doit suivre sans
  // faire tourner une boucle d'animation : on ne recalcule qu'à ces moments-là.
  let placing = false;
  const requestPlace = () => {
    if (placing) return;
    placing = true;
    requestAnimationFrame(() => {
      placing = false;
      place();
    });
  };
  window.addEventListener('scroll', requestPlace, { passive: true, capture: true });
  window.addEventListener('resize', requestPlace, { passive: true });

  function show() {
    build();
    const root = document.body || document.documentElement;
    if (root && host.parentNode !== root) root.appendChild(host);
  }

  function hide() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  function refresh() {
    if (overlayAllowed() && shouldOffer()) {
      show();
      place();
    } else {
      hide();
    }
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
      // La mise en page bouge aussi sans défilement (bandeau qui apparaît,
      // lecteur redimensionné) : un recalage régulier suffit, il ne coûte rien.
      if (host && host.parentNode) place();
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
