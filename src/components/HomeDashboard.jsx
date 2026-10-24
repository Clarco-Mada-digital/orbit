import { useEffect, useMemo, useState } from 'react';
import { Search, Settings2, Plus, CloudSun, Clock3, LayoutGrid } from 'lucide-react';
import { useStore } from '../stores/useStore';
import AppIcon from './AppIcon';
import { useT, resolveLang } from '../lib/i18n';
import { isMac } from '../lib/shortcuts';
import { normalizeHome, resolveBackground, backgroundStyle, greetingKey } from '../lib/home';
import { describeWeather, readWeatherCache, fetchWeather } from '../lib/weather';

// ---------------------------------------------------------------------------
// Page d'accueil d'un profil : ce qui remplace l'écran noir quand aucune app
// n'est ouverte. Trois idées, et rien de plus :
//   • un FOND personnalisable (dégradé prêt à l'emploi ou image) qu'on laisse
//     respirer — d'où les widgets volontairement rares ;
//   • le CHAMP D'ALT+K directement sur la page (ouvrir la palette au clic ou
//     au clavier), pour ne pas avoir à se souvenir du raccourci ;
//   • quelques PETITS widgets utiles : heure/date, météo (si une ville est
//     réglée) et un accès rapide aux apps du profil.
// Tout est en blanc sur fond sombre : le fond reste une image, on ne peut pas
// faire dépendre la lisibilité du thème clair/sombre.
// ---------------------------------------------------------------------------

// Carte de verre commune aux widgets — discrète, pour laisser voir le fond.
const CARD = 'rounded-2xl bg-white/10 border border-white/10 backdrop-blur-md';

export default function HomeDashboard({ apps = [], onOpenSearch, onOpenStore, onOpenSettings, onSelectApp }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const profiles = useStore((s) => s.profiles);
  const activeProfile = useStore((s) => s.activeProfile);

  const profile = profiles.find((p) => p.id === activeProfile);
  const homeSettings = profile?.home || settings?.home;
  const home = useMemo(() => normalizeHome(homeSettings), [homeSettings]);
  const bg = useMemo(() => resolveBackground(homeSettings), [homeSettings]);

  // L'heure sert au message (« Bonjour » / « Bonsoir ») et à l'horloge.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Taille de police réglée par l'utilisateur : sur le fond d'écran on ne
  // reprend pas l'échelle de l'interface (elle est en rem, tout suivrait), on
  // l'applique en `px` — sinon l'accueil deviendrait démesuré en 120 %.
  const basePx = ({ small: 12, medium: 14, large: 16, xlarge: 18 })[settings?.fontSize] ?? 14;
  const scale = (settings?.uiScale ?? 100) / 100;

  // Libellé du raccourci de recherche, adapté à la plateforme (Alt+K / ⌘K).
  const searchKeys = isMac() ? ['⌘', 'K'] : ['Alt', 'K'];

  const imageStyle =
    bg.kind === 'image'
      ? {
          ...backgroundStyle(bg),
          // Le flou laisse des bords nets : on agrandit légèrement pour les
          // repousser hors du cadre.
          filter: home.blur > 0 ? `blur(${home.blur}px)` : undefined,
          transform: home.blur > 0 ? 'scale(1.08)' : undefined,
        }
      : backgroundStyle(bg);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#07070c]">
      {/* Fond : image ou dégradé, puis voile sombre réglable (lisibilité) */}
      <div className="absolute inset-0" style={imageStyle} />
      {home.dim > 0 && (
        <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${home.dim / 100})` }} />
      )}
      {/* Léger halo en bas : l'accueil se détache du fond même sur une photo */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/40" />

      <div
        className="relative h-full w-full flex flex-col items-center text-white overflow-y-auto"
        style={{ fontSize: basePx * scale }}
      >
        {/* Bandeau : profil courant à gauche, réglages de l'accueil à droite */}
        <div className="w-full max-w-4xl flex items-center justify-between gap-3 px-6 pt-6">
          <div className="flex items-center gap-2.5 rounded-full bg-white/10 border border-white/10 pl-2 pr-3.5 py-1.5 backdrop-blur-md">
            <span className="text-lg leading-none">{profile?.emoji || '🛰️'}</span>
            <span className="text-sm font-medium">{profile?.name || ''}</span>
          </div>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-2 h-9 px-3.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-md text-sm font-medium transition-colors"
            title={t('st.homeTitle')}
          >
            <Settings2 size={15} />
            <span className="hidden sm:inline">{t('home.customize')}</span>
          </button>
        </div>

        {/* Bloc central : aéré à dessein — on doit voir le fond d'écran */}
        <div className="w-full max-w-3xl flex-1 flex flex-col justify-center gap-6 px-6 py-10">
          <div className="text-center">
            <h1 className="text-3xl font-semibold drop-shadow-sm">
              {t(greetingKey(now))}
              {profile?.name ? <span className="text-white/60"> · {profile.name}</span> : null}
            </h1>
            <p className="text-sm text-white/55 mt-1.5">{t('home.subtitle')}</p>
          </div>

          {/* Le champ d'Alt+K, affiché directement sur la page */}
          <button
            onClick={onOpenSearch}
            className="group w-full flex items-center gap-3 h-14 px-5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 backdrop-blur-md text-left shadow-2xl transition-colors"
          >
            <Search size={20} className="text-white/70 flex-shrink-0" />
            <span className="flex-1 min-w-0 truncate text-white/55">{t('home.searchPlaceholder')}</span>
            <span className="flex items-center gap-1 flex-shrink-0">
              {searchKeys.map((k, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-white/40 text-xs">+</span>}
                  <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/15 text-xs tabular-nums">
                    {k}
                  </kbd>
                </span>
              ))}
            </span>
          </button>

          {/* Widgets : l'essentiel, pas plus */}
          <div className="flex flex-wrap gap-3">
            {home.widgets.clock && <HomeClock now={now} />}
            {home.widgets.weather && <HomeWeather onConfigure={onOpenSettings} />}
            {home.widgets.apps && (
              <HomeApps apps={apps} onSelectApp={onSelectApp} onOpenStore={onOpenStore} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Heure + date ---------------------------------------------------------
function HomeClock({ now }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const lang = resolveLang(settings?.language);
  const locale = lang === 'en' ? 'en-US' : 'fr-FR';
  const cfg = settings?.clock || {};

  const time = now.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(cfg.seconds ? { second: '2-digit' } : {}),
    hour12: cfg.format === '12',
  });
  const date = now.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className={`${CARD} flex-1 min-w-[200px] px-4 py-3`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/50 mb-1">
        <Clock3 size={12} /> {t('home.clock')}
      </div>
      <div className="text-2xl font-semibold tabular-nums leading-tight">{time}</div>
      <div className="text-xs text-white/60 capitalize truncate">{date}</div>
    </div>
  );
}

// --- Météo (uniquement si une ville est réglée) ---------------------------
function HomeWeather({ onConfigure }) {
  const t = useT();
  const cfg = useStore((s) => s.settings?.weather) || {};
  const city = (cfg.city || '').trim();
  const units = cfg.units;

  const [data, setData] = useState(() => (city ? readWeatherCache(city, units) : null));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!city) {
      setData(null);
      return undefined;
    }
    // Valeurs en cache : affichage immédiat, l'appel réseau rafraîchit ensuite.
    setData(readWeatherCache(city, units));
    setFailed(false);
    let alive = true;
    fetchWeather(city, units)
      .then((payload) => {
        if (alive) {
          setData(payload);
          setFailed(false);
        }
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [city, units]);

  // Sans ville : on invite à en choisir une plutôt que de cacher le widget
  // (sinon il semble cassé).
  if (!city) {
    return (
      <button onClick={onConfigure} className={`${CARD} flex-1 min-w-[200px] px-4 py-3 text-left hover:bg-white/15 transition-colors`}>
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/50 mb-1">
          <CloudSun size={12} /> {t('home.weather')}
        </div>
        <div className="text-sm text-white/60">{t('home.weatherSetCity')}</div>
      </button>
    );
  }

  const [emoji, label] = data ? describeWeather(data.current.weather_code) : ['🌡️', ''];
  return (
    <div className={`${CARD} flex-1 min-w-[200px] px-4 py-3`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/50 mb-1">
        <CloudSun size={12} /> {t('home.weather')}
      </div>
      {failed && !data ? (
        <div className="text-sm text-white/60">{t('home.weatherError')}</div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">{data ? emoji : '…'}</span>
          <div className="min-w-0">
            <div className="text-xl font-semibold tabular-nums leading-tight">
              {data ? `${Math.round(data.current.temperature_2m)}${data.tempUnit}` : '—'}
            </div>
            <div className="text-xs text-white/60 truncate">{data ? data.place : label}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Accès rapide aux apps du profil (+ boutique) -------------------------
function HomeApps({ apps, onSelectApp, onOpenStore }) {
  const t = useT();
  // Six apps suffisent : au-delà, la page se remplit et le fond disparaît.
  const shown = apps.slice(0, 6);

  return (
    <div className={`${CARD} w-full px-4 py-3`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/50">
          <LayoutGrid size={12} /> {t('home.apps')}
        </div>
        <button
          onClick={onOpenStore}
          className="text-xs text-white/60 hover:text-white transition-colors"
        >
          {t('home.browseStore')}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-white/60">{t('home.noApps')}</span>
          <button
            onClick={onOpenStore}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium transition-colors"
          >
            <Plus size={14} /> {t('home.addApp')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {shown.map((app) => (
            <button
              key={app.id}
              onClick={() => onSelectApp(app.id)}
              title={app.name}
              className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center transition-colors"
            >
              <AppIcon app={app} className="w-5 h-5 rounded" fallbackClassName="text-lg" />
            </button>
          ))}
          <button
            onClick={onOpenStore}
            title={t('sb.store')}
            className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/15 border border-dashed border-white/25 flex items-center justify-center transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
