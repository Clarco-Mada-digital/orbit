// ---------------------------------------------------------------------------
// « Y a-t-il quelque chose à télécharger sur cette page ? »
//
// La question est posée à deux endroits qui n'ont rien en commun : un script
// posé DANS la page (electron/media-button-preload.cjs, qui superpose le
// bouton sur la vidéo) et la barre d'Orbit (la pastille qui s'allume). Les
// deux doivent répondre pareil, sinon le bouton apparaît là où la pastille
// reste éteinte et personne n'y comprend rien.
//
// Module SANS DÉPENDANCE (ni DOM, ni Electron) : il juge sur des faits qu'on
// lui donne. Testé par test/mediaDetect.test.js.
// ---------------------------------------------------------------------------

// Sites dont yt-dlp sait extraire un média à partir de l'URL de la PAGE, même
// quand la vidéo n'est pas une balise <video> lisible (lecteurs chiffrés,
// flux découpés en fragments). Sur ceux-là on propose sans rien détecter.
//
// Liste volontairement courte : ce sont les cas où l'on est SÛR. Partout
// ailleurs, c'est la présence d'une vidéo jouable qui décide — yt-dlp gère
// des centaines de sites, mais promettre un téléchargement qui échoue est
// pire que ne rien proposer.
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

// Pages d'un site connu où il n'y a RIEN à télécharger : l'accueil, la
// connexion, les réglages. Proposer un bouton là est du bruit.
const BARREN_PATHS = /^\/(|login|signin|signup|register|settings|account|feed|explore|results|search|about|terms|privacy)\/?$/i;

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

// L'hôte fait-il partie des sites connus (lui ou un de ses sous-domaines) ?
export function isKnownMediaHost(url) {
  const host = hostOf(url);
  if (!host) return false;
  return KNOWN_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

// Une page de site connu qui porte vraisemblablement un média.
export function isKnownMediaPage(url) {
  if (!isKnownMediaHost(url)) return false;
  let pathname = '/';
  let search = '';
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname || '/';
    search = parsed.search || '';
  } catch {
    return false;
  }
  // « youtube.com/results?search_query=… » n'est pas une vidéo, mais
  // « youtube.com/watch?v=… » oui : la query tranche quand le chemin est nu.
  if (BARREN_PATHS.test(pathname) && !/[?&]v=/.test(search)) return false;
  return true;
}

// Décision finale, pour une page et ce qu'on y a trouvé.
//
//   url       l'adresse de la page
//   videos    [{ durationSeconds, width, height, src }] — les <video> jouables
//
// Rend { offer, reason } : `offer` commande l'affichage, `reason` sert au
// journal et aux tests (c'est elle qui dit POURQUOI, et c'est ce qui se
// relit dans six mois).
export function shouldOfferMedia({ url = '', videos = [] } = {}) {
  if (!/^https?:/i.test(String(url))) {
    return { offer: false, reason: 'not-web' };
  }
  if (isKnownMediaPage(url)) return { offer: true, reason: 'known-host' };

  // Ailleurs : une vidéo assez longue et assez grande pour ne pas être une
  // décoration. Les fonds animés et les aperçus au survol sont muets, courts
  // et minuscules — proposer de les télécharger décrédibilise le bouton.
  const real = (Array.isArray(videos) ? videos : []).filter((video) => {
    const duration = Number(video?.durationSeconds);
    const width = Number(video?.width) || 0;
    const height = Number(video?.height) || 0;
    if (Number.isFinite(duration) && duration > 0 && duration < 8) return false;
    if (width > 0 && width < 200) return false;
    if (height > 0 && height < 150) return false;
    return true;
  });
  if (real.length) return { offer: true, reason: 'video-element' };
  return { offer: false, reason: 'nothing-found' };
}

// --- Où afficher la proposition ------------------------------------------
//
// Réglage `mediaButtonSurface` : 'both' | 'overlay' | 'topbar' | 'none'.
// Toute valeur inconnue (réglage d'une version future, fichier abîmé) vaut
// 'both' — le défaut, plutôt qu'une fonctionnalité muette sans explication.
export function surfaceFlags(setting) {
  switch (setting) {
    case 'none':
      return { overlay: false, topbar: false };
    case 'overlay':
      return { overlay: true, topbar: false };
    case 'topbar':
      return { overlay: false, topbar: true };
    case 'both':
    default:
      return { overlay: true, topbar: true };
  }
}
