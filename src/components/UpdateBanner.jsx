import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useT } from '../lib/i18n';

// Bannière discrète de mise à jour (electron-updater). S'affiche quand une
// version est disponible / en cours de téléchargement / prête à installer.
export default function UpdateBanner() {
  const [status, setStatus] = useState(null); // 'available' | 'progress' | 'downloaded' | 'error'
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const t = useT();

  useEffect(() => {
    const off = window.electronAPI?.onUpdate?.((type, payload) => {
      if (type === 'available') {
        setVersion(payload?.version || '');
        setStatus('available');
        setDismissed(false);
      } else if (type === 'progress') {
        setStatus('progress');
        setPercent(payload?.percent || 0);
      } else if (type === 'downloaded') {
        setVersion(payload?.version || '');
        setStatus('downloaded');
        setDismissed(false);
      } else if (type === 'error') {
        setStatus(null);
      }
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  if (!status || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] max-w-sm bg-bg-elevated border border-border rounded-xl shadow-2xl p-3.5 app-no-drag">
      {status === 'downloaded' ? (
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/15 flex items-center justify-center flex-shrink-0">
            <RefreshCw size={18} className="text-accent-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">
              {t('update.ready')} {version && `(${version})`}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{t('update.readyDesc')}</p>
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => window.electronAPI?.installUpdate?.()}
                className="btn btn-primary btn-sm"
              >
                {t('update.restart')}
              </button>
              <button onClick={() => setDismissed(true)} className="btn btn-ghost btn-sm">
                {t('update.later')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent-primary/15 flex items-center justify-center flex-shrink-0">
            <Download size={18} className="text-accent-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">
              {status === 'progress'
                ? t('update.downloading', { percent })
                : t('update.available', { version })}
            </p>
            {status === 'progress' && (
              <div className="h-1.5 bg-bg-hover rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full bg-accent-primary transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
          </div>
          <button onClick={() => setDismissed(true)} className="btn-icon w-7 h-7" title="Masquer">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
