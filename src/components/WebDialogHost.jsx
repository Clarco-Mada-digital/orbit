import { useCallback, useEffect, useState } from 'react';
import WebDialog from './WebDialog';
import { useStore } from '../stores/useStore';
import { getRegisteredWebviews } from '../lib/webviewRegistry';

// ---------------------------------------------------------------------------
// Point d'arrivée des questions posées par les apps
//
// Monté une seule fois, au-dessus de toute l'interface — pas dans chaque
// <webview>. C'est important : une app en arrière-plan qui appelle confirm()
// est figée tant qu'on n'a pas répondu, et sa modale doit rester visible même
// si l'app n'est pas celle qu'on regarde. On bascule d'ailleurs sur l'app
// concernée pour que la question ait un contexte.
//
// Les demandes arrivent une par une : le processus principal en garde la trace
// et attend la réponse. Si deux apps parlent en même temps, on répond à la
// première et les suivantes patientent dans la file.
// ---------------------------------------------------------------------------
export default function WebDialogHost() {
  const [queue, setQueue] = useState([]);
  const apps = useStore((s) => s.apps);
  const setActiveApp = useStore((s) => s.setActiveApp);
  const activeApp = useStore((s) => s.activeApp);

  // À quelle app appartient le webview qui pose la question ? Le processus
  // principal ne connaît que l'identifiant du contenu web ; le nom, lui, est
  // ici.
  const appForContents = useCallback((wcId) => {
    if (!wcId) return null;
    for (const [appId, wv] of getRegisteredWebviews()) {
      try {
        if (wv.getWebContentsId() === wcId) return appId;
      } catch {
        /* webview pas encore attaché */
      }
    }
    return null;
  }, []);

  useEffect(() => {
    const api = window.electronAPI?.webDialog;
    if (!api?.onShow) return undefined;

    const offShow = api.onShow((info) => {
      if (!info?.id) return;
      const appId = appForContents(info.wcId);
      const app = appId ? apps.find((a) => a.id === appId) : null;
      // On confirme tout de suite la prise en charge : sans cet accusé, le
      // processus principal considère au bout de 3 s que la modale ne s'est
      // pas affichée et débloque la page sans nous.
      window.electronAPI?.webDialog?.ack?.(info.id);
      setQueue((q) => (q.some((d) => d.id === info.id) ? q : [...q, { ...info, appId, appName: app?.name }]));
    });

    // Demande abandonnée côté page (délai dépassé, app rechargée) : la modale
    // n'a plus lieu d'être.
    const offClose = api.onClose?.(({ id } = {}) => {
      setQueue((q) => q.filter((d) => d.id !== id));
    });

    return () => {
      offShow?.();
      offClose?.();
    };
  }, [apps, appForContents]);

  const current = queue[0] || null;

  // La question vient d'une autre app : on l'affiche, donc on l'ouvre.
  useEffect(() => {
    if (current?.appId && current.appId !== activeApp) setActiveApp(current.appId);
  }, [current?.id, current?.appId, activeApp, setActiveApp]);

  const answer = useCallback(
    (payload) => {
      if (!current) return;
      window.electronAPI?.webDialog?.answer?.({ id: current.id, ...payload });
      setQueue((q) => q.filter((d) => d.id !== current.id));
    },
    [current]
  );

  return <WebDialog dialog={current} onAnswer={answer} />;
}
