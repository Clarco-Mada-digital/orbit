import { useRef, useState } from 'react';
import { Download, Music, Video, Check, AlertTriangle } from 'lucide-react';
import { shouldOfferMedia, surfaceFlags } from '../../lib/mediaDetect';
import { useT } from '../../lib/i18n';
import { useDismiss } from '../../lib/useDismiss';

// ---------------------------------------------------------------------------
// Pastille « média téléchargeable » de la barre d'Orbit.
//
// L'autre surface du même geste (voir electron/media-button-preload.cjs, qui
// pose un bouton SUR la vidéo). Celle-ci n'injecte RIEN dans la page : elle
// juge sur l'URL de l'app active. C'est le choix de qui préfère une page
// intacte — et la seule option possible sur un site dont le lecteur n'aime pas
// qu'on lui superpose quoi que ce soit.
//
// Le bouton n'EXISTE que quand il y a quelque chose à télécharger : une
// pastille grisée en permanence est du bruit, et apprend à ne plus la voir.
// ---------------------------------------------------------------------------
export default function MediaDownloadButton({ app, partition, align = 'right' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Le retour est MÉMORISÉ AVEC l'adresse qui l'a produit. Sans ça, changer de
  // page gardait affichée la coche verte du téléchargement précédent — une
  // confirmation qui ne porte plus sur ce qu'on regarde est un mensonge. Le
  // comparer à l'URL courante évite aussi de remettre l'état à zéro dans un
  // effet, qui provoque un rendu de plus à chaque navigation.
  const [sent, setSent] = useState({ url: '', value: null }); // 'sending' | 'ok' | 'error'
  const ref = useRef(null);
  useDismiss(ref, open, () => setOpen(false));

  const url = app?.url || '';
  const { offer } = shouldOfferMedia({ url });
  const status = sent.url === url ? sent.value : null;

  if (!offer) return null;

  const ask = async (mode) => {
    setSent({ url, value: 'sending' });
    let value = 'ok';
    try {
      // La partition est transmise : sans elle, le processus principal lirait
      // les cookies de la fenêtre d'Orbit, qui n'en a aucun pour le site.
      const res = await window.electronAPI?.downloadMedia?.(url, mode, partition);
      if (res && res.success === false) value = 'error';
    } catch {
      value = 'error';
    }
    setSent({ url, value });
    setOpen(false);
    setTimeout(() => setSent((prev) => (prev.url === url ? { url, value: null } : prev)), 4000);
  };

  const Icon = status === 'ok' ? Check : status === 'error' ? AlertTriangle : Download;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`btn-icon relative ${
          status === 'ok' ? 'text-success' : status === 'error' ? 'text-error' : 'text-accent-primary'
        }`}
        title={t('media.topbarTitle')}
        aria-label={t('media.topbarTitle')}
      >
        <Icon size={18} className={status === 'sending' ? 'animate-pulse' : ''} />
      </button>

      {open && (
        <div
          className={`absolute top-full mt-1 ${
            align === 'left' ? 'left-0' : 'right-0'
          } w-56 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}
        >
          <button
            onClick={() => ask('video')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-bg-hover text-left"
          >
            <Video size={16} className="text-accent-primary flex-shrink-0" />
            {t('media.downloadVideo')}
          </button>
          <button
            onClick={() => ask('audio')}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-bg-hover text-left border-t border-border"
          >
            <Music size={16} className="text-accent-primary flex-shrink-0" />
            {t('media.downloadAudio')}
          </button>
        </div>
      )}
    </div>
  );
}

// Le module ne s'affiche que si le réglage le demande. Exporté à part pour que
// la barre puisse décider SANS monter le composant.
export function topbarEnabled(setting) {
  return surfaceFlags(setting).topbar;
}
