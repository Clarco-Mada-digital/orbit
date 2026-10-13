import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudSun, MapPin, RefreshCw, Wind, Droplets } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { useT } from '../../lib/i18n';
import { useZoneHold } from '../../lib/autoHide';
import { useDismiss } from '../../lib/useDismiss';
import {
  WEATHER_REFRESH_MS as REFRESH_MS,
  describeWeather as describe,
  readWeatherCache,
  writeWeatherCache,
  fetchWeather,
} from '../../lib/weather';

// Météo via Open-Meteo : la logique (codes WMO, cache, appel API) vit dans
// lib/weather.js — partagée avec la page d'accueil. Ici, seul l'habillage du
// widget de l'en-tête.


export default function WeatherWidget({ placement = 'top', align = 'right-0' }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const cfg = settings?.weather || {};
  const city = (cfg.city || '').trim();
  const units = cfg.units;
  const [data, setData] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | error
  const [reload, setReload] = useState(0); // incrémenté par le bouton « Actualiser »
  const [open, setOpen] = useState(false);
  // Mode épuré : garde la barre ouverte tant que ce panneau l'est.
  useZoneHold(placement, 'panel', open);
  const ref = useRef(null);

  // Clic ailleurs, Échap, clic DANS une app… : règle commune (lib/useDismiss).
  const closePanel = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, closePanel);

  useEffect(() => {
    if (!city) {
      setData(null);
      setState('idle');
      return;
    }
    let alive = true;

    const load = async (force = false) => {
      // Cache local : évite de retaper l'API à chaque ouverture d'Orbit
      if (!force) {
        const cached = readWeatherCache(city, units);
        if (cached) {
          if (alive) {
            setData(cached);
            setState('idle');
          }
          return;
        }
      }
      if (alive) setState('loading');
      try {
        const payload = await fetchWeather(city, units);
        if (!alive) return;
        setData(payload);
        setState('idle');
        writeWeatherCache(city, units, payload);
      } catch {
        if (alive) setState('error');
      }
    };

    load(reload > 0);
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [city, units, reload]);

  // Pas de ville configurée : on invite à en choisir une plutôt que de
  // disparaître silencieusement (sinon le widget semble cassé).
  if (!city) {
    return (
      <div className="app-no-drag flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-text-muted text-xs">
        <CloudSun size={16} />
        <span className="hidden lg:inline">{t('weather.setCity')}</span>
      </div>
    );
  }

  const [emoji, label] = data ? describe(data.current.weather_code) : ['🌡️', ''];
  const temp = data ? Math.round(data.current.temperature_2m) : null;

  return (
    <div className="relative app-no-drag" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-2.5 rounded-lg flex items-center gap-1.5 hover:bg-bg-hover transition-colors ${
          open ? 'bg-bg-hover' : ''
        }`}
        title={data ? `${label} — ${data.place}` : city}
      >
        {state === 'error' ? (
          <CloudSun size={16} className="text-text-muted" />
        ) : (
          <span className="text-base leading-none">{emoji}</span>
        )}
        <span className="text-sm font-medium tabular-nums">
          {temp === null ? '—' : `${temp}${data.tempUnit}`}
        </span>
      </button>

      {open && (
        <div className={`absolute ${align} ${placement === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'} w-72 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
          {state === 'error' || !data ? (
            <div className="px-4 py-6 text-center text-sm text-text-muted">
              {state === 'loading' ? t('weather.loading') : t('weather.error', { city })}
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <span className="text-3xl leading-none">{emoji}</span>
                  <div className="min-w-0">
                    <div className="text-2xl font-semibold tabular-nums">
                      {temp}
                      {data.tempUnit}
                    </div>
                    <div className="text-sm text-text-muted truncate">{label}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-muted mt-2">
                  <MapPin size={12} /> {data.place}
                </div>
              </div>
              <div className="px-4 py-2 grid grid-cols-3 gap-2 text-xs border-b border-border">
                <div>
                  <div className="text-text-muted">{t('weather.feels')}</div>
                  <div className="font-medium tabular-nums">
                    {Math.round(data.current.apparent_temperature)}
                    {data.tempUnit}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted flex items-center gap-1">
                    <Droplets size={11} /> {t('weather.humidity')}
                  </div>
                  <div className="font-medium tabular-nums">{data.current.relative_humidity_2m}%</div>
                </div>
                <div>
                  <div className="text-text-muted flex items-center gap-1">
                    <Wind size={11} /> {t('weather.wind')}
                  </div>
                  <div className="font-medium tabular-nums">
                    {Math.round(data.current.wind_speed_10m)} {data.windUnit}
                  </div>
                </div>
              </div>
              <div className="py-1">
                {(data.daily?.time || []).slice(1).map((day, i) => {
                  const [dEmoji] = describe(data.daily.weather_code[i + 1]);
                  return (
                    <div key={day} className="flex items-center justify-between px-4 py-1.5 text-sm">
                      <span className="text-text-secondary capitalize">
                        {new Date(day).toLocaleDateString('fr-FR', { weekday: 'long' })}
                      </span>
                      <span className="flex items-center gap-2 tabular-nums">
                        <span>{dEmoji}</span>
                        <span className="text-text-muted">
                          {Math.round(data.daily.temperature_2m_min[i + 1])}°
                        </span>
                        <span className="font-medium">
                          {Math.round(data.daily.temperature_2m_max[i + 1])}°
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <div className="px-4 py-2 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
            <span>Open-Meteo</span>
            <button
              onClick={() => setReload((n) => n + 1)}
              className="flex items-center gap-1 hover:text-text-primary"
            >
              <RefreshCw size={11} /> {t('weather.refresh')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
