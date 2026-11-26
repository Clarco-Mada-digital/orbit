import { useEffect, useState } from 'react';
import { Languages, X } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { getWebContentsIdFor } from '../lib/webviewRegistry';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// « Cette page est en anglais · Traduire en français » — proposition discrète,
// DÉSACTIVÉE par défaut (Réglages → Traduction). Elle n'apparaît que pour la
// page affichée, d'après la langue que la page déclare elle-même (<html
// lang>) : rien ne part sur le réseau avant le clic. Elle s'efface seule.
// ---------------------------------------------------------------------------
export default function TranslateOffer() {
  const t = useT();
  const [offer, setOffer] = useState(null); // { webContentsId, langName, targetName }
  const activeApp = useStore((s) => s.activeApp);

  useEffect(() => {
    const off = window.electronAPI?.onTranslateOffer?.((payload) => {
      if (!payload) return;
      // Seulement pour la page qu'on regarde.
      const appId = useStore.getState().activeApp;
      if (getWebContentsIdFor(appId) !== payload.webContentsId) return;
      setOffer({ ...payload, appId });
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Elle s'efface d'elle-même, et ne suit pas quand on change d'app.
  useEffect(() => {
    if (!offer) return undefined;
    const timer = setTimeout(() => setOffer(null), 10000);
    return () => clearTimeout(timer);
  }, [offer]);

  if (!offer || offer.appId !== activeApp) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[10000] -translate-x-1/2 flex items-center gap-2 rounded-full border border-border bg-bg-elevated/95 backdrop-blur-sm py-1 pl-3 pr-1 text-xs shadow-lg animate-scale-in app-no-drag"
    >
      <Languages size={14} className="text-accent-primary" />
      <span className="text-text-secondary">{t('tr.offer', { lang: offer.langName })}</span>
      <button
        type="button"
        onClick={() => {
          window.electronAPI?.translatePage?.(offer.webContentsId, 'on')?.catch?.(() => {});
          setOffer(null);
        }}
        className="rounded-full bg-accent-primary/15 px-2.5 py-1 font-medium text-accent-primary hover:bg-accent-primary/25"
      >
        {t('tr.offerAction', { lang: offer.targetName })}
      </button>
      <button
        type="button"
        onClick={() => {
          const st = useStore.getState();
          const list = st.settings.translateAlways || [];
          if (!list.includes(offer.lang)) st.updateSettings({ translateAlways: [...list, offer.lang] });
          window.electronAPI?.translatePage?.(offer.webContentsId, 'on')?.catch?.(() => {});
          setOffer(null);
        }}
        className="rounded-full px-2 py-1 text-text-secondary hover:bg-bg-hover"
        title={t('tr.alwaysHint')}
      >
        {t('tr.always', { lang: offer.langName })}
      </button>
      {offer.site && (
        <button
          type="button"
          onClick={() => {
            const st = useStore.getState();
            const list = st.settings.translateNever || [];
            if (!list.includes(offer.site)) st.updateSettings({ translateNever: [...list, offer.site] });
            setOffer(null);
          }}
          className="rounded-full px-2 py-1 text-text-secondary hover:bg-bg-hover"
        >
          {t('tr.never')}
        </button>
      )}
      <button type="button" onClick={() => setOffer(null)} className="btn-icon w-6 h-6" title={t('tr.offerDismiss')}>
        <X size={12} />
      </button>
    </div>
  );
}
