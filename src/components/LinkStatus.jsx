import { useEffect, useState } from 'react';
import { useStore } from '../stores/useStore';

// Bulle « adresse du lien survolé », comme la barre d'état d'un navigateur.
//
// Elle se pose en bas de la page, un peu décollée du bord, et prend le côté
// LIBRE : pointeur dans la moitié gauche → bulle à droite, et inversement.
// Sinon elle masquerait justement ce qu'on est en train de survoler.
//
// Le <webview> ne transmet pas ses mouvements de souris à l'interface d'Orbit :
// la position du pointeur est donc demandée au processus principal (même
// lecture que le studio d'enregistrement). Si elle est indisponible, on reste
// à gauche, la place habituelle des navigateurs.

// Une adresse lisible : les caractères accentués et les espaces encodés
// (%C3%A9, %20…) sont décodés quand c'est possible.
function readable(url) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

async function freeSide(wv) {
  try {
    const p = await window.electronAPI?.studio?.cursor?.();
    if (!p || typeof p.x !== 'number') return 'left';
    const rect = wv.getBoundingClientRect();
    const x = p.x - window.screenX;
    return x < rect.left + rect.width / 2 ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

export default function LinkStatus({ webviewRef, visible }) {
  const enabled = useStore((s) => s.settings?.linkStatus !== false);
  const [status, setStatus] = useState({ url: '', side: 'left' });

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !enabled) return undefined;
    let hideTimer = null;
    // Numéro de la dernière demande : une réponse plus ancienne est ignorée.
    let seq = 0;
    let closed = false;

    const onTarget = async (e) => {
      const url = e?.url || '';
      const n = ++seq;
      clearTimeout(hideTimer);
      // Un court délai avant de masquer : passer d'un lien à son voisin ne
      // doit pas faire clignoter la bulle.
      if (!url) {
        hideTimer = setTimeout(() => setStatus((s) => (s.url ? { ...s, url: '' } : s)), 150);
        return;
      }
      const side = await freeSide(wv);
      // Une réponse plus récente est déjà arrivée : on ne revient pas en arrière.
      if (closed || n !== seq) return;
      setStatus({ url, side });
    };

    wv.addEventListener('update-target-url', onTarget);
    return () => {
      clearTimeout(hideTimer);
      wv.removeEventListener('update-target-url', onTarget);
      closed = true;
      setStatus((s) => (s.url ? { ...s, url: '' } : s));
    };
  }, [webviewRef, enabled]);

  const shown = enabled && visible && !!status.url;

  return (
    <div
      aria-hidden="true"
      className={`orbit-link-status ${status.side === 'right' ? 'is-right' : 'is-left'} ${shown ? 'is-shown' : ''}`}
    >
      {readable(status.url)}
    </div>
  );
}
