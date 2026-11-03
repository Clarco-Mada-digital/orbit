import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Copy, Crop, Download, Expand, LoaderCircle, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { getWebContentsIdFor } from '../lib/webviewRegistry';
import { useStore } from '../stores/useStore';

export default function ScreenshotPreview() {
  const t = useT();
  const activeApp = useStore((state) => state.activeApp);
  const [capture, setCapture] = useState(null);
  const [chooseMode, setChooseMode] = useState(false);
  const [sourceWcId, setSourceWcId] = useState(null);
  const [captureSource, setCaptureSource] = useState('page');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [delaySeconds, setDelaySeconds] = useState(0);
  const cancelCountdown = useRef(false);
  const chooserRef = useRef(null);

  const chooseCaptureMode = useCallback(async (mode, copyDirect) => {
    const wcId = captureSource === 'orbit' ? null : sourceWcId || getWebContentsIdFor(activeApp);
    if (captureSource !== 'orbit' && !wcId) {
      setError(t('cm.screenshotNoActivePage'));
      return;
    }
    setBusy(true);
    setError('');
    setChooseMode(false);
    cancelCountdown.current = false;
    try {
      for (let remaining = delaySeconds; remaining > 0; remaining -= 1) {
        if (cancelCountdown.current) return;
        setCountdown(remaining);
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (cancelCountdown.current) return;
      setCountdown(null);
      const result = await window.electronAPI?.screenshots?.capture?.(
        wcId,
        mode,
        copyDirect,
        captureSource
      );
      if (!result?.success && !result?.cancelled) {
        throw new Error(result?.error || t('cm.screenshotError'));
      }
    } catch (err) {
      console.error('[orbit] capture via raccourci échouée:', err);
      setError(t('cm.screenshotError'));
      setChooseMode(true);
    } finally {
      setBusy(false);
      setCountdown(null);
    }
  }, [activeApp, captureSource, delaySeconds, sourceWcId, t]);

  useEffect(() => {
    const off = window.electronAPI?.screenshots?.onPreview?.((payload) => {
      setCapture(payload);
      setChooseMode(false);
      setBusy(false);
      setError('');
    });
    const open = (event) => {
      setSourceWcId(Number(event.detail?.wcId) || null);
      setCaptureSource(event.detail?.source === 'orbit' ? 'orbit' : 'page');
      setChooseMode(true);
      setError('');
    };
    window.addEventListener('orbit:screenshot-open', open);
    return () => {
      if (typeof off === 'function') off();
      window.removeEventListener('orbit:screenshot-open', open);
    };
  }, []);

  useEffect(() => {
    if (!chooseMode) return undefined;
    const frame = window.requestAnimationFrame(() => chooserRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [chooseMode]);

  useEffect(() => {
    if (!chooseMode && !capture && countdown === null) return undefined;
    const onKeyDown = (event) => {
      if (chooseMode && !busy && countdown === null && /^[1-3]$/.test(event.key)) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('input, select, textarea, [contenteditable="true"]')) {
          return;
        }
        event.preventDefault();
        const modes = ['visible', 'full', 'selection'];
        chooseCaptureMode(modes[Number(event.key) - 1], false);
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (countdown !== null) {
        cancelCountdown.current = true;
        setCountdown(null);
        setBusy(false);
      } else if (capture) {
        Promise.resolve(window.electronAPI?.screenshots?.cancel?.(capture.id)).catch((err) => {
          console.error('[orbit] annulation de la capture échouée:', err);
        });
        setCapture(null);
      } else {
        setChooseMode(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, capture, chooseCaptureMode, chooseMode, countdown]);

  const close = async () => {
    try {
      await window.electronAPI?.screenshots?.cancel?.(capture.id);
    } catch (err) {
      console.error('[orbit] annulation de la capture échouée:', err);
    } finally {
      setCapture(null);
    }
  };
  const copy = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI?.screenshots?.copy?.(capture.id);
      if (!result?.success) throw new Error(result?.error || t('cm.screenshotError'));
      setCapture(null);
    } catch (err) {
      console.error('[orbit] copie de la capture échouée:', err);
      setError(t('cm.screenshotError'));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI?.screenshots?.save?.(capture.id);
      if (result?.success) setCapture(null);
      else if (!result?.cancelled) throw new Error(result?.error || t('cm.screenshotError'));
    } catch (err) {
      console.error('[orbit] enregistrement de la capture échoué:', err);
      setError(t('cm.screenshotError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    {chooseMode && !capture && (
      <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md">
        <section
          ref={chooserRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="orbit-screenshot-chooser"
          tabIndex={-1}
          className="w-full max-w-xl overflow-hidden rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-2xl shadow-black/40 backdrop-blur-2xl"
          style={{ backgroundImage: 'radial-gradient(circle at 10% 0%, rgba(99,102,241,.27), transparent 55%)' }}
        >
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10">
                <Camera size={20} />
              </span>
              <h2 id="orbit-screenshot-chooser" className="text-xl font-semibold">
                {t('cm.chooseScreenshot')}
              </h2>
              <p className="mt-1 text-sm text-white/65">
                {t('cm.screenshotShortcut', {
                  shortcut: window.electronAPI?.platform === 'darwin' ? '⌘ + ⇧ + S' : 'Alt + Maj + S',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setChooseMode(false); setError(''); }}
              className="rounded-xl p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label={t('cm.cancelScreenshot')}
            >
              <X size={18} />
            </button>
          </div>
          <label className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm">
            <span className="text-white/80">{t('cm.screenshotDelay')}</span>
            <select
              value={delaySeconds}
              onChange={(event) => setDelaySeconds(Number(event.target.value))}
              className="rounded-lg border border-white/15 bg-slate-900/80 px-3 py-2 text-white outline-none focus:border-indigo-300"
            >
              {[0, 1, 2, 3, 5, 10].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds === 0 ? t('cm.screenshotNoDelay') : t('cm.screenshotDelaySeconds', { count: seconds })}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { mode: 'visible', label: t('cm.screenshotCurrent'), icon: Camera },
              { mode: 'full', label: t('cm.screenshotFullPage'), icon: Expand },
              { mode: 'selection', label: t('cm.screenshotSelection'), icon: Crop },
            ].map(({ mode, label, icon: Icon }, index) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                onClick={(event) => chooseCaptureMode(mode, event.ctrlKey || event.metaKey)}
                className="group flex min-h-28 flex-col items-start justify-between rounded-2xl border border-white/15 bg-white/[0.07] p-4 text-left transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.14] disabled:opacity-50"
              >
                <span className="flex w-full items-start justify-between">
                  <Icon size={20} className="text-indigo-200 transition group-hover:scale-110" />
                  <kbd className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-xs text-white/75">
                    {index + 1}
                  </kbd>
                </span>
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
          {error && <p role="alert" className="mt-4 text-sm text-rose-200">{error}</p>}
          {busy && (
            <p role="status" className="mt-4 flex items-center gap-2 text-sm text-white/70">
              <LoaderCircle size={15} className="animate-spin" />
              {t('cm.screenshotCapturing')}
            </p>
          )}
        </section>
      </div>
    )}
    {countdown !== null && (
      <div
        role="status"
        className="pointer-events-none fixed left-1/2 top-5 z-[12001] -translate-x-1/2 rounded-full border border-white/20 bg-slate-950/75 px-5 py-3 text-sm font-medium text-white shadow-xl backdrop-blur-xl"
      >
        {t('cm.screenshotCountdown', { count: countdown })}
      </div>
    )}
    {capture && (
    <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="orbit-screenshot-title"
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 id="orbit-screenshot-title" className="font-semibold text-text-primary">
              {t('cm.screenshotPreview')}
            </h2>
            <p className="truncate text-xs text-text-muted">{capture.filename}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={close} disabled={busy} aria-label={t('cm.cancelScreenshot')}>
            <X size={17} />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-auto bg-black/30 p-3">
          <img
            src={capture.dataUrl}
            alt={t('cm.screenshotPreview')}
            className="mx-auto h-auto max-h-[66vh] max-w-full rounded-lg object-contain shadow-xl"
          />
        </div>
        {error && <p role="alert" className="px-5 pt-3 text-sm text-error">{error}</p>}
        <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
            {t('cm.cancelScreenshot')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={copy} disabled={busy}>
            <Copy size={15} />
            {t('cm.copyScreenshot')}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
            {t('cm.saveScreenshot')}
          </button>
        </footer>
      </section>
    </div>
    )}
    </>
  );
}
