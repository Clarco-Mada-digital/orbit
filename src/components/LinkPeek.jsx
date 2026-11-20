import { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Columns2, AppWindow, Globe, Copy, Check, Loader2 } from 'lucide-react';
import { CHROME_UA } from '../lib/userAgent';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Aperçu de lien.
//
// Un lien ouvert « à côté » depuis une app (Ctrl+clic, clic molette,
// target=_blank) ne crée plus directement une fenêtre détachée : il s'affiche
// d'abord ICI, par-dessus l'app, dans la MÊME session que l'app d'origine
// (on y est donc connecté). La barre de gauche propose la suite :
//
//   ✕  fermer (clic sur le fond, Échap quand le focus est dans Orbit, Alt+W)
//   ⤢  ouvrir dans Orbit (page volante)
//   ▥  ouvrir à côté de l'app courante (écran partagé)
//   ▢  fenêtre détachée (session de l'app conservée)
//   🌐 navigateur du système
//
// Les actions portent sur l'adresse COURANTE de l'aperçu : si l'on y a suivi
// un lien ou une redirection, c'est la page qu'on regarde qui part, pas celle
// qui a été cliquée.
// ---------------------------------------------------------------------------
const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export default function LinkPeek({ peek, onClose, onOpenInOrbit, onOpenSplit }) {
  const t = useT();
  const ref = useRef(null);
  const [current, setCurrent] = useState(peek.url);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    const onNav = (e) => {
      if (e.url && /^https?:/i.test(e.url)) setCurrent(e.url);
    };
    const onInPage = (e) => {
      if (e.isMainFrame && e.url) setCurrent(e.url);
    };
    const onTitle = (e) => setTitle(e.title || '');
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onInPage);
    wv.addEventListener('page-title-updated', onTitle);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    return () => {
      wv.removeEventListener('did-navigate', onNav);
      wv.removeEventListener('did-navigate-in-page', onInPage);
      wv.removeEventListener('page-title-updated', onTitle);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
    };
  }, []);

  // Échap ferme — quand le focus est dans l'interface. (Dans la page de
  // l'aperçu, Échap appartient à la page ; Alt+W reste disponible.)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const detach = () => {
    window.electronAPI?.peekDetach?.({ url: current, partition: peek.partition });
    onClose();
  };
  const external = () => {
    window.electronAPI?.openOutside?.(current);
    onClose();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* presse-papiers indisponible */
    }
  };

  const actions = [
    { id: 'close', icon: X, label: t('peek.close'), run: onClose },
    { id: 'orbit', icon: Maximize2, label: t('peek.openInOrbit'), run: () => onOpenInOrbit(current) },
    { id: 'split', icon: Columns2, label: t('peek.openSplit'), run: () => onOpenSplit(current) },
    { id: 'detach', icon: AppWindow, label: t('peek.detach'), run: detach },
    { id: 'external', icon: Globe, label: t('peek.external'), run: external },
  ];

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/55 flex items-center justify-center animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-label={t('peek.title')}
    >
      <div className="relative flex items-stretch gap-3 w-[min(1180px,calc(100vw-7rem))] h-[calc(100vh-5rem)]">
        {/* Barre d'actions, à gauche de la page */}
        <div className="flex flex-col gap-2 pt-1 flex-shrink-0">
          {actions.map(({ id, icon: Icon, label, run }) => (
            <button
              key={id}
              onClick={run}
              title={label}
              aria-label={label}
              className={`group relative w-9 h-9 rounded-full flex items-center justify-center shadow-lg border border-border transition-colors ${
                id === 'close'
                  ? 'bg-bg-elevated text-text-primary hover:bg-error hover:text-white hover:border-error'
                  : 'bg-bg-elevated text-text-secondary hover:text-accent-primary hover:border-accent-primary'
              }`}
            >
              <Icon size={16} />
              <span className="pointer-events-none absolute left-11 whitespace-nowrap rounded-md bg-bg-elevated border border-border px-2 py-1 text-xs text-text-primary opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* La page */}
        <div className="flex-1 min-w-0 flex flex-col rounded-xl overflow-hidden border border-border bg-bg-primary shadow-2xl">
          <div className="flex items-center gap-2 px-3 h-9 border-b border-border bg-bg-secondary text-xs flex-shrink-0">
            {loading ? (
              <Loader2 size={13} className="animate-spin text-accent-primary flex-shrink-0" />
            ) : (
              <Globe size={13} className="text-text-muted flex-shrink-0" />
            )}
            <span className="font-medium truncate max-w-[45%]">{title || hostOf(current)}</span>
            <span className="text-text-muted truncate flex-1 font-mono" title={current}>
              {current}
            </span>
            <button onClick={copy} className="btn-icon flex-shrink-0" title={t('peek.copy')}>
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
          </div>
          <webview
            ref={ref}
            src={peek.url}
            partition={peek.partition}
            useragent={CHROME_UA}
            allowpopups="true"
            className="flex-1 w-full min-h-0"
          />
        </div>
      </div>
    </div>
  );
}
