import { useEffect, useRef, useState } from 'react';
import { CloudSun, MapPin, RefreshCw, Wind, Droplets } from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { useT } from '../../lib/i18n';

// Météo via Open-Meteo : API publique, sans clé ni compte. La position vient
// de la ville saisie dans les paramètres (géocodage Open-Meteo) — jamais de
// géolocalisation silencieuse.
const CACHE_KEY = 'orbit.weather.cache';
const REFRESH_MS = 15 * 60 * 1000;

// Codes météo WMO → emoji + libellé
const WMO = {
  0: ['☀️', 'Ciel dégagé'],
  1: ['🌤️', 'Plutôt dégagé'],
  2: ['⛅', 'Partiellement nuageux'],
  3: ['☁️', 'Couvert'],
  45: ['🌫️', 'Brouillard'],
  48: ['🌫️', 'Brouillard givrant'],
  51: ['🌦️', 'Bruine légère'],
  53: ['🌦️', 'Bruine'],
  55: ['🌦️', 'Bruine dense'],
  61: ['🌧️', 'Pluie faible'],
  63: ['🌧️', 'Pluie'],
  65: ['🌧️', 'Pluie forte'],
  66: ['🌧️', 'Pluie verglaçante'],
  67: ['🌧️', 'Pluie verglaçante forte'],
  71: ['🌨️', 'Neige faible'],
  73: ['🌨️', 'Neige'],
  75: ['❄️', 'Neige forte'],
  77: ['🌨️', 'Grains de neige'],
  80: ['🌦️', 'Averses'],
  81: ['🌧️', 'Averses'],
  82: ['⛈️', 'Fortes averses'],
  85: ['🌨️', 'Averses de neige'],
  86: ['❄️', 'Fortes averses de neige'],
  95: ['⛈️', 'Orage'],
  96: ['⛈️', 'Orage et grêle'],
  99: ['⛈️', 'Orage violent'],
};
const describe = (code) => WMO[code] || ['🌡️', '—'];

export default function WeatherWidget() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const cfg = settings?.weather || {};
  const city = (cfg.city || '').trim();
  const unit = cfg.units === 'imperial' ? 'fahrenheit' : 'celsius';
  const [data, setData] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | error
  const [reload, setReload] = useState(0); // incrémenté par le bouton « Actualiser »
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

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
        try {
          const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
          if (raw && raw.key === `${city}|${unit}` && Date.now() - raw.at < REFRESH_MS) {
            if (alive) {
              setData(raw.data);
              setState('idle');
            }
            return;
          }
        } catch { /* cache illisible */ }
      }
      if (alive) setState('loading');
      try {
        const geo = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`
        ).then((r) => r.json());
        const place = geo?.results?.[0];
        if (!place) throw new Error('ville introuvable');
        const w = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
            `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=4&timezone=auto` +
            `&temperature_unit=${unit}&wind_speed_unit=${unit === 'fahrenheit' ? 'mph' : 'kmh'}`
        ).then((r) => r.json());
        if (!w?.current) throw new Error('météo indisponible');
        const payload = {
          place: `${place.name}${place.country_code ? `, ${place.country_code}` : ''}`,
          current: w.current,
          daily: w.daily,
          windUnit: unit === 'fahrenheit' ? 'mph' : 'km/h',
          tempUnit: unit === 'fahrenheit' ? '°F' : '°C',
        };
        if (!alive) return;
        setData(payload);
        setState('idle');
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ key: `${city}|${unit}`, at: Date.now(), data: payload }));
        } catch { /* quota */ }
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
  }, [city, unit, reload]);

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
        <div className="absolute right-0 top-full mt-2 w-72 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
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
