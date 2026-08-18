import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { resolveLang, useT } from '../../lib/i18n';

// Horloge de l'en-tête. Affiche l'heure (et la date), et déplie un panneau
// avec la date complète, le numéro de semaine et jusqu'à trois fuseaux
// supplémentaires (utile quand on bosse avec des équipes ailleurs).
export default function ClockWidget() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const lang = resolveLang(settings?.language);
  const locale = lang === 'en' ? 'en-US' : 'fr-FR';
  const cfg = settings?.clock || {};
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
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
        <div className="absolute right-0 top-full mt-2 w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
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
