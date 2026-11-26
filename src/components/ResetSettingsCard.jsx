import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

// « Repartir de zéro » : remet les préférences d'Orbit à leurs valeurs
// d'origine. La confirmation se fait dans la carte elle-même (pas de boîte
// système, qui figerait les pages ouvertes). Apps, profils, coffre et
// connexions restent en place : c'est un retour aux réglages d'usine, pas un
// effacement des données.
export default function ResetSettingsCard() {
  const t = useT();
  const resetSettings = useStore((s) => s.resetSettings);
  const setOnboarded = useStore((s) => s.setOnboarded);
  const [confirming, setConfirming] = useState(false);
  const [withWelcome, setWithWelcome] = useState(false);
  const [done, setDone] = useState(false);

  const run = () => {
    resetSettings();
    if (withWelcome) setOnboarded(false);
    setConfirming(false);
    setWithWelcome(false);
    setDone(true);
  };

  return (
    <div className="card">
      <h4 className="font-semibold mb-2">{t('about.reset')}</h4>
      <p className="text-sm text-text-muted mb-1">{t('about.resetDesc')}</p>
      <p className="text-xs text-text-muted mb-3">{t('about.resetBackup')}</p>

      {!confirming ? (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => {
              setDone(false);
              setConfirming(true);
            }}
            className="btn btn-secondary btn-sm"
          >
            <RotateCcw size={14} /> {t('about.resetButton')}
          </button>
          {done && <span className="text-xs text-success">{t('about.resetDone')}</span>}
        </div>
      ) : (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-3">
          <p className="text-sm font-medium">{t('about.resetConfirm')}</p>
          <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={withWelcome}
              onChange={(e) => setWithWelcome(e.target.checked)}
            />
            {t('about.resetWelcome')}
          </label>
          <div className="flex gap-2">
            <button onClick={run} className="btn btn-primary btn-sm">
              {t('about.resetYes')}
            </button>
            <button onClick={() => setConfirming(false)} className="btn btn-secondary btn-sm">
              {t('about.resetCancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
