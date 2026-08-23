import { Fragment, useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Star,
  Bell,
  Search,
  CheckCheck,
  Puzzle,
  Settings2,
  Power,
  ZoomIn,
  ZoomOut,
  Columns2,
  Rows2,
  Unplug,
  Moon,
  LayoutGrid,
  Plus,
  Trash2,
} from 'lucide-react';
import { useStore } from '../../stores/useStore';
import { useT } from '../../lib/i18n';
import { useLoadingStore } from '../../lib/loadingStore';
import { reloadUrlFor } from '../../lib/urls';
import { getWebview } from '../../lib/webviewRegistry';
import OrbitLogo from '../OrbitLogo';
import AppIcon from '../AppIcon';
import Downloads from '../Downloads';
import NowPlaying from '../NowPlaying';
import ClockWidget from './ClockWidget';
import WeatherWidget from './WeatherWidget';
import BatteryWidget from './BatteryWidget';
import FocusTimer from './FocusTimer';
import SystemWidget from './SystemWidget';
import ProfileWidget from './ProfileWidget';

// Icône d'une extension dans une barre (comme la barre d'extensions d'un
// navigateur). Les infos (nom, icône, page d'options) sont chargées une fois
// via le main process.
function ExtensionIcon({ ext, onOpenMenu }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let mounted = true;
    const p = window.electronAPI?.getExtensionInfo?.({ id: ext.id, path: ext.path });
    if (p && typeof p.then === 'function') {
      p.then((res) => {
        if (mounted && res?.success) setInfo(res.info);
      }).catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [ext.id, ext.path]);

  return (
    <button
      onClick={() => onOpenMenu(ext, info)}
      className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors hover:bg-bg-hover"
      title={info?.name || ext.name}
    >
      {info?.iconUrl ? (
        <img
          src={info.iconUrl}
          alt=""
          className="w-4 h-4 object-contain"
          draggable={false}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <Puzzle size={16} className="text-text-muted" />
      )}
    </button>
  );
}

// Logique partagée des modules de barre (en-tête ET barre du bas) : état des
// menus, actions de navigation, et rendu d'un module par son id. La disposition
// (quels modules, dans quelle zone, dans quel ordre) vient des paramètres —
// voir src/lib/topbarLayout.js et Paramètres → Apparence.
//
// `placement` : 'top' (menus sous la barre) ou 'bottom' (menus au-dessus).
export function useTopbarModules({ onOpenQuickSwitcher, placement = 'top' }) {
  const {
    activeApp,
    apps,
    extensions,
    updateExtensions,
    updateApp,
    setActiveApp,
    setActiveProfile,
    markAllRead,
    settings,
    updateSettings,
    adjustAppZoom,
    resetAppZoom,
    splitView,
    setSplitView,
    clearSplitView,
    toggleSplitDirection,
    workspaces,
    saveWorkspace,
    applyWorkspace,
    deleteWorkspace,
  } = useStore();
  const t = useT();
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef(null);
  const [extMenu, setExtMenu] = useState(null); // { ext, info } | null
  const extMenuRef = useRef(null);
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const splitMenuRef = useRef(null);
  const [showWsMenu, setShowWsMenu] = useState(false);
  const wsMenuRef = useRef(null);
  const [wsSaving, setWsSaving] = useState(false);
  const [wsName, setWsName] = useState('');
  const app = apps.find((a) => a.id === activeApp);

  // Position des menus déroulants selon que la barre est en haut ou en bas
  const menuPos = placement === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2';

  // Apps du même profil que l'app active (candidats à l'écran partagé)
  const splitPartners = app
    ? apps.filter((a) => a.profileId === app.profileId && a.id !== app.id && !a.sleeping)
    : [];
  const splitActive = splitView && splitView.appIds.includes(activeApp);

  // Ajoute/retire une app du partage (2 à 4 apps max ; l'app active est l'ancre)
  const toggleSplitPartner = (partner) => {
    if (!splitView) {
      setSplitView({
        appIds: [activeApp, partner.id],
        direction: 'row',
        sizes: [0.5, 0.5],
      });
      setShowSplitMenu(false);
      return;
    }
    let appIds = [...splitView.appIds];
    // Si l'app active n'est pas dans le partage, elle devient l'ancre
    if (!appIds.includes(activeApp)) {
      if (appIds.length >= 4) appIds.pop();
      appIds.unshift(activeApp);
    }
    if (appIds.includes(partner.id)) {
      appIds = appIds.filter((id) => id !== partner.id);
      if (appIds.length < 2) {
        clearSplitView();
        setShowSplitMenu(false);
        return;
      }
    } else {
      if (appIds.length >= 4) appIds.pop();
      appIds.push(partner.id);
    }
    setSplitView({ ...splitView, appIds });
    setShowSplitMenu(false);
  };

  // Extensions activées → affichées dans la barre
  const enabledExtensions = extensions.filter((e) => e.enabled);

  // Fermer les menus (extension + partage) en cliquant à l'extérieur
  useEffect(() => {
    const onClick = (e) => {
      if (extMenuRef.current && !extMenuRef.current.contains(e.target)) {
        setExtMenu(null);
      }
      if (splitMenuRef.current && !splitMenuRef.current.contains(e.target)) {
        setShowSplitMenu(false);
      }
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target)) {
        setShowWsMenu(false);
        setWsSaving(false);
        setWsName('');
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  // Apps avec des messages non lus (tous profils confondus)
  const unreadApps = apps
    .filter((a) => a.unread > 0 && !a.sleeping)
    .sort((a, b) => b.unread - a.unread);
  const totalUnread = unreadApps.reduce((sum, a) => sum + a.unread, 0);

  // Fermer le panneau en cliquant à l'extérieur
  useEffect(() => {
    const onClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifPanel(false);
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  // L'app active est-elle en train de charger ? (bouton Actualiser qui tourne)
  const isLoading = useLoadingStore((s) => !!s.loadingApps[activeApp]);

  const handleBack = () => getWebview(activeApp)?.goBack();
  const handleForward = () => getWebview(activeApp)?.goForward();
  const handleReload = () => {
    const wv = getWebview(activeApp);
    if (!wv) return;
    // Ne jamais recharger une URL avec un jeton éphémère (CSRF Roundcube,
    // code OAuth…) : une fois périmé → « Invalid request » = page blanche.
    // On navigue vers la version nettoyée, sinon rechargement classique.
    const clean = reloadUrlFor(app?.url);
    if (clean) {
      try {
        wv.loadURL(clean);
      } catch {
        /* ignore */
      }
    } else {
      wv.reload();
    }
  };

  const toggleFavorite = () => {
    if (app) {
      updateApp(activeApp, { isFavorite: !app.isFavorite });
    }
  };

  // ---------------------------------------------------------------------
  // Rendu d'un module de barre par son id.
  // ---------------------------------------------------------------------
  const renderModule = (id, key) => {
    switch (id) {
      case 'logo':
        return (
          <Fragment key={key}>
            <div className="flex items-center gap-2 min-w-0 app-drag">
              <OrbitLogo size={18} className="flex-shrink-0" />
              <span className="text-sm font-semibold flex-shrink-0">Orbit</span>
            </div>
          </Fragment>
        );
      case 'nav':
        return (
          <Fragment key={key}>
            <div className="flex items-center gap-1 flex-shrink-0 app-no-drag">
              <button
                onClick={handleBack}
                disabled={!activeApp}
                className="btn-icon disabled:opacity-30"
                title={t('tb.back')}
              >
                <ArrowLeft size={18} />
              </button>
              <button
                onClick={handleForward}
                disabled={!activeApp}
                className="btn-icon disabled:opacity-30"
                title={t('tb.forward')}
              >
                <ArrowRight size={18} />
              </button>
              <button
                onClick={handleReload}
                disabled={!activeApp}
                className="btn-icon disabled:opacity-30"
                title={isLoading ? t('tb.loading') : t('tb.reload')}
              >
                {/* L'icône tourne pendant tout le chargement de la page : signe
              visible que l'app recharge (comme dans un navigateur). */}
                <RotateCw size={18} className={isLoading ? 'animate-spin' : undefined} />
              </button>
            </div>
          </Fragment>
        );
      case 'appTitle':
        return (
          <Fragment key={key}>
            {app && (
              <div className="flex items-center gap-2 min-w-0 app-drag">
                <div className="w-6 h-6 rounded-md bg-bg-elevated border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <AppIcon app={app} className="w-4 h-4 rounded" fallbackClassName="text-sm" />
                </div>
                <span className="text-sm font-medium truncate max-w-[200px]">
                  {app.title || app.name}
                </span>
              </div>
            )}
          </Fragment>
        );
      case 'zoom':
        return (
          <Fragment key={key}>
            {activeApp && (
              <div className="flex items-center gap-0.5 flex-shrink-0 app-no-drag">
                <button
                  onClick={() => adjustAppZoom(activeApp, -0.1)}
                  className="btn-icon w-8 h-8"
                  title={t('tb.zoomOut')}
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  onClick={() => resetAppZoom(activeApp)}
                  className="text-xs font-medium min-w-[44px] px-1 py-1 text-center rounded hover:bg-bg-hover transition-colors"
                  title={t('tb.zoomReset')}
                >
                  {Math.round((app?.zoom || 1) * 100)}%
                </button>
                <button
                  onClick={() => adjustAppZoom(activeApp, 0.1)}
                  className="btn-icon w-8 h-8"
                  title={t('tb.zoomIn')}
                >
                  <ZoomIn size={16} />
                </button>
              </div>
            )}
          </Fragment>
        );
      case 'search':
        return (
          <Fragment key={key}>
            <button
              onClick={onOpenQuickSwitcher}
              className="w-full max-w-md h-8 px-3 bg-bg-elevated border border-border rounded-lg flex items-center gap-2.5 text-text-muted hover:border-accent-primary/50 transition-all text-sm app-no-drag"
            >
              <Search size={16} />
              <span>{t('tb.search')}</span>
            </button>
          </Fragment>
        );
      case 'extensions':
        return (
          <Fragment key={key}>
            {enabledExtensions.length > 0 && (
              <>
                <div className="relative flex items-center gap-0.5 app-no-drag" ref={extMenuRef}>
                  {enabledExtensions.map((ext) => (
                    <ExtensionIcon
                      key={ext.id}
                      ext={ext}
                      onOpenMenu={(ext, info) => setExtMenu({ ext, info })}
                    />
                  ))}

                  {/* Menu de l'extension cliquée */}
                  {extMenu && (
                    <div className={`absolute right-0 ${menuPos} w-56 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
                      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-bg-secondary border border-border flex items-center justify-center flex-shrink-0">
                          {extMenu.info?.iconUrl ? (
                            <img
                              src={extMenu.info.iconUrl}
                              alt=""
                              className="w-4 h-4 object-contain"
                              draggable={false}
                            />
                          ) : (
                            <Puzzle size={16} className="text-text-muted" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">
                            {extMenu.info?.name || extMenu.ext.name}
                          </div>
                          <div className="text-xs text-text-muted">v{extMenu.ext.version}</div>
                        </div>
                      </div>
                      <div className="py-1">
                        {extMenu.info?.hasOptions && (
                          <button
                            onClick={() => {
                              window.electronAPI?.openExtensionOptions?.({
                                id: extMenu.ext.id,
                                path: extMenu.ext.path,
                              });
                              setExtMenu(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-bg-hover transition-colors"
                          >
                            <Settings2 size={15} /> Options
                          </button>
                        )}
                        <button
                          onClick={() => {
                            updateExtensions(
                              extensions.map((e) =>
                                e.id === extMenu.ext.id ? { ...e, enabled: false } : e,
                              ),
                            );
                            setExtMenu(null);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-bg-hover transition-colors"
                        >
                          <Power size={15} /> Désactiver
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-px h-5 bg-border mx-1 flex-shrink-0"></div>
              </>
            )}
          </Fragment>
        );
      case 'split':
        return (
          <Fragment key={key}>
            {activeApp && splitPartners.length > 0 && (
              <div className="relative" ref={splitMenuRef}>
                <button
                  onClick={() => setShowSplitMenu((v) => !v)}
                  className={`btn-icon ${showSplitMenu || splitActive ? 'bg-bg-hover text-accent-primary' : ''}`}
                  title={t('tb.split')}
                >
                  <Columns2 size={18} />
                </button>

                {showSplitMenu && (
                  <div className={`absolute right-0 ${menuPos} w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <span className="font-semibold text-sm">{t('tb.split')}</span>
                      {(!splitView || splitView.appIds.length === 2) && (
                        <button
                          onClick={toggleSplitDirection}
                          className="btn-icon w-7 h-7"
                          title={
                            splitView?.direction === 'col' ? t('tb.sideBySide') : t('tb.topBottom')
                          }
                        >
                          {splitView?.direction === 'col' ? (
                            <Columns2 size={14} />
                          ) : (
                            <Rows2 size={14} />
                          )}
                        </button>
                      )}
                    </div>
                    <div className="px-4 py-2 text-xs text-text-muted border-b border-border">
                      {splitView
                        ? t('tb.splitAddRemove', { n: splitView.appIds.length })
                        : t('tb.splitChoose')}
                    </div>
                    <div className="py-1 max-h-64 overflow-y-auto">
                      {splitPartners.map((partner) => {
                        const inSplit = splitView?.appIds.includes(partner.id);
                        return (
                          <button
                            key={partner.id}
                            onClick={() => toggleSplitPartner(partner)}
                            className={`w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-bg-hover transition-colors ${
                              inSplit ? 'text-accent-primary' : ''
                            }`}
                          >
                            <div
                              className="w-6 h-6 rounded-md flex items-center justify-center text-sm flex-shrink-0"
                              style={{ backgroundColor: `${partner.color}20` }}
                            >
                              <AppIcon
                                app={partner}
                                className="w-4 h-4 rounded"
                                fallbackClassName="text-sm"
                              />
                            </div>
                            <span className="flex-1 text-left truncate">{partner.name}</span>
                            {inSplit && <span className="text-xs text-accent-primary">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    {splitActive && (
                      <div className="border-t border-border py-1">
                        <button
                          onClick={() => {
                            clearSplitView();
                            setShowSplitMenu(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-error hover:bg-error/10 transition-colors"
                        >
                          <Unplug size={15} /> {t('tb.splitExit')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Fragment>
        );
      case 'workspaces':
        return (
          <Fragment key={key}>
            <div className="relative" ref={wsMenuRef}>
              <button
                onClick={() => setShowWsMenu((v) => !v)}
                className={`btn-icon ${showWsMenu ? 'bg-bg-hover text-accent-primary' : ''}`}
                title={t('tb.workspaces')}
              >
                <LayoutGrid size={18} />
              </button>

              {showWsMenu && (
                <div
                  className={`absolute right-0 ${menuPos} w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-4 py-3 border-b border-border">
                    <div className="font-semibold text-sm">{t('tb.workspaces')}</div>
                    <p className="text-[11px] text-text-muted mt-1 leading-snug">
                      {t('tb.workspacesHelp')}
                    </p>
                  </div>
                  <div className="py-1 max-h-64 overflow-y-auto">
                    {workspaces.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-text-muted">
                        {t('tb.workspacesEmpty')}
                      </div>
                    ) : (
                      workspaces.map((ws) => (
                        <div
                          key={ws.id}
                          className="w-full flex items-center gap-2 px-2 py-1 hover:bg-bg-hover transition-colors group"
                        >
                          <button
                            onClick={() => {
                              applyWorkspace(ws.id);
                              setShowWsMenu(false);
                            }}
                            className="flex-1 flex items-center gap-3 px-2 py-1 text-sm text-left truncate"
                          >
                            <LayoutGrid size={15} className="text-text-muted flex-shrink-0" />
                            <span className="flex-1 truncate">{ws.name}</span>
                            {ws.splitView && (
                              <span className="text-[10px] text-text-muted">split</span>
                            )}
                          </button>
                          <button
                            onClick={() => deleteWorkspace(ws.id)}
                            className="btn-icon w-7 h-7 opacity-0 group-hover:opacity-100 text-error"
                            title={t('common.remove')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="border-t border-border py-1">
                    {wsSaving ? (
                      <div className="px-3 py-2">
                        <input
                          type="text"
                          value={wsName}
                          onChange={(e) => setWsName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const name = wsName.trim();
                              if (name) {
                                saveWorkspace(name);
                                setWsSaving(false);
                                setWsName('');
                                setShowWsMenu(false);
                              }
                            } else if (e.key === 'Escape') {
                              setWsSaving(false);
                              setWsName('');
                            }
                          }}
                          placeholder={t('tb.workspacePrompt')}
                          className="input text-sm"
                          autoFocus
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => {
                              const name = wsName.trim();
                              if (name) {
                                saveWorkspace(name);
                                setWsSaving(false);
                                setWsName('');
                                setShowWsMenu(false);
                              }
                            }}
                            disabled={!wsName.trim()}
                            className="flex-1 btn btn-primary btn-sm disabled:opacity-40"
                          >
                            {t('common.save')}
                          </button>
                          <button
                            onClick={() => {
                              setWsSaving(false);
                              setWsName('');
                            }}
                            className="btn btn-secondary btn-sm"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setWsName(t('tb.workspaceDefault'));
                          setWsSaving(true);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-bg-hover transition-colors"
                      >
                        <Plus size={15} /> {t('tb.saveLayout')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Fragment>
        );
      case 'favorite':
        return (
          <Fragment key={key}>
            {activeApp && (
              <button
                onClick={toggleFavorite}
                className={`btn-icon ${app?.isFavorite ? 'text-yellow-500' : ''}`}
                title={app?.isFavorite ? t('tb.favRemove') : t('tb.favAdd')}
              >
                <Star size={18} fill={app?.isFavorite ? 'currentColor' : 'none'} />
              </button>
            )}
          </Fragment>
        );
      case 'nowPlaying':
        return (
          <Fragment key={key}>
            <NowPlaying />
          </Fragment>
        );
      case 'downloads':
        return (
          <Fragment key={key}>
            <Downloads />
          </Fragment>
        );
      case 'notifications':
        return (
          <Fragment key={key}>
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifPanel((prev) => !prev)}
                className={`btn-icon relative ${showNotifPanel ? 'bg-bg-hover' : ''}`}
                title={t('tb.notifications')}
              >
                <Bell size={18} />
                {totalUnread > 0 && (
                  <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-accent-primary text-white text-[10px] font-bold flex items-center justify-center">
                    {totalUnread > 99 ? '99+' : totalUnread}
                  </span>
                )}
              </button>

              {/* Panneau de notifications */}
              {showNotifPanel && (
                <div className={`absolute right-0 ${menuPos} w-80 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{t('tb.notifications')}</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => updateSettings({ dnd: !settings.dnd })}
                        className={`text-xs flex items-center gap-1 ${
                          settings.dnd
                            ? 'text-accent-primary'
                            : 'text-text-muted hover:text-text-primary'
                        }`}
                        title={t('tb.dnd')}
                      >
                        <Moon size={13} />
                        {settings.dnd ? t('tb.dndOn') : t('tb.dnd')}
                      </button>
                      {unreadApps.length > 0 && (
                        <button
                          onClick={markAllRead}
                          className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
                        >
                          <CheckCheck size={13} />
                          {t('tb.readShort')}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto">
                    {unreadApps.length === 0 ? (
                      <div className="px-4 py-8 text-center text-text-muted text-sm">
                        <div className="text-3xl mb-2">🔕</div>
                        <p>{t('tb.noNotifications')}</p>
                      </div>
                    ) : (
                      unreadApps.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            setActiveProfile(a.profileId);
                            setActiveApp(a.id);
                            setShowNotifPanel(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left"
                        >
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                            style={{ backgroundColor: `${a.color}20` }}
                          >
                            <AppIcon app={a} className="w-5 h-5 rounded" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{a.name}</div>
                            <div className="text-xs text-text-muted truncate">
                              {a.title || a.url}
                            </div>
                          </div>
                          <span className="badge flex-shrink-0">
                            {a.unread > 99 ? '99+' : a.unread}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </Fragment>
        );
      case 'clock':
        return <ClockWidget key={key} />;
      case 'weather':
        return <WeatherWidget key={key} />;
      case 'battery':
        return <BatteryWidget key={key} />;
      case 'focus':
        return <FocusTimer key={key} />;
      case 'system':
        return <SystemWidget key={key} />;
      case 'profile':
        return <ProfileWidget key={key} />;
      case 'divider':
        return <div key={key} className="w-px h-5 bg-border flex-shrink-0" />;
      default:
        return null;
    }
  };

  return renderModule;
}
