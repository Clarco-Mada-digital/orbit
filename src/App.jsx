import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Play, X, Columns2, Rows2, Plus, Wifi } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Bottombar from './components/Bottombar';
import { useAutoHide, RevealStrip, REVEALED_BAR_Z, useAutoHideStore } from './lib/autoHide';
import QuickSwitcher from './components/QuickSwitcher';
// Surimpressions chargées À LA DEMANDE. Ce sont les écrans les plus lourds
// (réglages et leurs sept onglets, coffre-fort, boutique et son catalogue de
// recettes) et les seuls qu'on n'ouvre jamais au démarrage : les inclure dans
// le paquet principal faisait analyser leur code à chaque lancement, avant même
// d'afficher la première app.
const Settings = lazy(() => import('./components/Settings'));
const ProfileManager = lazy(() => import('./components/ProfileManager'));
const AppStore = lazy(() => import('./components/AppStore'));
import WebView from './components/WebView';
import GuestContextMenu from './components/GuestContextMenu';
import WebDialogHost from './components/WebDialogHost';
import LockScreen from './components/LockScreen';
import FindBar from './components/FindBar';
import UpdateBanner from './components/UpdateBanner';
import Welcome from './components/Welcome';
import { useStore, appVisibleIn } from './stores/useStore';
import { useSecurityStore } from './lib/securityStore';
import { useMediaStore } from './lib/mediaStore';
import { mediaToggle, mediaPrev, mediaNext, mediaSeek, pickNowPlaying } from './lib/mediaControls';
import { appViewKey, appPartition, resolveProxy } from './lib/session';
import { matchShortcut } from './lib/shortcuts';
import { reloadApp } from './lib/webviewRegistry';
import { logDiagnostic } from './lib/diagnosticsStore';
import { attachTtsPlayer, setVolume as setTtsVolume } from './lib/ttsPlayer';

// Construit l'état à afficher dans le mini-lecteur flottant (ou null)
function buildMiniPlayerState() {
  const pick = pickNowPlaying(useMediaStore.getState().media, useStore.getState().activeApp);
  if (!pick) return null;
  const [appId, info] = pick;
  const app = useStore.getState().apps.find((a) => a.id === appId);
  return {
    appId,
    appName: app?.name || '',
    title: info.title || '',
    artist: info.artist || '',
    artwork: info.artwork || '',
    playing: !!info.playing,
    currentTime: info.currentTime || 0,
    duration: info.duration || 0,
  };
}

const FONT_SIZES = { small: 12, medium: 14, large: 16, xlarge: 18 };

// '#6366f1' → '99 102 241' (triplet pour les variables CSS)
function hexToRgbTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '99 102 241';
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`;
}

function mixWithWhite(rgb, amount) {
  const [r, g, b] = rgb.split(' ').map(Number);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `${mix(r)} ${mix(g)} ${mix(b)}`;
}

export default function App() {
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [showAppStore, setShowAppStore] = useState(false);
  const [captive, setCaptive] = useState(null); // { detected, url } | null
  const [showFind, setShowFind] = useState(false);
  const {
    activeProfile,
    activeApp,
    apps,
    profiles,
    extensions,
    settings,
    updateApp,
    setActiveApp,
    toggleAppSleep,
    sidebarCollapsed,
    setSidebarCollapsed,
    splitView,
    setSplitView,
    clearSplitView,
    toggleSplitDirection,
    onboarded,
    setOnboarded,
  } = useStore();

  // App de démarrage : au lancement, ouvre l'app choisie (une seule fois).
  // '' = reprendre la dernière (activeApp persisté), 'none' = aucune.
  const startupDoneRef = useRef(false);
  useEffect(() => {
    if (startupDoneRef.current) return;
    startupDoneRef.current = true;
    const st = useStore.getState();
    const sa = st.settings.startupApp;
    if (!sa) return; // reprendre la dernière
    if (sa === 'none') {
      st.setActiveApp(null);
      return;
    }
    const target = st.apps.find((a) => a.id === sa);
    if (target) {
      st.setActiveProfile(target.profileId);
      st.setActiveApp(target.id);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Média : pour synchroniser le mini-lecteur flottant
  const media = useMediaStore((s) => s.media);

  // Pousse l'état de lecture au mini-lecteur dès qu'il change
  useEffect(() => {
    window.electronAPI?.miniPlayer?.sendState?.(buildMiniPlayerState());
  }, [media, activeApp]);

  // Le mini-lecteur demande l'état courant (à son ouverture)
  useEffect(() => {
    const off = window.electronAPI?.miniPlayer?.onRequestState?.(() => {
      window.electronAPI?.miniPlayer?.sendState?.(buildMiniPlayerState());
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Applique les actions du mini-lecteur au <webview> qui joue
  useEffect(() => {
    const off = window.electronAPI?.miniPlayer?.onAction?.((action) => {
      const pick = pickNowPlaying(useMediaStore.getState().media, useStore.getState().activeApp);
      if (!pick) return;
      const [appId] = pick;
      if (action.type === 'playpause') mediaToggle(appId);
      else if (action.type === 'prev') mediaPrev(appId);
      else if (action.type === 'next') mediaNext(appId);
      else if (action.type === 'seek') mediaSeek(appId, action.value);
      else if (action.type === 'goto') {
        const st = useStore.getState();
        const app = st.apps.find((a) => a.id === appId);
        if (app) {
          st.setActiveProfile(app.profileId);
          st.setActiveApp(appId);
        }
      }
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Mise en veille automatique des apps inactives. On NE met JAMAIS en veille :
  // l'app active, celles en écran partagé, ni celles qui jouent un média.
  useEffect(() => {
    const mins = settings.autoSleepMinutes || 0;
    if (!mins) return undefined;
    const thresholdMs = mins * 60000;
    const lastSeen = {}; // { appId: timestamp du dernier usage }
    const tick = () => {
      const st = useStore.getState();
      const md = useMediaStore.getState().media;
      const now = Date.now();
      const active = st.activeApp;
      const split = st.splitView?.appIds || [];
      for (const a of st.apps) {
        if (a.sleeping) continue;
        const busy = a.id === active || split.includes(a.id) || md[a.id]?.playing;
        if (busy) {
          lastSeen[a.id] = now; // toujours « frais » tant qu'utilisée / sonore
          continue;
        }
        if (lastSeen[a.id] == null) {
          lastSeen[a.id] = now; // première observation → on démarre le compteur
          continue;
        }
        if (now - lastSeen[a.id] > thresholdMs) {
          st.toggleAppSleep(a.id);
          // Tracé dans le journal : une app qui s'endort ferme sa page, ce qui
          // ressemble à une déconnexion vue de l'utilisateur. Savoir que c'est
          // la veille automatique évite de chercher un bug ailleurs.
          logDiagnostic(
            a.id,
            a.name,
            'sleep',
            `Mise en veille automatique après ${mins} min d'inactivité`
          );
        }
      }
    };
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [settings.autoSleepMinutes]);

  // Portail captif (Wi-Fi public) : bannière quand une connexion réseau est
  // requise, + re-vérification au retour en ligne et au focus de la fenêtre.
  useEffect(() => {
    const off = window.electronAPI?.onCaptivePortal?.((info) => {
      setCaptive(info?.detected ? info : null);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);
  useEffect(() => {
    const check = () => window.electronAPI?.checkCaptivePortal?.();
    window.addEventListener('online', check);
    window.addEventListener('focus', check);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  // Touches média globales du clavier → pilotent l'app en lecture
  useEffect(() => {
    window.electronAPI?.setMediaKeysEnabled?.(settings.globalMediaKeys === true);
  }, [settings.globalMediaKeys]);

  // Fermer-vers-le-tray
  useEffect(() => {
    window.electronAPI?.setCloseToTray?.(settings.closeToTray !== false);
  }, [settings.closeToTray]);

  // Raccourci global d'invocation (afficher/masquer Orbit)
  useEffect(() => {
    window.electronAPI?.setSummonHotkey?.(
      settings.globalHotkeyEnabled ? settings.globalHotkey || 'CommandOrControl+Alt+O' : null
    );
  }, [settings.globalHotkeyEnabled, settings.globalHotkey]);

  useEffect(() => {
    const off = window.electronAPI?.onMediaKey?.((action) => {
      const pick = pickNowPlaying(useMediaStore.getState().media, useStore.getState().activeApp);
      if (!pick) return;
      const [appId] = pick;
      if (action === 'playpause') mediaToggle(appId);
      else if (action === 'prev') mediaPrev(appId);
      else if (action === 'next') mediaNext(appId);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Verrouillage : état miroir du process principal
  const security = useSecurityStore();
  useEffect(() => {
    security.refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Verrouillage auto après inactivité : synchro du délai + reverrouillage
  useEffect(() => {
    window.electronAPI?.security?.setAutoLock?.(settings.autoLockMinutes || 0);
  }, [settings.autoLockMinutes]);
  useEffect(() => {
    const off = window.electronAPI?.security?.onRelock?.(() => security.refresh());
    return () => {
      if (typeof off === 'function') off();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Un profil est-il accessible (pas de verrou, ou déjà déverrouillé) ?
  const profileAccessible = (pid) =>
    !security.lockedProfileIds.includes(pid) || security.unlockedProfileIds.includes(pid);
  const activeProfileAccessible = profileAccessible(activeProfile);
  const appLocked = security.ready && security.appLockEnabled && !security.appUnlocked;

  const handleUnlockApp = async (pin) => {
    const res = await window.electronAPI?.security?.unlockApp?.(pin);
    if (res?.success) await security.refresh();
    return res;
  };
  const handleUnlockProfile = async (pin) => {
    const res = await window.electronAPI?.security?.unlockProfile?.(activeProfile, pin);
    if (res?.success) await security.refresh();
    return res;
  };

  // Apps du profil actif, triées
  // Une app « tous profils » venue d'un profil VERROUILLÉ est exclue : sans
  // ça, la portée globale ouvrirait une porte dérobée dans le verrou de profil.
  const profileApps = useMemo(
    () =>
      apps
        .filter(
          (a) =>
            appVisibleIn(a, activeProfile) &&
            (a.profileId === activeProfile || profileAccessible(a.profileId))
        )
        .sort((a, b) => a.order - b.order),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apps, activeProfile, security.lockedProfileIds, security.unlockedProfileIds]
  );
  const activeAppData = apps.find((a) => a.id === activeApp);

  // Apps maintenues « vivantes » (webview monté) même hors du profil actif.
  // Une fois OUVERTE, une app reste chargée : changer de profil puis revenir
  // ne la recharge plus (fini le rechargement complet à chaque bascule). La
  // mise en veille reste le moyen explicite de la fermer pour libérer la RAM.
  const [mountedIds, setMountedIds] = useState(() => new Set());
  useEffect(() => {
    if (!activeApp) return;
    setMountedIds((prev) => (prev.has(activeApp) ? prev : new Set(prev).add(activeApp)));
  }, [activeApp]);

  // Liste UNIQUE des webviews à monter (tous profils confondus) : apps du
  // profil actif + apps déjà ouvertes ailleurs. Une seule liste keyée par
  // app.id → React préserve l'instance à la bascule de profil (pas de remontage
  // = pas de rechargement). Les apps en veille ne sont jamais montées.
  const liveApps = useMemo(
    () =>
      apps.filter(
        (a) =>
          !a.sleeping &&
          // Tant que l'état de verrouillage n'est pas chargé, on ne monte RIEN
          // (évite d'afficher un profil verrouillé une fraction de seconde).
          security.ready &&
          // Verrou global : rien ne se monte tant qu'Orbit n'est pas déverrouillé
          !appLocked &&
          // Verrou de profil : les apps d'un profil verrouillé (non déverrouillé)
          // ne sont pas montées → page fermée, non peinte, aucun accès.
          profileAccessible(a.profileId) &&
          (a.profileId === activeProfile || a.scope === 'all' || mountedIds.has(a.id))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      apps,
      activeProfile,
      mountedIds,
      appLocked,
      security.ready,
      security.lockedProfileIds,
      security.unlockedProfileIds,
    ]
  );

  // Le partage n'est effectif que si toutes les apps existent dans le profil actif
  const activeSplit =
    splitView &&
    splitView.appIds.length >= 2 &&
    splitView.appIds.length <= 4 &&
    splitView.appIds.every((id) => profileApps.some((a) => a.id === id))
      ? splitView
      : null;

  // Tailles des panneaux (2 apps) — défaut 50/50, persistées dans le store
  const splitSizes =
    activeSplit && Array.isArray(activeSplit.sizes) && activeSplit.sizes.length === activeSplit.appIds.length
      ? activeSplit.sizes
      : activeSplit && activeSplit.appIds.length === 2
        ? [0.5, 0.5]
        : null;

  // Séparateur ajustable : glisser pour agrandir/réduire un panneau
  const splitContainerRef = useRef(null);
  const [splitDragging, setSplitDragging] = useState(false);
  const startSplitDrag = useCallback(
    (e) => {
      e.preventDefault();
      const container = splitContainerRef.current;
      if (!container || !activeSplit || activeSplit.appIds.length !== 2) return;
      setSplitDragging(true);
      const direction = activeSplit.direction;
      const onMove = (ev) => {
        const rect = container.getBoundingClientRect();
        const total = direction === 'row' ? rect.width : rect.height;
        if (total <= 0) return;
        const pos = direction === 'row' ? ev.clientX - rect.left : ev.clientY - rect.top;
        const ratio = Math.min(0.85, Math.max(0.15, pos / total));
        setSplitView({ ...activeSplit, sizes: [ratio, 1 - ratio] });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setSplitDragging(false);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [activeSplit, setSplitView]
  );

  // Marquer comme lue l'app qu'on active (tous les chemins : sidebar, quick switcher…)
  useEffect(() => {
    if (!activeApp) return;
    const app = apps.find((a) => a.id === activeApp);
    if (app && app.unread > 0) {
      updateApp(activeApp, { unread: 0 });
    }
  }, [activeApp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Badge de la fenêtre (dock/taskbar) = total de messages non lus
  useEffect(() => {
    const total = apps.reduce((sum, a) => sum + (a.unread || 0), 0);
    window.electronAPI?.setBadgeCount?.(total);
  }, [apps]);

  // Synchroniser les extensions Chrome avec le main process (chargées par session)
  useEffect(() => {
    window.electronAPI?.syncExtensions?.(extensions);
  }, [extensions]);

  // Synchroniser les sources d'identifiants proposées dans les pages. Le
  // processus principal repart de « les deux » à chaque lancement : sans cet
  // envoi, un utilisateur ayant écarté KeePassXC le reverrait interrogé.
  useEffect(() => {
    const source = settings.credentials?.source || 'both';
    window.electronAPI?.credentialsSetSource?.(source);
    window.electronAPI?.keepassSetEnabled?.(source === 'both' || source === 'keepass');
  }, [settings.credentials?.source]);

  // Fenêtres secondaires : style choisi + thème courant, pour que les pop-ups
  // (connexion Google, liens externes…) soient habillées comme la fenêtre.
  useEffect(() => {
    const theme =
      settings.theme === 'auto'
        ? window.matchMedia?.('(prefers-color-scheme: light)')?.matches
          ? 'light'
          : 'dark'
        : settings.theme;
    window.electronAPI?.setPopupStyle?.({
      style: settings.popupStyle || 'orbit',
      theme,
      accent: settings.accentColor,
    });
  }, [settings.popupStyle, settings.theme, settings.accentColor]);

  // Synchroniser le bloqueur de pub natif avec le réglage (activé par défaut)
  useEffect(() => {
    window.electronAPI?.adblock?.setEnabled?.(settings.adblock !== false);
  }, [settings.adblock]);

  // Menu contextuel : dessiné par Orbit, ou natif si l'utilisateur préfère.
  useEffect(() => {
    window.electronAPI?.contextMenu?.setMode?.(settings.nativeContextMenu !== true);
  }, [settings.nativeContextMenu]);

  // Lecture vocale Piper : l'audio est synthétisé dans le processus principal
  // et rejoué ici. L'abonnement ne crée rien tant qu'aucun son n'arrive.
  useEffect(() => attachTtsPlayer(), []);
  useEffect(() => {
    setTtsVolume((settings.soundVolume ?? 80) / 100);
  }, [settings.soundVolume]);

  // Moteur vocal choisi, poussé au processus principal.
  useEffect(() => {
    const cfg = settings.tts || {};
    window.electronAPI?.tts?.setPrefs?.(cfg.engine || 'system', cfg.voiceId || '');
  }, [settings.tts]);

  // Proxy/VPN : applique à chaque partition (app/profil) son proxy effectif.
  // Une seule application par partition. On ne (ré)applique QUE les partitions
  // dont le proxy a réellement changé (apps change souvent : titres, non-lus…).
  const proxyRef = useRef({});
  useEffect(() => {
    const next = {};
    for (const a of apps) {
      const profile = profiles.find((p) => p.id === a.profileId);
      const partition = appPartition(a, !!profile?.sharedSession);
      if (!(partition in next)) next[partition] = resolveProxy(a, profile, settings.globalProxy);
    }
    for (const [partition, rules] of Object.entries(next)) {
      if (proxyRef.current[partition] !== rules) {
        window.electronAPI?.applyProxy?.({ partition, rules });
      }
    }
    proxyRef.current = next;
  }, [apps, profiles, settings.globalProxy]);

  // Synchroniser la config de traduction (langue + moteur Google/LibreTranslate)
  useEffect(() => {
    window.electronAPI?.setTranslateConfig?.({
      target: settings.translateTarget || 'fr',
      engine: settings.translateEngine || 'google',
      url: settings.libreTranslateUrl || '',
      apiKey: settings.libreTranslateApiKey || '',
    });
  }, [
    settings.translateTarget,
    settings.translateEngine,
    settings.libreTranslateUrl,
    settings.libreTranslateApiKey,
  ]);

  const handleSetActiveApp = useCallback((appId) => {
    setActiveApp(appId);
  }, [setActiveApp]);

  // Plein écran (F11) : masque topbar, sidebar et barre du bas pour ne
  // laisser que l'app. F11 ou le bouton dédié quitte ; bouger la souris sur
  // le bord supérieur fait réapparaître la topbar (avec le bouton de sortie).
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [revealTopbar, setRevealTopbar] = useState(false);
  const toggleFullscreen = useCallback(() => {
    window.electronAPI?.toggleFullscreen?.();
  }, []);
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        window.electronAPI?.toggleFullscreen?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const off = window.electronAPI?.onFullScreenChange?.((fs) => {
      setIsFullscreen(!!fs);
      setRevealTopbar(false);
    });
    window.electronAPI?.getFullscreen?.().then((res) => {
      if (res?.success) setIsFullscreen(!!res.fullscreen);
    }).catch(() => {});
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (typeof off === 'function') off();
    };
  }, []);

  // Appliquer les paramètres d'affichage EN TEMPS RÉEL
  useEffect(() => {
    const root = document.documentElement;

    // Thème (sombre / clair / auto)
    const applyTheme = () => {
      const theme =
        settings.theme === 'auto'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : settings.theme;
      root.dataset.theme = theme;
    };
    applyTheme();

    // Couleur d'accent → variables CSS (accent-primary, hover, light).
    // Option « accent par profil » : suit la couleur du profil actif.
    const activeProfileObj = profiles.find((p) => p.id === activeProfile);
    const accentHex =
      settings.accentPerProfile && activeProfileObj
        ? activeProfileObj.accent || activeProfileObj.color || settings.accentColor || '#6366f1'
        : settings.accentColor || '#6366f1';
    const accent = hexToRgbTriplet(accentHex);
    root.style.setProperty('--accent-primary', accent);
    root.style.setProperty('--accent-hover', mixWithWhite(accent, 0.15));
    root.style.setProperty('--accent-light', mixWithWhite(accent, 0.4));

    // Taille de police + échelle UI : la base rem est multipliée,
    // tout le UI (textes ET espacements Tailwind) suit, sans clipping.
    const base = FONT_SIZES[settings.fontSize] ?? 14;
    const scale = (settings.uiScale ?? 100) / 100;
    root.style.fontSize = `${Math.round(base * scale)}px`;
    // La police doit être appliquée sur <body> : la règle CSS de body
    // (font-family: Inter, …) surchargerait une valeur posée sur <html>.
    document.body.style.fontFamily = settings.fontFamily || 'Inter';

    root.classList.toggle('compact-mode', !!settings.compactMode);
    root.classList.toggle('no-animations', !settings.animationsEnabled);

    if (settings.theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onChange = () => applyTheme();
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [settings, activeProfile, profiles]);

  // Exécute une action de raccourci (nom centralisé dans lib/shortcuts.js)
  const runShortcut = useCallback((action) => {
    if (action === 'search') return setShowQuickSwitcher((v) => !v);
    if (action === 'settings') return setShowSettings((v) => !v);
    if (action === 'store') return setShowAppStore((v) => !v);
    if (action === 'profiles') return setShowProfileManager((v) => !v);
    if (action === 'find') {
      if (useStore.getState().activeApp) setShowFind(true);
      return;
    }
    // Ctrl+R / F5 — même comportement que le bouton « Actualiser »
    if (action === 'reload' || action === 'reload-hard') {
      const { activeApp: a, apps: all } = useStore.getState();
      if (a) reloadApp(a, all.find((x) => x.id === a)?.url, action === 'reload-hard');
      return;
    }
    // Mode épuré : appelle (ou renvoie) toutes les barres masquées. Sans ce
    // raccourci, elles seraient inatteignables sans souris.
    if (action === 'toggle-bars') {
      useAutoHideStore.getState().toggleSummon();
      return;
    }
    if (action === 'toggle-sidebar') {
      const { sidebarCollapsed: c, setSidebarCollapsed: set } = useStore.getState();
      return set(!c);
    }
    if (action === 'toggle-sleep') {
      const { activeApp: a, toggleAppSleep: t } = useStore.getState();
      if (a) t(a);
      return;
    }
    // Profil suivant / précédent, en boucle. Un profil verrouillé reste
    // atteignable : on y arrive sur son écran de déverrouillage, exactement
    // comme en cliquant dessus dans la barre latérale.
    if (action === 'next-profile' || action === 'prev-profile') {
      const { profiles: list, activeProfile: cur, setActiveProfile: setP } = useStore.getState();
      if (list.length < 2) return;
      const i = list.findIndex((p) => p.id === cur);
      const step = action === 'next-profile' ? 1 : -1;
      const next = list[(((i < 0 ? 0 : i) + step) % list.length + list.length) % list.length];
      if (next) setP(next.id);
      return;
    }
    if (action === 'mark-all-read') return useStore.getState().markAllRead();
    if (action === 'next-app' || action === 'prev-app') {
      const { activeProfile, apps: all, activeApp, setActiveApp: setAa } = useStore.getState();
      const list = all
        .filter((a) => appVisibleIn(a, activeProfile) && !a.sleeping)
        .sort((a, b) => a.order - b.order);
      if (list.length === 0) return;
      const idx = list.findIndex((a) => a.id === activeApp);
      const next =
        action === 'next-app'
          ? list[(idx + 1) % list.length]
          : list[(idx - 1 + list.length) % list.length];
      setAa(next.id);
      return;
    }
    const m = /^app-(\d)$/.exec(action);
    if (m) {
      const { activeProfile, apps: all, setActiveApp: setAa } = useStore.getState();
      const list = all
        .filter((a) => appVisibleIn(a, activeProfile) && !a.sleeping)
        .sort((a, b) => a.order - b.order);
      const target = list[parseInt(m[1], 10) - 1];
      if (target) setAa(target.id);
      return;
    }
    const { activeApp, adjustAppZoom, resetAppZoom } = useStore.getState();
    if (!activeApp) return;
    if (action === 'zoom-in') adjustAppZoom(activeApp, 0.1);
    else if (action === 'zoom-out') adjustAppZoom(activeApp, -0.1);
    else if (action === 'zoom-reset') resetAppZoom(activeApp);
  }, []);

  // Raccourcis clavier quand le focus est dans l'interface (sidebar, topbar…)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const action = matchShortcut(e);
      if (action) {
        e.preventDefault();
        runShortcut(action);
        return;
      }
      if (e.key === 'Escape') {
        setShowQuickSwitcher(false);
        setShowSettings(false);
        setShowProfileManager(false);
        setShowAppStore(false);
        setShowFind(false);
        // Échap renvoie aussi les barres appelées au clavier.
        useAutoHideStore.getState().clearSummon();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runShortcut]);

  // Raccourcis GLOBAUX : interceptés par le main process même quand le focus
  // est DANS une app embarquée (Gmail, Slack…) — les apps gardent leurs Ctrl.
  useEffect(() => {
    const off = window.electronAPI?.onShortcut?.(runShortcut);
    return () => {
      if (typeof off === 'function') off();
    };
  }, [runShortcut]);

  // Clic sur une notification système → ouvrir l'app concernée : on bascule
  // sur son profil si besoin, on la réveille si elle dormait, et on l'active.
  useEffect(() => {
    const off = window.electronAPI?.onActivateApp?.((appId) => {
      const { apps: all, setActiveProfile: setProfile, setActiveApp: setAa, toggleAppSleep: toggleSleep } =
        useStore.getState();
      const target = all.find((a) => a.id === appId);
      if (!target) return;
      // Une app de portée « tous les profils » est déjà atteignable d'où l'on
      // est : basculer sur son profil d'origine ferait changer tout le reste de
      // l'écran pour rien.
      const { activeProfile: cur } = useStore.getState();
      if (!appVisibleIn(target, cur)) setProfile(target.profileId);
      if (target.sleeping) toggleSleep(target.id);
      setAa(target.id);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Mode épuré : quelles zones se masquent. Le plein écran a déjà son propre
  // masquage (tout disparaît) — les deux ne se cumulent pas.
  const autoHide = settings.autoHide || {};
  const hideTop = Boolean(autoHide.top) && !isFullscreen;
  const hideLeft = Boolean(autoHide.left) && !isFullscreen;
  const hideBottom = Boolean(autoHide.bottom) && !isFullscreen && settings.bottombarEnabled;

  const topZone = useAutoHide('top', hideTop);
  const leftZone = useAutoHide('left', hideLeft);
  const bottomZone = useAutoHide('bottom', hideBottom);

  // Largeurs en rem → elles suivent la taille de police réglée
  const sidebarWidth = sidebarCollapsed ? '4rem' : '17.5rem';
  // Une barre masquable passe en SURIMPRESSION : elle ne doit plus réserver de
  // place. Sinon chaque passage de souris réagencerait toute la fenêtre — et
  // forcerait les <webview> à se remettre en page, ce qui est coûteux et fait
  // perdre leur position de défilement à certaines apps.
  const sidebarOffset = isFullscreen || hideLeft ? 0 : sidebarWidth;
  // Hauteur de la barre du bas (h-10) quand elle occupe le flux : la sidebar
  // s'arrête juste au-dessus pour ne pas masquer sa zone gauche.
  const bottombarHeight =
    !isFullscreen && settings.bottombarEnabled && !hideBottom ? '2.5rem' : 0;
  // Haut de la barre latérale : collée à 0 quand l'en-tête ne réserve plus de
  // place, sous l'en-tête sinon.
  const sidebarTop = hideTop ? 0 : '3rem';
  const hasApps = profileApps.length > 0;

  // Un overlay (Réglages, Boutique…) est ouvert : on masque les webviews.
  // Évite tout problème de composition GPU où un webview serait peint
  // par-dessus la modale (visible : menu à gauche, contenu masqué).
  // visibility:hidden ne décharge PAS les webviews — juste pas de peinture.
  const overlayOpen =
    showQuickSwitcher || showSettings || showProfileManager || showAppStore;

  return (
    <div
      className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden"
      style={{ borderRadius: isFullscreen ? 0 : '12px' }}
    >
      {/* Barre unifiée : logo, navigation, URL, notifications + contrôles fenêtre.
          En plein écran elle disparaît ; elle réapparaît en surimpression quand
          la souris touche le bord supérieur. */}
      {!isFullscreen && !hideTop && (
        <Topbar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} />
      )}
      {/* Mode épuré : l'en-tête sort du flux et glisse depuis le bord haut. */}
      {hideTop && (
        <>
          <RevealStrip zone="top" enabled />
          <div
            className="fixed top-0 left-0 right-0 transition-transform duration-200 ease-out shadow-xl"
            style={{
              zIndex: REVEALED_BAR_Z,
              transform: topZone.visible ? 'translateY(0)' : 'translateY(-100%)',
            }}
            {...topZone.handlers}
          >
            <Topbar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} />
          </div>
        </>
      )}
      {isFullscreen && !revealTopbar && (
        <div
          className="fixed top-0 left-0 right-0 h-2 z-[500]"
          onMouseEnter={() => setRevealTopbar(true)}
        />
      )}
      {isFullscreen && revealTopbar && (
        <div
          className="fixed top-0 left-0 right-0 z-[500] shadow-xl"
          onMouseLeave={() => setRevealTopbar(false)}
        >
          <Topbar
            onOpenQuickSwitcher={() => setShowQuickSwitcher(true)}
            isFullscreen
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      )}

      {/* Portail captif : ce réseau Wi-Fi exige une connexion */}
      {captive?.detected && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-b border-amber-500/30 text-sm flex-shrink-0">
          <Wifi size={16} className="flex-shrink-0" />
          <span className="flex-1 min-w-0">
            Ce réseau Wi-Fi demande une connexion pour accéder à Internet.
          </span>
          <button
            onClick={() => window.electronAPI?.openCaptivePortal?.()}
            className="btn btn-primary btn-sm whitespace-nowrap"
          >
            Se connecter
          </button>
          <button onClick={() => setCaptive(null)} className="btn-icon w-7 h-7" title="Ignorer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Layout principal */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (fixed) — masquée en plein écran */}
        {!isFullscreen && (
          <>
            <RevealStrip zone="left" enabled={hideLeft} offset={hideTop ? 0 : 48} />
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
              onOpenSettings={() => setShowSettings(true)}
              onOpenStore={() => setShowAppStore(true)}
              onOpenProfileManager={() => setShowProfileManager(true)}
              onSelectApp={handleSetActiveApp}
              bottomOffset={bottombarHeight}
              topOffset={sidebarTop}
              autoHidden={hideLeft}
              revealed={leftZone.visible}
              revealHandlers={leftZone.handlers}
            />
          </>
        )}

        {/* Zone principale — marge = largeur sidebar (rem) */}
        <div
          className="flex-1 flex flex-col min-w-0 transition-[margin-left] duration-300"
          style={{ marginLeft: sidebarOffset }}
        >
          {/* Apps embarquées : un <webview> par app, reste vivant en arrière-plan.
              Écran partagé :
                • 2 apps → côte à côte (row) ou haut/bas (col), séparateur AJUSTABLE
                • 3-4 apps → grille 2×2 (les webviews restent responsives) */}
          <div
            ref={splitContainerRef}
            className={`flex-1 relative bg-bg-secondary overflow-hidden ${
              activeSplit && activeSplit.appIds.length >= 3
                ? 'grid grid-cols-2 grid-rows-2 gap-0.5 bg-border'
                : activeSplit
                  ? `flex ${activeSplit.direction === 'col' ? 'flex-col' : 'flex-row'}`
                  : ''
            }`}
            style={{ visibility: overlayOpen ? 'hidden' : 'visible' }}
          >
            {liveApps.map((a) => {
                  // Une app n'est « active/visible » que si elle est ATTEIGNABLE
                  // depuis le profil courant — ce qui inclut les apps de portée
                  // « tous les profils ». Tester l'appartenance stricte les
                  // montait sans jamais les afficher : elles apparaissaient dans
                  // la barre latérale mais leur page restait invisible hors de
                  // leur profil d'origine.
                  // Les autres restent montées mais masquées (leur page et leur
                  // session survivent à la bascule de profil).
                  const inActive = appVisibleIn(a, activeProfile);
                  const inSplit = inActive && activeSplit && activeSplit.appIds.includes(a.id);
                  const idx = inSplit ? activeSplit.appIds.indexOf(a.id) : -1;
                  const gridMode = activeSplit && activeSplit.appIds.length >= 3;
                  // Clé qui change avec le mode de session (isolée ↔ partagée)
                  // pour remonter le webview sur la bonne partition.
                  const vkey = appViewKey(a, profiles.find((p) => p.id === a.profileId)?.sharedSession);
                  // IMPORTANT — structure d'arbre IDENTIQUE en écran partagé et
                  // hors partage. Avant, le mode partagé renvoyait un Fragment
                  // (séparateur + div) et le mode normal un <WebView> nu : à
                  // chaque entrée/sortie du partage React voyait un type
                  // d'élément différent, DÉMONTAIT le webview et le remontait
                  // → la page se rechargeait et l'app pouvait se retrouver
                  // déconnectée. On garde donc toujours Fragment > div >
                  // WebView ; hors partage, le div est neutralisé par
                  // `display: contents` (aucune boîte générée → la mise en page
                  // est exactement celle d'avant).
                  const paneStyle = !inSplit
                    ? { display: 'contents' }
                    : gridMode
                      ? undefined
                      : {
                          flexGrow: splitSizes ? splitSizes[idx] : 0.5,
                          flexBasis: 0,
                          minWidth: 0,
                          minHeight: 0,
                        };
                  return (
                    <Fragment key={vkey}>
                      {/* Séparateur ajustable (2 apps seulement) */}
                      {inSplit && !gridMode && idx > 0 ? (
                        <div
                          onMouseDown={startSplitDrag}
                          className={`flex-shrink-0 transition-colors ${
                            splitDragging ? 'bg-accent-primary/70' : 'bg-border hover:bg-accent-primary/40'
                          }`}
                          style={
                            activeSplit.direction === 'row'
                              ? { width: 6, cursor: 'col-resize' }
                              : { height: 6, cursor: 'row-resize' }
                          }
                        />
                      ) : null}
                      <div
                        className={
                          inSplit
                            ? `relative min-w-0 min-h-0 bg-bg-secondary ${gridMode ? '' : 'flex'}`
                            : undefined
                        }
                        style={paneStyle}
                      >
                        <WebView
                          app={a}
                          active={inActive && a.id === activeApp}
                          visible={inSplit || (inActive && a.id === activeApp)}
                          flexLayout={inSplit}
                        />
                      </div>
                    </Fragment>
                  );
                })}

                {/* Cellule « + » : ajouter une 4e app à la grille 2×2 */}
                {activeSplit && activeSplit.appIds.length === 3 && (
                  <button
                    onClick={() => {
                      const next = profileApps.find(
                        (x) => !activeSplit.appIds.includes(x.id) && !x.sleeping
                      );
                      if (next) setSplitView({ ...activeSplit, appIds: [...activeSplit.appIds, next.id] });
                    }}
                    className="flex items-center justify-center text-text-muted hover:text-accent-primary hover:bg-bg-hover transition-colors border-2 border-dashed border-border rounded-lg m-0.5"
                    title="Ajouter une 4e application"
                  >
                    <Plus size={24} />
                  </button>
                )}

                {/* Barre de contrôle du partage (direction + quitter) */}
                {activeSplit && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-bg-elevated border border-border rounded-full shadow-xl px-1.5 py-1">
                    {activeSplit.appIds.length === 2 && (
                      <button
                        onClick={toggleSplitDirection}
                        className="btn-icon w-7 h-7"
                        title={
                          activeSplit.direction === 'row'
                            ? 'Passer en haut / bas'
                            : 'Passer côte à côte'
                        }
                      >
                        {activeSplit.direction === 'row' ? (
                          <Columns2 size={14} />
                        ) : (
                          <Rows2 size={14} />
                        )}
                      </button>
                    )}
                    <button
                      onClick={clearSplitView}
                      className="btn-icon w-7 h-7"
                      title="Quitter le partage d'écran"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* L'app active est en veille → écran de réveil par-dessus */}
                {activeAppData?.sleeping && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-bg-secondary">
                    <div className="w-20 h-20 rounded-full bg-bg-elevated border border-border flex items-center justify-center mb-6">
                      <Moon size={36} className="text-text-muted" />
                    </div>
                    <h2 className="text-xl font-semibold mb-2">
                      {activeAppData.name} est en veille
                    </h2>
                    <p className="text-text-secondary mb-6 text-center max-w-md">
                      L'application est fermée pour économiser les ressources.
                      Réveillez-la pour la recharger et continuer à l'utiliser.
                    </p>
                    <button
                      onClick={() => toggleAppSleep(activeAppData.id)}
                      className="btn btn-primary"
                    >
                      <Play size={16} /> Réveiller
                    </button>
                  </div>
                )}

            {/* Écran d'accueil : superposé quand le profil actif n'a aucune app.
                Rendu par-dessus les webviews (qui restent montés pour les autres
                profils) plutôt qu'à leur place → pas de démontage. */}
            {!hasApps && (
              <div className="absolute inset-0 flex flex-col items-center justify-center h-full bg-bg-secondary">
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent-primary to-purple-500 flex items-center justify-center mb-6 animate-pulse">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v6m0 6v6m8.66-15.66l-4.24 4.24m-4.84 4.84l-4.24 4.24m15.08.08l-4.24-4.24m-4.84-4.84L2.34 2.34" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold mb-2">Bienvenue dans Orbit 🛰</h2>
                <p className="text-text-secondary mb-6 text-center max-w-md">
                  Installez vos applications depuis la boutique ou appuyez sur{' '}
                  <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded mx-1">⌘K</kbd>{' '}
                  pour rechercher
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setShowQuickSwitcher(true)} className="btn btn-primary">
                    🔍 Rechercher
                  </button>
                  <button onClick={() => setShowAppStore(true)} className="btn btn-secondary">
                    🛍️ Boutique
                  </button>
                </div>

                <div className="mt-12 grid grid-cols-2 gap-4 max-w-2xl">
                  <div className="card text-left">
                    <div className="text-2xl mb-2">⚡</div>
                    <h3 className="font-semibold mb-1">Quick Switcher</h3>
                    <p className="text-sm text-text-muted">
                      Appuyez sur Cmd/Ctrl + K pour rechercher rapidement
                    </p>
                  </div>
                  <div className="card text-left">
                    <div className="text-2xl mb-2">💼</div>
                    <h3 className="font-semibold mb-1">Profils multiples</h3>
                    <p className="text-sm text-text-muted">
                      Séparez travail et personnel avec des profils
                    </p>
                  </div>
                  <div className="card text-left">
                    <div className="text-2xl mb-2">🎨</div>
                    <h3 className="font-semibold mb-1">Personnalisable</h3>
                    <p className="text-sm text-text-muted">Thèmes, couleurs d'accent et plus encore</p>
                  </div>
                  <div className="card text-left">
                    <div className="text-2xl mb-2">🌐</div>
                    <h3 className="font-semibold mb-1">80+ Apps</h3>
                    <p className="text-sm text-text-muted">Gmail, Slack, Notion, ChatGPT et bien plus</p>
                  </div>
                </div>
              </div>
            )}

            {/* Rechercher dans la page (Ctrl/Cmd+F) — sur l'app active */}
            {showFind && activeApp && !overlayOpen && activeProfileAccessible && !appLocked && (
              <FindBar appId={activeApp} onClose={() => setShowFind(false)} />
            )}

            {/* Profil verrouillé : gate de déverrouillage sur la zone de contenu.
                Les apps du profil ne sont pas montées tant qu'on n'a pas saisi
                le code (voir liveApps). */}
            {!appLocked && !activeProfileAccessible && (
              <LockScreen
                variant="profile"
                title={`Profil « ${profiles.find((p) => p.id === activeProfile)?.name || ''} » verrouillé`}
                subtitle="Entrez le code de ce profil pour l'afficher"
                onSubmit={handleUnlockProfile}
              />
            )}
          </div>
        </div>
      </div>

      {/* Barre du bas (optionnelle) — masquée en plein écran */}
      {!isFullscreen && settings.bottombarEnabled && !hideBottom && (
        <Bottombar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} />
      )}
      {hideBottom && (
        <>
          <RevealStrip zone="bottom" enabled />
          <div
            className="fixed bottom-0 left-0 right-0 transition-transform duration-200 ease-out shadow-xl"
            style={{
              zIndex: REVEALED_BAR_Z,
              transform: bottomZone.visible ? 'translateY(0)' : 'translateY(100%)',
            }}
            {...bottomZone.handlers}
          >
            <Bottombar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} />
          </div>
        </>
      )}

      {/* Overlays — au-dessus des webviews car ils sont dans le DOM */}
      {showQuickSwitcher && (
        <QuickSwitcher
          onClose={() => setShowQuickSwitcher(false)}
          onOpenSettings={() => {
            setShowQuickSwitcher(false);
            setShowSettings(true);
          }}
          onOpenStore={() => {
            setShowQuickSwitcher(false);
            setShowAppStore(true);
          }}
          onOpenProfileManager={() => {
            setShowQuickSwitcher(false);
            setShowProfileManager(true);
          }}
        />
      )}
      {/* Menu contextuel des apps embarquées (remplace le menu natif) */}
      <GuestContextMenu />

      {/* Questions posées par les apps : alert/confirm/prompt et demandes
          d'autorisation (caméra, micro, position…) */}
      <WebDialogHost />

      {/* Repli `null` : ces écrans s'ouvrent déjà avec une animation d'entrée,
          et le chargement est local (quelques millisecondes) — afficher un
          indicateur ferait clignoter l'interface plus qu'il n'informerait. */}
      <Suspense fallback={null}>
        {showSettings && <Settings onClose={() => setShowSettings(false)} />}
        {showProfileManager && <ProfileManager onClose={() => setShowProfileManager(false)} />}
        {showAppStore && <AppStore onClose={() => setShowAppStore(false)} />}
      </Suspense>

      {/* Verrou global : plein écran au lancement, par-dessus TOUT (topbar,
          sidebar, webviews). Aucune app n'est montée tant que non déverrouillé. */}
      {appLocked && (
        <LockScreen variant="app" onSubmit={handleUnlockApp} />
      )}

      {/* Mise à jour automatique */}
      <UpdateBanner />

      {/* Bienvenue au tout premier lancement */}
      {!onboarded && !appLocked && (
        <Welcome onClose={() => setOnboarded(true)} onOpenStore={() => setShowAppStore(true)} />
      )}
    </div>
  );
}
