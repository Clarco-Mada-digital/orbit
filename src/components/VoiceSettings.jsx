import { useCallback, useEffect, useState } from 'react';
import { Volume2, Download, Trash2, Play, Square, AudioLines, HardDrive } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Réglages → Lecture vocale
//
// Deux moteurs : celui du système (immédiat, déjà là, robotique) et Piper
// (voix neuronales hors ligne, nettement plus naturelles, mais ~26 Mo de moteur
// et 28 à 120 Mo par voix).
//
// Rien n'est téléchargé, lancé ni même chargé sans un clic explicite : cet
// écran est le seul endroit d'où Piper peut être installé, et tant qu'il ne
// l'est pas, Orbit ne le touche jamais.
// ---------------------------------------------------------------------------
const api = () => window.electronAPI?.tts;

export default function VoiceSettings() {
  const t = useT();
  const { settings, updateSettings } = useStore();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const cfg = settings.tts || { engine: 'system', voiceId: '' };

  const refresh = useCallback(async () => {
    const res = await api()?.state();
    if (res?.success) setState(res);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => api()?.onProgress?.(setProgress), []);

  const withBusy = async (key, fn) => {
    setBusy(key);
    setError('');
    setProgress(null);
    const res = await fn();
    setBusy('');
    setProgress(null);
    if (res && res.success === false) setError(res.error || t('vs.failed'));
    await refresh();
    return res;
  };

  const pct = progress?.total ? Math.round((progress.received / progress.total) * 100) : null;

  const setEngine = (engine) => updateSettings({ tts: { ...cfg, engine } });
  const setVoice = (voiceId) => updateSettings({ tts: { ...cfg, engine: 'piper', voiceId } });

  const installed = state?.piper?.voices || [];
  const catalog = state?.piper?.catalog || [];
  const systemEngine = state?.system?.engine;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <AudioLines size={18} /> {t('vs.title')}
        </h3>
        <p className="text-sm text-text-muted">{t('vs.desc')}</p>
      </div>

      {/* Moteur du système */}
      <label className="card flex items-start gap-3 cursor-pointer">
        <input
          type="radio"
          checked={cfg.engine !== 'piper'}
          onChange={() => setEngine('system')}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="font-medium">{t('vs.system')}</div>
          <div className="text-sm text-text-muted mt-0.5">
            {systemEngine
              ? t('vs.systemFound', { engine: systemEngine })
              : state?.system?.hint || t('vs.systemMissing')}
          </div>
        </div>
      </label>

      {/* Piper */}
      <div className="card space-y-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            checked={cfg.engine === 'piper'}
            onChange={() => setEngine('piper')}
            disabled={!state?.piper?.installed || installed.length === 0}
            className="mt-1"
          />
          <div className="flex-1">
            <div className="font-medium">{t('vs.piper')}</div>
            <div className="text-sm text-text-muted mt-0.5">{t('vs.piperDesc')}</div>
          </div>
        </label>

        {!state?.piper?.installed ? (
          <div className="pl-7 space-y-2">
            <p className="text-xs text-text-muted">{t('vs.piperNotInstalled')}</p>
            <button
              onClick={() => withBusy('engine', () => api().installEngine())}
              disabled={busy === 'engine'}
              className="btn btn-primary btn-sm"
            >
              <Download size={14} />
              {busy === 'engine'
                ? pct !== null
                  ? `${pct} %`
                  : t('vs.installing')
                : t('vs.installEngine')}
            </button>
          </div>
        ) : (
          <div className="pl-7 space-y-3">
            <div>
              <div className="text-xs font-semibold text-text-muted uppercase mb-2">
                {t('vs.voices')}
              </div>
              <div className="space-y-1.5">
                {catalog.map((voice) => {
                  const here = installed.includes(voice.id);
                  const active = cfg.engine === 'piper' && cfg.voiceId === voice.id;
                  return (
                    <div
                      key={voice.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        active ? 'border-accent-primary bg-accent-primary/10' : 'border-border'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{voice.label}</div>
                        <div className="text-xs text-text-muted flex items-center gap-1">
                          <HardDrive size={11} /> {voice.sizeMb} Mo
                        </div>
                      </div>
                      {here ? (
                        <>
                          {!active && (
                            <button onClick={() => setVoice(voice.id)} className="btn btn-secondary btn-sm">
                              {t('vs.use')}
                            </button>
                          )}
                          <button
                            onClick={() => api().removeVoice(voice.id).then(refresh)}
                            className="btn-icon text-error"
                            title={t('vs.removeVoice')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => withBusy(voice.id, () => api().installVoice(voice.id))}
                          disabled={Boolean(busy)}
                          className="btn btn-secondary btn-sm"
                        >
                          <Download size={13} />
                          {busy === voice.id ? (pct !== null ? `${pct} %` : '…') : t('vs.download')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => api().uninstall().then(refresh)}
              className="text-xs text-error hover:underline"
            >
              {t('vs.uninstall')}
            </button>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-error">{error}</div>}

      <div className="flex gap-2">
        <button onClick={() => api()?.preview?.()} className="btn btn-secondary btn-sm">
          <Play size={14} /> {t('vs.preview')}
        </button>
        <button onClick={() => api()?.stop?.()} className="btn btn-secondary btn-sm">
          <Square size={14} /> {t('vs.stop')}
        </button>
      </div>

      <p className="text-xs text-text-muted flex items-start gap-2">
        <Volume2 size={13} className="mt-0.5 flex-shrink-0" />
        {t('vs.note')}
      </p>
    </div>
  );
}
