import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../stores/useStore';
import { ChevronLeft, ChevronRight, Plus, Settings, Grid, User, Moon, BellOff, Lock } from 'lucide-react';
import AppContextMenu from './AppContextMenu';
import AppIcon from './AppIcon';
import { useSecurityStore } from '../lib/securityStore';

export default function Sidebar({ collapsed, onToggle, onOpenSettings, onOpenStore, onOpenProfileManager, onSelectApp }) {
  const { profiles, activeProfile, setActiveProfile, getProfileApps, activeApp, settings, reorderApps } = useStore();
  const { lockedProfileIds, unlockedProfileIds } = useSecurityStore();
  // Un profil affiche un cadenas s'il est verrouillé ET pas encore déverrouillé
  const profileShowsLock = (id) =>
    lockedProfileIds.includes(id) && !unlockedProfileIds.includes(id);
  const currentProfile = profiles.find((p) => p.id === activeProfile);
  const apps = getProfileApps(activeProfile);

  // Menu contextuel (clic droit) : { appId, x, y } | null
  const [menu, setMenu] = useState(null);

  // Glisser-déposer : id de l'app déplacée + id survolé (cible de dépôt)
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const openContextMenu = (e, appId) => {
    e.preventDefault();
    setMenu({ appId, x: e.clientX, y: e.clientY });
  };

  // --- Réordonner par glisser-déposer -------------------------------------
  const handleDragStart = (e, appId) => {
    setDragId(appId);
    e.dataTransfer.effectAllowed = 'move';
    // Nécessaire pour que le glisser démarre sur Firefox
    try {
      e.dataTransfer.setData('text/plain', appId);
    } catch {
      /* ignore */
    }
  };

  const handleDragOver = (e, targetId) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // 'end' = déposer tout en bas de la liste (espace sous la dernière app)
    setOverId(e.target === e.currentTarget ? '__end__' : targetId);
  };

  const handleDrop = (e, targetId) => {
    if (!dragId) return;
    e.preventDefault();
    const next = apps.map((a) => a.id).filter((id) => id !== dragId);
    if (targetId !== '__end__') {
      const to = apps.findIndex((a) => a.id === targetId);
      if (to !== -1) next.splice(to, 0, dragId);
      else next.push(dragId);
    } else {
      next.push(dragId); // tout en bas
    }
    reorderApps(activeProfile, next);
    setDragId(null);
    setOverId(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setOverId(null);
  };
  // -------------------------------------------------------------------------

  // Appliquer les paramètres d'affichage
  const spacing = settings.compactMode ? 'gap-1' : 'gap-2';
  const padding = settings.compactMode ? 'p-2' : 'p-3';

  // Numéro d'instance par recette (pour distinguer les comptes multiples :
  // Gmail (1), Gmail (2)… — surtout quand la sidebar est réduite et qu'on
  // ne voit que l'icône).
  const counters = {};
  const instanceIndex = {};
  apps.forEach((a) => {
    if (a.recipeId) {
      counters[a.recipeId] = (counters[a.recipeId] || 0) + 1;
      instanceIndex[a.id] = counters[a.recipeId];
    }
  });

  return (
    <aside
      className={`fixed left-0 top-12 bottom-0 bg-bg-secondary border-r border-border transition-all duration-300 flex flex-col z-10 ${
        collapsed ? 'w-16' : 'w-[17.5rem]'
      }`}
    >
      {/* Header avec toggle */}
      <div className={`h-14 flex items-center ${collapsed ? 'px-2' : 'px-4'} border-b border-border gap-1`}>
        {!collapsed && (
          <button
            onClick={onOpenProfileManager}
            className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity"
            title="Gérer les profils"
          >
            <div className="text-2xl flex-shrink-0">{currentProfile?.emoji}</div>
            <div className="flex-1 text-left min-w-0">
              <h2 className="font-semibold text-sm truncate">{currentProfile?.name}</h2>
              <p className="text-xs text-text-muted">{apps.length} apps</p>
            </div>
          </button>
        )}
        {collapsed && (
          <button
            onClick={onOpenProfileManager}
            className="flex-1 flex justify-center py-1 hover:opacity-80 transition-opacity"
            title="Gérer les profils"
          >
            <div className="text-xl">{currentProfile?.emoji}</div>
          </button>
        )}
        <button
          onClick={onToggle}
          className={`btn-icon ${collapsed ? 'w-8 h-8' : ''}`}
          title={collapsed ? 'Développer la sidebar' : 'Réduire la sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Profils - TOUJOURS VISIBLE */}
      <div className={`${padding} border-b border-border`}>
        {!collapsed && (
          <div className="flex items-center justify-between mb-2 px-2">
            <div className="text-xs font-semibold text-text-muted uppercase">Profils</div>
            <button
              onClick={onOpenProfileManager}
              className="text-xs text-accent-primary hover:text-accent-hover"
              title="Gérer les profils"
            >
              <User size={14} />
            </button>
          </div>
        )}
        <div className={`space-y-1 ${spacing}`}>
          {profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => setActiveProfile(profile.id)}
              className={`relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${
                settings.compactMode ? 'px-2 py-1.5' : 'px-3 py-2'
              } rounded-lg transition-all ${
                profile.id === activeProfile
                  ? 'bg-accent-primary/10 text-accent-primary'
                  : 'hover:bg-bg-hover text-text-secondary'
              }`}
              title={collapsed ? profile.name : undefined}
            >
              <span className="text-xl flex-shrink-0">{profile.emoji}</span>
              {!collapsed && (
                <>
                  <span className="font-medium text-sm flex-1 text-left truncate">{profile.name}</span>
                  {profileShowsLock(profile.id) && (
                    <Lock size={13} className="text-text-muted flex-shrink-0" title="Profil verrouillé" />
                  )}
                  {profile.id === activeProfile && !profileShowsLock(profile.id) && (
                    <div className="w-2 h-2 rounded-full bg-accent-primary flex-shrink-0"></div>
                  )}
                </>
              )}
              {collapsed && profileShowsLock(profile.id) && (
                <Lock size={11} className="absolute right-1 top-1 text-text-muted" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Applications */}
      <div className={`flex-1 overflow-y-auto ${padding}`}>
        {!collapsed && (
          <div className="text-xs font-semibold text-text-muted uppercase mb-2 px-2">Applications</div>
        )}
        {apps.length === 0 ? (
          !collapsed && (
            <div className="text-center py-8 text-text-muted text-sm">
              <div className="text-3xl mb-2">📦</div>
              <p>Aucune application</p>
              <button onClick={onOpenStore} className="btn btn-primary btn-sm mt-3">
                <Plus size={14} />
                Ajouter
              </button>
            </div>
          )
        ) : (
          <div
            className={`space-y-1 ${spacing} ${dragId ? 'pb-1' : ''}`}
            // « __end__ » = zone vide sous la dernière app (déposer tout en bas).
            // Ne réagit que si la cible est le conteneur lui-même (pas un bouton
            // d'app : les événements remontent et déclencheraient un double drop).
            onDragOver={(e) => {
              if (e.target === e.currentTarget) handleDragOver(e, '__end__');
            }}
            onDrop={(e) => {
              if (e.target === e.currentTarget) handleDrop(e, '__end__');
            }}
          >
            {apps.map((app) => (
              <button
                key={app.id}
                onClick={() => onSelectApp(app.id)}
                onContextMenu={(e) => openContextMenu(e, app.id)}
                draggable
                onDragStart={(e) => handleDragStart(e, app.id)}
                onDragOver={(e) => handleDragOver(e, app.id)}
                onDrop={(e) => handleDrop(e, app.id)}
                onDragEnd={handleDragEnd}
                className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${
                  settings.compactMode ? 'px-2 py-1.5' : 'px-3 py-2'
                } rounded-lg transition-all group relative cursor-grab active:cursor-grabbing ${
                  app.id === activeApp
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'hover:bg-bg-hover text-text-secondary'
                } ${app.sleeping ? 'opacity-50' : ''} ${
                  dragId === app.id ? 'opacity-50' : ''
                } ${overId === app.id ? 'ring-2 ring-accent-primary ring-inset' : ''} ${
                  overId === '__end__' && app.id === apps[apps.length - 1]?.id
                    ? 'ring-2 ring-accent-primary ring-inset'
                    : ''
                }`}
                title={collapsed ? app.name : undefined}
              >
                {/* Icône : image téléversée → favicon (repli auto) → emoji. Grisée si en veille */}
                <div
                  className={`${collapsed ? 'w-9 h-9' : 'w-8 h-8'} rounded-lg flex items-center justify-center text-xl flex-shrink-0 relative ${
                    app.sleeping ? 'grayscale opacity-60' : ''
                  }`}
                  style={{ backgroundColor: settings.showAppIcons ? `${app.color}20` : 'transparent' }}
                >
                  <AppIcon app={app} className="w-5 h-5 rounded" />
                  {/* Comptes multiples (Gmail 1, Gmail 2…) : petit numéro sur
                      l'icône quand la sidebar est réduite pour les distinguer */}
                  {collapsed && app.recipeId && counters[app.recipeId] > 1 && (
                    <span
                      className="absolute -top-1 -left-1 min-w-4 h-4 px-0.5 rounded-full text-[9px] font-bold text-white flex items-center justify-center border border-bg-secondary"
                      style={{ backgroundColor: app.color }}
                      title={`Compte ${instanceIndex[app.id]} / ${counters[app.recipeId]}`}
                    >
                      {instanceIndex[app.id]}
                    </span>
                  )}
                  {app.sleeping && (
                    <span
                      className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-bg-elevated border border-border flex items-center justify-center"
                      title="En veille"
                    >
                      <Moon size={9} className="text-text-muted" />
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="font-medium text-sm flex-1 text-left truncate">{app.name}</span>
                    {app.muted && (
                      <BellOff size={13} className="text-text-muted flex-shrink-0" title="Notifications coupées" />
                    )}
                    {app.unread > 0 && !app.sleeping && (
                      <span className="badge flex-shrink-0">{app.unread > 99 ? '99+' : app.unread}</span>
                    )}
                  </>
                )}
                {collapsed && app.unread > 0 && !app.sleeping && (
                  <div className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full bg-accent-primary border-2 border-bg-secondary"></div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`${padding} border-t border-border`}>
        {!collapsed ? (
          <div className="space-y-2">
            <button
              onClick={onOpenStore}
              className={`w-full btn btn-primary ${settings.compactMode ? 'text-xs py-2' : 'text-sm'}`}
              title="Boutique d'applications"
            >
              <Grid size={16} />
              Boutique
            </button>
            <div className="flex gap-2">
              <button
                onClick={onOpenProfileManager}
                className={`flex-1 btn btn-secondary ${settings.compactMode ? 'text-xs py-1.5' : 'text-xs'}`}
                title="Gérer les profils"
              >
                <User size={14} />
                Profils
              </button>
              <button
                onClick={onOpenSettings}
                className={`flex-1 btn btn-secondary ${settings.compactMode ? 'text-xs py-1.5' : 'text-xs'}`}
                title="Paramètres"
              >
                <Settings size={14} />
                Réglages
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={onOpenStore}
              className="w-full btn-icon flex items-center justify-center"
              title="Boutique"
            >
              <Grid size={18} />
            </button>
            <button
              onClick={onOpenSettings}
              className="w-full btn-icon flex items-center justify-center"
              title="Paramètres"
            >
              <Settings size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Menu contextuel — rendu à la RACINE du document (portal) :
          la sidebar crée un contexte d'empilement (z-10) qui piégerait
          le menu sous les webviews quand on clique près de leur zone. */}
      {menu &&
        createPortal(
          <AppContextMenu
            appId={menu.appId}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
          />,
          document.body
        )}
    </aside>
  );
}
