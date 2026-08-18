import { useEffect, useRef, useState } from 'react';
import { Timer, Play, Pause, RotateCcw, Coffee, Brain } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { useT } from '../../lib/i18n';

// Minuteur de concentration (Pomodoro) dans l'en-tête : 25 min de travail,
// 5 min de pause, pause longue toutes les 4 sessions. Une notification système
// signale la fin — même si Orbit est en arrière-plan.
export default function FocusTimer() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const cfg = settings?.focus || {};
  const durations = {
    work: (cfg.workMinutes || 25) * 60,
    short: (cfg.shortBreakMinutes || 5) * 60,
    long: (cfg.longBreakMinutes || 15) * 60,
  };

  const [phase, setPhase] = useState('work'); // work | short | long
  const [left, setLeft] = useState(durations.work);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // Fin visée en horloge murale : un simple décompte dérive quand l'onglet
  // est ralenti, ici l'affichage reste juste à la seconde près.
  const endAt = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Changer les durées dans les paramètres remet le minuteur à l'heure
  useEffect(() => {
    if (!running) setLeft(durations[phase]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.workMinutes, cfg.shortBreakMinutes, cfg.longBreakMinutes, phase]);

  useEffect(() => {
    if (!running) return undefined;
    if (endAt.current === null) endAt.current = Date.now() + left * 1000;
    const id = setInterval(() => {
      const remaining = Math.round((endAt.current - Date.now()) / 1000);
      if (remaining > 0) {
        setLeft(remaining);
        return;
      }
      // Fin de phase : on enchaîne travail → pause → travail…
      clearInterval(id);
      endAt.current = null;
      setRunning(false);
      setLeft(0);
      const nextRounds = phase === 'work' ? rounds + 1 : rounds;
      const next = phase === 'work' ? (nextRounds % 4 === 0 ? 'long' : 'short') : 'work';
      window.electronAPI?.showNotification?.({
        title: phase === 'work' ? t('focus.doneWork') : t('focus.doneBreak'),
        body: phase === 'work' ? t('focus.nextBreak') : t('focus.nextWork'),
        silent: false,
      });
      setRounds(nextRounds);
      setPhase(next);
      setLeft(durations[next]);
      if (cfg.autoContinue) {
        endAt.current = Date.now() + durations[next] * 1000;
        setRunning(true);
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase, rounds]);

  const toggle = () => {
    if (running) {
      // Pause : on fige le temps restant, la fin sera recalculée au redémarrage
      setLeft(Math.max(0, Math.round((endAt.current - Date.now()) / 1000)));
      endAt.current = null;
      setRunning(false);
    } else {
      endAt.current = Date.now() + left * 1000;
      setRunning(true);
    }
  };

  const reset = (to = phase) => {
    endAt.current = null;
    setRunning(false);
    setPhase(to);
    setLeft(durations[to]);
  };

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const total = durations[phase] || 1;
  const progress = 1 - left / total;

  return (
    <div className="relative app-no-drag" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 transition-colors ${
          running
            ? phase === 'work'
              ? 'bg-accent-primary/15 text-accent-primary'
              : 'bg-success/15 text-success'
            : 'hover:bg-bg-hover text-text-secondary'
        }`}
        title={t('focus.title')}
      >
        {phase === 'work' ? <Brain size={16} /> : <Coffee size={16} />}
        <span className="text-sm font-semibold tabular-nums">
          {mm}:{ss}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Timer size={16} className="text-accent-primary" />
            <span className="font-semibold text-sm">{t('focus.title')}</span>
            <span className="ml-auto text-[11px] text-text-muted">
              {t('focus.rounds', { n: rounds })}
            </span>
          </div>

          <div className="px-4 py-4 text-center">
            <div className="text-4xl font-semibold tabular-nums">
              {mm}:{ss}
            </div>
            <div className="text-xs text-text-muted mt-1">
              {phase === 'work' ? t('focus.phaseWork') : phase === 'short' ? t('focus.phaseShort') : t('focus.phaseLong')}
            </div>
            <div className="h-1.5 bg-bg-secondary rounded-full mt-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  phase === 'work' ? 'bg-accent-primary' : 'bg-success'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              />
            </div>
          </div>

          <div className="px-4 pb-3 flex items-center gap-2">
            <button onClick={toggle} className="btn btn-primary btn-sm flex-1 flex items-center justify-center gap-1.5">
              {running ? <Pause size={14} /> : <Play size={14} />}
              {running ? t('focus.pause') : t('focus.start')}
            </button>
            <button onClick={() => reset()} className="btn btn-secondary btn-sm" title={t('focus.reset')}>
              <RotateCcw size={14} />
            </button>
          </div>

          <div className="border-t border-border grid grid-cols-3 text-xs">
            {[
              ['work', t('focus.shortWork')],
              ['short', t('focus.shortBreak')],
              ['long', t('focus.longBreak')],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => reset(key)}
                className={`py-2 hover:bg-bg-hover transition-colors ${
                  phase === key ? 'text-accent-primary font-medium' : 'text-text-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
