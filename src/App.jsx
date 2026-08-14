import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Play, X, Columns2, Rows2, Plus } from 'lucide-react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import QuickSwitcher from './components/QuickSwitcher';
import Settings from './components/Settings';
import ProfileManager from './components/ProfileManager';
import AppStore from './components/AppStore';
import WebView from './components/WebView';
import { useStore } from './stores/useStore';
import { matchShortcut } from './lib/shortcuts';

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
  const {
    activeProfile,
    activeApp,
    apps,
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
  } = useStore();

  // Apps du profil actif, triées
  const profileApps = useMemo(
    () => apps.filter((a) => a.profileId === activeProfile).sort((a, b) => a.order - b.order),
    [apps, activeProfile]
  );
  const activeAppData = apps.find((a) => a.id === activeApp);

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

  // Synchroniser l'état KeePassXC (activer/désactiver l'auto-remplissage)
  useEffect(() => {
    window.electronAPI?.keepassSetEnabled?.(settings.keepass?.enabled !== false);
  }, [settings.keepass?.enabled]);

  const handleSetActiveApp = useCallback((appId) => {
    setActiveApp(appId);
  }, [setActiveApp]);

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

    // Couleur d'accent → variables CSS (accent-primary, hover, light)
    const accent = hexToRgbTriplet(settings.accentColor || '#6366f1');
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
  }, [settings]);

  // Exécute une action de raccourci (nom centralisé dans lib/shortcuts.js)
  const runShortcut = useCallback((action) => {
    if (action === 'search') return setShowQuickSwitcher((v) => !v);
    if (action === 'settings') return setShowSettings((v) => !v);
    if (action === 'store') return setShowAppStore((v) => !v);
    if (action === 'profiles') return setShowProfileManager((v) => !v);
    if (action === 'next-app' || action === 'prev-app') {
      const { activeProfile, apps: all, activeApp, setActiveApp: setAa } = useStore.getState();
      const list = all
        .filter((a) => a.profileId === activeProfile && !a.sleeping)
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
        .filter((a) => a.profileId === activeProfile && !a.sleeping)
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

  // Largeurs en rem → elles suivent la taille de police réglée
  const sidebarWidth = sidebarCollapsed ? '4rem' : '17.5rem';
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
      style={{ borderRadius: '12px' }}
    >
      {/* Barre unifiée : logo, navigation, URL, notifications + contrôles fenêtre */}
      <Topbar onOpenQuickSwitcher={() => setShowQuickSwitcher(true)} />

      {/* Layout principal */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (fixed) */}
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenStore={() => setShowAppStore(true)}
          onOpenProfileManager={() => setShowProfileManager(true)}
          onSelectApp={handleSetActiveApp}
        />

        {/* Zone principale — marge = largeur sidebar (rem) */}
        <div
          className="flex-1 flex flex-col min-w-0 transition-[margin-left] duration-300"
          style={{ marginLeft: sidebarWidth }}
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
            {hasApps ? (
              <>
                {profileApps.map((a) => {
                  const inSplit = activeSplit && activeSplit.appIds.includes(a.id);
                  const idx = inSplit ? activeSplit.appIds.indexOf(a.id) : -1;
                  const gridMode = activeSplit && activeSplit.appIds.length >= 3;
                  // Toutes les apps restent montées ; seules celles du partage
                  // sont dans des panneaux (les autres restent cachées).
                  if (!inSplit) {
                    return (
                      <WebView
                        key={a.id}
                        app={a}
                        active={a.id === activeApp}
                        visible={a.id === activeApp}
                      />
                    );
                  }
                  return (
                    <Fragment key={a.id}>
                      {/* Séparateur ajustable (2 apps seulement) */}
                      {!gridMode && idx > 0 && (
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
                      )}
                      <div
                        className={`relative min-w-0 min-h-0 bg-bg-secondary ${gridMode ? '' : 'flex'}`}
                        style={
                          gridMode
                            ? undefined
                            : { flexGrow: splitSizes ? splitSizes[idx] : 0.5, flexBasis: 0, minWidth: 0, minHeight: 0 }
                        }
                      >
                        <WebView app={a} active={a.id === activeApp} visible flexLayout />
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
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
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
          </div>
        </div>
      </div>

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
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showProfileManager && <ProfileManager onClose={() => setShowProfileManager(false)} />}
      {showAppStore && <AppStore onClose={() => setShowAppStore(false)} />}
    </div>
  );
}
