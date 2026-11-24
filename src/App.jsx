import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Play, X, Columns2, Rows2, Wifi, KeyRound, Plus, Copy, ExternalLink, Globe, EyeOff } from 'lucide-react';
import Sidebar from './components/Sidebar';
import { basenameOf, isViewerKind, toolForFile } from './lib/fileTypes';
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
const DownloadsPage = lazy(() => import('./components/DownloadsPage'));
const ProfileManager = lazy(() => import('./components/ProfileManager'));
const AppStore = lazy(() => import('./components/AppStore'));
// L'espace Téléphone vient d'une extension : bureau, aperçu et réglages ne
// sont chargés qu'à la première ouverture, si l'extension est installée.
const PhoneOverlay = lazy(() => import('./components/PhoneOverlay'));
const DevToolsOverlay = lazy(() => import('./components/DevToolsOverlay'));
import ProfileTransition from './components/ProfileTransition';
const PhoneFloatingAccess = lazy(() => import('./components/PhoneFloatingAccess'));
// Même raison pour ces quatre-là, et une de plus pour la visionneuse : elle
// embarque KaTeX (~280 Ko) pour les formules des documents. Statique, elle le
// faisait charger et analyser à CHAQUE lancement, pour un rendu de formule
// mathématique que la plupart des sessions n'affichent jamais.
const DocumentViewer = lazy(() => import('./components/DocumentViewer'));
const RecordingStudio = lazy(() => import('./components/RecordingStudio'));
const PasswordVault = lazy(() => import('./components/PasswordVault'));
const OfflineProofreader = lazy(() => import('./components/OfflineProofreader'));
import WebView from './components/WebView';
import GuestContextMenu from './components/GuestContextMenu';
import ScreenshotPreview from './components/ScreenshotPreview';
import WebDialogHost from './components/WebDialogHost';
import EditUrlDialog from './components/EditUrlDialog';
import { migrateThemeSetting, resolveTheme, themeVars } from './lib/themes';
import LockScreen from './components/LockScreen';
import FindBar from './components/FindBar';
import UpdateBanner from './components/UpdateBanner';
import Welcome from './components/Welcome';
import HomeDashboard from './components/HomeDashboard';
import ThemeDecor from './components/ThemeDecor';
import LinkPeek from './components/LinkPeek';
import SplitDropOverlay from './components/SplitDropOverlay';
import { splitForDrop } from './lib/splitDrop';

// Aperçu ouvert depuis une page privée (partition en mémoire, voir lib/session.js).
const isPrivatePeek = (peek) => String(peek?.partition || '').startsWith('priv:');
import { useStore, appVisibleIn } from './stores/useStore';
import { useShallow } from 'zustand/react/shallow';
import { usePhoneStore } from './lib/phoneStore';
import { describeCallState } from './lib/phone';
import { useSecurityStore } from './lib/securityStore';
import { useMediaStore } from './lib/mediaStore';
import { mediaToggle, mediaPrev, mediaNext, mediaSeek, pickNowPlaying } from './lib/mediaControls';
import { appViewKey, appPartition, resolveProxy } from './lib/session';
import { matchShortcut, normalizeAssistantChatShortcutKey } from './lib/shortcuts';
import { useDevToolsStore } from './lib/devToolsStore';
import { openNativeApp } from './lib/nativeApps';
import { createAutomationRunner } from './lib/automationRunner';
import { useAutomationLog, setActiveRunner } from './lib/automationLog';
import { layoutFor, areaLetter, parseTracks } from './lib/splitLayouts';
import {
  reloadApp,
  navigateApp,
  getRegisteredWebviews,
  getWebContentsIdFor,
} from './lib/webviewRegistry';
import { logDiagnostic } from './lib/diagnosticsStore';
import { useT } from './lib/i18n';
import { attachTtsPlayer, setVolume as setTtsVolume } from './lib/ttsPlayer';
import { useDownloadsStore } from './lib/downloadsStore';

function AssistantHost() {
  const [Assistant, setAssistant] = useState(null);
  const [pendingEvent, setPendingEvent] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const importPromise = useRef(null);
  const assistantReady = useRef(false);

  const loadAssistant = useCallback((eventName, detail, fromIpc = false) => {
    if (assistantReady.current) {
      if (fromIpc) {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
      }
      return;
    }
    setPendingEvent({ eventName, detail });
    setLoadError(false);
    if (importPromise.current) return;
    importPromise.current = import('./components/OrbitAssistant')
      .then((module) => setAssistant(() => module.default))
      .catch((error) => {
        importPromise.current = null;
        setLoadError(true);
        console.error('[orbit] chargement de l’assistant impossible:', error);
      });
  }, []);

  useEffect(() => {
    const openAssistant = () => loadAssistant('orbit:assistant-open');
    const openChatAssistant = () => loadAssistant('orbit:assistant-chat-open');
    const openSelection = (payload) =>
      loadAssistant('orbit:assistant-selection', payload, true);
    const openConversation = (event) =>
      loadAssistant('orbit:assistant-load-conversation', event.detail, true);
    const offSelection = window.electronAPI?.assistant?.onSelection?.(openSelection);
    window.addEventListener('orbit:assistant-open', openAssistant);
    window.addEventListener('orbit:assistant-chat-open', openChatAssistant);
    window.addEventListener('orbit:assistant-conversation-open', openConversation);
    return () => {
      if (typeof offSelection === 'function') offSelection();
      window.removeEventListener('orbit:assistant-open', openAssistant);
      window.removeEventListener('orbit:assistant-chat-open', openChatAssistant);
      window.removeEventListener('orbit:assistant-conversation-open', openConversation);
    };
  }, [loadAssistant]);

  const markAssistantReady = useCallback(() => {
    assistantReady.current = true;
  }, []);

  useEffect(() => {
    if (!Assistant || !pendingEvent) return undefined;
    const frame = requestAnimationFrame(() => {
      window.dispatchEvent(
        pendingEvent.detail === undefined
          ? new Event(pendingEvent.eventName)
          : new CustomEvent(pendingEvent.eventName, { detail: pendingEvent.detail })
      );
      setPendingEvent(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [Assistant, pendingEvent]);

  return (
    <>
      {Assistant && <Assistant onReady={markAssistantReady} />}
      {loadError && (
        <div role="alert" className="fixed bottom-4 right-4 z-[10000] rounded-lg bg-red-950 px-4 py-3 text-sm text-red-100 shadow-lg">
          Impossible de charger l’assistant. Redémarrez Orbit et réessayez.
        </div>
      )}
    </>
  );
}

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

// Accent d'origine d'Orbit. Présent dans les réglages par défaut, il ne peut
// pas être distingué d'un choix de l'utilisateur — on le traite donc comme
// « rien choisi », pour que chaque thème puisse montrer sa couleur.
const LEGACY_ACCENT = '#6366f1';

// La conversion hex → triplet et le mélange vers le blanc vivent désormais
// dans src/lib/themes.js (hexToTriplet / mixWhite), avec les thèmes qui s'en
// servent — et sous test.

export default function App() {
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  // Requête de départ de la palette (« ? » = liste des raccourcis, via F1).
  const [quickSwitcherQuery, setQuickSwitcherQuery] = useState('');
  // Aperçu d'un lien ouvert « à côté » depuis une app : { url, partition, key }
  const [linkPeek, setLinkPeek] = useState(null);
  const linkPeekRef = useRef(null);
  useEffect(() => {
    linkPeekRef.current = linkPeek;
  }, [linkPeek]);
  // Studio d'enregistrement (écran + caméra). Monté seulement à l'ouverture :
  // il tient des flux média, il n'a rien à faire en mémoire le reste du temps.
  const [showStudio, setShowStudio] = useState(false);
  const phoneOpen = usePhoneStore((s) => s.open);
  const phoneEnabled = useStore((s) => s.nativeApps.includes('phone'));
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileManager, setShowProfileManager] = useState(false);
  const [showAppStore, setShowAppStore] = useState(false);
  const [storePrefill, setStorePrefill] = useState(null); // app personnalisée pré-remplie depuis une page volante
  const [flyMenu, setFlyMenu] = useState(null); // { x, y, page } — menu contextuel d'une page volante
const [editUrlFor, setEditUrlFor] = useState(null); // { id, url } — boîte « modifier l'adresse »
  const [showVault, setShowVault] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const t = useT();
  const upsertDownload = useDownloadsStore((state) => state.upsert);
  const hydrateDownloads = useDownloadsStore((state) => state.hydrate);

  useEffect(() => {
    let active = true;
    Promise.resolve(window.electronAPI?.listDownloads?.() || { success: false })
      .then((result) => {
        if (active && result?.success) hydrateDownloads(result.downloads);
      })
      .catch((error) => console.error('[orbit] historique des téléchargements indisponible:', error));
    const off = window.electronAPI?.onDownload?.((payload) => {
      upsertDownload(payload);
    });
    return () => {
      active = false;
      if (typeof off === 'function') off();
    };
  }, [hydrateDownloads, upsertDownload]);
  const [captive, setCaptive] = useState(null); // { detected, url } | null
  const [showFind, setShowFind] = useState(false);
  useEffect(() => {
    const openSettings = () => setShowSettings(true);
    window.addEventListener('orbit:assistant-open-settings', openSettings);
    return () => window.removeEventListener('orbit:assistant-open-settings', openSettings);
  }, []);
  const {
    activeProfile,
    activeApp,
    apps: installedApps,
    flyPages,
    closeFlyPage,
    rules,
    profiles,
    extensions,
    updateExtensions,
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
  } = useStore(
    useShallow((s) => ({ activeProfile: s.activeProfile, activeApp: s.activeApp, apps: s.apps, flyPages: s.flyPages, closeFlyPage: s.closeFlyPage, rules: s.rules, profiles: s.profiles, extensions: s.extensions, updateExtensions: s.updateExtensions, settings: s.settings, updateApp: s.updateApp, setActiveApp: s.setActiveApp, toggleAppSleep: s.toggleAppSleep, sidebarCollapsed: s.sidebarCollapsed, setSidebarCollapsed: s.setSidebarCollapsed, splitView: s.splitView, setSplitView: s.setSplitView, clearSplitView: s.clearSplitView, toggleSplitDirection: s.toggleSplitDirection, onboarded: s.onboarded, setOnboarded: s.setOnboarded })),
  );

  // Animation de passage : un voile bref par-dessus la zone de contenu à
  // chaque changement d'app ou de profil. Un <webview> est une surface native :
  // on ne peut pas l'animer en CSS, mais on PEUT poser un voile au-dessus.
  const animStyle =
    settings.animationStyle ?? (settings.animationsEnabled === false ? 'none' : 'fade');
  const [viewAnim, setViewAnim] = useState(0);
  const viewAnimFirst = useRef(true);
  const viewAnimProfile = useRef(activeProfile);
  useEffect(() => {
    if (viewAnimFirst.current) {
      viewAnimFirst.current = false;
      return undefined;
    }
    // Un changement de PROFIL a sa propre transition (ProfileTransition) :
    // on n'empile pas les deux voiles.
    const profileChanged = viewAnimProfile.current !== activeProfile;
    viewAnimProfile.current = activeProfile;
    if (profileChanged && (settings.profileTransition || 'cube') !== 'none') return undefined;
    if (animStyle === 'none') return undefined;
    // Différé d'une tâche : aucun setState pendant l'effet lui-même.
    const t = setTimeout(() => setViewAnim((n) => n + 1), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeApp, activeProfile, animStyle]);

  // Zoom à la molette (Ctrl + molette) : le preload du <webview> applique le
  // zoom dans la page et nous prévient ; on persiste la valeur sur l'app, pour
  // que les boutons de la barre et le prochain démarrage la retrouvent.
  useEffect(() => {
    const off = window.electronAPI?.onGuestZoom?.(({ appId, wcId, factor } = {}) => {
      const zoom = Number(factor);
      if (!Number.isFinite(zoom)) return;
      const value = Math.min(3, Math.max(0.5, zoom));
      // Fenêtre détachée : son webContents n'est pas un <webview> enregistré
      // côté interface, c'est le processus principal qui nomme l'app.
      if (appId) {
        updateApp(appId, { zoom: value });
        return;
      }
      const found = getRegisteredWebviews().find(
        ([id]) => getWebContentsIdFor(id) === wcId
      );
      if (found) updateApp(found[0], { zoom: value });
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [updateApp]);

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
  }, []);

  // --- Automatisations ---------------------------------------------------
  // Le processus principal décide du sort d'un lien AU MOMENT DU CLIC, et son
  // gestionnaire est synchrone : il a donc besoin de sa propre copie des
  // règles, qu'on lui pousse à chaque changement.
  useEffect(() => {
    window.electronAPI?.setRules?.(rules);
  }, [rules]);

  // Liens routés par une règle « ouvrir dans telle app » / « page volante ».
  useEffect(() => {
    const off = window.electronAPI?.onLinkRouted?.(({ url: target, rule }) => {
      const st = useStore.getState();
      if (rule.action === 'flyPage') {
        st.openFlyPage(target);
        return;
      }
      const app = st.apps.find((a) => a.id === rule.targetAppId);
      if (!app) {
        // L'app cible a été désinstallée depuis : plutôt que de ne rien faire
        // (l'utilisateur croirait à un lien mort), on ouvre en page volante.
        st.openFlyPage(target);
        return;
      }
      st.setActiveProfile(app.profileId);
      st.setActiveApp(app.id);
      // L'app peut ne pas être encore montée : on laisse un instant au
      // <webview> pour s'enregistrer avant de le piloter.
      setTimeout(() => {
        if (!navigateApp(app.id, target)) st.openFlyPage(target);
      }, 250);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Liens venus de l'EXTÉRIEUR : le système a lancé (ou rappelé) Orbit avec une
  // URL ou le chemin d'un fichier — parce que l'utilisateur a choisi Orbit dans
  // « Ouvrir avec », ou double-cliqué un document associé. On l'ouvre en PAGE
  // VOLANTE : un « lien libre », jamais un compte déjà connecté.
  // `path` est transmis au store : c'est lui qui autorise la lecture du fichier
  // par la visionneuse (le processus principal ne lit que les fichiers ouverts
  // ainsi — voir documents:read).
  useEffect(() => {
    const off = window.electronAPI?.onOpenLink?.(async ({ url, path: filePath } = {}) => {
      // Un fichier qu'un outil d'Orbit sait EXÉCUTER s'ouvre directement
      // dedans (.http → API, .sql / .sqlite → Base de données), si son
      // extension est installée. Sinon : la visionneuse, qui le propose.
      const tool = filePath ? toolForFile(filePath, useStore.getState().nativeApps) : null;
      if (tool) {
        let text = null;
        if (tool.kind !== 'sqlite') {
          const res = await window.electronAPI?.documents?.read({ path: filePath });
          if (res?.ok) text = res.text;
        }
        if (tool.kind === 'sqlite' || text !== null) {
          useDevToolsStore.getState().openFile({ kind: tool.kind, path: filePath, name: basenameOf(filePath), text });
          openNativeApp(tool.app);
          return;
        }
      }
      if (url) useStore.getState().openFlyPage(url, { filePath });
    });
    // On prévient le processus principal qu'on écoute : il livre alors ce qui
    // est arrivé pendant le démarrage (sinon le lien serait perdu).
    window.electronAPI?.linksReady?.();
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // --- Automatisations « Quand… / Si… / Alors… » ---------------------------
  // Le moteur (lib/automations.js) dit quand partir, l'exécuteur
  // (lib/automationRunner.js) fait le travail ; ici on se contente de lui
  // brancher l'horloge et les événements d'Orbit.
  useEffect(() => {
    const runner = createAutomationRunner(
      {
        getState: useStore.getState,
        reloadApp: (id, url) => reloadApp(id, url, false),
        notify: (title, body) => {
          try {
            new Notification(title, { body });
          } catch {
            /* notifications indisponibles */
          }
        },
        setThemeMode: (mode) => {
          const st = useStore.getState();
          const { skin } = migrateThemeSetting(st.settings, st.settings.customThemes || []);
          st.updateSettings({ themeSkin: skin, themeMode: mode });
        },
        isPlaying: (id) => Boolean(useMediaStore.getState().media?.[id]?.playing),
      },
      {
        onLog: (entry) => {
          useAutomationLog.getState().push(entry);
          if (!entry.ok) {
            logDiagnostic(
              null,
              'Orbit',
              'automation',
              `Automatisation « ${entry.name || entry.ruleId} » : ${entry.errors.length} action(s) en échec`,
              entry.errors.map((e) => `${e.type}: ${e.error}`).join(', '),
            );
          }
        },
      },
    );
    setActiveRunner(runner);

    // Heures et intervalles : un passage toutes les 30 s suffit (la fenêtre
    // de déclenchement d'une heure est de 90 s).
    const tick = () => runner.tick();
    const clock = setInterval(tick, 30 * 1000);
    tick();

    // Démarrage : une fois, quand l'interface est en place.
    const boot = setTimeout(() => runner.dispatch({ type: 'startup' }), 2500);

    // App ouverte, profil changé, nouveaux messages.
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.activeApp && state.activeApp !== prev.activeApp) {
        runner.dispatch({ type: 'appOpen', appId: state.activeApp });
      }
      if (state.activeProfile && state.activeProfile !== prev.activeProfile) {
        runner.dispatch({ type: 'profileSwitch', profileId: state.activeProfile });
      }
      if (state.apps !== prev.apps) {
        const before = new Map((prev.apps || []).map((a) => [a.id, a.unread || 0]));
        for (const app of state.apps || []) {
          if ((app.unread || 0) > (before.get(app.id) || 0)) {
            runner.dispatch({ type: 'unread', appId: app.id });
          }
        }
      }
    });

    // Réseau perdu / retrouvé.
    const onOnline = () => runner.dispatch({ type: 'online' });
    const onOffline = () => runner.dispatch({ type: 'offline' });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      clearInterval(clock);
      clearTimeout(boot);
      unsubscribe();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      setActiveRunner(null);
    };
  }, []);

  // Données de test (« Fake data ») : le remplissage 🎲 vit dans le preload des
  // webviews, qui lit ses valeurs perso depuis le main → on les y pousse ici.
  useEffect(() => {
    window.electronAPI?.setFakeData?.(settings.fakeData || {});
  }, [settings.fakeData]);

  // Réglages de téléchargement. C'est le PROCESSUS PRINCIPAL qui décide où
  // écrire (il seul touche au disque et ouvre les boîtes de dialogue du
  // système) : on lui pousse simplement les deux réglages à chaque changement.
  useEffect(() => {
    window.electronAPI?.setDownloadPrefs?.({
      dir: settings.downloadDir || '',
      ask: settings.askDownloadPath === true,
      videoQuality: settings.downloadVideoQuality || 'best',
      audioFormat: settings.downloadAudioFormat || 'm4a',
      // Moteur accéléré. L'interface raisonne en Ko/s (lisible), le processus
      // principal en octets par seconde (utile) : la conversion est ici, un
      // seul endroit à corriger si l'unité change.
      connections: settings.downloadConnections ?? 8,
      maxConcurrent: settings.downloadMaxConcurrent ?? 3,
      globalRate: Math.max(0, Number(settings.downloadSpeedLimit) || 0) * 1024,
      perFileRate: Math.max(0, Number(settings.downloadFileSpeedLimit) || 0) * 1024,
      retries: settings.downloadRetries ?? 3,
      categorize: settings.downloadCategorize === true,
      // Cookies de session confiés à yt-dlp (Facebook, vidéos réservées).
      // Strictement limités au domaine visé — voir src/lib/mediaCookies.js.
      useCookies: settings.downloadUseCookies !== false,
      // Où proposer le téléchargement d'un média repéré : bouton posé sur la
      // vidéo, pastille dans la barre, les deux, ou aucun.
      buttonSurface: settings.mediaButtonSurface || 'both',
    });
  }, [
    settings.downloadDir,
    settings.askDownloadPath,
    settings.downloadVideoQuality,
    settings.downloadAudioFormat,
    settings.downloadConnections,
    settings.downloadMaxConcurrent,
    settings.downloadSpeedLimit,
    settings.downloadFileSpeedLimit,
    settings.downloadRetries,
    settings.downloadCategorize,
    settings.downloadUseCookies,
    settings.mediaButtonSurface,
  ]);

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

  // Mode panique : raccourci global et actions choisies dans Réglages → Sécurité.
  useEffect(() => {
    window.electronAPI?.panic?.configure?.({ ...(settings.panic || {}) });
  }, [settings.panic]);

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

  // Apps installées + pages volantes. Une page volante a la même forme qu'une
  // app, donc tout le rendu en aval (webview, écran partagé, recherche dans la
  // page, zoom, veille) fonctionne sans distinction de cas.
  const apps = useMemo(() => [...installedApps, ...flyPages], [installedApps, flyPages]);

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

  // Gabarit de disposition (3-4 apps) : forme choisie (maître-gauche, colonnes…).
  const splitLayout =
    activeSplit && activeSplit.appIds.length >= 3
      ? layoutFor(activeSplit.appIds.length, activeSplit.layout)
      : null;
  // Tailles effectives des pistes de la grille (override utilisateur ou défaut).
  const gridCols = splitLayout ? activeSplit.cols || parseTracks(splitLayout.cols) : null;
  const gridRows = splitLayout ? activeSplit.rows || parseTracks(splitLayout.rows) : null;

  // Séparateur ajustable : glisser pour agrandir/réduire un panneau
  const splitContainerRef = useRef(null);
  const [splitDragging, setSplitDragging] = useState(false);
  const [dragAxis, setDragAxis] = useState(null); // 'col' | 'row' | null (curseur du voile)
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
      setDragAxis(direction === 'col' ? 'row' : 'col');
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        setSplitDragging(false);
        setDragAxis(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      // Filet de sécurité : si la fenêtre perd le focus en plein drag (Alt-Tab,
      // clic hors fenêtre…), on arrête aussi — jamais de drag « fantôme ».
      window.addEventListener('blur', onUp);
    },
    [activeSplit, setSplitView]
  );

  // Redimensionnement en mode grille (3-4 apps) : glisser un séparateur entre
  // deux pistes (colonnes ou lignes). Ne touche que la paire de pistes adjacente
  // (leur somme reste constante) → les autres panneaux ne bougent pas.
  const startGridDrag = useCallback(
    (axis, at) => (e) => {
      e.preventDefault();
      const container = splitContainerRef.current;
      if (!container || !activeSplit || !splitLayout) return;
      const src = axis === 'col' ? activeSplit.cols : activeSplit.rows;
      const tracks = src ? [...src] : parseTracks(axis === 'col' ? splitLayout.cols : splitLayout.rows);
      const sumAll = tracks.reduce((s, v) => s + v, 0);
      const before = tracks.slice(0, at - 1).reduce((s, v) => s + v, 0);
      const pairTotal = tracks[at - 1] + tracks[at];
      setSplitDragging(true);
      setDragAxis(axis);
      const onMove = (ev) => {
        const rect = container.getBoundingClientRect();
        const total = axis === 'col' ? rect.width : rect.height;
        if (total <= 0) return;
        const pos = axis === 'col' ? ev.clientX - rect.left : ev.clientY - rect.top;
        const frac = Math.min(1, Math.max(0, pos / total));
        let first = frac * sumAll - before; // nouvelle taille de la piste at-1
        first = Math.min(pairTotal - 0.15, Math.max(0.15, first));
        const next = [...tracks];
        next[at - 1] = first;
        next[at] = pairTotal - first;
        setSplitView({ ...activeSplit, [axis === 'col' ? 'cols' : 'rows']: next });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        setSplitDragging(false);
        setDragAxis(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
    },
    [activeSplit, splitLayout, setSplitView]
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

  // Notifications du téléphone : le processus principal sonde l'appareil et
  // pousse la liste ; l'interface la garde hors du store persisté. Abonnement
  // unique, même si l'extension n'est pas installée (aucun événement alors).
  useEffect(() => {
    const api = window.electronAPI?.phone;
    // Un appel se reconnaît à son ÉTAT, pas à sa seule catégorie : un appel
    // décroché, un appel sortant et un appel manqué portent `category=call`
    // comme un appel qui sonne. Seuls ceux qui vivent encore méritent un
    // bandeau — et le bandeau lit l'état à chaque poussée, pour passer de
    // « Décrocher » à « Terminer » quand la conversation s'établit.
    const applyNotifications = (payload) => {
      const state = usePhoneStore.getState();
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const call = items.find((item) => {
        if (item.category !== 'call') return false;
        const phase = describeCallState(item);
        return phase === 'ringing' || phase === 'ongoing' || phase === 'outgoing';
      }) || null;
      state.setNotifications(payload);
      const previous = state.activeCall;
      // Même appel, notification réécrite : on garde le décrochage local (sinon
      // le bandeau redemanderait de décrocher une conversation en cours).
      const answeredAt =
        call && previous?.notification?.key === call.key ? previous.answeredAt : null;
      // Reverrouiller un bandeau fermé à la main toutes les douze secondes
      // serait une brimade : la clé de l'appel fermé est respectée.
      if (call && call.key !== state.dismissedCallKey) {
        state.setActiveCall({ serial: payload.serial, notification: call, answeredAt });
      } else if (!call) {
        if (previous) state.setActiveCall(null);
        if (state.dismissedCallKey) state.clearDismissedCall();
      }
    };
    const off = api?.onNotifications?.(applyNotifications);
    const pending = api?.notifications?.();
    if (pending?.then) {
      // Premier chargement : un appel déjà en cours au démarrage mérite son
      // bandeau (au bon état), comme s'il venait d'arriver.
      pending
        .then((res) => {
          if (res?.success) applyNotifications(res);
        })
        .catch(() => {});
    }
    // Clic sur une alerte système : Orbit s'ouvre sur le téléphone et lance
    // l'application concernée.
    const offOpen = api?.onOpenRequest?.(({ package: pkg } = {}) => {
      // L'espace Téléphone ouvre l'app dans une fenêtre scrcpy native dédiée.
      usePhoneStore.getState().requestOpen(pkg || null);
    });
    return () => {
      if (typeof off === 'function') off();
      if (typeof offOpen === 'function') offOpen();
    };
  }, []);

  // Synchroniser les extensions Chrome avec le main process (chargées par session)
  useEffect(() => {
    const pending = window.electronAPI?.syncExtensions?.(extensions);
    if (!pending?.then) return;
    pending
      .then((res) => {
        // Les apps natives (`orbit.nativeApp`) suivent l'état RÉEL des
        // extensions : installées → l'app apparaît, sinon elle disparaît.
        if (res?.nativeApps) useStore.getState().syncNativeApps(res.nativeApps);
        // Dossier disparu (nettoyage d'un ancien dossier temporaire,
        // suppression à la main…) : la ligne « installée » serait un mensonge,
        // et son bouton d'installation resterait désactivé pour toujours. On
        // la retire, ce qui rend l'extension réinstallable depuis le catalogue.
        if (res?.missing?.length) {
          const gone = new Set(res.missing.map((item) => item.id));
          console.warn(
            '[orbit] extensions retirées (dossier introuvable) :',
            res.missing.map((item) => item.name).join(', '),
          );
          updateExtensions(extensions.filter((ext) => !gone.has(ext.id)));
        }
      })
      .catch(() => {});
  }, [extensions, updateExtensions]);

  // Ouverture du studio depuis la palette de commandes.
  useEffect(() => {
    const open = () => setShowStudio(true);
    window.addEventListener('orbit:studio-open', open);
    return () => window.removeEventListener('orbit:studio-open', open);
  }, []);

  // Synchroniser les sources d'identifiants proposées dans les pages. Le
  // processus principal repart de « les deux » à chaque lancement : sans cet
  // envoi, un utilisateur ayant écarté KeePassXC le reverrait interrogé.
  useEffect(() => {
    const source = settings.credentials?.source || 'both';
    window.electronAPI?.credentialsSetSource?.(source);
    window.electronAPI?.keepassSetEnabled?.(source === 'both' || source === 'keepass');
  }, [settings.credentials?.source]);

  // Même raison pour le bouton « code 2FA » des pages : le processus principal
  // le propose par défaut, il faut lui dire si l'utilisateur l'a écarté.
  useEffect(() => {
    window.electronAPI?.credentialsSetTotpOffer?.(settings.credentials?.totp !== false);
  }, [settings.credentials?.totp]);

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
      peek: settings.linkPeek !== false,
      theme,
      accent: settings.accentColor,
    });
  }, [settings.popupStyle, settings.linkPeek, settings.theme, settings.accentColor]);

  // Aperçu de lien : le main l'annonce (Ctrl+clic, target=_blank dans une
  // app), on l'affiche par-dessus. Un nouveau lien remplace l'aperçu ouvert.
  useEffect(() => {
    const off = window.electronAPI?.onLinkPeek?.(({ url, partition } = {}) => {
      if (!url || !/^https?:\/\//i.test(url)) return;
      setLinkPeek({ url, partition, key: Date.now() });
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  // Ouvre `url` en page volante et la range à côté de l'app affichée.
  const openBesideActive = useCallback((url, options = {}) => {
    const st = useStore.getState();
    const anchor = st.activeApp;
    const id = st.openFlyPage(url, options);
    if (!id || !anchor || anchor === id) return;
    const result = splitForDrop(useStore.getState().splitView, anchor, id, 'right');
    if (result?.splitView) st.setSplitView(result.splitView);
    if (result?.activeApp) st.setActiveApp(result.activeApp);
  }, []);

  // Dépôt sur la zone de contenu (voir SplitDropOverlay / lib/splitDrop.js).
  const handleSplitDrop = useCallback(({ appId, url, zone }) => {
    const st = useStore.getState();
    const anchor = st.activeApp;
    const dropped = appId || (url ? st.openFlyPage(url) : null);
    if (!dropped) return;
    usePhoneStore.getState().setOpen(false);
    const split = useStore.getState().splitView;
    // Centre, en écran partagé : l'app déposée prend la place du panneau actif.
    if (zone === 'center' && split?.appIds?.includes(anchor) && anchor !== dropped) {
      if (!split.appIds.includes(dropped)) {
        st.setSplitView({ ...split, appIds: split.appIds.map((id) => (id === anchor ? dropped : id)) });
      }
      st.setActiveApp(dropped);
      return;
    }
    const result = splitForDrop(split, anchor, dropped, zone);
    if (!result) return;
    if (result.splitView !== undefined) st.setSplitView(result.splitView);
    st.setActiveApp(result.activeApp);
  }, []);

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
    usePhoneStore.getState().setOpen(false);
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

    // Thème : DEUX AXES — l'identité (`themeSkin`) et l'ambiance
    // (`themeMode`). `migrateThemeSetting` lit aussi l'ancien réglage
    // `theme`, pour que les installations existantes ne changent pas
    // d'apparence à la mise à jour (voir src/lib/themes.js).
    const customThemes = settings.customThemes || [];
    const { skin, mode } = migrateThemeSetting(settings, customThemes);

    // Accent : le thème PROPOSE sa couleur signature, l'utilisateur DISPOSE.
    //
    // Sans cette distinction, la couleur d'un thème serait toujours écrasée :
    // l'accent est posé en style inline sur :root, ce qui bat n'importe quelle
    // règle CSS. On ne transmet donc un accent que s'il a été VOULU — un
    // réglage absent vaut « laisse le thème décider », et non « indigo ».
    const activeProfileObj = profiles.find((p) => p.id === activeProfile);
    // `accentColor` vaut '#6366f1' dans les réglages par défaut : on ne peut
    // donc pas distinguer « l'utilisateur a choisi l'indigo » de « il n'a rien
    // choisi ». Sans cette nuance, la couleur signature d'un thème n'apparaît
    // JAMAIS — le thème Tech s'affichait en indigo au lieu de cyan, ce qui ne
    // se voit qu'en lançant l'application.
    //
    // Même arbitrage que pour la police : la valeur historique par défaut
    // laisse parler le thème, toute autre valeur est un choix qui l'emporte.
    const explicitAccent =
      settings.accentColor && settings.accentColor !== LEGACY_ACCENT ? settings.accentColor : null;
    const chosenAccent =
      settings.accentPerProfile && activeProfileObj
        ? activeProfileObj.accent || activeProfileObj.color || explicitAccent
        : explicitAccent;

    const applyTheme = () => {
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const theme = resolveTheme(skin, mode, prefersLight, customThemes);
      // `data-theme` reste posé pour la compatibilité (color-scheme, et les
      // quelques règles qui s'y accrochent encore) ; `data-skin` porte
      // l'identité, dont dépendent les signatures (texture, liseré…).
      root.dataset.theme = theme.mode;
      root.dataset.skin = theme.skin;
      for (const [key, value] of Object.entries(themeVars(theme, chosenAccent))) {
        root.style.setProperty(key, value);
      }
      return theme;
    };
    const appliedTheme = applyTheme();

    // Taille de police + échelle UI : la base rem est multipliée,
    // tout le UI (textes ET espacements Tailwind) suit, sans clipping.
    // Police : un préréglage, ou une taille personnalisée en pixels. La valeur
    // est bornée aux mêmes limites que le champ des réglages, pour qu'une
    // saisie aberrante (ou un ancien profil) ne rende pas l'interface illisible.
    const customPx = Number(settings.fontSizePx);
    const base =
      settings.fontSize === 'custom'
        ? Math.min(24, Math.max(10, Number.isFinite(customPx) && customPx > 0 ? customPx : 14))
        : FONT_SIZES[settings.fontSize] ?? 14;
    const scale = (settings.uiScale ?? 100) / 100;
    root.style.fontSize = `${Math.round(base * scale)}px`;
    // La police doit être appliquée sur <body> : la règle CSS de body
    // (font-family: Inter, …) surchargerait une valeur posée sur <html>.
    // Police : même règle que l'accent. Le thème propose la sienne (Tech
    // demande une police technique), un choix explicite de l'utilisateur
    // l'emporte. 'Inter' étant l'ancien défaut, on ne peut pas le distinguer
    // d'un choix — on considère donc que seule une valeur AUTRE qu'Inter est
    // un choix délibéré, et Inter laisse parler le thème.
    const chosenFont = settings.fontFamily && settings.fontFamily !== 'Inter'
      ? settings.fontFamily
      : appliedTheme.traits.font;
    document.body.style.fontFamily = chosenFont;
    document.body.style.letterSpacing = appliedTheme.traits.tracking || '';

    root.classList.toggle('compact-mode', !!settings.compactMode);
    const animStyle =
      settings.animationStyle ?? (settings.animationsEnabled === false ? 'none' : 'fade');
    root.classList.toggle('no-animations', animStyle === 'none' || settings.animationsEnabled === false);

    // Mode « auto » : on suit le système tant que la fenêtre est ouverte.
    if (mode === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const onChange = () => applyTheme();
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [settings, activeProfile, profiles]);

  // Ouvre `url` DANS la page `id` : on la pilote comme une app, mais sans passer
// par openFlyPage — celui-ci cherche une page existante par URL et peut en créer
// une seconde. Ici on corrige l'adresse de celle qui est déjà là, en gardant
// son <webview> (donc son état de navigation).
const navigateToUrl = useCallback((id, url) => {
  if (!navigateApp(id, url)) return;
  const st = useStore.getState();
  if (st.flyPages.some((p) => p.id === id)) {
    st.updateApp(id, { url });
  }
}, []);

const openEditUrl = useCallback((id) => {
  const st = useStore.getState();
  const target =
    st.flyPages.find((p) => p.id === id) || st.apps.find((a) => a.id === id) || null;
  if (!target) return;
  setEditUrlFor({ id, url: target.url || target.homeUrl || '' });
}, []);

  // Exécute une action de raccourci (nom centralisé dans lib/shortcuts.js)
  const runShortcut = useCallback((action, payload) => {
    if (action === 'screenshot') {
      window.dispatchEvent(new CustomEvent('orbit:screenshot-open', {
        detail: payload?.wcId ? payload : { ...payload, source: 'orbit' },
      }));
      return;
    }
    if (action === 'assistant-chat') {
      if (useStore.getState().settings.assistantChatEnabled !== false) {
        window.dispatchEvent(new Event('orbit:assistant-chat-open'));
      }
      return;
    }
    if (action === 'search') {
      setQuickSwitcherQuery('');
      return setShowQuickSwitcher((v) => !v);
    }
    if (action === 'help') {
      setQuickSwitcherQuery('?');
      return setShowQuickSwitcher(true);
    }
    if (action === 'downloads') return setShowDownloads((v) => !v);
    if (action === 'vault') return setShowVault((v) => !v);
    // Nouvelle page volante : la boîte d'adresse, vide, sans page à modifier.
    if (action === 'new-page') return setEditUrlFor({ id: null, url: '' });
    // Fermer : l'aperçu de lien s'il est ouvert, sinon la page volante active.
    // Une app installée ne se ferme pas au clavier (elle se met en veille :
    // Alt+S) — un geste réflexe ne doit pas perdre une session.
    if (action === 'close-page') {
      if (linkPeekRef.current) {
        setLinkPeek(null);
        return;
      }
      const st = useStore.getState();
      if (st.flyPages.some((p) => p.id === st.activeApp)) st.closeFlyPage(st.activeApp);
      return;
    }
    if (action === 'detach') {
      const st = useStore.getState();
      const app = st.apps.find((x) => x.id === st.activeApp);
      if (!app || app.native) return;
      const sharedSession = !!st.profiles.find((p) => p.id === app.profileId)?.sharedSession;
      window.electronAPI?.openDetached?.({
        appId: app.id,
        url: app.url,
        partition: appPartition(app, sharedSession),
        title: app.name,
        zoom: app.zoom,
      });
      return;
    }
    // --- Écran partagé ----------------------------------------------------
    if (action === 'split-toggle' || action === 'split-direction' || action === 'split-focus') {
      const st = useStore.getState();
      const split = st.splitView;
      const inSplit = split?.appIds?.includes(st.activeApp);
      if (action === 'split-toggle') {
        if (inSplit) return st.clearSplitView();
        // Partager avec l'app précédente dans la liste (ou la suivante).
        const list = [...st.apps, ...st.flyPages]
          .filter((a) => appVisibleIn(a, st.activeProfile) && !a.sleeping)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const i = list.findIndex((a) => a.id === st.activeApp);
        if (i < 0 || list.length < 2) return;
        const partner = list[i > 0 ? i - 1 : 1];
        return st.setSplitView({ appIds: [partner.id, st.activeApp], direction: 'row', sizes: [0.5, 0.5] });
      }
      if (!inSplit) return;
      if (action === 'split-direction') {
        if (split.appIds.length === 2) st.toggleSplitDirection();
        return;
      }
      const ids = split.appIds;
      return st.setActiveApp(ids[(ids.indexOf(st.activeApp) + 1) % ids.length]);
    }
    if (action === 'settings') return setShowSettings((v) => !v);
    // Modifier l'adresse de la page courante : indispensable sur une page
    // volante, qui n'a pas de champ d'URL et se corrigait jusqu'ici en
    // fermant tout.
    if (action === 'edit-url') return openEditUrl(useStore.getState().activeApp);
    if (action === 'store') return setShowAppStore((v) => !v);
    if (action === 'profiles') return setShowProfileManager((v) => !v);
    if (action === 'find') {
      // Une app native n'a pas de DOM à fouiller : le raccourci resterait
      // sans effet visible, barre de recherche comprise.
      const app = useStore.getState().apps.find((x) => x.id === useStore.getState().activeApp);
      if (app && !app.native) setShowFind(true);
      return;
    }
    // Ctrl+R / F5 — même comportement que le bouton « Actualiser »
    if (action === 'reload' || action === 'reload-hard') {
      const { activeApp: a, apps: all } = useStore.getState();
      const app = all.find((x) => x.id === a);
      if (a && !app?.native) reloadApp(a, app?.url, action === 'reload-hard');
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
    // Un outil natif (Base de données, API) est affiché par-dessus l'app :
    // le zoom s'applique à lui, pas à la page cachée dessous.
    const devTool = useDevToolsStore.getState().open;
    if (devTool && /^zoom-/.test(action)) {
      useDevToolsStore.getState().setZoom(devTool, action);
      return;
    }
    const { activeApp, adjustAppZoom, resetAppZoom } = useStore.getState();
    if (!activeApp) return;
    if (action === 'zoom-in') adjustAppZoom(activeApp, 0.1);
    else if (action === 'zoom-out') adjustAppZoom(activeApp, -0.1);
    else if (action === 'zoom-reset') resetAppZoom(activeApp);
  }, [openEditUrl]);

  // Raccourcis clavier quand le focus est dans l'interface (sidebar, topbar…)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const configuredKey = settings.assistantChatEnabled !== false &&
        settings.assistantChatShortcutEnabled !== false
        ? normalizeAssistantChatShortcutKey(settings.assistantChatShortcutKey) || 'a'
        : null;
      const action = matchShortcut(e, configuredKey);
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
        setShowDownloads(false);
        // Échap renvoie aussi les barres appelées au clavier.
        useAutoHideStore.getState().clearSummon();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runShortcut, settings.assistantChatEnabled, settings.assistantChatShortcutEnabled, settings.assistantChatShortcutKey]);

  // Raccourcis GLOBAUX : interceptés par le main process même quand le focus
  // est DANS une app embarquée (Gmail, Slack…) — les apps gardent leurs Ctrl.
  useEffect(() => {
    const off = window.electronAPI?.onShortcut?.(runShortcut);
    return () => {
      if (typeof off === 'function') off();
    };
  }, [runShortcut]);

  useEffect(() => {
    const configuredKey = settings.assistantChatEnabled !== false &&
      settings.assistantChatShortcutEnabled !== false
      ? normalizeAssistantChatShortcutKey(settings.assistantChatShortcutKey) || 'a'
      : null;
    const setChatShortcut = window.electronAPI?.assistant?.setChatShortcut;
    if (typeof setChatShortcut !== 'function') return;
    setChatShortcut(configuredKey).then((result) => {
      if (result?.success === false) {
        console.error('[orbit] raccourci de discussion IA refusé:', result.error);
      }
    }).catch((error) => {
      console.error('[orbit] synchronisation du raccourci de discussion IA échouée:', error);
    });
  }, [settings.assistantChatEnabled, settings.assistantChatShortcutEnabled, settings.assistantChatShortcutKey]);

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

  // Y a-t-il une app RÉELLEMENT affichée ? Une app en veille a son propre écran
  // de réveil, et une app d'un autre profil n'est pas atteignable d'ici (son
  // <webview> reste monté mais masqué) : dans ces deux cas, rien n'est visible
  // et c'est la page d'accueil qui prend la place.
  const activeAppVisible =
    !!activeAppData && !activeAppData.sleeping && appVisibleIn(activeAppData, activeProfile);
  // Page d'accueil : affichée dans un profil où aucune app n'est ouverte — ce
  // qui remplace l'écran noir (et l'ancien écran de bienvenue, qui ne servait
  // qu'au cas « profil sans aucune app »). On attend que l'état de verrouillage
  // soit chargé (`security.ready`) pour ne pas la peindre une fraction de
  // seconde par-dessus un profil verrouillé.
  const showHome =
    security.ready && !appLocked && activeProfileAccessible && !activeSplit && !activeAppVisible;

  // Un overlay (Réglages, Boutique…) est ouvert : on masque les webviews.
  // Évite tout problème de composition GPU où un webview serait peint
  // par-dessus la modale (visible : menu à gauche, contenu masqué).
  // visibility:hidden ne décharge PAS les webviews — juste pas de peinture.
  const overlayOpen =
    showQuickSwitcher || showSettings || showProfileManager || showAppStore || showDownloads;

  return (
    <div
      className="flex flex-col h-screen bg-bg-primary text-text-primary overflow-hidden"
      data-decor={showHome ? 'full' : 'chrome'}
      style={{
        borderRadius: isFullscreen ? 0 : '12px',
        // Zone réservée au contenu : le décor s'y découpe pour laisser la page
        // nette quand une app est ouverte (et pour laisser la sidebar gérer
        // son propre décor).
        '--decor-left': typeof sidebarOffset === 'number' ? `${sidebarOffset}px` : sidebarOffset,
        '--decor-top': sidebarTop === 0 ? '0px' : sidebarTop,
        '--decor-bottom': bottombarHeight === 0 ? '0px' : bottombarHeight,
      }}
    >
      {/* Décors des thèmes à signature : neige de Noël, étoiles et planètes
          d'Aurore. `position: fixed` et `pointer-events: none` : ils couvrent
          toute la fenêtre (accueil compris) sans jamais intercepter un clic.
          Masqués tant que leur thème n'est pas actif (index.css). */}
      <ThemeDecor />

      {/* Barre unifiée : logo, navigation, URL, notifications + contrôles fenêtre.
          En plein écran elle disparaît ; elle réapparaît en surimpression quand
          la souris touche le bord supérieur. */}
      {!isFullscreen && !hideTop && (
        <Topbar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} onOpenVault={() => setShowVault(true)} />
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
            <Topbar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} onOpenVault={() => setShowVault(true)} />
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
            onOpenVault={() => setShowVault(true)}
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
              onOpenDownloads={() => setShowDownloads(true)}
              onSelectApp={handleSetActiveApp}
              onFlyPageMenu={(e, page) => {
                e.preventDefault();
                setFlyMenu({ x: e.clientX, y: e.clientY, page });
              }}
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
          className="relative flex-1 flex flex-col min-w-0 transition-[margin-left] duration-300"
          style={{ marginLeft: sidebarOffset }}
        >
          {/* Glisser une app ou un lien libre de la barre latérale vers un
              bord : écran partagé (voir SplitDropOverlay). */}
          <SplitDropOverlay
            enabled={!appLocked && !overlayOpen}
            splitActive={Boolean(activeSplit)}
            onDrop={handleSplitDrop}
          />

          {/* Voile d'animation (changement d'app / de profil). Il reste
              AU-DESSUS des webviews mais ne capte aucun clic. */}
          {viewAnim > 0 && animStyle !== 'none' && (
            <div
              key={viewAnim}
              aria-hidden="true"
              className={`orbit-view-anim orbit-view-${
                ['fade', 'slide', 'zoom', 'flip', 'iris', 'curtain', 'glow'].includes(animStyle) ? animStyle : 'fade'
              }`}
            />
          )}

          {/* Changement de profil : carte 3D + pastille « où suis-je ». */}
          <ProfileTransition />

          {/* Apps embarquées : un <webview> par app, reste vivant en arrière-plan.
              Écran partagé :
                • 2 apps → côte à côte (row) ou haut/bas (col), séparateur AJUSTABLE
                • 3-4 apps → grille 2×2 (les webviews restent responsives) */}
          <div
            ref={splitContainerRef}
            className={`flex-1 relative bg-bg-secondary overflow-hidden ${
              activeSplit && activeSplit.appIds.length >= 3
                ? 'grid gap-0.5 bg-border'
                : activeSplit
                  ? `flex ${activeSplit.direction === 'col' ? 'flex-col' : 'flex-row'}`
                  : ''
            }`}
            style={{
              // …sauf quand c'est la page d'accueil qui occupe la zone : elle
              // n'a aucune webview à peindre, et la masquer ferait disparaître
              // le fond d'écran derrière la palette de recherche. Les webviews
              // montées mais inactives se masquent déjà elles-mêmes (voir
              // WebView.jsx).
              visibility: (overlayOpen || phoneOpen) && !showHome ? 'hidden' : 'visible',
              ...(splitLayout
                ? {
                    gridTemplateColumns: gridCols.map((f) => `${f}fr`).join(' '),
                    gridTemplateRows: gridRows.map((f) => `${f}fr`).join(' '),
                    gridTemplateAreas: splitLayout.areas,
                  }
                : {}),
            }}
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
                  // Les panneaux sont rendus dans l'ordre du STORE (liveApps), pas
                  // de appIds : on force donc l'ordre visuel avec CSS `order` (idx
                  // = position dans le partage) → réordonner appIds déplace bien
                  // les panneaux. Le séparateur s'intercale à order impair.
                  const paneStyle = !inSplit
                    ? { display: 'contents' }
                    : gridMode
                      ? // Grille pilotée par le gabarit : chaque panneau occupe sa
                        // zone (a, b, c, d) selon son index dans le partage.
                        { gridArea: splitLayout ? areaLetter(idx) : undefined }
                      : {
                          // 2 apps : flex redimensionnable ; `order` fait suivre
                          // l'ordre visuel à appIds (échange des côtés possible).
                          order: idx * 2,
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
                          style={{
                            order: idx * 2 - 1,
                            ...(activeSplit.direction === 'row'
                              ? { width: 6, cursor: 'col-resize' }
                              : { height: 6, cursor: 'row-resize' }),
                          }}
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
                        {/* Document texte (page volante .md, .json, .csv…) :
                            c'est la VISIONNEUSE d'Orbit qui l'affiche. Un
                            <webview> resterait blanc — le moteur n'a aucun
                            rendu pour ces formats et, selon le Content-Type
                            du serveur, en fait même un téléchargement. */}
                        {isViewerKind(a.kind) ? (
                          <Suspense fallback={null}>
                            <DocumentViewer
                              app={a}
                              visible={inSplit || (inActive && a.id === activeApp)}
                              flexLayout={inSplit}
                            />
                          </Suspense>
                        ) : (
                          <WebView
                            app={a}
                            active={inActive && a.id === activeApp}
                            visible={inSplit || (inActive && a.id === activeApp)}
                            flexLayout={inSplit}
                          />
                        )}
                      </div>
                    </Fragment>
                  );
                })}


                {/* Séparateurs ajustables de la grille (3-4 apps) : un par
                    frontière de piste définie dans le gabarit. */}
                {splitLayout &&
                  (splitLayout.dividers || []).map((d, k) => {
                    const tracks = d.axis === 'col' ? gridCols : gridRows;
                    const sum = tracks.reduce((s, v) => s + v, 0) || 1;
                    const pct = `${(tracks.slice(0, d.at).reduce((s, v) => s + v, 0) / sum) * 100}%`;
                    const isCol = d.axis === 'col';
                    return (
                      <div
                        key={`${d.axis}-${d.at}-${k}`}
                        onMouseDown={startGridDrag(d.axis, d.at)}
                        className={`absolute z-20 transition-colors ${
                          splitDragging ? 'bg-accent-primary/70' : 'bg-border hover:bg-accent-primary/40'
                        }`}
                        style={
                          isCol
                            ? { top: 0, bottom: 0, left: `calc(${pct} - 3px)`, width: 6, cursor: 'col-resize' }
                            : { left: 0, right: 0, top: `calc(${pct} - 3px)`, height: 6, cursor: 'row-resize' }
                        }
                      />
                    );
                  })}

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

            {/* Page d'accueil : superposée quand le profil actif n'a aucune app
                ouverte. Rendu par-dessus les webviews (qui restent montés pour
                les autres profils) plutôt qu'à leur place → pas de démontage. */}
            {showHome && (
              <HomeDashboard
                apps={profileApps}
                onSelectApp={handleSetActiveApp}
                onOpenSearch={() => setShowQuickSwitcher(true)}
                onOpenStore={() => setShowAppStore(true)}
                onOpenSettings={() => setShowSettings(true)}
              />
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
          <Suspense fallback={null}>
            <PhoneOverlay />
          </Suspense>
          <Suspense fallback={null}>
            <DevToolsOverlay />
          </Suspense>
        </div>
      </div>

      {/* Barre du bas (optionnelle) — masquée en plein écran */}
      {!isFullscreen && settings.bottombarEnabled && !hideBottom && (
        <Bottombar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} onOpenVault={() => setShowVault(true)} />
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
            <Bottombar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} onOpenVault={() => setShowVault(true)} />
          </div>
        </>
      )}

      {/* Overlays — au-dessus des webviews car ils sont dans le DOM */}
      {showQuickSwitcher && (
        <QuickSwitcher
          initialQuery={quickSwitcherQuery}
          onClose={() => {
            setShowQuickSwitcher(false);
            setQuickSwitcherQuery('');
          }}
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
      {phoneEnabled && (
        <Suspense fallback={null}>
          <PhoneFloatingAccess />
        </Suspense>
      )}
      <ScreenshotPreview />
      <Suspense fallback={null}>
        {showStudio && <RecordingStudio onClose={() => setShowStudio(false)} />}
        {/* La relecture hors ligne ne se monte vraiment qu'au premier appel :
            le composant s'affiche sinon sans rien faire. */}
        <OfflineProofreader />
      </Suspense>
      <AssistantHost />

      {/* Questions posées par les apps : alert/confirm/prompt et demandes
          d'autorisation (caméra, micro, position…) */}
      <WebDialogHost />

      {/* Repli `null` : ces écrans s'ouvrent déjà avec une animation d'entrée,
          et le chargement est local (quelques millisecondes) — afficher un
          indicateur ferait clignoter l'interface plus qu'il n'informerait. */}
      <Suspense fallback={null}>
        {showDownloads && <DownloadsPage onClose={() => setShowDownloads(false)} />}
        {showSettings && <Settings onClose={() => setShowSettings(false)} />}
        {showProfileManager && <ProfileManager onClose={() => setShowProfileManager(false)} />}
        {showAppStore && (
          <AppStore
            onClose={() => {
              setShowAppStore(false);
              setStorePrefill(null);
            }}
            prefill={storePrefill}
          />
        )}
      </Suspense>

      {/* Menu contextuel d'une page volante */}
      {flyMenu && (
        <>
          {/* Voile : un clic n'importe où referme le menu. Même étage que le
              menu des apps (AppContextMenu, z-9999) : à z-70, la barre latérale
              révélée en masquage auto (z-650) passait PAR-DESSUS le menu. */}
          <div
            className="fixed inset-0 z-[9998]"
            onClick={() => setFlyMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setFlyMenu(null);
            }}
          />
          <div
            className="fixed z-[9999] min-w-52 bg-bg-elevated border border-border rounded-xl shadow-2xl py-1 text-sm"
            // Les pages volantes vivent en BAS de la barre latérale : le menu
            // s'ouvre vers le haut dans la moitié basse de l'écran, plutôt que
            // de déborder sous la barre du bas (l'ancien plafond fixe de 160 px
            // était plus petit que le menu lui-même).
            style={{
              left: Math.min(flyMenu.x, window.innerWidth - 220),
              ...(flyMenu.y > window.innerHeight / 2
                ? { bottom: Math.max(8, window.innerHeight - flyMenu.y) }
                : { top: flyMenu.y }),
            }}
          >
            <button
              className="w-full text-left px-3 py-2 hover:bg-bg-hover flex items-center gap-2"
              onClick={() => {
                // Promotion en vraie app : on ouvre le formulaire d'app
                // personnalisée pré-rempli (nom, URL, favicon récupérés de la
                // page) plutôt que de créer l'app en aveugle — l'utilisateur
                // garde la main sur le profil, l'icône et la couleur.
                setStorePrefill({
                  url: flyMenu.page.url,
                  name: flyMenu.page.title || flyMenu.page.name,
                  favicon: flyMenu.page.favicon,
                  flyPageId: flyMenu.page.id,
                });
                setShowAppStore(true);
                setFlyMenu(null);
              }}
            >
              <Plus size={14} /> {t('fly.addAsApp')}
            </button>
            {/* Modifier l'adresse : une faute de frappe sur une URL libre
                ne devrait pas obliger à fermer la page et la rouvrir. */}
            <button
              className="w-full text-left px-3 py-2 hover:bg-bg-hover flex items-center gap-2"
              onClick={() => {
                openEditUrl(flyMenu.page.id);
                setFlyMenu(null);
              }}
            >
              <Globe size={14} /> {t('fly.editUrl')}
            </button>
            <button
              className="w-full text-left px-3 py-2 hover:bg-bg-hover flex items-center gap-2"
              onClick={() => {
                navigator.clipboard?.writeText(flyMenu.page.url);
                setFlyMenu(null);
              }}
            >
              <Copy size={14} /> {t('fly.copyUrl')}
            </button>
            {/* Repartir de zéro sur la même adresse : nouvelle page privée, la
                page actuelle reste ouverte telle quelle. */}
            {!flyMenu.page.private && (
              <button
                className="w-full text-left px-3 py-2 hover:bg-bg-hover flex items-center gap-2"
                onClick={() => {
                  useStore.getState().openFlyPage(flyMenu.page.url, { private: true });
                  setFlyMenu(null);
                }}
              >
                <EyeOff size={14} /> {t('fly.openPrivate')}
              </button>
            )}
            <button
              className="w-full text-left px-3 py-2 hover:bg-bg-hover flex items-center gap-2"
              onClick={() => {
                window.open(flyMenu.page.url, '_blank');
                setFlyMenu(null);
              }}
            >
              <ExternalLink size={14} /> {t('fly.openExternal')}
            </button>
            <div className="my-1 border-t border-border" />
            <button
              className="w-full text-left px-3 py-2 hover:bg-error/10 text-error flex items-center gap-2"
              onClick={() => {
                closeFlyPage(flyMenu.page.id);
                setFlyMenu(null);
              }}
            >
              <X size={14} /> {t('fly.close')}
            </button>
          </div>
        </>
      )}

      {/* Coffre-fort de mots de passe en overlay (bouton « trousseau » de la barre) */}
      {linkPeek && (
        <LinkPeek
          key={linkPeek.key}
          peek={linkPeek}
          onClose={() => setLinkPeek(null)}
          // Un lien venu d'une page PRIVÉE reste privé : jamais d'historique,
          // jamais la session d'une page normale.
          onOpenInOrbit={(url) => {
            setLinkPeek(null);
            usePhoneStore.getState().setOpen(false);
            useStore.getState().openFlyPage(url, { private: isPrivatePeek(linkPeek) });
          }}
          onOpenSplit={(url) => {
            setLinkPeek(null);
            usePhoneStore.getState().setOpen(false);
            openBesideActive(url, { private: isPrivatePeek(linkPeek) });
          }}
        />
      )}

      {editUrlFor && (
        <EditUrlDialog
          initialUrl={editUrlFor.url}
          onClose={() => setEditUrlFor(null)}
          onSubmit={(url) => {
            // Sans page cible (Alt+T) : nouvelle page volante.
            if (editUrlFor.id) navigateToUrl(editUrlFor.id, url);
            else useStore.getState().openFlyPage(url);
            setEditUrlFor(null);
          }}
        />
      )}

      {showVault && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center animate-fade-in p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowVault(false);
          }}
        >
          <div className="w-full max-w-3xl h-[85vh] bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in">
            <div className="h-14 border-b border-border flex items-center justify-between px-5 flex-shrink-0">
              <div className="flex items-center gap-2">
                <KeyRound size={18} className="text-accent-primary" />
                <h2 className="font-semibold">{t('tb.vaultTitle')}</h2>
              </div>
              <button onClick={() => setShowVault(false)} className="btn-icon" title={t('common.close')}>
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <Suspense fallback={null}>
                <PasswordVault />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* Verrou global : plein écran au lancement, par-dessus TOUT (topbar,
          sidebar, webviews). Aucune app n'est montée tant que non déverrouillé. */}
      {appLocked && (
        <LockScreen variant="app" onSubmit={handleUnlockApp} />
      )}

      {/* Mise à jour automatique */}
      {/* Pendant le redimensionnement de l'écran partagé : voile transparent
          plein écran AU-DESSUS des webviews. Sans lui, dès que le curseur passe
          sur un webview, celui-ci capte la souris → le mousemove/mouseup ne
          remontent plus à la fenêtre → le drag « colle » (la taille suit la
          souris même après avoir lâché). Le voile capte la souris à sa place. */}
      {splitDragging && (
        <div
          className="fixed inset-0 z-[9999]"
          style={{ cursor: dragAxis === 'row' ? 'row-resize' : 'col-resize' }}
        />
      )}

      <UpdateBanner />

      {/* Bienvenue au tout premier lancement */}
      {!onboarded && !appLocked && (
        <Welcome onClose={() => setOnboarded(true)} onOpenStore={() => setShowAppStore(true)} />
      )}
    </div>
  );
}
