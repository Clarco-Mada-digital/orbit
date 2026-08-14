import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Star, Bell, Search, CheckCheck, Puzzle, Settings2, Power, ZoomIn, ZoomOut, Columns2, Rows2, Unplug } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useLoadingStore } from '../lib/loadingStore';
import { getWebview } from '../lib/webviewRegistry';
import OrbitLogo from './OrbitLogo';
import AppIcon from './AppIcon';
import Downloads from './Downloads';
import NowPlaying from './NowPlaying';

// Icône d'une extension dans l'en-tête (comme la barre d'extensions d'un navigateur).
// Les infos (nom, icône, page d'options) sont chargées une fois via le main process.
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

// Barre supérieure UNIFIÉE, style Station : pas de barre d'adresse — on
// n'entre jamais d'URL à la main. Logo + app active (zone de déplacement),
// navigation, et à droite notifications + contrôles de fenêtre.
export default function Topbar({ onOpenQuickSwitcher }) {
  const {
    activeApp,
    apps,
    extensions,
    updateExtensions,
    updateApp,
    setActiveApp,
    setActiveProfile,
    markAllRead,
    adjustAppZoom,
    resetAppZoom,
    splitView,
    setSplitView,
    clearSplitView,
    toggleSplitDirection,
  } = useStore();
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef(null);
  const [extMenu, setExtMenu] = useState(null); // { ext, info } | null
  const extMenuRef = useRef(null);
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const splitMenuRef = useRef(null);
  const app = apps.find((a) => a.id === activeApp);

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

  // Extensions activées → affichées dans l'en-tête
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
  const handleReload = () => getWebview(activeApp)?.reload();

  const toggleFavorite = () => {
    if (app) {
      updateApp(activeApp, { isFavorite: !app.isFavorite });
    }
  };

  return (
    <div className="h-12 bg-bg-secondary border-b border-border flex items-center gap-2 px-3 select-none flex-shrink-0 app-drag">
      {/* Logo — zone de déplacement de la fenêtre */}
      <div className="flex items-center gap-2 min-w-0">
        <OrbitLogo size={18} className="flex-shrink-0" />
        <span className="text-sm font-semibold flex-shrink-0">Orbit</span>
      </div>

      <div className="w-px h-5 bg-border flex-shrink-0"></div>

      {/* Navigation */}
      <div className="flex items-center gap-1 flex-shrink-0 app-no-drag">
        <button
          onClick={handleBack}
          disabled={!activeApp}
          className="btn-icon disabled:opacity-30"
          title="Retour"
        >
          <ArrowLeft size={18} />
        </button>
        <button
          onClick={handleForward}
          disabled={!activeApp}
          className="btn-icon disabled:opacity-30"
          title="Avancer"
        >
          <ArrowRight size={18} />
        </button>
        <button
          onClick={handleReload}
          disabled={!activeApp}
          className="btn-icon disabled:opacity-30"
          title={isLoading ? 'Chargement…' : 'Actualiser'}
        >
          {/* L'icône tourne pendant tout le chargement de la page : signe
              visible que l'app recharge (comme dans un navigateur). */}
          <RotateCw size={18} className={isLoading ? 'animate-spin' : undefined} />
        </button>
      </div>

      {/* App active : icône + nom (comme Station) — zone de déplacement */}
      {app && (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-bg-elevated border border-border flex items-center justify-center flex-shrink-0 overflow-hidden">
            <AppIcon app={app} className="w-4 h-4 rounded" fallbackClassName="text-sm" />
          </div>
          <span className="text-sm font-medium truncate max-w-[200px]">
            {app.title || app.name}
          </span>
        </div>
      )}

      {/* Zoom de l'app active — mémorisé par app */}
      {activeApp && (
        <div className="flex items-center gap-0.5 flex-shrink-0 app-no-drag">
          <button
            onClick={() => adjustAppZoom(activeApp, -0.1)}
            className="btn-icon w-8 h-8"
            title="Zoom arrière (Alt − / ⌘ −)"
          >
            <ZoomOut size={16} />
          </button>
          <button
            onClick={() => resetAppZoom(activeApp)}
            className="text-xs font-medium min-w-[44px] px-1 py-1 text-center rounded hover:bg-bg-hover transition-colors"
            title="Réinitialiser le zoom (Alt 0 / ⌘ 0)"
          >
            {Math.round((app?.zoom || 1) * 100)}%
          </button>
          <button
            onClick={() => adjustAppZoom(activeApp, 0.1)}
            className="btn-icon w-8 h-8"
            title="Zoom avant (Alt + / ⌘ +)"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      )}

      {/* Espace flexible — zone de déplacement ; recherche quand aucune app n'est active */}
      <div className="flex-1 min-w-0 app-no-drag">
        {!activeApp && (
          <button
            onClick={onOpenQuickSwitcher}
            className="w-full max-w-md mx-auto h-9 px-4 bg-bg-elevated border border-border rounded-lg flex items-center gap-3 text-text-muted hover:border-accent-primary/50 transition-all text-sm"
          >
            <Search size={18} />
            <span>Rechercher des apps, onglets, actions... ⌘K</span>
          </button>
        )}
      </div>

      {/* Actions + contrôles de fenêtre — collés à droite */}
      <div className="flex items-center gap-1 ml-auto flex-shrink-0">
        {/* Barre d'extensions — comme un navigateur */}
        {enabledExtensions.length > 0 && (
          <>
            <div className="relative flex items-center gap-0.5 app-no-drag" ref={extMenuRef}>
              {enabledExtensions.map((ext) => (
                <ExtensionIcon key={ext.id} ext={ext} onOpenMenu={(ext, info) => setExtMenu({ ext, info })} />
              ))}

              {/* Menu de l'extension cliquée */}
              {extMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
                  <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-bg-secondary border border-border flex items-center justify-center flex-shrink-0">
                      {extMenu.info?.iconUrl ? (
                        <img src={extMenu.info.iconUrl} alt="" className="w-4 h-4 object-contain" draggable={false} />
                      ) : (
                        <Puzzle size={16} className="text-text-muted" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{extMenu.info?.name || extMenu.ext.name}</div>
                      <div className="text-xs text-text-muted">v{extMenu.ext.version}</div>
                    </div>
                  </div>
                  <div className="py-1">
                    {extMenu.info?.hasOptions && (
                      <button
                        onClick={() => {
                          window.electronAPI?.openExtensionOptions?.({ id: extMenu.ext.id, path: extMenu.ext.path });
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
                            e.id === extMenu.ext.id ? { ...e, enabled: false } : e
                          )
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

        <div className="flex items-center gap-1 app-no-drag">
          {/* Écran partagé : afficher deux apps en même temps */}
          {activeApp && splitPartners.length > 0 && (
            <div className="relative" ref={splitMenuRef}>
              <button
                onClick={() => setShowSplitMenu((v) => !v)}
                className={`btn-icon ${showSplitMenu || splitActive ? 'bg-bg-hover text-accent-primary' : ''}`}
                title="Écran partagé"
              >
                <Columns2 size={18} />
              </button>

              {showSplitMenu && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="font-semibold text-sm">Écran partagé</span>
                    {(!splitView || splitView.appIds.length === 2) && (
                      <button
                        onClick={toggleSplitDirection}
                        className="btn-icon w-7 h-7"
                        title={
                          splitView?.direction === 'col'
                            ? 'Côte à côte'
                            : 'Haut / bas'
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
                      ? `Cliquez pour ajouter ou retirer (${splitView.appIds.length}/4)`
                      : 'Choisissez une app à afficher en même temps'}
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
                            <AppIcon app={partner} className="w-4 h-4 rounded" fallbackClassName="text-sm" />
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
                        <Unplug size={15} /> Quitter le partage
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeApp && (
            <button
              onClick={toggleFavorite}
              className={`btn-icon ${app?.isFavorite ? 'text-yellow-500' : ''}`}
              title={app?.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            >
              <Star size={18} fill={app?.isFavorite ? 'currentColor' : 'none'} />
            </button>
          )}
          {/* Lecture en cours : n'apparaît que si un média joue quelque part */}
          <NowPlaying />

          {/* Téléchargements (comme un navigateur) : n'apparaît qu'en cas
              d'activité ou d'historique */}
          <Downloads />

          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setShowNotifPanel((prev) => !prev)}
              className={`btn-icon relative ${showNotifPanel ? 'bg-bg-hover' : ''}`}
              title="Notifications"
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
              <div className="absolute right-0 top-full mt-2 w-80 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="font-semibold text-sm">Notifications</span>
                  {unreadApps.length > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
                    >
                      <CheckCheck size={13} />
                      Tout marquer comme lu
                    </button>
                  )}
                </div>

                <div className="max-h-72 overflow-y-auto">
                  {unreadApps.length === 0 ? (
                    <div className="px-4 py-8 text-center text-text-muted text-sm">
                      <div className="text-3xl mb-2">🔕</div>
                      <p>Aucune notification</p>
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
                          <div className="text-xs text-text-muted truncate">{a.title || a.url}</div>
                        </div>
                        <span className="badge flex-shrink-0">{a.unread > 99 ? '99+' : a.unread}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="w-px h-5 bg-border mx-1 flex-shrink-0"></div>

        {/* Contrôles de fenêtre */}
        <div className="flex items-center gap-1 app-no-drag">
          <button
            onClick={() => window.electronAPI?.minimizeWindow?.()}
            className="w-10 h-8 hover:bg-bg-hover flex items-center justify-center transition-colors"
            title="Réduire"
          >
            <svg width="12" height="2" viewBox="0 0 12 2" fill="currentColor">
              <rect width="12" height="2" />
            </svg>
          </button>
          <button
            onClick={() => window.electronAPI?.maximizeWindow?.()}
            className="w-10 h-8 hover:bg-bg-hover flex items-center justify-center transition-colors"
            title="Agrandir / Restaurer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="1" width="10" height="10" />
            </svg>
          </button>
          <button
            onClick={() => window.electronAPI?.closeWindow?.()}
            className="w-10 h-8 hover:bg-error flex items-center justify-center transition-colors"
            title="Fermer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
