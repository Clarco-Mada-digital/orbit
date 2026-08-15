import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../stores/useStore';
import { useLoadingStore } from '../lib/loadingStore';
import { useMediaStore } from '../lib/mediaStore';
import { registerWebview, unregisterWebview } from '../lib/webviewRegistry';

// Lu DANS la page (via executeJavaScript) : métadonnées de lecture (Media
// Session en priorité, sinon le titre de la page) + état lecture/pause.
const READ_MEDIA_FN = `(() => {
  try {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    const el = document.querySelector('video, audio');
    return {
      hasMedia: !!el,
      paused: el ? el.paused : true,
      currentTime: el && isFinite(el.currentTime) ? el.currentTime : 0,
      duration: el && isFinite(el.duration) ? el.duration : 0,
      title: (md && md.title) || document.title || '',
      artist: (md && md.artist) || '',
      artwork: (md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : '') || '',
    };
  } catch (e) { return { hasMedia: false, paused: true, currentTime: 0, duration: 0, title: '', artist: '', artwork: '' }; }
})()`;
import { computeStartUrl } from '../lib/urls';
import { recipes } from '../lib/recipes';
import { CHROME_UA } from '../lib/userAgent';
import { appPartition } from '../lib/session';
import { notificationsSilenced } from '../lib/dnd';

// Un <webview> par app installée. Reste monté (masqué proprement) quand
// l'app n'est pas affichée → l'état de la page est conservé, comme dans
// Station. En revanche une app en VEILLE est complètement démontée : elle
// se ferme et ne consomme plus de ressources en arrière-plan.
//
// Props :
//   active  — l'app a le focus (remplissage/notifications, zoom)
//   visible — l'app est À L'ÉCRAN (active OU dans l'écran partagé)
//   flexLayout — rendue dans une grille partagée (flex:1) au lieu de plein écran
export default function WebView({ app, active, visible, flexLayout }) {
  const ref = useRef(null);
  // Le <webview> est-il prêt ? executeJavaScript/sendInputEvent lèvent une
  // exception SYNCHRONE tant que 'dom-ready' n'a pas été émis (webview non
  // attaché) → on ne pilote la page qu'après.
  const domReadyRef = useRef(false);
  const updateApp = useStore((s) => s.updateApp);
  const setAppLoading = useLoadingStore((s) => s.setAppLoading);
  const setMedia = useMediaStore((s) => s.setMedia);
  const clearMedia = useMediaStore((s) => s.clearMedia);
  const notificationsEnabled = useStore((s) => s.settings?.notifications !== false);
  const notifSound = useStore((s) => s.settings?.notificationSound || '');
  // Réglages « Ne pas déranger » (évalués à l'instant de la notif)
  const dnd = useStore((s) => s.settings?.dnd);
  const quietHoursEnabled = useStore((s) => s.settings?.quietHoursEnabled);
  const quietStart = useStore((s) => s.settings?.quietStart);
  const quietEnd = useStore((s) => s.settings?.quietEnd);
  const autoPip = useStore((s) => s.settings?.autoPictureInPicture !== false);
  // Le profil de l'app partage-t-il ses connexions (mode « navigateur » / SSO) ?
  const sharedSession = useStore(
    (s) => !!s.profiles.find((p) => p.id === app.profileId)?.sharedSession
  );
  // « Plafond » de non-lus déjà notifiés : on ne re-notifie que si le compteur
  // le DÉPASSE (le clignotement de titre 1↔0 ne le franchit jamais → pas de
  // notification/son en boucle). Réarmé à la lecture (app active ou 0 durable).
  const unreadRef = useRef(app.unread || 0);
  const zeroTimerRef = useRef(null);

  // Indicateur de chargement : un petit spinner s'affiche quand la page
  // se recharge (navigation, reload…). Délai de 500 ms avant d'apparaître
  // pour ne pas clignoter sur les recharges rapides (ex. redirections).
  const [loading, setLoading] = useState(false);
  const loadingTimer = useRef(null);

  // URL de démarrage fixée AU MONTAGE de l'app : jamais une page de connexion
  // persistée (signin, 2FA, cpsess…) → on repart de la « maison » (recette).
  // Mémorisée par id : les navigations internes ne doivent pas la recharger.
  const startUrl = useMemo(() => computeStartUrl(app, recipes), [app.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;

    registerWebview(app.id, wv);

    const handleNavigate = () => {
      // On ne garde que l'URL de la FRAME PRINCIPALE réelle (wv.getURL()).
      // did-navigate-in-page peut remonter des navigations parasites
      // (widgets/iframes : ex. contacts.google.com/widget/hovercard dans
      // Gmail) qui polluaient l'URL persistée → au redémarrage l'app
      // chargeait une page cassée et « il fallait se reconnecter ».
      let url = '';
      try {
        url = wv.getURL();
      } catch {
        /* ignore */
      }
      if (url) updateApp(app.id, { url });
    };

    const handleTitle = (e) => {
      updateApp(app.id, { title: e.title });
      // Badge de messages non lus à partir du titre : "(2) Gmail" → 2
      const m = /^\((\d+)\)/.exec(e.title || '');
      const unread = m ? parseInt(m[1], 10) : 0;
      updateApp(app.id, { unread });

      // Notification SEULEMENT si le compteur dépasse le plafond déjà notifié
      // (et app non active, non coupée) → une notif par vague de messages, pas
      // à chaque clignotement de titre.
      // « En avant-plan » = app active ET fenêtre visible/focus. Si Orbit est
      // masqué/minimisé (ex. raccourci global), on notifie même l'app active.
      const inForeground = active && !document.hidden && document.hasFocus();
      if (
        unread > unreadRef.current &&
        !inForeground &&
        notificationsEnabled &&
        !app.muted &&
        !notificationsSilenced({ dnd, quietHoursEnabled, quietStart, quietEnd }) &&
        window.electronAPI?.showNotification
      ) {
        unreadRef.current = unread; // on monte le plafond
        // Son personnalisé (joué ici) → on coupe le son système côté natif
        if (notifSound) {
          try {
            new Audio(notifSound).play().catch(() => {});
          } catch {
            /* ignore */
          }
        }
        window.electronAPI.showNotification({
          title: app.name,
          body: `${unread} nouveau${unread > 1 ? 'x' : ''} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`,
          // Permet à un clic sur la notification d'ouvrir cette app précise
          appId: app.id,
          silent: !!notifSound,
        });
      }

      // Lecture réelle : compteur à 0 pendant 5 s → on réarme le plafond
      // (un futur message re-notifiera). Le passage transitoire à 0 dû au
      // clignotement ne réarme pas (le compteur redevient >0 avant le délai).
      clearTimeout(zeroTimerRef.current);
      if (unread === 0) {
        zeroTimerRef.current = setTimeout(() => {
          unreadRef.current = 0;
        }, 5000);
      }
    };

    const handleFavicon = (e) => {
      const icon = e.favicons && e.favicons.length > 0 ? e.favicons[0] : undefined;
      if (icon) updateApp(app.id, { favicon: icon });
    };

    const handleDidFailLoad = (e) => {
      // -3 = ERR_ABORTED : navigation remplacée par une autre (redirections
      // normales de Gmail/Slack…). Bénin, on ne l'affiche pas comme erreur.
      if (e.errorCode === -3) return;
      console.warn('[orbit] échec de chargement', app.name, e.errorCode, e.errorDescription);
    };

    // Indicateur de chargement. Deux vitesses :
    //   - le bouton Actualiser de la Topbar tourne IMMÉDIATEMENT (retour
    //     visuel au clic, comme dans un navigateur)
    //   - le voile plein cadre n'apparaît qu'après 500 ms, pour ne pas
    //     clignoter sur les recharges rapides (redirections…)
    const startLoading = () => {
      setAppLoading(app.id, true);
      clearTimeout(loadingTimer.current);
      loadingTimer.current = setTimeout(() => setLoading(true), 500);
    };
    const stopLoading = () => {
      setAppLoading(app.id, false);
      clearTimeout(loadingTimer.current);
      setLoading(false);
    };

    // Appliquer le zoom mémorisé une fois la page chargée + marquer prêt
    const applyZoom = () => {
      domReadyRef.current = true;
      try {
        wv.setZoomFactor(Math.min(3, Math.max(0.5, app.zoom || 1)));
      } catch {
        /* ignore */
      }
    };

    // « Lecture en cours » : quand un média démarre, on lit ses métadonnées
    // (Media Session + position/durée) et on met à jour le store → mini-barre
    // + mini-lecteur flottant. On rafraîchit la position toutes les secondes
    // PENDANT la lecture (pour la barre de progression), pas quand c'est en pause.
    let pollTimer = null;
    const readMedia = () => {
      if (!domReadyRef.current) return;
      try {
        const p = wv.executeJavaScript(READ_MEDIA_FN);
        if (p && typeof p.then === 'function') {
          p.then((info) => {
            if (info && (info.hasMedia || info.title)) {
              setMedia(app.id, {
                playing: !info.paused,
                hasMedia: info.hasMedia,
                currentTime: info.currentTime,
                duration: info.duration,
                title: info.title,
                artist: info.artist,
                artwork: info.artwork,
              });
            }
          }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    };
    const startPolling = () => {
      clearInterval(pollTimer);
      pollTimer = setInterval(readMedia, 1000);
    };
    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = null;
    };
    const onMediaPlay = () => {
      readMedia();
      startPolling();
    };
    const onMediaPaused = () => {
      readMedia();
      stopPolling();
    };

    wv.addEventListener('media-started-playing', onMediaPlay);
    wv.addEventListener('media-paused', onMediaPaused);
    wv.addEventListener('dom-ready', applyZoom);
    wv.addEventListener('did-navigate', handleNavigate);
    wv.addEventListener('did-navigate-in-page', handleNavigate);
    wv.addEventListener('page-title-updated', handleTitle);
    wv.addEventListener('favicon-updated', handleFavicon);
    wv.addEventListener('did-fail-load', handleDidFailLoad);
    wv.addEventListener('did-start-loading', startLoading);
    wv.addEventListener('did-stop-loading', stopLoading);

    return () => {
      unregisterWebview(app.id);
      // Démontage (veille, suppression…) : le chargement ne peut plus finir,
      // sinon le bouton Actualiser tournerait indéfiniment.
      setAppLoading(app.id, false);
      clearMedia(app.id);
      clearInterval(pollTimer);
      clearTimeout(loadingTimer.current);
      clearTimeout(zeroTimerRef.current);
      wv.removeEventListener('media-started-playing', onMediaPlay);
      wv.removeEventListener('media-paused', onMediaPaused);
      wv.removeEventListener('dom-ready', applyZoom);
      wv.removeEventListener('did-navigate', handleNavigate);
      wv.removeEventListener('did-navigate-in-page', handleNavigate);
      wv.removeEventListener('page-title-updated', handleTitle);
      wv.removeEventListener('favicon-updated', handleFavicon);
      wv.removeEventListener('did-fail-load', handleDidFailLoad);
      wv.removeEventListener('did-start-loading', startLoading);
      wv.removeEventListener('did-stop-loading', stopLoading);
    };
  }, [app.id, app.name, app.zoom, app.sleeping, app.muted, active, notificationsEnabled, notifSound, dnd, quietHoursEnabled, quietStart, quietEnd, updateApp, setAppLoading, setMedia, clearMedia]);

  // Quand on ouvre l'app (elle devient active), on la considère LUE : on réarme
  // le plafond de notifications → un prochain message re-notifiera.
  useEffect(() => {
    if (active) {
      unreadRef.current = 0;
      clearTimeout(zeroTimerRef.current);
    }
  }, [active]);

  // Zoom en temps réel : re-appliqué dès que le réglage change (boutons − / % / +)
  useEffect(() => {
    const wv = ref.current;
    if (!wv || app.sleeping || typeof wv.setZoomFactor !== 'function') return;
    try {
      wv.setZoomFactor(Math.min(3, Math.max(0.5, app.zoom || 1)));
    } catch {
      /* ignore */
    }
  }, [app.zoom, app.sleeping]);

  // Donner le focus au webview quand l'app devient active, et forcer un
  // re-composite peu après (anti « page blanche » après masquage : certaines
  // pages complexes perdent leur surface GPU pendant qu'elles sont cachées).
  useEffect(() => {
    if (!active || !ref.current) return;
    const wv = ref.current;
    wv.focus();
    const t = setTimeout(() => {
      try {
        // Ré-appliquer le même zoom force le guest à se re-peindre
        wv.setZoomFactor(Math.min(3, Math.max(0.5, app.zoom || 1)));
      } catch {
        /* ignore */
      }
    }, 80);
    return () => clearTimeout(t);
  }, [active, app.zoom]);

  // Picture-in-Picture automatique : quand on QUITTE une app dont une vidéo
  // joue, on la sort en mini-fenêtre flottante (PiP natif Chromium) ; quand on
  // REVIENT, on referme le PiP. userGesture=true satisfait l'exigence de geste
  // utilisateur de l'API requestPictureInPicture.
  useEffect(() => {
    const wv = ref.current;
    // Ne rien faire tant que la page n'est pas prête (sinon executeJavaScript
    // lève une exception synchrone : webview non attaché / pas de dom-ready).
    if (!wv || app.sleeping || !domReadyRef.current || typeof wv.executeJavaScript !== 'function') {
      return;
    }
    const code =
      !active && autoPip
        ? `(() => { try { const v=[...document.querySelectorAll('video')].find(x=>!x.paused && x.readyState>2 && !x.disablePictureInPicture); if (v && !document.pictureInPictureElement && v.requestPictureInPicture) v.requestPictureInPicture().catch(()=>{}); } catch(e){} })()`
        : active
          ? `(() => { try { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{}); } catch(e){} })()`
          : null;
    if (!code) return;
    try {
      const p = wv.executeJavaScript(code, true);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* webview pas prêt : on ignore */
    }
  }, [active, autoPip, app.sleeping]);

  // App en veille → pas de webview du tout : la page est fermée.
  // Au réveil, elle se recharge à neuf.
  if (app.sleeping) return null;

  return (
    <div
      // Même logique de masquage qu'avant, mais sur le conteneur : le webview
      // reste plein cadre, et l'indicateur de chargement s'affiche par-dessus.
      style={{
        position: visible ? 'relative' : 'absolute',
        inset: visible ? undefined : 0,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
        // En écran partagé, le webview remplit sa cellule (la taille est
        // pilotée par le conteneur : pane flex/grille + séparateur ajustable)
        ...(visible && flexLayout ? { width: '100%', height: '100%' } : {}),
      }}
      className="w-full h-full min-w-0 min-h-0"
    >
      <webview
        ref={ref}
        src={startUrl}
        // Partition (« coffre à cookies ») : soit propre à l'app (sessions
        // isolées, plusieurs comptes possibles), soit partagée avec tout le
        // profil (mode « navigateur » → SSO Google entre Gmail/YouTube/Drive).
        // Voir lib/session.js.
        partition={appPartition(app, sharedSession)}
        useragent={CHROME_UA}
        allowpopups="true"
        className="w-full h-full min-w-0 min-h-0"
        // NB : le preload KeePassXC (détection/remplissage) est injecté par le
        // main process dans 'will-attach-webview' — pas d'attribut ici.
      />
      {/* Indicateur de chargement : fine barre de progression EN HAUT, discrète,
          dans la couleur d'accent du thème (aucun voile plein cadre → on garde
          la page visible pendant le rechargement, comme un vrai navigateur). */}
      {loading && visible && (
        <div className="orbit-progress" aria-hidden="true">
          <div className="orbit-progress__bar" />
        </div>
      )}
    </div>
  );
}
