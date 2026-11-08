import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Check,
  Download,
  Home,
  Keyboard,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  Power,
  Palette,
  Pin,
  RefreshCw,
  Search,
  Smartphone,
  Square,
  Star,
  Usb,
  Wifi,
  X,
} from 'lucide-react';
import { detectUrl } from '../lib/urls';
import { neededSources, normalizeDesktopLayout, presetLayout } from '../lib/phoneDesktop';
import PhoneDesktop from './phone/PhoneDesktop';
import { usePhoneStore } from '../lib/phoneStore';
import {
  compareVersions,
  describeCallNotification,
  describeCallLogEntry,
  formatCallDuration,
  filterPhoneApps,
  initialsOf,
  normalizePhoneSettings,
  PHONE_HOME_BACKGROUNDS,
  MAX_PINNED_PHONE_APPS,
  scrcpyCapabilities,
  sortPhoneApps,
} from '../lib/phone';

// ---------------------------------------------------------------------------
// Téléphone — app NATIVE d'Orbit.
//
// Le bureau Orbit sert à choisir l'app ; chaque app s'ouvre dans sa propre
// fenêtre scrcpy native. L'aperçu de l'écran physique reste facultatif.
//   • Accueil  : favoris, récents, recherche d'applications (icônes réelles) ;
//   • Écran    : aperçu ponctuel de l'écran physique et commandes ;
//   • Réglages : moteur scrcpy, fenêtres d'apps, connexion, performances.
//
// Perf : les fenêtres d'applications utilisent le flux vidéo scrcpy direct.
// Les icônes sont extraites à la demande et l'aperçu physique ne capture QUE
// lorsque son onglet est visible.
// ---------------------------------------------------------------------------

const ICON_CACHE = new Map();
const ICON_PENDING = new Map();
// Les paquets sans icône (icône adaptative en XML, APK sans PNG) ne doivent
// pas relancer une extraction à chaque montage : l'absence est un résultat.
const ICON_MISS = new Set();
let iconRunning = 0;
let iconLimit = 3;
const iconWaiting = [];

function drainIcons() {
  while (iconRunning < iconLimit && iconWaiting.length) {
    const job = iconWaiting.shift();
    iconRunning += 1;
    const api = window.electronAPI?.phone;
    Promise.resolve(api ? api.getIcon({ serial: job.serial, package: job.pkg }) : null)
      .then((res) => {
        const icon = res?.success ? res.icon || null : null;
        if (icon) ICON_CACHE.set(job.key, icon);
        else ICON_MISS.add(job.key);
        job.resolve(icon);
      })
      .catch(() => job.resolve(null))
      .finally(() => {
        iconRunning -= 1;
        ICON_PENDING.delete(job.key);
        drainIcons();
      });
  }
}

function loadIcon(serial, pkg, limit) {
  const key = `${serial}|${pkg}`;
  if (ICON_CACHE.has(key)) return Promise.resolve(ICON_CACHE.get(key));
  if (ICON_MISS.has(key)) return Promise.resolve(null);
  if (ICON_PENDING.has(key)) return ICON_PENDING.get(key);
  iconLimit = Math.max(1, Math.min(8, Number(limit) || 3));
  const promise = new Promise((resolve) => {
    iconWaiting.push({ key, serial, pkg, resolve });
  });
  ICON_PENDING.set(key, promise);
  drainIcons();
  return promise;
}

function PhoneIcon({ serial, pkg, name, size, limit }) {
  const key = `${serial}|${pkg}`;
  const ref = useRef(null);
  const [near, setNear] = useState(() => ICON_CACHE.has(key));
  const [src, setSrc] = useState(() => ICON_CACHE.get(key) || null);

  // Extraction paresseuse : sur un téléphone qui a 300 applications, lancer
  // 300 lectures d'APK d'un coup sature l'USB et le disque. On ne demande
  // l'icône qu'une fois la tuile proche de la zone visible.
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      const timer = setTimeout(() => setNear(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return undefined;
    let alive = true;
    // Le cache est consulté DANS la promesse : `loadIcon` répond
    // immédiatement s'il connaît déjà l'icône, sans setState synchrone dans
    // le corps de l'effet.
    loadIcon(serial, pkg, limit).then((icon) => {
      if (alive && icon) setSrc(icon);
    });
    return () => {
      alive = false;
    };
  }, [near, key, serial, pkg, limit]);

  return (
    <span
      ref={ref}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[22%] bg-bg-hover text-text-secondary"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-contain" draggable={false} />
      ) : (
        <span className="text-[11px] font-semibold uppercase tracking-tight">
          {initialsOf(name) || '?'}
        </span>
      )}
    </span>
  );
}

function Toggle({ checked, onChange, label, hint, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`flex w-full items-center justify-between gap-3 py-2 text-left ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <span className="min-w-0">
        <span className="block text-sm text-text-primary">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-text-muted">{hint}</span> : null}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent-primary' : 'bg-bg-hover'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function Range({ label, value, min, max, step = 1, suffix = '', onChange }) {
  return (
    <label className="block py-2">
      <span className="mb-1 flex items-center justify-between text-sm text-text-primary">
        <span>{label}</span>
        <span className="text-xs tabular-nums text-text-muted">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent-primary)]"
      />
    </label>
  );
}

function Pill({ children, tone = 'muted' }) {
  const tones = {
    muted: 'bg-bg-hover text-text-secondary',
    good: 'bg-emerald-500/15 text-emerald-400',
    warn: 'bg-amber-500/15 text-amber-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone] || tones.muted}`}>
      {children}
    </span>
  );
}

export default function PhoneApp({ visible, onClose }) {
  // `api` sert au rendu (présence du pont), `apiRef` aux effets et aux
  // gestionnaires : un ref ne se lit jamais pendant le rendu.
  const api = window.electronAPI?.phone || null;
  const apiRef = useRef(api);
  const engineChecked = useRef(false);
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(() => normalizePhoneSettings({}));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controlBusy, setControlBusy] = useState('');
  const [tab, setTab] = useState('home');
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const wallpaperFileRef = useRef(null);
  const phoneNotifications = usePhoneStore((s) => s.notifications);

  const [apps, setApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsToken, setAppsToken] = useState(0);
  const [query, setQuery] = useState('');
  const [appDrawerOpen, setAppDrawerOpen] = useState(false);
  // Le tiroir couvre tout l'écran : Échap doit le refermer LUI, pas le
  // Téléphone entier. L'écouteur est posé en capture et arrête la propagation,
  // sinon celui de l'overlay (`PhoneOverlay`) referme le panneau derrière.
  useEffect(() => {
    if (!appDrawerOpen) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setAppDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [appDrawerOpen]);

  const [favorites, setFavorites] = useState([]);
  const [pinnedPackages, setPinnedPackages] = useState([]);
  const [recents, setRecents] = useState([]);

  const [screen, setScreen] = useState(null);
  const [screenError, setScreenError] = useState('');
  const [paused, setPaused] = useState(false);
  const [mirrorRunning, setMirrorRunning] = useState(false);
  // Largeur CSS réellement occupée par l'image de l'aperçu facultatif.
  const [viewWidth, setViewWidth] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const [engineBusy, setEngineBusy] = useState(false);
  const [engineProgress, setEngineProgress] = useState(null);
  const [engineError, setEngineError] = useState('');

  const [connectOpen, setConnectOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [connectAddress, setConnectAddress] = useState('');
  const [pairAddress, setPairAddress] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState('');

  const serial = status?.serial || null;
  const device = status?.device || null;
  const engine = status?.engine || null;
  const desktopBackground = settings.homeBackgroundImage
    ? `linear-gradient(rgba(2, 6, 23, 0.56), rgba(2, 6, 23, 0.56)), url("${settings.homeBackgroundImage}")`
    : PHONE_HOME_BACKGROUNDS.find((background) => background.id === settings.homeBackground)?.css;

  const refreshStatus = useCallback(async () => {
    const api = apiRef.current;
    if (!api) {
      setError("Cette fonction nécessite l'application de bureau Orbit.");
      setLoading(false);
      return null;
    }
    const res = await api.status();
    setLoading(false);
    if (!res?.success) {
      setError(res?.error || 'Impossible de joindre le service Téléphone.');
      return null;
    }
    setStatus(res);
    setSettings(normalizePhoneSettings(res.settings || {}));
    setWallpaperUrl(res.settings?.homeBackgroundImage || '');
    setFavorites(Array.isArray(res.settings?.favoritePackages) ? res.settings.favoritePackages : []);
    setPinnedPackages(Array.isArray(res.settings?.pinnedPackages) ? res.settings.pinnedPackages : []);
    setRecents(Array.isArray(res.settings?.recentPackages) ? res.settings.recentPackages : []);
    setMirrorRunning(!!res.mirror?.running);
    // Vérification de mise à jour : une seule fois par ouverture, en tâche de
    // fond (le processus principal met le résultat en cache 6 h). Jamais
    // bloquante : sans réseau, l'app reste pleinement utilisable.
    if (!engineChecked.current && res.settings?.autoUpdateEngine !== false) {
      engineChecked.current = true;
      api.engineStatus(true)
        .then((upd) => {
          if (upd?.success) setStatus((prev) => (prev ? { ...prev, engine: upd } : prev));
        })
        .catch(() => {});
    }
    return res;
  }, []);

  const clearPhoneNotifications = useCallback(async () => {
    if (!phoneNotifications.length || clearingNotifications) return;
    if (!serial) {
      setError('Aucun téléphone connecté pour écarter les notifications.');
      return;
    }
    setClearingNotifications(true);
    try {
      const result = await apiRef.current?.dismissNotifications?.({
        serial,
        keys: phoneNotifications.map((notification) => notification.key),
      });
      const dismissedKeys = new Set(result?.dismissedKeys || []);
      if (dismissedKeys.size) {
        usePhoneStore.getState().setNotifications(
          usePhoneStore.getState().notifications.filter((notification) => !dismissedKeys.has(notification.key))
        );
      }
      if (!result?.success) {
        setError(result?.error || 'Certaines notifications n’ont pas pu être écartées du téléphone.');
      } else {
        setError('');
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setClearingNotifications(false);
    }
  }, [clearingNotifications, phoneNotifications, serial]);

  const choosePhoneWallpaper = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError('L’image doit peser 4 Mo ou moins.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Choisis une image PNG, JPEG, WebP ou GIF.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = String(reader.result || '');
      if (!image.startsWith('data:image/')) {
        setError('Impossible de lire cette image.');
        return;
      }
      setWallpaperUrl(image);
      saveSettings({ homeBackgroundImage: image });
    };
    reader.onerror = () => setError('Impossible de lire cette image.');
    reader.readAsDataURL(file);
  };

  const setPhoneRadio = useCallback(
    async (radio, enabled) => {
      if (!serial) return;
      setControlBusy(radio);
      try {
        const result = await apiRef.current?.setRadio({ serial, radio, enabled });
        if (!result?.success) {
          setError(result?.error || `Impossible de modifier ${radio}.`);
          return;
        }
        await refreshStatus();
      } catch (err) {
        setError(String(err.message || err));
      } finally {
        setControlBusy('');
      }
    },
    [serial, refreshStatus]
  );

  // Sonnerie et Ne pas déranger. Le processus principal relit l'état appliqué
  // par Android : on rafraîchit ensuite pour que la barre dise le vrai mode,
  // même quand le téléphone a ignoré la demande.
  const setPhoneRinger = useCallback(
    async (mode) => {
      if (!serial) return;
      setControlBusy('ringer');
      try {
        const result = await apiRef.current?.setRingerMode({ serial, mode });
        if (!result?.success) setError(result?.error || 'Impossible de changer le mode sonnerie.');
        await refreshStatus();
      } catch (err) {
        setError(String(err.message || err));
      } finally {
        setControlBusy('');
      }
    },
    [serial, refreshStatus]
  );

  const setPhoneDnd = useCallback(
    async (enabled) => {
      if (!serial) return;
      setControlBusy('dnd');
      try {
        const result = await apiRef.current?.setDnd({ serial, enabled });
        if (!result?.success) setError(result?.error || 'Impossible de changer Ne pas déranger.');
        await refreshStatus();
      } catch (err) {
        setError(String(err.message || err));
      } finally {
        setControlBusy('');
      }
    },
    [serial, refreshStatus]
  );

  const openDevicePanel = useCallback(
    async (panel) => {
      if (!serial) return;
      try {
        const result = await apiRef.current?.openSettings({ serial, panel });
        if (!result?.success) {
          setError(result?.error || 'Impossible d’ouvrir les réglages Android.');
        }
      } catch (err) {
        setError(String(err.message || err));
      }
    },
    [serial]
  );

  const deviceModel = device?.model;
  const openPhoneMirror = useCallback(async () => {
    if (!serial) return;
    try {
      const result = await apiRef.current?.startMirror({
        serial,
        title: deviceModel || 'Téléphone',
      });
      if (result?.success) {
        setMirrorRunning(true);
        setError('');
      } else {
        setError(result?.error || "Impossible d'ouvrir le miroir.");
      }
    } catch (err) {
      setError(String(err.message || err));
    }
  }, [serial, deviceModel]);

  const sendPhoneKey = useCallback(
    async (key) => {
      if (!serial) return;
      try {
        const result = await apiRef.current?.key({ serial, key });
        if (!result?.success) setError(result?.error || 'La commande n’a pas été envoyée.');
      } catch (err) {
        setError(String(err.message || err));
      }
    },
    [serial]
  );

  useEffect(() => {
    if (visible) refreshStatus();
  }, [visible, refreshStatus]);

  useEffect(() => {
    const refreshPins = async () => {
      try {
        const result = await apiRef.current?.getSettings?.();
        if (result?.success) {
          setPinnedPackages(Array.isArray(result.settings?.pinnedPackages) ? result.settings.pinnedPackages : []);
        }
      } catch (err) {
        console.error('[orbit] actualisation des applications téléphone épinglées échouée:', err);
      }
    };
    window.addEventListener('orbit:phone-pins-changed', refreshPins);
    return () => window.removeEventListener('orbit:phone-pins-changed', refreshPins);
  }, []);

  // Souscription aux événements du processus principal (progression moteur et
  // fermeture de la fenêtre miroir).
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return undefined;
    const offProgress = api.onEngineProgress?.((payload) => setEngineProgress(payload));
    const offMirror = api.onMirrorStopped?.(() => {
      setMirrorRunning(false);
      refreshStatus();
    });
    return () => {
      offProgress?.();
      offMirror?.();
    };
  }, [refreshStatus]);

  // Sans appareil, on réessaie doucement : un câble branché doit être vu sans
  // cliquer sur « Actualiser ».
  useEffect(() => {
    if (!visible || loading || serial) return undefined;
    const timer = setInterval(() => refreshStatus(), 7000);
    return () => clearInterval(timer);
  }, [visible, loading, serial, refreshStatus]);

  // Liste des applications : cache disque côté principal, rafraîchie à la
  // demande (bouton ou changement de « apps système »).
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !serial) {
      setApps([]);
      return undefined;
    }
    let alive = true;
    setAppsLoading(true);
    api
      // `appsToken` > 0 = rechargement explicite : on ignore le cache du
      // processus principal (mais on garde l'instantané disque pour l'affichage).
      .listApps({ serial, refresh: appsToken > 0 })
      .then((res) => {
        if (!alive) return;
        if (res?.success) {
          setApps(Array.isArray(res.apps) ? res.apps : []);
          setError('');
        } else {
          setError(res?.error || 'Liste des applications indisponible.');
        }
      })
      .catch((err) => alive && setError(String(err.message || err)))
      .finally(() => alive && setAppsLoading(false));
    return () => {
      alive = false;
    };
  }, [serial, appsToken]);

  useEffect(() => {
    iconLimit = settings.iconConcurrency;
  }, [settings.iconConcurrency]);

  // Largeur de capture = largeur RÉELLE de l'image à l'écran (× densité), bornée
  // par la définition du téléphone. C'est ce qui rend la vue plein écran nette
  // sans envoyer 4 Mo d'image par trame quand la zone est plus petite.
  const deviceWidth = screen?.deviceWidth || 0;
  const captureMaxWidth = useMemo(() => {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const wanted = Math.round((viewWidth || settings.captureWidth) * dpr);
    // On ne dépasse jamais : la place à l'écran, le plafond choisi dans les
    // réglages, et la définition du téléphone (au-delà, on n'invente rien).
    const cap = Math.min(wanted, settings.captureWidth, deviceWidth || wanted);
    return Math.max(240, Math.min(1600, cap));
  }, [viewWidth, deviceWidth, settings.captureWidth]);

  // Aperçu intégré. La boucle s'arrête dès que l'onglet change, que l'app
  // passe en arrière-plan ou que la fenêtre Orbit est masquée.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !serial || tab !== 'screen' || !visible || paused) return undefined;
    let alive = true;
    let timer = null;
    let failures = 0;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(tick, 800);
        return;
      }
      const started = performance.now();
      try {
        const res = await api.screen({
          serial,
          maxWidth: captureMaxWidth,
          // L'app ouverte a son propre écran : on capture CE display, sinon
          // on verrait l'accueil du téléphone derrière elle.
        });
        if (!alive) return;
        if (res?.success) {
          failures = 0;
          setScreen(res);
          setScreenError('');
        } else {
          failures += 1;
          setScreenError(res?.error || 'Capture impossible.');
        }
      } catch (err) {
        failures += 1;
        if (alive) setScreenError(String(err.message || err));
      }
      // Un appareil débranché échoue à chaque tour : on ralentit au lieu de
      // marteler adb, et on rafraîchit l'état après trois échecs.
      if (failures >= 3 && failures % 3 === 0) refreshStatus();
      const elapsed = performance.now() - started;
      const delay = failures
        ? Math.min(4000, 900 * failures)
        : Math.max(120, (settings.refreshMs || 400) - elapsed);
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [serial, tab, visible, paused, captureMaxWidth, settings.refreshMs, refreshStatus]);

  // État réel du plein écran (le raccourci F11 d'Orbit le change aussi) : un
  // bouton qui afficherait l'inverse de l'écran serait plus gênant qu'utile.
  useEffect(() => {
    const api = window.electronAPI;
    const pending = api?.getFullscreen?.();
    if (pending?.then) pending.then((v) => setFullscreen(!!v)).catch(() => {});
    return api?.onFullScreenChange?.((v) => setFullscreen(!!v));
  }, []);

  // Les réglages sont l'endroit où l'on veut savoir s'il existe une version
  // plus récente : la vérification réseau n'a lieu qu'à l'ouverture de l'onglet.
  useEffect(() => {
    if (tab !== 'settings' || !visible) return undefined;
    let alive = true;
    apiRef.current?.engineStatus?.(true).then((res) => {
      if (alive && res?.success) {
        setStatus((prev) => (prev ? { ...prev, engine: res } : prev));
      }
    });
    return () => {
      alive = false;
    };
  }, [tab, visible]);

  const selectTab = useCallback((id) => {
    setTab(id);
    if (id !== 'screen') setKeyboardOpen(false);
  }, []);

  const saveSettings = useCallback(async (patch) => {
    const api = apiRef.current;
    setSettings((prev) => normalizePhoneSettings({ ...prev, ...patch }));
    if (!api) return;
    try {
      const res = await api.setSettings(patch);
      if (res?.success && res.settings) {
        setSettings(normalizePhoneSettings(res.settings));
        if (typeof patch.homeBackgroundImage === 'string') {
          setWallpaperUrl(res.settings.homeBackgroundImage || '');
        }
      }
      else setError(res?.error || 'Impossible d’enregistrer ces réglages.');
    } catch (err) {
      setError(String(err.message || err));
    }
  }, []);

  const toggleFavorite = useCallback(
    async (pkg) => {
      const next = favorites.includes(pkg)
        ? favorites.filter((p) => p !== pkg)
        : [pkg, ...favorites.filter((p) => p !== pkg)].slice(0, 24);
      setFavorites(next);
      try {
        const result = await apiRef.current?.setSettings({ favoritePackages: next });
        if (!result?.success) {
          setFavorites(favorites);
          setError(result?.error || 'Impossible d’enregistrer les favoris.');
        }
      } catch (err) {
        setFavorites(favorites);
        setError(String(err.message || err));
      }
    },
    [favorites]
  );

  const togglePinned = useCallback(
    async (pkg) => {
      const next = pinnedPackages.includes(pkg)
        ? pinnedPackages.filter((item) => item !== pkg)
        : [...pinnedPackages, pkg].slice(0, MAX_PINNED_PHONE_APPS);
      if (!pinnedPackages.includes(pkg) && pinnedPackages.length >= MAX_PINNED_PHONE_APPS) {
        setError(`Vous pouvez épingler jusqu'à ${MAX_PINNED_PHONE_APPS} applications.`);
        return;
      }
      setPinnedPackages(next);
      try {
        const result = await apiRef.current?.setSettings({ pinnedPackages: next });
        if (!result?.success) {
          setPinnedPackages(pinnedPackages);
          setError(result?.error || 'Impossible d’enregistrer les applications épinglées.');
          return;
        }
        window.dispatchEvent(new Event('orbit:phone-pins-changed'));
      } catch (err) {
        setPinnedPackages(pinnedPackages);
        setError(String(err.message || err));
      }
    },
    [pinnedPackages]
  );

  const launch = useCallback(
    async (target) => {
      const api = apiRef.current;
      if (!api || !serial || !target?.package) return;
      let res;
      try {
        res = await api.startApp({
          serial,
          package: target.package,
          name: target.name || target.package,
        });
      } catch (err) {
        setError(err?.message || `Impossible d'ouvrir ${target.name || target.package}.`);
        return;
      }
      if (!res?.success) {
        setError(res?.error || `Impossible d'ouvrir ${target.name || target.package} dans une fenêtre.`);
        return;
      }

      const nextRecents = [target.package, ...recents.filter((p) => p !== target.package)].slice(0, 8);
      setRecents(nextRecents);
      api.setSettings({ recentPackages: nextRecents }).catch(() => {});
      setError('');
    },
    [serial, recents]
  );

  const dismissPhoneNotification = useCallback(async (notification) => {
    if (!serial || !notification?.key) return;
    const result = await apiRef.current?.dismissNotification?.({ serial, key: notification.key });
    if (result?.success) usePhoneStore.getState().removeNotification(notification.key);
    else setError(result?.error || "Impossible d'écarter cette notification du téléphone.");
  }, [serial]);

  // Journal d'appels : lu à l'ouverture de l'accueil, puis rafraîchi quand les
  // notifications du téléphone bougent (un appel manqué en produit une) — pas
  // de sondage régulier pour une liste qui ne change que rarement.
  const [callLog, setCallLog] = useState([]);
  const [callBusy, setCallBusy] = useState('');
  // Le journal d'appels n'est lu que si une carte l'affiche.
  const showCalls = Array.isArray(settings.homeWidgets)
    && settings.homeWidgets.some((widget) => widget?.type === 'calls');
  const refreshCallLog = useCallback(async () => {
    if (!serial) {
      setCallLog([]);
      return;
    }
    const result = await apiRef.current?.callLog?.({ serial, limit: 12 }).catch(() => null);
    if (result?.success) setCallLog(result.entries || []);
  }, [serial]);

  useEffect(() => {
    if (!visible || !serial || !showCalls) return;
    // Hors du corps de l'effet : la lecture du journal met l'état à jour, et
    // la déclencher pendant le rendu enchaîne un rendu de plus pour rien.
    Promise.resolve().then(refreshCallLog);
  }, [visible, serial, showCalls, phoneNotifications.length, refreshCallLog]);

  // Envoi de fichiers vers le téléphone. Le compte rendu reste affiché : savoir
  // OÙ le fichier est arrivé fait partie du service rendu.
  const [sendingFiles, setSendingFiles] = useState(false);
  const [sendReport, setSendReport] = useState('');
  // `folder` : sélecteur de dossiers, envoi récursif. L'arborescence est
  // recréée dans les téléchargements du téléphone.
  const sendFilesToPhone = useCallback(async (folder = false) => {
    if (!serial) return;
    setSendingFiles(true);
    setSendReport('');
    try {
      const result = await apiRef.current?.sendFiles?.({ serial, folder });
      if (result?.cancelled) return;
      const count = result?.sent?.length || 0;
      if (count) {
        setSendReport(
          `${count} fichier${count > 1 ? 's' : ''} envoyé${count > 1 ? 's' : ''} dans ${result.directory} du téléphone${result.error ? ` — ${result.error}` : ''}`
        );
      } else {
        setError(result?.error || 'Aucun fichier n’a pu être envoyé au téléphone.');
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSendingFiles(false);
    }
  }, [serial]);

  // Rappeler. Deux intentions distinctes : préparer le numéro sur le clavier
  // du téléphone (défaut, l'utilisateur confirme sur l'appareil) ou lancer
  // l'appel — un appel ne part donc jamais par surprise.
  const callBack = useCallback(async (entry, mode) => {
    if (!serial || !entry?.number) return;
    setCallBusy(entry.number + mode);
    setError('');
    try {
      const result = await apiRef.current?.placeCall?.({ serial, number: entry.number, mode });
      if (!result?.success) setError(result?.error || 'Le téléphone n’a pas composé ce numéro.');
    } finally {
      setCallBusy('');
    }
  }, [serial]);

  // Demande venue d'ailleurs (alerte système, notification dans la cloche) :
  // on ouvre l'app demandée dès que l'appareil et la liste sont prêts.
  const requestedPackage = usePhoneStore((s) => s.requestedPackage);
  useEffect(() => {
    if (!requestedPackage || !visible || loading || !serial) return;
    usePhoneStore.getState().clearRequest();
    const known = apps.find((a) => a.package === requestedPackage);
    launch({ package: requestedPackage, name: known?.name || requestedPackage });
  }, [requestedPackage, visible, loading, serial, apps, launch]);

  // Commandes Android dans l'aperçu de l'écran physique.
  const goBack = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !serial) return;
    await api.key({ serial, key: 'back' });
  }, [serial]);

  // Commandes de navigation pour l'écran physique affiché dans l'aperçu.
  const leaveApp = useCallback(
    async (deviceKey) => {
      setKeyboardOpen(false);
      setScreen(null);
      if (serial) await apiRef.current?.key({ serial, key: deviceKey });
    },
    [serial]
  );

  const toggleFullscreen = useCallback(() => {
    // Plein écran de la FENÊTRE Orbit (F11) : l'app du téléphone occupe alors
    // tout l'écran, sans barre latérale ni barres d'Orbit. L'état réel est
    // relu depuis le processus principal (F11 marche aussi hors de ce bouton).
    window.electronAPI?.toggleFullscreen?.();
  }, []);

  const openUrl = useCallback(async () => {
    const url = detectUrl(query);
    if (!url || !serial) return;
    const res = await apiRef.current?.openUrl({ serial, url });
    if (!res?.success) setError(res?.error || "Le téléphone n'a pas ouvert ce lien.");
    else setQuery('');
  }, [query, serial]);

  // L'aperçu est une image, donc Chromium ne peut pas y saisir les touches
  // comme dans un champ de texte. On relaie explicitement clavier et caractères
  // vers l'écran Android ciblé.
  const handlePreviewKeyDown = useCallback((event) => {
    if (!serial || event.ctrlKey || event.metaKey || event.altKey) return;
    const keys = {
      Escape: 'back',
      Enter: 'enter',
      Backspace: 'backspace',
      Delete: 'delete',
      Tab: 'tab',
      ArrowUp: 'dpad_up',
      ArrowDown: 'dpad_down',
      ArrowLeft: 'dpad_left',
      ArrowRight: 'dpad_right',
      PageUp: 'page_up',
      PageDown: 'page_down',
      Home: 'move_home',
      End: 'move_end',
      ' ': 'space',
    };
    const key = keys[event.key];
    if (!key && event.key.length !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    if (key) {
      apiRef.current?.key({ serial, key });
    } else {
      apiRef.current?.text({ serial, text: event.key });
    }
  }, [serial]);

  const connect = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !connectAddress.trim()) return;
    setConnectBusy(true);
    setConnectError('');
    const res = await api.connect(connectAddress.trim());
    setConnectBusy(false);
    if (!res?.success) {
      setConnectError(res?.output || res?.error || 'Connexion refusée.');
      return;
    }
    setConnectAddress('');
    setConnectOpen(false);
    await refreshStatus();
  }, [connectAddress, refreshStatus]);

  const pair = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !pairAddress.trim() || !pairCode.trim()) return;
    setConnectBusy(true);
    setConnectError('');
    const res = await api.pair({ address: pairAddress.trim(), code: pairCode.trim() });
    setConnectBusy(false);
    if (!res?.success) {
      setConnectError(res?.output || res?.error || "Appairage refusé.");
      return;
    }
    setPairCode('');
    setPairOpen(false);
    setConnectError('');
    // Le port d'appairage est différent du port de connexion : on ne garde que
    // l'hôte et l'utilisateur lit le port « IP et port » dans Android.
    setConnectAddress(`${pairAddress.replace(/:\d+$/, '')}:`);
    setConnectOpen(true);
  }, [pairAddress, pairCode]);

  const disconnect = useCallback(async () => {
    if (!serial) return;
    await apiRef.current?.disconnect(serial);
    selectTab('home');
    setScreen(null);
    await refreshStatus();
  }, [serial, refreshStatus, selectTab]);

  const installEngine = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    setEngineBusy(true);
    setEngineError('');
    setEngineProgress({ phase: 'download', received: 0, total: 0 });
    const res = await api.installEngine();
    setEngineBusy(false);
    if (!res?.success) {
      setEngineError(res?.error || "L'installation du moteur a échoué.");
      setEngineProgress(null);
      return;
    }
    setEngineProgress({ phase: 'done', version: res.version });
    await refreshStatus();
  }, [refreshStatus]);

  const refreshApps = useCallback(
    async (withSystem) => {
      if (!serial) return;
      if (typeof withSystem === 'boolean' && withSystem !== settings.showSystemApps) {
        await saveSettings({ showSystemApps: withSystem });
      }
      setAppsToken((n) => n + 1);
    },
    [serial, settings.showSystemApps, saveSettings]
  );

  // Le tri du tiroir vient des RÉGLAGES. Il était en état local : la clé
  // `sortMode` existait dans le schéma mais n'était ni lue ni écrite, donc le
  // choix se perdait à chaque fermeture du Téléphone.
  const sortMode = settings.sortMode;
  const filtered = useMemo(() => {
    const list = filterPhoneApps(apps, query);
    return sortPhoneApps(list, sortMode, recents);
  }, [apps, query, sortMode, recents]);

  const favoriteApps = useMemo(
    () =>
      favorites
        .map((pkg) => apps.find((a) => a.package === pkg))
        .filter(Boolean)
        .slice(0, 12),
    [favorites, apps]
  );

  const recentApps = useMemo(
    () =>
      recents
        .map((pkg) => apps.find((a) => a.package === pkg))
        .filter((a) => a && !favorites.includes(a.package))
        .slice(0, 8),
    [recents, apps, favorites]
  );

  // --- Bureau -------------------------------------------------------------
  //
  // La disposition vit dans les réglages (donc par appareil, et persistée).
  // Le bureau ne lit QUE les sources dont une carte a besoin : poser une
  // horloge ne doit pas déclencher une lecture d'agenda.
  const desktopLayout = Array.isArray(settings.homeWidgets) ? settings.homeWidgets : [];
  const desktopSources = useMemo(() => neededSources(desktopLayout), [desktopLayout]);
  const setDesktopLayout = useCallback(
    (next) => saveSettings({ homeWidgets: normalizeDesktopLayout(next) }),
    [saveSettings]
  );
  const [shadeOpen, setShadeOpen] = useState(false);
  const [calendarData, setCalendarData] = useState(null);
  const [mediaData, setMediaData] = useState(null);
  const [mediaBusy, setMediaBusy] = useState('');
  const [storageData, setStorageData] = useState(null);
  const [screenPreview, setScreenPreview] = useState(null);

  const pinnedAppsList = useMemo(
    () => pinnedPackages.map((pkg) => apps.find((a) => a.package === pkg)).filter(Boolean),
    [pinnedPackages, apps]
  );

  // Clé STABLE des sources. `neededSources` rend un Set neuf à chaque rendu :
  // s'en servir comme dépendance relançait tout l'effet au moindre
  // enregistrement de réglage — donc une capture d'écran de plus, à chaque
  // fois, pour rien.
  const desktopSourcesKey = useMemo(() => [...desktopSources].sort().join(','), [desktopSources]);

  // Chaque source a son rythme : l'agenda et le stockage bougent lentement, la
  // lecture en cours doit suivre le morceau, l'aperçu d'écran est le plus cher
  // (une capture) et reste donc le plus lent des trois rapides.
  //
  // Rien ne tourne si le Téléphone n'est pas à l'écran, si l'onglet Accueil
  // n'est pas celui qu'on regarde, ou si la fenêtre d'Orbit est masquée :
  // interroger un téléphone que personne ne regarde lui coûte sa batterie.
  useEffect(() => {
    if (!visible || !serial || tab !== 'home') return undefined;
    const api = apiRef.current;
    if (!api) return undefined;
    let alive = true;
    let timers = [];
    const sources = new Set(desktopSourcesKey ? desktopSourcesKey.split(',') : []);

    const poll = (source, everyMs, read) => {
      if (!sources.has(source)) return;
      const tick = async () => {
        try {
          const result = await read();
          if (alive) result();
        } catch {
          /* une source muette laisse sa carte dans son état précédent */
        }
      };
      Promise.resolve().then(tick);
      timers.push(window.setInterval(tick, everyMs));
    };

    // Fenêtre d'Orbit masquée (réduite, autre bureau) : on arrête tout et on
    // reprend au retour. Sans ça, l'aperçu d'écran continue de réclamer une
    // capture toutes les cinq secondes à un téléphone que personne ne regarde.
    const stop = () => {
      for (const timer of timers) window.clearInterval(timer);
      timers = [];
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!timers.length) start();
    };

    function start() {
      poll('calendar', 10 * 60 * 1000, async () => {
        const res = await api.calendar?.({ serial, from: Date.now() - 2 * 3600 * 1000, limit: 20 });
        return () =>
          setCalendarData(
            res?.success
              ? { events: res.events || [] }
              : { error: res?.error || 'agenda indisponible', events: [] }
          );
      });

      poll('storage', 5 * 60 * 1000, async () => {
        const res = await api.storage?.({ serial });
        return () =>
          setStorageData(
            res?.success ? { storage: res.storage } : { error: res?.error || 'stockage indisponible' }
          );
      });

      poll('media', 8000, async () => {
        const res = await api.media?.({ serial });
        return () => setMediaData(res?.success ? { media: res.media } : { error: res?.error || '' });
      });

      poll('screen', 5000, async () => {
        // Largeur modeste : c'est une vignette sur un bureau, pas le miroir.
        // `dataUrl` (et non `image`) : c'est le nom que rend `captureScreen`.
        const res = await api.screen?.({ serial, maxWidth: 420 });
        return () =>
          setScreenPreview(
            res?.success && res.dataUrl
              ? { image: res.dataUrl }
              : { error: res?.error || 'aperçu indisponible' }
          );
      });
    }

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [visible, serial, tab, desktopSourcesKey]);

  // Les appels, dans la forme que la carte attend (le libellé et le numéro
  // sont déjà résolus par `describeCallLogEntry`).
  const desktopCalls = useMemo(
    () => ({
      entries: callLog.slice(0, 8).map((entry) => {
        const call = describeCallLogEntry(entry);
        return { ...call, at: entry.at, duration: formatCallDuration(entry.duration), raw: entry };
      }),
    }),
    [callLog]
  );

  // Un appel se lit par son appelant, pas par le titre que pose le dialer
  // (« Appel entrant ») : le volet et la carte Notifications reçoivent donc un
  // intitulé déjà résolu.
  const desktopNotifications = useMemo(
    () =>
      phoneNotifications.map((notification) => {
        if (notification.category !== 'call') return notification;
        const app = apps.find((item) => item.package === notification.package);
        const caller = describeCallNotification(notification, app?.name || notification.appName);
        return {
          ...notification,
          title: caller.unknown ? 'Appel — appelant inconnu' : `Appel — ${caller.who}`,
          text: caller.detail || notification.text || '',
        };
      }),
    [phoneNotifications, apps]
  );

  // La taille est décidée par l'APPELANT : une icône de dock, une tuile et une
  // vignette de liste n'ont pas la même. Elle était figée à 40 px, donc trop
  // grande pour sa boîte dans les grilles — l'icône débordait et se faisait
  // rogner.
  const renderDesktopIcon = useCallback(
    (app, size = 40) => (
      <PhoneIcon
        serial={serial}
        pkg={app.package}
        name={app.name}
        size={size}
        limit={settings.iconConcurrency}
      />
    ),
    [serial, settings.iconConcurrency]
  );

  const desktopActions = useMemo(
    () => ({
      launch,
      renderIcon: renderDesktopIcon,
      openMirror: openPhoneMirror,
      openDrawer: () => {
        setAppDrawerOpen(true);
        setQuery('');
      },
      openSettings: () => selectTab('settings'),
      sendKey: sendPhoneKey,
      mediaKey: async (action) => {
        if (!serial || mediaBusy) return;
        setMediaBusy(action);
        try {
          await apiRef.current?.mediaKey?.({ serial, action });
          // On relit tout de suite : le titre ou l'état de lecture vient de
          // changer, attendre le prochain tour donnerait un bouton menteur.
          const res = await apiRef.current?.media?.({ serial });
          if (res?.success) setMediaData({ media: res.media });
        } catch (err) {
          setError(String(err?.message || err));
        } finally {
          setMediaBusy('');
        }
      },
      toggleRadio: (radio) =>
        setPhoneRadio(radio, (radio === 'wifi' ? device?.wifiEnabled : device?.bluetoothEnabled) !== true),
      toggleRinger: () => setPhoneRinger(device?.ringerMode === 'normal' ? 'vibrate' : 'normal'),
      toggleDnd: () => setPhoneDnd(device?.doNotDisturb !== true),
      sendFiles: () => sendFilesToPhone(false),
      sendFolder: () => sendFilesToPhone(true),
      openDevicePanel,
      openNotification: (item) =>
        launch({ package: item.package, name: item.title || item.package }),
      dismissNotification: dismissPhoneNotification,
      clearNotifications: clearPhoneNotifications,
      callBack: (entry) => callBack(entry.raw || entry, 'call'),
    }),
    [
      launch,
      renderDesktopIcon,
      openPhoneMirror,
      sendPhoneKey,
      serial,
      mediaBusy,
      device,
      setPhoneRadio,
      setPhoneRinger,
      setPhoneDnd,
      sendFilesToPhone,
      openDevicePanel,
      dismissPhoneNotification,
      clearPhoneNotifications,
      callBack,
      selectTab,
    ]
  );

  const searchUrl = detectUrl(query);
  const tileSize = settings.iconSize === 'small' ? 40 : settings.iconSize === 'large' ? 68 : 52;
  // Le tiroir s'étalait sur un nombre FIXE de colonnes : sur un grand écran il
  // laissait la moitié de la place vide, et sur une fenêtre étroite il
  // tassait. Il en met maintenant autant que la largeur en autorise, à partir
  // de « largeur minimale d'une tuile » — un réglage qui existait déjà, avec
  // son curseur, mais qui n'était appliqué nulle part.
  // « Taille des icônes » vaut aussi pour le BUREAU : le réglage ne touchait
  // que le tiroir, donc le changer ne changeait rien là où on regarde.
  const desktopIconBase = settings.iconSize === 'small' ? 32 : settings.iconSize === 'large' ? 52 : 40;
  const appCellWidth = Math.max(settings.gridMin, tileSize + 28);
  const appCellHeight = tileSize + 46;
  const appGridTemplate = `repeat(auto-fill, minmax(${appCellWidth}px, 1fr))`;
  const iconLimitForGrid = settings.iconConcurrency;
  // Une app est ouverte : on retire la coquille Téléphone (en-tête + onglets)
  // pour que l'app occupe TOUTE la zone d'Orbit. Les commandes sont dans la
  // barre flottante de la vue, et la croix referme l'app.
  // --- Rendu des tuiles ---------------------------------------------------

  const tile = (app, compact = false) => (
    <div
      key={app.package}
      className={`group relative flex ${
        compact ? 'min-w-0 flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-white hover:bg-white/[0.09]' : 'flex-col items-center gap-1.5 rounded-xl px-1 py-2 hover:bg-bg-hover'
      }`}
    >
      <button
        type="button"
        onClick={() => launch(app)}
        className={`min-w-0 ${compact ? 'flex w-full flex-col items-center gap-1.5 text-center' : 'flex w-full flex-col items-center gap-1.5'}`}
        title={`${app.name} — ${app.package}`}
      >
        <PhoneIcon
          serial={serial}
          pkg={app.package}
          name={app.name}
          size={compact ? 44 : tileSize}
          limit={iconLimitForGrid}
        />
        <span className={`line-clamp-2 min-w-0 leading-tight ${
          compact ? 'w-full text-center text-[11px] text-white/80' : 'w-full text-center text-[11px] text-text-secondary'
        }`}>
          {app.name}
        </span>
      </button>
      <button
        type="button"
        onClick={() => toggleFavorite(app.package)}
        className={`absolute right-1 top-1 rounded-full p-1 transition-opacity ${compact ? '' : 'opacity-0 group-hover:opacity-100'} ${
          favorites.includes(app.package)
            ? 'text-amber-400 opacity-100'
            : 'text-text-muted hover:text-text-primary'
        }`}
        title={favorites.includes(app.package) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      >
        <Star size={12} fill={favorites.includes(app.package) ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        onClick={() => togglePinned(app.package)}
        className={`absolute left-1 top-1 rounded-full p-1 transition-opacity ${compact ? '' : 'opacity-0 group-hover:opacity-100'} ${
          pinnedPackages.includes(app.package)
            ? 'text-sky-300 opacity-100'
            : 'text-text-muted hover:text-text-primary'
        }`}
        title={pinnedPackages.includes(app.package) ? 'Retirer de la barre flottante' : 'Épingler dans la barre flottante'}
        aria-label={pinnedPackages.includes(app.package) ? 'Retirer de la barre flottante' : 'Épingler dans la barre flottante'}
      >
        <Pin size={12} fill={pinnedPackages.includes(app.package) ? 'currentColor' : 'none'} />
      </button>
    </div>
  );

  // --- États globaux ------------------------------------------------------

  if (!api) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-text-muted">
        <div>
          <Smartphone size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            L'app Téléphone nécessite l'application de bureau Orbit (adb + scrcpy).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col text-text-primary ${tab === 'home' ? '' : 'bg-bg-primary'}`}
      style={tab === 'home' ? {
        backgroundImage: desktopBackground || PHONE_HOME_BACKGROUNDS[0].css,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      } : undefined}
    >
      {/* L'en-tête a disparu : il répétait ce que la barre d'état du bureau
          dit déjà (modèle, version d'Android, batterie), et l'engrenage
          doublait l'onglet Réglages. Il ne restait que deux actions propres à
          la coquille — actualiser et fermer — qui ont rejoint les onglets. */}
      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-red-500/10 px-4 py-1.5 text-xs text-red-300">
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <button type="button" onClick={() => setError('')} className="shrink-0 p-0.5">
            <X size={13} />
          </button>
        </div>
      ) : null}

      <nav className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1">
        {[
          ['home', 'Accueil'],
          ['screen', 'Écran'],
          ['settings', 'Réglages'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => selectTab(id)}
            className={`max-w-[220px] truncate rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === id
                ? 'bg-accent-primary/15 text-accent-primary'
                : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
            }`}
            title={label}
          >
            {label}
          </button>
        ))}
        {mirrorRunning ? <Pill tone="good">Miroir ouvert</Pill> : null}
        {!device && !loading ? <Pill tone="warn">Aucun appareil</Pill> : null}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => refreshStatus()}
            className="rounded-lg p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
            title="Actualiser"
            aria-label="Actualiser"
          >
            <RefreshCw size={15} />
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
              title="Fermer le Téléphone (Échap)"
              aria-label="Fermer le Téléphone"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </nav>

      {/* ------------------------------- ACCUEIL ------------------------------ */}
      {tab === 'home' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
              <Loader2 size={16} className="animate-spin" /> Recherche de l'appareil…
            </div>
          ) : !device ? (
            <div className="mx-auto max-w-xl p-6">
              <div className="rounded-2xl border border-border bg-bg-secondary p-5">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <Usb size={17} className="text-accent-primary" /> Connecter un téléphone
                </div>
                <p className="text-xs leading-relaxed text-text-muted">
                  Activez le <strong className="text-text-secondary">débogage USB</strong> dans les
                  options de développement, branchez le câble, puis acceptez l'empreinte sur le
                  téléphone. La connexion sans fil (débogage sans fil Android 11+) marche aussi.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => refreshStatus()}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    <RefreshCw size={13} /> Actualiser
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectOpen((v) => !v)}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover"
                  >
                    <Wifi size={13} /> Sans fil
                  </button>
                  <button
                    type="button"
                    onClick={() => setPairOpen((v) => !v)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover"
                  >
                    Associer un code
                  </button>
                </div>

                {connectOpen ? (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={connectAddress}
                      onChange={(e) => setConnectAddress(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && connect()}
                      placeholder="192.168.1.42:5555"
                      className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-xs outline-none focus:border-accent-primary"
                    />
                    <button
                      type="button"
                      onClick={connect}
                      disabled={connectBusy || !connectAddress.trim()}
                      className="rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {connectBusy ? <Loader2 size={13} className="animate-spin" /> : 'Connecter'}
                    </button>
                  </div>
                ) : null}

                {pairOpen ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={pairAddress}
                      onChange={(e) => setPairAddress(e.target.value)}
                      placeholder="Adresse d'appairage (IP:port affiché par Android)"
                      className="w-full rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-xs outline-none focus:border-accent-primary"
                    />
                    <div className="flex gap-2">
                      <input
                        value={pairCode}
                        onChange={(e) => setPairCode(e.target.value)}
                        placeholder="Code à 6 chiffres"
                        inputMode="numeric"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-xs outline-none focus:border-accent-primary"
                      />
                      <button
                        type="button"
                        onClick={pair}
                        disabled={connectBusy || !pairAddress.trim() || !pairCode.trim()}
                        className="rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Associer
                      </button>
                    </div>
                  </div>
                ) : null}

                {connectError ? (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs text-red-300">{connectError}</p>
                ) : null}
              </div>

              <EngineCard
                engine={engine}
                latest={status?.engine?.latest}
                progress={engineProgress}
                busy={engineBusy}
                error={engineError}
                targetAvailable={status?.engine?.targetAvailable !== false}
                onInstall={installEngine}
              />
            </div>
          ) : (
            <>
              <PhoneDesktop
                layout={desktopLayout}
                onLayoutChange={setDesktopLayout}
                device={device}
                apps={apps}
                pinnedApps={pinnedAppsList}
                favorites={favoriteApps}
                recent={recentApps}
                notifications={desktopNotifications}
                calls={desktopCalls}
                calendar={calendarData}
                media={mediaData}
                storage={storageData}
                screen={screenPreview}
                mediaBusy={mediaBusy}
                callBusy={callBusy}
                controlBusy={controlBusy}
                sendingFiles={sendingFiles}
                sendReport={sendReport}
                mirrorRunning={mirrorRunning}
                shadeOpen={shadeOpen}
                onShadeToggle={setShadeOpen}
                dockVisible={settings.homeDock !== false}
                iconBase={desktopIconBase}
                actions={desktopActions}
              />
              {/* Le tiroir : toutes les applications, par-dessus le bureau.
                  Ouvert depuis le dock, fermé par Échap ou son bouton. */}
              {appDrawerOpen ? (
                <div className="absolute inset-0 z-30 overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-xl">
                  <div className="w-full">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-white shadow-xl backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">Applications</h2><p className="text-xs text-white/50">Choisis une application pour l’ouvrir dans sa fenêtre.</p></div><button type="button" onClick={() => setAppDrawerOpen(false)} className="rounded-lg px-2.5 py-1.5 text-xs text-white/65 hover:bg-white/10">Fermer</button></div>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    if (searchUrl) openUrl();
                    else if (filtered[0]) launch(filtered[0]);
                  }}
                  placeholder="Rechercher une application, un paquet… ou ouvrir un lien"
                  className="w-full rounded-xl border border-border bg-bg-secondary py-2 pl-9 pr-9 text-sm outline-none placeholder:text-text-muted focus:border-accent-primary"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted hover:text-text-primary"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>

              {searchUrl ? (
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-accent-primary/30 bg-accent-primary/10 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={searchUrl}>
                    {searchUrl}
                  </span>
                  <button
                    type="button"
                    onClick={openUrl}
                    className="shrink-0 rounded-lg bg-accent-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    Ouvrir sur le téléphone
                  </button>
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => selectTab('screen')}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-bg-hover"
                >
                  <Monitor size={14} /> Aperçu de l'écran
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await apiRef.current?.startMirror({
                      serial,
                      title: device?.model || 'Téléphone',
                    });
                    if (res?.success) setMirrorRunning(true);
                    else setError(res?.error || "Impossible d'ouvrir le miroir.");
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-bg-hover"
                >
                  <Smartphone size={14} /> Fenêtre miroir
                </button>
                {/* Navigation du téléphone disponible aussi depuis l'accueil :
                    on n'est pas obligé d'ouvrir l'aperçu pour revenir en arrière. */}
                <span className="mx-1 h-4 w-px bg-border" />
                <button
                  type="button"
                  onClick={() => apiRef.current?.key({ serial, key: 'back' })}
                  title="Retour sur le téléphone"
                  className="flex items-center gap-1.5 rounded-lg bg-accent-primary/10 px-2.5 py-1.5 text-xs font-medium text-accent-primary hover:bg-accent-primary/20"
                >
                  <ArrowLeft size={14} /> Retour
                </button>
                <ScreenButton icon={Home} title="Accueil du téléphone" onClick={() => apiRef.current?.key({ serial, key: 'home' })} />
                <ScreenButton icon={Square} title="Applications récentes" onClick={() => apiRef.current?.key({ serial, key: 'recents' })} />
                <ScreenButton icon={Power} title="Éteindre / réveiller l'écran" onClick={() => apiRef.current?.key({ serial, key: 'wakeup' })} />
                <div className="ml-auto flex items-center gap-2 text-[11px] text-text-muted">
                  <span>{apps.length} applications</span>
                  <select
                    value={sortMode}
                    onChange={(e) => saveSettings({ sortMode: e.target.value })}
                    className="rounded-md border border-border bg-bg-secondary px-1.5 py-1 text-[11px] outline-none"
                  >
                    <option value="name">Nom</option>
                    <option value="recent">Récents</option>
                    <option value="package">Paquet</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => refreshApps()}
                    disabled={appsLoading}
                    className="rounded-md p-1 hover:bg-bg-hover disabled:opacity-40"
                    title="Recharger la liste"
                  >
                    <RefreshCw size={13} className={appsLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <section className="mt-5">
                <h3 className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {query ? 'Résultats' : 'Toutes les applications'}
                  {appsLoading ? <Loader2 size={11} className="animate-spin" /> : null}
                </h3>
                {appsLoading && !filtered.length ? (
                  <div className="grid gap-1 overflow-y-auto pr-1" style={{ gridTemplateColumns: appGridTemplate, gridAutoRows: `${appCellHeight}px` }}>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="flex flex-col items-center gap-2 py-2">
                        <div className="h-12 w-12 animate-pulse rounded-2xl bg-bg-hover" />
                        <div className="h-2 w-12 animate-pulse rounded bg-bg-hover" />
                      </div>
                    ))}
                  </div>
                ) : filtered.length ? (
                  <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: appGridTemplate, gridAutoRows: `${appCellHeight}px` }}
                  >
                    {filtered.map(tile)}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-text-muted">
                    {query ? 'Aucune application ne correspond.' : 'Aucune application visible.'}
                  </p>
                )}
              </section>
                  </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* -------------------------------- ÉCRAN ------------------------------- */}
      {/* Vue PLEIN ÉCRAN : l'écran du téléphone remplit toute la zone d'Orbit
          (aucun cadre, aucune marge). L'image est mise à l'échelle selon la
          place disponible — c'est elle qui définit la largeur de capture — et
          les commandes flottent au-dessus pour ne rien voler à l'app. */}
      {tab === 'screen' ? (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black">
          {!device ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-text-muted">
              Aucun téléphone connecté.
            </div>
          ) : (
            <>
              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                {screenError && !screen ? (
                  <div className="max-w-sm p-6 text-center text-sm text-text-muted">
                    <Smartphone size={34} className="mx-auto mb-2 opacity-40" />
                    {screenError}
                  </div>
                ) : screen ? (
                  <Preview
                    screen={screen}
                    serial={serial}
                    onFit={setViewWidth}
                    onError={setScreenError}
                    onKeyDown={handlePreviewKeyDown}
                    onGesture={(payload) =>
                      apiRef.current?.swipe({ serial, ...payload })
                    }
                    onTap={(x, y) =>
                      apiRef.current?.tap({ serial, x, y })
                    }
                  />
                ) : (
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Loader2 size={16} className="animate-spin" /> Première capture…
                  </div>
                )}
              </div>

              {/* Barre flottante : elle disparaît visuellement (dégradé) et ne
                  réserve aucune place à l'image. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 bg-gradient-to-b from-black/80 via-black/35 to-transparent p-2">
                <div className="pointer-events-auto flex items-center gap-0.5 rounded-full bg-black/60 p-1 text-white/80 shadow-lg backdrop-blur">
                  <RemoteButton
                    icon={ArrowLeft}
                    title="Retour (reste dans l'application)"
                    onClick={goBack}
                  />
                  <RemoteButton icon={Home} title="Accueil du téléphone" onClick={() => leaveApp('home')} />
                  <RemoteButton
                    icon={Square}
                    title="Applications récentes"
                    onClick={() => leaveApp('recents')}
                  />
                  <RemoteButton
                    icon={Power}
                    title="Éteindre / réveiller"
                    onClick={() => apiRef.current?.key({ serial, key: 'wakeup' })}
                  />
                  <span className="mx-0.5 h-4 w-px bg-white/15" />
                  <RemoteButton
                    icon={Keyboard}
                    title="Clavier"
                    active={keyboardOpen}
                    onClick={() => setKeyboardOpen((v) => !v)}
                  />
                  <RemoteButton
                    icon={RefreshCw}
                    title={paused ? 'Reprendre' : 'Mettre en pause'}
                    active={!paused}
                    onClick={() => setPaused((v) => !v)}
                  />
                  <RemoteButton
                    icon={fullscreen ? Minimize2 : Maximize2}
                    title={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                    active={fullscreen}
                    onClick={toggleFullscreen}
                  />
                  <RemoteButton
                    icon={Monitor}
                    title="Ouvrir le miroir dans une fenêtre"
                    onClick={async () => {
                      const res = await apiRef.current?.startMirror({
                        serial,
                        title: device?.model || 'Téléphone',
                      });
                      if (res?.success) setMirrorRunning(true);
                      else setError(res?.error || "Impossible d'ouvrir le miroir.");
                    }}
                  />
                  {onClose ? (
                    <>
                      <span className="mx-0.5 h-4 w-px bg-white/15" />
                      <RemoteButton icon={X} title="Fermer le Téléphone (Échap)" onClick={onClose} />
                    </>
                  ) : null}
                </div>

              </div>

              {keyboardOpen ? (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/70 p-2 backdrop-blur">
                  <input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      // Les touches de navigation pilotent directement l'app :
                      // c'est ce qu'on attend d'un clavier branché sur un
                      // écran virtuel, sans passer par le champ de texte.
                      const nav = {
                        ArrowUp: 'dpad_up',
                        ArrowDown: 'dpad_down',
                        ArrowLeft: 'dpad_left',
                        ArrowRight: 'dpad_right',
                        Backspace: 'backspace',
                        Delete: 'delete',
                        Tab: 'tab',
                        PageUp: 'page_up',
                        PageDown: 'page_down',
                        Home: 'move_home',
                        End: 'move_end',
                      }[e.key];
                      if (nav) {
                        e.preventDefault();
                        apiRef.current?.key({ serial, key: nav });
                        return;
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        apiRef.current?.text({ serial, text: typed });
                        setTyped('');
                      }
                    }}
                    placeholder="Écrire sur le téléphone…"
                    className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-accent-primary"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      apiRef.current?.text({ serial, text: typed });
                      setTyped('');
                    }}
                    disabled={!typed}
                    className="rounded-full bg-accent-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Envoyer
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      apiRef.current?.key({ serial, key: 'enter' })
                    }
                    className="rounded-full border border-white/15 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10"
                  >
                    Entrée
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* ------------------------------- RÉGLAGES ----------------------------- */}
      {tab === 'settings' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl space-y-4 p-4">
            <EngineCard
              engine={engine}
              latest={status?.engine?.latest}
              progress={engineProgress}
              busy={engineBusy}
              error={engineError}
              targetAvailable={status?.engine?.targetAvailable !== false}
              platform={status?.engine?.supportedPlatform}
              onInstall={installEngine}
            />

            <section className="rounded-xl border border-border bg-bg-secondary p-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Wifi size={15} className="text-accent-primary" /> Appareil
              </h3>
              {device ? (
                <>
                  <p className="text-xs text-text-muted">
                    {device.model}
                    {device.android ? ` · Android ${device.android}` : ''} ·{' '}
                    <span className="font-mono">{device.serial}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={disconnect}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover"
                    >
                      Déconnecter
                    </button>
                    <button
                      type="button"
                      onClick={() => setConnectOpen((v) => !v)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover"
                    >
                      Changer d'appareil
                    </button>
                  </div>
                  {connectOpen ? (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={connectAddress}
                        onChange={(e) => setConnectAddress(e.target.value)}
                        placeholder="192.168.1.42:5555"
                        className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-xs outline-none focus:border-accent-primary"
                      />
                      <button
                        type="button"
                        onClick={connect}
                        disabled={connectBusy || !connectAddress.trim()}
                        className="rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Connecter
                      </button>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-text-muted">Aucun appareil connecté.</p>
              )}
              {connectError ? <p className="mt-2 text-xs text-red-300">{connectError}</p> : null}
            </section>

            <section className="rounded-xl border border-border bg-bg-secondary p-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Palette size={15} className="text-accent-primary" /> Bureau du téléphone
              </h3>
              <p className="mb-3 text-xs text-text-muted">Choisis le fond et les widgets visibles sur l’accueil Orbit du téléphone.</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {PHONE_HOME_BACKGROUNDS.map(({ id, label, css }) => (
                  <button key={id} type="button" onClick={() => saveSettings({ homeBackground: id, homeBackgroundImage: '' })}
                    className={`h-16 w-24 rounded-lg border bg-cover bg-center text-xs font-medium text-white shadow-sm transition-transform hover:scale-[1.03] ${settings.homeBackground === id && !settings.homeBackgroundImage ? 'border-accent-primary ring-2 ring-accent-primary/50' : 'border-white/20'}`}
                    style={{ backgroundImage: css }}>
                    <span className="rounded bg-black/45 px-1.5 py-0.5">{label}</span>
                  </button>
                ))}
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  ref={wallpaperFileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.gif"
                  className="hidden"
                  onChange={choosePhoneWallpaper}
                />
                <input
                  type="url"
                  value={wallpaperUrl.startsWith('data:') ? '' : wallpaperUrl}
                  onChange={(event) => setWallpaperUrl(event.target.value)}
                  placeholder="https://… (image)"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-xs outline-none focus:border-accent-primary"
                />
                <button type="button" onClick={() => saveSettings({ homeBackgroundImage: wallpaperUrl.trim() })} disabled={!wallpaperUrl.trim()} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover disabled:opacity-40">
                  Appliquer l’URL
                </button>
                <button type="button" onClick={() => wallpaperFileRef.current?.click()} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover">
                  Fichier…
                </button>
                {settings.homeBackgroundImage ? (
                  <button type="button" onClick={() => saveSettings({ homeBackgroundImage: '' })} className="rounded-lg px-2 py-1.5 text-xs text-text-muted hover:bg-bg-hover">
                    Retirer
                  </button>
                ) : null}
              </div>
              <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
                Scrcpy crée un nouvel écran Android avec ces dimensions. Ce réglage s’applique aux nouvelles fenêtres ; ferme les fenêtres déjà ouvertes ci-dessous avant de relancer une app. Une app peut toujours imposer sa propre orientation.
              </p>
              <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
                Les cartes du bureau s’ajoutent et s’enlèvent directement sur l’accueil, par le bouton
                « Ajouter » : c’est là qu’on les voit, donc c’est là qu’on les choisit. Deux dispositions
                de départ y sont proposées, « sobre » et « tout afficher ». Les widgets Android fournis par
                d’autres applications ne peuvent pas être hébergés ici : Android ne les expose qu’à un
                lanceur installé sur le téléphone. Les cartes Agenda, Lecture en cours et Stockage lisent
                donc les mêmes données, directement sur l’appareil.
              </p>
              <Toggle
                label="Dock en bas du bureau"
                hint="Les applications épinglées, la navigation du téléphone et le miroir, toujours à portée."
                checked={settings.homeDock !== false}
                onChange={(v) => saveSettings({ homeDock: v })}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveSettings({ homeWidgets: presetLayout('sobre') })}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-bg-hover"
                  title="L’heure et les favoris, rien de plus"
                >
                  Bureau sobre
                </button>
                <button
                  type="button"
                  onClick={() => saveSettings({ homeWidgets: presetLayout('complet') })}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-bg-hover"
                  title="Toutes les cartes disponibles"
                >
                  Tout afficher
                </button>
                <button
                  type="button"
                  onClick={() => saveSettings({ homeWidgets: [] })}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-bg-hover"
                  title="Un bureau nu : le fond d’écran, le volet et le dock"
                >
                  Bureau nu
                </button>
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <h4 className="mb-2 text-xs font-medium text-text-secondary">Tiroir d’applications</h4>
                <Range label="Taille des icônes" value={settings.iconSize === 'small' ? 1 : settings.iconSize === 'large' ? 3 : 2} min={1} max={3} step={1} suffix="" onChange={(v) => saveSettings({ iconSize: v === 1 ? 'small' : v === 3 ? 'large' : 'medium' })} />
                {/* « Colonnes par ligne » et « Lignes visibles » ont disparu :
                    le tiroir remplit maintenant la largeur disponible, autant
                    de colonnes que la fenêtre en permet. Un nombre fixe
                    laissait la moitié d'un grand écran vide. La taille des
                    icônes ci-dessus décide seule de la densité. */}
                <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                  Le tiroir s’adapte à la largeur de la fenêtre : la taille des icônes décide du
                  nombre de colonnes.
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-bg-secondary p-4">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Monitor size={15} className="text-accent-primary" /> Fenêtres des applications
              </h3>
              <p className="mb-3 text-xs leading-relaxed text-text-muted">
                Chaque application s'ouvre dans sa propre fenêtre scrcpy, avec un flux vidéo direct.
                Le miroir reste une fenêtre séparée pour l'écran physique du téléphone.
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                {[
                  ['landscape', 'Paysage'],
                  ['portrait', 'Portrait'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => saveSettings({ appDisplayOrientation: value })}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      settings.appDisplayOrientation === value
                        ? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
                        : 'border-border text-text-muted hover:bg-bg-hover'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Range
                label="Largeur de l'écran Android virtuel"
                value={settings.appDisplayWidth}
                min={800}
                max={1920}
                step={80}
                suffix=" px"
                onChange={(v) => saveSettings({ appDisplayWidth: v })}
              />
              <Range
                label="Hauteur de l'écran Android virtuel"
                value={settings.appDisplayHeight}
                min={480}
                max={1400}
                step={40}
                suffix=" px"
                onChange={(v) => saveSettings({ appDisplayHeight: v })}
              />
              <Range
                label="Densité Android"
                value={settings.appDisplayDpi}
                min={72}
                max={320}
                step={8}
                suffix=" dpi"
                onChange={(v) => saveSettings({ appDisplayDpi: v })}
              />
              <Range
                label="Taille initiale de la fenêtre"
                value={settings.appWindowScale}
                min={35}
                max={85}
                step={5}
                suffix=" % du bureau"
                onChange={(v) => saveSettings({ appWindowScale: v })}
              />
              <Toggle
                label="Adapter l'écran Android au redimensionnement"
                hint="Avec scrcpy 4+, Android recalcule son interface quand tu redimensionnes la fenêtre. La densité suit la taille pour garder des proportions lisibles."
                checked={settings.appFollowWindow}
                onChange={(v) => saveSettings({ appFollowWindow: v })}
              />
              <button type="button" onClick={async () => { await apiRef.current?.stopApp?.({}); setError(''); }} className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition hover:bg-bg-hover">
                Fermer les fenêtres d’applications pour appliquer les réglages
              </button>
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                Certaines applications imposent le portrait. L'orientation Paysage leur fournit un écran large,
                mais Android respecte toujours les choix d'orientation imposés par l'application.
              </p>
            </section>

            <section className="rounded-xl border border-border bg-bg-secondary p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Monitor size={15} className="text-accent-primary" /> Aperçu et performances
              </h3>
              <Range
                label="Résolution maximale de la capture"
                value={settings.captureWidth}
                min={480}
                max={1600}
                step={80}
                suffix=" px"
                onChange={(v) => saveSettings({ captureWidth: v })}
              />
              <p className="-mt-1 text-[11px] leading-relaxed text-text-muted">
                L'aperçu demande la résolution qui remplit la fenêtre, sans dépasser cette
                valeur. La baisser rend l'affichage plus fluide sur un téléphone lent ; la
                monter le rend plus net.
              </p>
              <Range
                label="Intervalle de rafraîchissement"
                value={settings.refreshMs}
                min={150}
                max={1500}
                step={50}
                suffix=" ms"
                onChange={(v) => saveSettings({ refreshMs: v })}
              />
              <Range
                label="Taille des icônes"
                value={settings.iconSize === 'small' ? 1 : settings.iconSize === 'large' ? 3 : 2}
                min={1}
                max={3}
                step={1}
                suffix={settings.iconSize === 'small' ? ' (petit)' : settings.iconSize === 'large' ? ' (grand)' : ' (moyen)'}
                onChange={(v) => saveSettings({ iconSize: v === 1 ? 'small' : v === 3 ? 'large' : 'medium' })}
              />
              <Range
                label="Largeur minimale d'une tuile"
                value={settings.gridMin}
                min={88}
                max={240}
                step={4}
                suffix=" px"
                onChange={(v) => saveSettings({ gridMin: v })}
              />
              <Range
                label="Extractions d'icônes simultanées"
                value={settings.iconConcurrency}
                min={1}
                max={6}
                onChange={(v) => saveSettings({ iconConcurrency: v })}
              />
              <Toggle
                label="Afficher les applications système"
                hint="La liste est plus longue et les icônes mettent plus de temps à venir."
                checked={settings.showSystemApps}
                onChange={(v) => refreshApps(v)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => refreshApps()}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover"
                >
                  Recharger la liste des applications
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await apiRef.current?.clearCache(serial);
                    ICON_CACHE.clear();
                    ICON_MISS.clear();
                    setApps([]);
                    setAppsToken((n) => n + 1);
                  }}
                  disabled={!serial}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover disabled:opacity-40"
                >
                  Effacer les icônes en cache
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-bg-secondary p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Bell size={15} className="text-accent-primary" /> Notifications
              </h3>
              <Toggle
                label="Alerte du bureau à chaque notification"
                hint="Les appels entrants affichent aussi un toast Orbit avec Décrocher et Refuser. Les notifications restent consultables dans la cloche d'Orbit."
                checked={settings.desktopNotifications}
                onChange={(v) => saveSettings({ desktopNotifications: v })}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                Orbit interroge le téléphone toutes les 12 secondes (liste des clés seulement ; le détail n'est
                lu que lorsqu'une notification apparaît). Écarter une notification la met en sommeil 24 h sur
                Android — c'est la seule action que le débogage USB autorise.
              </p>
            </section>

            <section className="rounded-xl border border-border bg-bg-secondary p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Smartphone size={15} className="text-accent-primary" /> Fenêtre miroir
              </h3>
              <Toggle
                label="Son du téléphone"
                hint="Transmet le son à l’ordinateur dans le miroir ou une fenêtre d’application. Scrcpy ≥ 2 et Android 11+ requis. Le miroir ouvert redémarre automatiquement ; ferme puis rouvre les fenêtres d’apps déjà ouvertes pour appliquer le choix."
                checked={settings.mirrorAudio}
                disabled={!scrcpyCapabilities(engine?.found?.version).audio}
                onChange={async (value) => {
                  await saveSettings({ mirrorAudio: value });
                  if (!mirrorRunning || !serial) return;
                  try {
                    const result = await apiRef.current?.startMirror({ serial, title: device?.model || 'Téléphone' });
                    setMirrorRunning(!!result?.success);
                    if (!result?.success) setError(result?.error || 'Le son ne peut pas être transmis par cet appareil.');
                    else setError('');
                  } catch (err) {
                    setMirrorRunning(false);
                    setError(err?.message || 'Impossible de redémarrer le miroir avec le son.');
                  }
                }}
              />
              <Toggle
                label="Toujours au premier plan"
                hint="La fenêtre miroir reste au-dessus des autres."
                checked={settings.mirrorAlwaysOnTop}
                onChange={(v) => saveSettings({ mirrorAlwaysOnTop: v })}
              />
              {/* Ces deux-là étaient APPLIQUÉS au miroir mais réglables nulle
                  part : sur une machine modeste ou un lien sans fil, ce sont
                  précisément les deux boutons qu'on cherche. */}
              {/* Bornes alignées sur `normalizePhoneSettings` : un curseur qui
                  descend à 10 i/s alors que le schéma remonte à 15 mentirait
                  sur ce qui a été enregistré. */}
              <Range
                label="Images par seconde"
                value={settings.mirrorFps}
                min={15}
                max={60}
                step={5}
                suffix=" i/s"
                onChange={(v) => saveSettings({ mirrorFps: v })}
              />
              <label className="mb-2 block">
                <span className="mb-1 block text-xs text-text-secondary">Débit vidéo</span>
                <select
                  value={settings.mirrorBitrate}
                  onChange={(e) => saveSettings({ mirrorBitrate: e.target.value })}
                  className="w-full rounded-lg border border-border bg-bg-primary px-2 py-1.5 text-xs outline-none focus:border-accent-primary"
                >
                  {/* Valeurs acceptées par le schéma (`BITRATES`) : scrcpy
                      attend un suffixe, pas un nombre d'octets. */}
                  {['2M', '4M', '6M', '8M', '12M', '16M', '24M'].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate.replace('M', ' Mb/s')}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mb-2 text-[11px] leading-relaxed text-text-muted">
                Baisser l’un ou l’autre allège le miroir sur une liaison sans fil ou une machine
                modeste. Les fenêtres déjà ouvertes gardent leurs réglages jusqu’à leur réouverture.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await apiRef.current?.startMirror({
                      serial,
                      title: device?.model || 'Téléphone',
                    });
                    if (res?.success) setMirrorRunning(true);
                    else setError(res?.error || "Impossible d'ouvrir le miroir.");
                  }}
                  disabled={!serial}
                  className="rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  Ouvrir le miroir
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await apiRef.current?.stopMirror();
                    setMirrorRunning(false);
                  }}
                  disabled={!mirrorRunning}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-bg-hover disabled:opacity-40"
                >
                  Fermer le miroir
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-bg-secondary p-4">
              <h3 className="mb-2 text-sm font-medium">Moteur</h3>
              <Toggle
                label="Mettre à jour automatiquement"
                hint="Une nouvelle version de scrcpy est proposée au démarrage (jamais installée sans accord)."
                checked={settings.autoUpdateEngine}
                onChange={(v) => saveSettings({ autoUpdateEngine: v })}
              />
              <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                Orbit embarque son propre scrcpy et son adb dans ses données. Rien n'est écrit dans
                le système, et la version du système n'est jamais modifiée.
              </p>
            </section>

            <p className="break-all pb-6 text-center text-[11px] text-text-muted">
              {device ? `Connecté à ${device.serial}` : "En attente d'un appareil"}
              {status?.engine?.directory ? ` · ${status.engine.directory}` : ''}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Bouton de la barre flottante de l'aperçu : posé sur une vidéo noire, il ne
// doit pas dépendre des couleurs de thème (toujours lisible).
function RemoteButton({ icon: Icon, title, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-full p-1.5 transition-colors ${
        active ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon size={15} />
    </button>
  );
}

function ScreenButton({ icon: Icon, title, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg p-1.5 transition-colors ${
        active ? 'bg-accent-primary/15 text-accent-primary' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      <Icon size={15} />
    </button>
  );
}

function EngineCard({ engine, latest, progress, busy, error, targetAvailable, platform, onInstall }) {
  const percent =
    progress?.phase === 'download' && progress.total
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;
  const update = !!(engine?.found && latest && compareVersions(latest, engine.found.version) > 0);
  return (
    <div className="mt-4 rounded-xl border border-border bg-bg-secondary p-4">
      <div className="flex items-center gap-2">
        <Download size={15} className="text-accent-primary" />
        <span className="text-sm font-medium">Moteur scrcpy</span>
        {engine?.found ? (
          <Pill tone={update ? 'warn' : 'good'}>
            {engine.found.version}
            {engine.found.source === 'system' ? ' (système)' : ''}
          </Pill>
        ) : (
          <Pill tone="warn">Non installé</Pill>
        )}
        {latest && update ? <span className="text-[11px] text-text-muted">→ {latest}</span> : null}
      </div>

      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        {targetAvailable === false
          ? `Aucune archive officielle de scrcpy pour ${platform || 'cette plateforme'}. L'appareil reste utilisable avec un scrcpy installé sur le système.`
          : engine?.found
            ? "Orbit utilise ce moteur pour l'aperçu intégré, les icônes et le miroir. Il vit dans les données d'Orbit, indépendamment du système."
            : "Installez le moteur embarqué (scrcpy + adb) pour piloter le téléphone sans rien installer sur le système."}
      </p>

      {progress?.phase === 'download' && percent !== null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-hover">
          <div className="h-full rounded-full bg-accent-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {progress?.phase === 'extract' ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" /> Extraction de l'archive…
        </p>
      ) : null}
      {progress?.phase === 'done' ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
          <Check size={12} /> Moteur {progress.version} prêt.
        </p>
      ) : null}

      {error ? <p className="mt-2 whitespace-pre-wrap break-words text-xs text-red-300">{error}</p> : null}

      <button
        type="button"
        onClick={onInstall}
        disabled={busy || targetAvailable === false}
        className="mt-3 flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        {engine?.found ? (update ? 'Mettre à jour le moteur' : 'Réinstaller le moteur') : 'Installer le moteur'}
      </button>
    </div>
  );
}

// Aperçu tactile : la capture peut être réduite (540 px par défaut) alors que
// l'écran du téléphone fait 1080 px. On convertit donc chaque geste avec les
// dimensions RÉELLES (`deviceWidth`/`deviceHeight`) et non celles de l'image.
function Preview({ screen, onTap, onGesture, onError, onFit, onKeyDown }) {
  const gesture = useRef(null);
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const gestureRef = useRef(onGesture);
  const [box, setBox] = useState(null);

  // La référence est mise à jour dans un effet : affecter pendant le rendu
  // marcherait par accident, mais un rendu interrompu laisserait l'ancienne.
  useEffect(() => {
    gestureRef.current = onGesture;
  }, [onGesture]);

  // Molette → geste de défilement sur le téléphone. Sans ça, la molette ne
  // faisait rien : elle ne peut pas défiler un flux d'images.
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return undefined;
    let last = 0;
    const onWheel = (event) => {
      if (!gestureRef.current) return;
      event.preventDefault();
      const now = Date.now();
      if (now - last < 300) return; // un geste par cran, pas un par pixel
      last = now;
      const dw = screen.deviceWidth || screen.width || 0;
      const dh = screen.deviceHeight || screen.height || 0;
      if (!dw || !dh) return;
      const dir = event.deltaY >= 0 ? 1 : -1; // vers le bas = le doigt monte
      const cx = Math.round(dw / 2);
      const cy = Math.round(dh / 2);
      const half = Math.round(dh * 0.16);
      gestureRef.current({
        x1: cx,
        y1: cy + dir * half,
        x2: cx,
        y2: cy - dir * half,
        duration: 160,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [screen.deviceWidth, screen.deviceHeight, screen.width, screen.height]);

  // L'image occupe exactement le rectangle qu'elle dessine (rapport d'aspect du
  // téléphone, plus grand possible dans la zone). Sans ça, `object-contain`
  // laisserait des bandes noires DANS l'élément et un clic près d'un bord
  // serait converti avec une géométrie fausse. On remonte aussi sa largeur
  // réelle au parent : c'est elle qui pilote la résolution de capture.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const dw = screen.deviceWidth || screen.width || 0;
    const dh = screen.deviceHeight || screen.height || 0;
    const ratio = dw && dh ? dw / dh : 9 / 19.5;
    let lastWidth = 0;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const h = Math.max(1, Math.floor(Math.min(height, width / ratio)));
      const w = Math.max(1, Math.round(h * ratio));
      setBox((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      if (onFit && w !== lastWidth) {
        lastWidth = w;
        onFit(w);
      }
    };
    fit();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [screen.deviceWidth, screen.deviceHeight, screen.width, screen.height, onFit]);

  const toDevice = (rect, clientX, clientY) => ({
    x: Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * screen.deviceWidth),
    y: Math.round(((clientY - rect.top) / Math.max(1, rect.height)) * screen.deviceHeight),
  });

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    gesture.current = { x: e.clientX, y: e.clientY, at: Date.now(), rect };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà capturé */
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) < 9) {
      const p = toDevice(g.rect, e.clientX, e.clientY);
      onTap(p.x, p.y);
      return;
    }
    const from = toDevice(g.rect, g.x, g.y);
    const to = toDevice(g.rect, e.clientX, e.clientY);
    onGesture({
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      duration: Math.max(60, Math.min(1200, Date.now() - g.at)),
    });
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={() => wrapRef.current?.focus()}
      className="flex h-full w-full items-center justify-center overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-primary/50"
    >
      <img
        ref={imgRef}
        src={screen.dataUrl}
        alt="Écran du téléphone"
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onError={() => onError('Image de capture illisible.')}
        className="select-none"
        style={{
          width: box ? box.width : undefined,
          height: box ? box.height : undefined,
          touchAction: 'none',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}
