import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../stores/useStore';
import { useLoadingStore } from '../lib/loadingStore';
import { registerWebview, unregisterWebview } from '../lib/webviewRegistry';
import { computeStartUrl } from '../lib/urls';
import { recipes } from '../lib/recipes';
import { CHROME_UA } from '../lib/userAgent';

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
  const updateApp = useStore((s) => s.updateApp);
  const setAppLoading = useLoadingStore((s) => s.setAppLoading);
  const notificationsEnabled = useStore((s) => s.settings?.notifications !== false);
  const unreadRef = useRef(app.unread || 0);

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

      // Notification système quand le compteur augmente et que l'app n'est
      // pas au premier plan (ne spamme pas l'app qu'on est en train d'utiliser)
      if (
        unread > 0 &&
        unread > unreadRef.current &&
        !active &&
        notificationsEnabled &&
        window.electronAPI?.showNotification
      ) {
        window.electronAPI.showNotification({
          title: app.name,
          body: `${unread} nouveau${unread > 1 ? 'x' : ''} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`,
        });
      }
      unreadRef.current = unread;
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

    // Appliquer le zoom mémorisé une fois la page chargée
    const applyZoom = () => {
      try {
        wv.setZoomFactor(Math.min(3, Math.max(0.5, app.zoom || 1)));
      } catch {
        /* ignore */
      }
    };

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
      clearTimeout(loadingTimer.current);
      wv.removeEventListener('dom-ready', applyZoom);
      wv.removeEventListener('did-navigate', handleNavigate);
      wv.removeEventListener('did-navigate-in-page', handleNavigate);
      wv.removeEventListener('page-title-updated', handleTitle);
      wv.removeEventListener('favicon-updated', handleFavicon);
      wv.removeEventListener('did-fail-load', handleDidFailLoad);
      wv.removeEventListener('did-start-loading', startLoading);
      wv.removeEventListener('did-stop-loading', stopLoading);
    };
  }, [app.id, app.name, app.zoom, app.sleeping, active, notificationsEnabled, updateApp, setAppLoading]);

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
        // Session UNIQUE par app : deux comptes de la même app (ex. deux Gmail)
        // n'ont aucun cookie en commun. Chaque instance = un compte séparé.
        partition={`persist:${app.profileId}:${app.id}`}
        useragent={CHROME_UA}
        allowpopups="true"
        className="w-full h-full min-w-0 min-h-0"
        // NB : le preload KeePassXC (détection/remplissage) est injecté par le
        // main process dans 'will-attach-webview' — pas d'attribut ici.
      />
      {/* Indicateur : visible quand la page recharge (>= 500 ms) */}
      {loading && visible && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ zIndex: 20, background: 'rgba(10, 10, 15, 0.55)', pointerEvents: 'none' }}
        >
          <div className="w-10 h-10 rounded-full border-[3px] border-indigo-500/30 border-t-indigo-400 animate-spin" />
        </div>
      )}
    </div>
  );
}
