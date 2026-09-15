import { Fragment, useCallback, useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Pin,
  PinOff,
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
  KeyRound,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useStore, appVisibleIn } from '../../stores/useStore';
import { useT } from '../../lib/i18n';
import { useZoneHold } from '../../lib/autoHide';
import { useGuestDismiss } from '../../lib/useDismiss';
import { useLoadingStore } from '../../lib/loadingStore';
import { getWebview, reloadApp } from '../../lib/webviewRegistry';
import { appPartition } from '../../lib/session';
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

// Icône d'une ligne de la liste repliée des extensions (pastille/options).
function ExtPopoverIcon({ ext }) {
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
    <div className="w-6 h-6 rounded-md bg-bg-elevated border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
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
        <Puzzle size={12} className="text-text-muted" />
      )}
    </div>
  );
}

// Logique partagée des modules de barre (en-tête ET barre du bas) : état des
// menus, actions de navigation, et rendu d'un module par son id. La disposition
// (quels modules, dans quelle zone, dans quel ordre) vient des paramètres —
// voir src/lib/topbarLayout.js et Paramètres → Apparence.
//
// `placement` : 'top' (menus sous la barre) ou 'bottom' (menus au-dessus).
export function useTopbarModules({ onOpenQuickSwitcher, onOpenVault, placement = 'top' }) {
  const {
    activeApp,
    activeProfile,
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
  const [showExtsPopover, setShowExtsPopover] = useState(false);
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const splitMenuRef = useRef(null);
  const [showWsMenu, setShowWsMenu] = useState(false);
  const wsMenuRef = useRef(null);
  const [wsSaving, setWsSaving] = useState(false);
  const [wsName, setWsName] = useState('');
  // État du coffre : au moins un trousseau ouvert ? (pour la pastille du bouton)
  const [vaultLocked, setVaultLocked] = useState(true);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const st = await window.electronAPI?.vault?.state?.();
        const list = st?.vaults || [];
        if (alive) setVaultLocked(!list.some((v) => v.unlocked));
      } catch {
        /* ignore */
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  // Mode épuré : chacun de ces panneaux garde sa barre ouverte tant qu'il est
  // déplié. Sans ça, écarter la souris pour lire une notification refermerait
  // la barre — et le panneau avec elle.
  useZoneHold(placement, 'notifications', showNotifPanel);
  useZoneHold(placement, 'extensions', Boolean(extMenu) || showExtsPopover);
  useZoneHold(placement, 'split', showSplitMenu);
  useZoneHold(placement, 'workspaces', showWsMenu);

  const app = apps.find((a) => a.id === activeApp);

  // Partition de l'app active : la page d'options des extensions doit tourner
  // dans CETTE partition pour que leur chrome.storage soit partagé avec les
  // content scripts injectés dans l'app (sinon les réglages ne s'appliquent pas).
  const profiles = useStore.getState().profiles;
  const activeAppPartition = app
    ? appPartition(app, !!profiles.find((p) => p.id === app.profileId)?.sharedSession)
    : undefined;

  // Position verticale des menus déroulants selon que la barre est en haut ou en bas
  const menuPos = placement === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2';
  // Alignement horizontal : un module de la zone GAUCHE ouvre son menu vers la
  // droite (aligné à gauche), sinon le menu déborderait hors de la fenêtre.
  const alignFor = (zone) => (zone === 'left' ? 'left-0' : 'right-0');

  // Candidats à l'écran partagé : toutes les apps ATTEIGNABLES depuis le profil
  // courant — ce qui inclut les apps de portée « tous les profils ». (Avant, le
  // filtre strict par profil d'origine les excluait, et une app « tous profils »
  // n'entraînait que les apps de son profil d'origine.)
  const splitPartners = app
    ? apps.filter((a) => a.id !== app.id && !a.sleeping && appVisibleIn(a, activeProfile))
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

  // Déplace une app dans l'ordre du partage (choisir sa position : gauche/droite,
  // haut/bas, ou sa place dans la grille). Réordonne aussi les tailles.
  const moveSplitApp = (appId, dir) => {
    if (!splitView) return;
    const ids = [...splitView.appIds];
    const i = ids.indexOf(appId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    let sizes = splitView.sizes;
    if (Array.isArray(sizes) && sizes.length === ids.length) {
      sizes = [...sizes];
      [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
    }
    setSplitView({ ...splitView, appIds: ids, ...(sizes ? { sizes } : {}) });
  };

  // Extensions activées → affichées dans la barre
  const enabledExtensions = extensions.filter((e) => e.enabled);

  // Extensions « épinglées » (gardées en icônes directes dans la barre). Les
  // autres se replient derrière la pastille 🧩 pour économiser la place.
  const pinnedExt = new Set(Object.keys(settings.pinnedExtensions || {}));
  const pinnedExts = enabledExtensions.filter((e) => pinnedExt.has(e.id));
  const hiddenExts = enabledExtensions.filter((e) => !pinnedExt.has(e.id));
  const togglePinnedExt = (id) => {
    const next = { ...(settings.pinnedExtensions || {}) };
    if (next[id]) delete next[id];
    else next[id] = true;
    updateSettings({ pinnedExtensions: next });
  };

  // Ouvre le menu d'une extension (icône épinglée ou ligne du menu replié),
  // en récupérant ses infos (icône, page d'options) à la volée pour que le
  // bouton « Options » soit là où il faut.
  const openExtMenu = (ext) => {
    setShowExtsPopover(false);
    setExtMenu({ ext, info: null });
    const p = window.electronAPI?.getExtensionInfo?.({ id: ext.id, path: ext.path });
    if (p && typeof p.then === 'function') {
      p.then((res) => {
        if (res?.success && res.info) {
          setExtMenu((cur) => (cur?.ext.id === ext.id ? { ext, info: res.info } : cur));
        }
      }).catch(() => {});
    }
  };

  // Fermer les menus (extension + partage) en cliquant à l'extérieur
  useEffect(() => {
    const onClick = (e) => {
      if (extMenuRef.current && !extMenuRef.current.contains(e.target)) {
        setExtMenu(null);
        setShowExtsPopover(false);
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
    // 'mousedown' en capture, comme partout ailleurs : un 'click' se déclenche
    // après que React ait pu retirer la cible du DOM, et fermait le menu à tort.
    window.addEventListener('mousedown', onClick, true);
    return () => window.removeEventListener('mousedown', onClick, true);
  }, []);

  // Un clic dans une app embarquée ne traverse pas la frontière de processus :
  // ces menus ne pouvaient pas savoir qu'on avait cliqué ailleurs.
  const closeMenus = useCallback(() => {
    setExtMenu(null);
    setShowExtsPopover(false);
    setShowSplitMenu(false);
    setShowWsMenu(false);
    setShowNotifPanel(false);
  }, []);
  useGuestDismiss(
    Boolean(extMenu) || showSplitMenu || showWsMenu || showNotifPanel,
    closeMenus
  );

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
    window.addEventListener('mousedown', onClick, true);
    return () => window.removeEventListener('mousedown', onClick, true);
  }, []);

  // L'app active est-elle en train de charger ? (bouton Actualiser qui tourne)
  const isLoading = useLoadingStore((s) => !!s.loadingApps[activeApp]);

  const handleBack = () => getWebview(activeApp)?.goBack();
  const handleForward = () => getWebview(activeApp)?.goForward();
  // Logique partagée avec le raccourci Ctrl+R (voir webviewRegistry.reloadApp) :
  // on ne recharge jamais une URL portant un jeton éphémère (CSRF Roundcube,
  // code OAuth…) — périmé, il donnerait « Invalid request » / page blanche.
  const handleReload = () => reloadApp(activeApp, app?.url);

  const toggleFavorite = () => {
    if (app) {
      updateApp(activeApp, { isFavorite: !app.isFavorite });
    }
  };

  // ---------------------------------------------------------------------
  // Rendu d'un module de barre par son id.
  // ---------------------------------------------------------------------
  const renderModule = (id, key, zone = 'right') => {
    const menuAlign = alignFor(zone);
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
                  {/* Extensions épinglées : icônes directes dans la barre */}
                  {pinnedExts.map((ext) => (
                    <ExtensionIcon
                      key={ext.id}
                      ext={ext}
                      onOpenMenu={openExtMenu}
                    />
                  ))}

                  {/* Pastille « repli » : une seule icône, au clic elle déplie
                      la liste des extensions non épinglées (le barre garde ainsi
                      de la place quand on a beaucoup d'extensions). */}
                  <button
                    onClick={() => {
                      setShowExtsPopover((v) => !v);
                      setExtMenu(null);
                    }}
                    className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                      showExtsPopover ? 'bg-bg-hover' : 'hover:bg-bg-hover'
                    }`}
                    title={t('tb.extsTitle')}
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-md border border-border bg-bg-elevated">
                      <Puzzle size={14} className="text-text-muted" />
                    </div>
                    {hiddenExts.length > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-accent-primary text-white text-[10px] font-bold flex items-center justify-center border border-bg-primary">
                        {hiddenExts.length > 9 ? '9+' : hiddenExts.length}
                      </span>
                    )}
                  </button>

                  {/* Popover : toutes les extensions, les épinglées en premier.
                      Chaque ligne : icône, nom, épingler/détacher + actions. */}
                  {showExtsPopover && (
                    <div
                      className={`absolute ${menuAlign} ${menuPos} w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}
                    >
                      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                        <span className="font-semibold text-sm">{t('tbm.extensions')}</span>
                        <span className="text-[11px] text-text-muted">
                          {enabledExtensions.length}
                        </span>
                      </div>
                      <div className="py-1 max-h-72 overflow-y-auto">
                        {enabledExtensions.length === 0 && (
                          <div className="px-4 py-3 text-xs text-text-muted">
                            {t('ex.none')}
                          </div>
                        )}
                        {enabledExtensions.map((ext) => (
                          <div
                            key={ext.id}
                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-bg-hover transition-colors group"
                          >
                            <button
                              onClick={() => openExtMenu(ext)}
                              className="flex-1 flex items-center gap-3 px-2 py-1 text-sm text-left truncate"
                            >
                              <ExtPopoverIcon ext={ext} />
                              <span className="flex-1 truncate">{ext.name}</span>
                            </button>
                            <button
                              onClick={() =>
                                togglePinnedExt(ext.id)
                              }
                              className={`btn-icon w-7 h-7 ${
                                pinnedExt.has(ext.id)
                                  ? 'text-accent-primary'
                                  : 'opacity-0 group-hover:opacity-100'
                              }`}
                              title={
                                pinnedExt.has(ext.id)
                                  ? t('tb.extUnpin')
                                  : t('tb.extPin')
                              }
                            >
                              {pinnedExt.has(ext.id) ? <Pin size={14} /> : <PinOff size={14} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Menu de l'extension cliquée (icône épinglée ou ligne du
                      popover) : ancré au conteneur relatif de la barre. */}
                  {extMenu && (
                    <div className={`absolute ${menuAlign} ${menuPos} w-56 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
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
                                partition: activeAppPartition,
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
                  <div className={`absolute ${menuAlign} ${menuPos} w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
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
                    {/* Ordre / position des panneaux (façon Windows 11) */}
                    {splitView && splitView.appIds.length >= 2 && (
                      <div className="border-t border-border py-1.5">
                        <div className="px-4 pb-1 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                          {t('tb.splitOrder')}
                        </div>
                        {splitView.appIds.map((id, i) => {
                          const a = apps.find((x) => x.id === id);
                          if (!a) return null;
                          return (
                            <div key={id} className="flex items-center gap-2 px-3 py-1">
                              <span className="w-3 text-[11px] text-text-muted tabular-nums">{i + 1}</span>
                              <div
                                className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: `${a.color}20` }}
                              >
                                <AppIcon app={a} className="w-3.5 h-3.5 rounded" fallbackClassName="text-xs" />
                              </div>
                              <span className="flex-1 text-sm truncate">{a.name}</span>
                              <button
                                onClick={() => moveSplitApp(id, -1)}
                                disabled={i === 0}
                                className="btn-icon w-6 h-6 disabled:opacity-25"
                                title={t('tb.moveBefore')}
                              >
                                <ChevronLeft size={14} />
                              </button>
                              <button
                                onClick={() => moveSplitApp(id, 1)}
                                disabled={i === splitView.appIds.length - 1}
                                className="btn-icon w-6 h-6 disabled:opacity-25"
                                title={t('tb.moveAfter')}
                              >
                                <ChevronRight size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
                  className={`absolute ${menuAlign} ${menuPos} w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}
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
                className={`btn-icon ${app?.isFavorite ? 'text-accent-primary' : ''}`}
                title={app?.isFavorite ? t('tb.favRemove') : t('tb.favAdd')}
              >
                {/* Épingle plutôt qu'étoile : le geste remonte l'app en haut de
                    la barre latérale — une étoile laissait attendre une simple
                    marque décorative. */}
                {app?.isFavorite ? <PinOff size={18} /> : <Pin size={18} />}
              </button>
            )}
          </Fragment>
        );
      case 'vault':
        return (
          <Fragment key={key}>
            <button
              onClick={() => onOpenVault?.()}
              className="btn-icon relative"
              title={t('tb.vaultTitle')}
            >
              <KeyRound size={18} />
              {/* Pastille : verte = un trousseau est ouvert, grise = tout verrouillé */}
              <span
                className={`absolute bottom-1 right-1 w-2 h-2 rounded-full border border-bg-primary ${
                  vaultLocked ? 'bg-text-muted' : 'bg-emerald-500'
                }`}
              />
            </button>
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
            <Downloads placement={placement} align={menuAlign} />
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
                <div className={`absolute ${menuAlign} ${menuPos} w-80 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in`}>
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
        return <ClockWidget key={key} placement={placement} align={menuAlign} />;
      case 'weather':
        return <WeatherWidget key={key} placement={placement} align={menuAlign} />;
      case 'battery':
        return <BatteryWidget key={key} />;
      case 'focus':
        return <FocusTimer key={key} placement={placement} align={menuAlign} />;
      case 'system':
        return <SystemWidget key={key} />;
      case 'profile':
        return <ProfileWidget key={key} placement={placement} align={menuAlign} />;
      case 'divider':
        return <div key={key} className="w-px h-5 bg-border flex-shrink-0" />;
      default:
        return null;
    }
  };

  return renderModule;
}
