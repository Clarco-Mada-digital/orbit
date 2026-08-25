import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { resolveLang, useT } from '../../lib/i18n';

// Horloge de l'en-tête. Affiche l'heure (et la date), et déplie un panneau
// avec la date complète, le numéro de semaine et jusqu'à trois fuseaux
// supplémentaires (utile quand on bosse avec des équipes ailleurs).
// placement : 'top' (barre en haut → panneau s'ouvre vers le bas)
// ou 'bottom' (barre en bas → panneau s'ouvre vers le haut).
export default function ClockWidget({ placement = 'top', align = 'right-0' }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const lang = resolveLang(settings?.language);
  const locale = lang === 'en' ? 'en-US' : 'fr-FR';
  const cfg = settings?.clock || {};
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  // Mois affiché dans la vue calendrier (null = mois courant)
  const [calMonth, setCalMonth] = useState(null);
  const ref = useRef(null);

  // On ne réveille le rendu qu'à la seconde si les secondes sont affichées,
  // sinon une fois par minute : inutile de faire tourner le CPU pour rien.
  useEffect(() => {
    const period = cfg.seconds ? 1000 : 15000;
    const id = setInterval(() => setNow(new Date()), period);
    return () => clearInterval(id);
  }, [cfg.seconds]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hour12 = cfg.format === '12';
  const timeOpts = {
    hour: '2-digit',
    minute: '2-digit',
    ...(cfg.seconds ? { second: '2-digit' } : {}),
    hour12,
  };
  const time = now.toLocaleTimeString(locale, timeOpts);
  const shortDate = now.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  // Numéro de semaine ISO 8601
  const weekNumber = (() => {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - start) / 86400000 + 1) / 7);
  })();

  const zones = (cfg.timezones || []).filter(Boolean).slice(0, 4);

  // Grille du calendrier pour le mois affiché (lundi → dimanche)
  const calendar = (() => {
    const base = calMonth || { y: now.getFullYear(), m: now.getMonth() };
    const first = new Date(base.y, base.m, 1);
    const startOffset = (first.getDay() + 6) % 7; // lundi = 0
    const daysInMonth = new Date(base.y, base.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return {
      label: first.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
      cells,
      today: !calMonth || (base.y === now.getFullYear() && base.m === now.getMonth())
        ? now.getDate()
        : -1,
    };
  })();

  const shiftCalMonth = (delta) => {
    const base = calMonth || { y: now.getFullYear(), m: now.getMonth() };
    const d = new Date(base.y, base.m + delta, 1);
    setCalMonth({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div className="relative app-no-drag" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-2.5 rounded-lg flex items-center gap-2 hover:bg-bg-hover transition-colors ${
          open ? 'bg-bg-hover' : ''
        }`}
        title={now.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })}
      >
        <span className="text-sm font-semibold tabular-nums leading-none">{time}</span>
        {cfg.showDate !== false && (
          <span className="text-[11px] text-text-muted leading-none hidden md:inline">{shortDate}</span>
        )}
      </button>

      {open && (
        <div className={`absolute ${align} ${placement === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'} w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
          <div className="px-4 py-3 border-b border-border">
            <div className="text-2xl font-semibold tabular-nums">{time}</div>
            <div className="text-sm text-text-muted mt-0.5">
              {now.toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </div>
            <div className="text-[11px] text-text-muted mt-1">
              {t('clock.week', { n: weekNumber })} · {t('clock.dayOfYear', {
                n: Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000),
              })}
            </div>
          </div>
          {/* Vue calendrier du mois */}
          <div className="px-3 py-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => shiftCalMonth(-1)}
                className="btn-icon w-6 h-6"
                title={t('common.previousMonth') || '‹'}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-sm font-medium capitalize flex items-center gap-1.5">
                <CalendarDays size={14} className="text-text-muted" />
                {calendar.label}
              </span>
              <button
                onClick={() => shiftCalMonth(1)}
                className="btn-icon w-6 h-6"
                title={t('common.nextMonth') || '›'}
              >
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] text-text-muted mb-1">
              {t('cal.weekdays').split(',').map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs tabular-nums">
              {calendar.cells.map((d, i) => (
                <span
                  key={i}
                  className={`w-7 h-7 mx-auto flex items-center justify-center rounded-full ${
                    d === null
                      ? ''
                      : d === calendar.today
                        ? 'bg-accent-primary text-white font-semibold'
                        : 'hover:bg-bg-hover'
                  }`}
                >
                  {d ?? ''}
                </span>
              ))}
            </div>
          </div>
          {zones.length > 0 && (
            <div className="py-1">
              {zones.map((tz) => {
                let label = tz.split('/').pop().replace(/_/g, ' ');
                let value = '—';
                try {
                  value = now.toLocaleTimeString(locale, {
                    timeZone: tz,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12,
                  });
                } catch {
                  label = tz; // fuseau invalide : on l'affiche tel quel
                }
                return (
                  <div key={tz} className="flex items-center justify-between px-4 py-1.5 text-sm">
                    <span className="flex items-center gap-2 text-text-secondary truncate">
                      <Clock size={13} className="text-text-muted flex-shrink-0" />
                      {label}
                    </span>
                    <span className="tabular-nums font-medium flex-shrink-0">{value}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="px-4 py-2 border-t border-border text-[11px] text-text-muted">
            {t('clock.hint')}
          </div>
        </div>
      )}
    </div>
  );
}
