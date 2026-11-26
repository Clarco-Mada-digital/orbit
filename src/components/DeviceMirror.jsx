import { useEffect, useRef } from 'react';
import { zoomPlan } from '../lib/responsive';
import { CHROME_UA } from '../lib/userAgent';

// Un appareil de plus dans la vue « Multi » : la même adresse, sur la MÊME
// session que la page (même connexion), à la taille de l'appareil et à
// l'échelle commune. Le défilement et la navigation sont synchronisés par
// WebView.jsx, qui garde la main sur tous les appareils via `register`.
export default function DeviceMirror({ device, url, partition, scale, register }) {
  const ref = useRef(null);
  // Zoom partagé : les appareils de la vue Multi sont sur le même site et la
  // même session, où Chromium garde UN zoom par site (voir zoomPlan).
  const plan = zoomPlan({ width: device.width, height: device.height }, scale, { shared: true });
  const zoom = plan.zoom;

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    register(device.id, wv);
    return () => register(device.id, null);
  }, [device.id, register]);

  // Zoom = échelle d'affichage : la page voit la largeur RÉELLE de l'appareil
  // (voir zoomPlan). Réappliqué à chaque chargement, que Chromium remet à 1.
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    const apply = () => {
      try {
        wv.setZoomFactor(zoom);
      } catch {
        /* pas encore prêt */
      }
    };
    apply();
    wv.addEventListener('dom-ready', apply);
    // Ctrl + molette dans cet appareil : la page s'est zoomée d'elle-même
    // (preload) ; WebView.jsx demande qu'on rétablisse le bon zoom.
    window.addEventListener('orbit:mirrors-rezoom', apply);
    return () => {
      wv.removeEventListener('dom-ready', apply);
      window.removeEventListener('orbit:mirrors-rezoom', apply);
    };
  }, [zoom]);

  return (
    <div
      className="relative flex-shrink-0"
      style={{
        width: plan.boxWidth,
        height: plan.boxHeight,
        boxShadow: '0 0 0 1px rgba(127,127,127,.35), 0 12px 40px rgba(0,0,0,.35)',
      }}
    >
      <span className="absolute -top-6 left-0 text-[11px] text-text-muted whitespace-nowrap">
        {device.name} · {device.width} × {device.height}
      </span>
      <webview
        ref={ref}
        src={url}
        partition={partition}
        // L'agent utilisateur de l'appareil, posé dès le premier chargement :
        // le site sert directement sa version mobile ou tablette.
        useragent={device.ua || CHROME_UA}
        className="flex"
        style={{ width: plan.boxWidth, height: plan.boxHeight }}
      />
    </div>
  );
}
