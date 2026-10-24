import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../stores/useStore';
import { ChevronLeft, ChevronRight, ChevronDown, Plus, Settings, Grid, User, Moon, BellOff, Lock, Volume2, VolumeX, LogIn, Globe, X, EyeOff, FolderPlus, Check, GripVertical, MessageCircle } from 'lucide-react';
import AppContextMenu from './AppContextMenu';
import MultiSelectionMenu from './MultiSelectionMenu';
import AppFolderMenu from './AppFolderMenu';
import AppIcon from './AppIcon';
import { useSecurityStore } from '../lib/securityStore';
import { useMediaStore } from '../lib/mediaStore';
import { getWebview, getRegisteredWebviews } from '../lib/webviewRegistry';
import { useT } from '../lib/i18n';
import { useZoneHold, REVEALED_BAR_Z } from '../lib/autoHide';
import { useDismiss } from '../lib/useDismiss';
import {
  groupByFolder,
  foldersFor,
  folderAppIds,
  toggleId,
  selectRange,
  isToggleClick,
  countUnread,
  reorderIdsByDrop,
} from '../lib/appGroups';

// Sélection vide partagée : une référence STABLE, pour que « pas de sélection »
// ne fasse pas re-rendre la liste à chaque rendu (un `[]` littéral en
// déclencherait un nouveau à chaque fois).
const EMPTY_SELECTION = [];

export default function Sidebar({
  collapsed,
  onToggle,
  onOpenSettings,
  onOpenStore,
  onOpenProfileManager,
  onSelectApp,
  onFlyPageMenu,
  bottomOffset = 0,
  topOffset = '3rem',
  autoHidden = false,
  revealed = true,
  revealHandlers = {},
}) {
  const {
    profiles,
    activeProfile,
    setActiveProfile,
    getProfileApps,
    activeApp,
    settings,
    reorderApps,
    containers,
    flyPages,
    closeFlyPage,
    closeAllFlyPages,
    apps: storedApps,
    folders,
    sidebarProfilesOpen,
    setSidebarProfilesOpen,
    createFolderWithApps,
    setAppFolder,
    toggleFolderCollapsed,
  } = useStore();
  const assistantSessions = useStore((state) => state.assistantSessions || []);
  const { lockedProfileIds, unlockedProfileIds } = useSecurityStore();
  const t = useT();
  const media = useMediaStore((s) => s.media);
  const setMedia = useMediaStore((s) => s.setMedia);

  // Liste des profils dépliée (une seule ligne tant qu'elle est repliée) : on
  // la referme au clic ailleurs, à Échap, au redimensionnement… Règle commune
  // de lib/useDismiss, partagée avec tous les autres menus flottants.
  const profilesRef = useRef(null);
  const closeProfiles = useCallback(() => setSidebarProfilesOpen(false), [setSidebarProfilesOpen]);
  useDismiss(profilesRef, sidebarProfilesOpen, closeProfiles);

  // Coupe / réactive le son d'une app précise (comme un onglet de navigateur).
  const toggleAppAudio = (appId) => {
    const next = !media[appId]?.audioMuted;
    const wv = getWebview(appId);
    try {
      wv?.setAudioMuted?.(next);
    } catch {
      /* webview pas prêt */
    }
    setMedia(appId, { audioMuted: next });
  };
  // Un profil affiche un cadenas s'il est verrouillé ET pas encore déverrouillé
  const profileShowsLock = (id) =>
    lockedProfileIds.includes(id) && !unlockedProfileIds.includes(id);
  const currentProfile = profiles.find((p) => p.id === activeProfile);
  const assistantChatEnabled = settings.assistantChatEnabled !== false;
  const assistantChatSidebarEnabled = settings.assistantChatSidebarEnabled !== false;
  // Les apps « tous profils » venues d'un profil VERROUILLÉ sont écartées :
  // la portée globale ne doit pas contourner le verrou de profil.
  const apps = getProfileApps(activeProfile).filter(
    (a) => a.profileId === activeProfile || !profileShowsLock(a.profileId)
  );
  // Les apps épinglées remontent dans leur propre groupe et SORTENT de la
  // liste principale : elles y figuraient en double auparavant (une pastille
  // en haut + la ligne complète en bas), ce qui donnait l'impression que le
  // favori ne servait à rien. Une app visible dans tous les profils y remonte
  // aussi — enterrée dans la liste, on ne comprendrait pas ce qu'elle fait là.
  const isPinned = (a) => a.isFavorite || a.scope === 'all';
  const pinned = apps.filter(isPinned);
  const unpinned = apps.filter((a) => !isPinned(a));

  // --- Dossiers ------------------------------------------------------------
  // Les épinglés remontent en haut et sortent de la liste : ils ne sont donc
  // jamais comptés deux fois. Conséquence assumée : un dossier dont toutes les
  // apps sont épinglées disparaît de la liste (elles sont juste au-dessus).
  const profileFolders = foldersFor(folders, activeProfile);
  const { groups, loose } = groupByFolder(unpinned, profileFolders);
  // Ordre AFFICHÉ à plat : sert au réordonnancement et à la sélection de plage
  // (Maj+clic), qui doit traverser les dossiers comme une seule liste.
  const flatApps = [...pinned, ...groups.flatMap((g) => g.apps), ...loose];

  // --- Sélection multiple (Ctrl/Cmd+clic, Maj+clic) -----------------------
  //
  // La sélection appartient au profil courant : on mémorise AVEC QUEL profil
  // elle a été faite. Changer de profil la vide donc par simple calcul, sans
  // effet ni état intermédiaire — un `useEffect` qui remet l'état à zéro
  // provoquerait ici un second rendu à chaque bascule de profil.
  const [selectionState, setSelectionState] = useState({ profileId: null, ids: [] });
  const selection = selectionState.profileId === activeProfile ? selectionState.ids : EMPTY_SELECTION;
  const setSelection = useCallback(
    (value) => {
      setSelectionState((prev) => {
        const current = prev.profileId === activeProfile ? prev.ids : EMPTY_SELECTION;
        const next = typeof value === 'function' ? value(current) : value;
        // Rien ne change (re-cliquer sur une sélection vide…) : on ne re-rend pas.
        if (prev.profileId === activeProfile && prev.ids === next) return prev;
        return { profileId: activeProfile, ids: next };
      });
    },
    [activeProfile]
  );
  // Ancre de la sélection de plage : la dernière ligne cliquée sans Maj.
  const selectionAnchor = useRef(null);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  // Une app sélectionnée qui disparaît (désinstallée, déplacée de profil) ne
  // doit pas rester « fantôme » dans la sélection : on la filtre à l'affichage.
  const selectedApps = apps.filter((a) => selectedSet.has(a.id));
  const [multiMenu, setMultiMenu] = useState(null); // { ids, x, y }
  const [folderMenu, setFolderMenu] = useState(null); // { folderId, x, y }
  const [assistantFlyout, setAssistantFlyout] = useState(false);
  const assistantFlyoutTimer = useRef(null);
  // Regroupement lancé depuis le bandeau de sélection : saisie du nom en place.
  // Le profil de départ est mémorisé — changer de profil abandonne la saisie
  // (même raison que pour la sélection : plus d'effet de remise à zéro).
  const [naming, setNaming] = useState({ profileId: null, open: false, name: '' });
  const namingOpen = naming.open && naming.profileId === activeProfile;

  const clearSelection = useCallback(() => {
    selectionAnchor.current = null;
    setSelection(EMPTY_SELECTION);
  }, [setSelection]);

  const openAssistantConversation = (sessionId) => {
    window.dispatchEvent(new CustomEvent('orbit:assistant-conversation-open', {
      detail: { sessionId },
    }));
    setAssistantFlyout(false);
  };

  const scheduleAssistantFlyoutClose = () => {
    clearTimeout(assistantFlyoutTimer.current);
    assistantFlyoutTimer.current = setTimeout(() => setAssistantFlyout(false), 260);
  };

  useEffect(() => () => clearTimeout(assistantFlyoutTimer.current), []);

  // Échap annule la sélection (le geste attendu quand on s'est trompé de cible).
  useEffect(() => {
    if (!selection.length) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      selectionAnchor.current = null;
      setSelection(EMPTY_SELECTION);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection.length, setSelection]);

  const handleAppClick = (app, e) => {
    if (isToggleClick(e)) {
      e.preventDefault();
      selectionAnchor.current = app.id;
      setSelection((prev) => toggleId(prev, app.id));
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      const anchor = selectionAnchor.current || selection[selection.length - 1];
      setSelection(selectRange(flatApps.map((a) => a.id), anchor, app.id));
      return;
    }
    // Clic simple : on ouvre l'app et on oublie la sélection.
    if (selection.length) clearSelection();
    onSelectApp(app.id);
  };

  const createGroupFromSelection = () => {
    const ids = selectedApps.map((a) => a.id);
    if (!ids.length) return;
    createFolderWithApps(naming.name, ids, {
      fallbackName: t('fold.untitled'),
      profileId: activeProfile,
    });
    setNaming({ profileId: activeProfile, open: false, name: '' });
    clearSelection();
  };

  // --- Mémoire par app (bulle au survol) ----------------------------------
  // Au survol d'une ligne (app installée ou page volante), on lit le processus
  // de rendu de chaque <webview> montée et on affiche la mémoire de la ligne
  // survolée + le classement des plus gourmandes. Rafraîchi toutes les 2 s tant
  // que la souris reste dessus.
  const [memPopup, setMemPopup] = useState(null); // { appId, name, top, left }
  const [memData, setMemData] = useState({}); // appId -> { residentSet, cpu… }
  const memHoveredRef = useRef(null);

  const readAppMemory = async () => {
    const next = {};
    await Promise.all(
      getRegisteredWebviews().map(async ([id, wv]) => {
        let wcId = null;
        try {
          wcId = wv.getWebContentsId();
        } catch {
          return; // webview pas encore attaché (pas de dom-ready)
        }
        try {
          const data = await window.electronAPI?.getAppMemory?.(wcId);
          if (data) next[id] = data;
        } catch {
          /* process fermé entre-temps */
        }
      })
    );
    // La souris est peut-être repartie pendant l'attente : on ne publie rien
    // dans ce cas (sinon la bulle se rouvrirait toute seule).
    if (memHoveredRef.current) setMemData(next);
  };

  useEffect(() => {
    const hovered = memPopup?.appId;
    if (!hovered) return undefined;
    memHoveredRef.current = hovered;
    readAppMemory();
    const timer = setInterval(readAppMemory, 2000);
    return () => {
      memHoveredRef.current = null;
      clearInterval(timer);
    };
  }, [memPopup?.appId]);

  const showMemPopup = (app, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMemPopup({
      appId: app.id,
      name: app.name,
      sleeping: !!app.sleeping,
      mounted: !!getWebview(app.id),
      // Bulle à droite de la ligne, bornée à l'écran (largeur ~260 px).
      top: Math.max(8, Math.min(rect.top, window.innerHeight - 230)),
      left: Math.min(rect.right + 8, window.innerWidth - 268),
    });
  };
  const hideMemPopup = () => setMemPopup(null);

  const fmtMem = (kb) => {
    if (!Number.isFinite(kb)) return '—';
    const mo = kb / 1024;
    return mo >= 1024 ? `${(mo / 1024).toFixed(1)} Go` : `${Math.round(mo)} Mo`;
  };

  // Classement des webviews ouvertes (top 5) : répond d'un coup d'œil à
  // « quelle app consomme le plus », sans survoler chacune.
  const memRanked = Object.entries(memData)
    .map(([id, d]) => ({
      id,
      name:
        storedApps.find((a) => a.id === id)?.name ||
        flyPages.find((p) => p.id === id)?.name ||
        id,
      kb: d?.residentSet || 0,
    }))
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 5);
  const memTotal = memRanked.reduce((sum, r) => sum + r.kb, 0);

  // Menu contextuel (clic droit) : { appId, x, y } | null
  const [menu, setMenu] = useState(null);
  // Ces menus sont rendus dans un PORTAIL : ils ne sont pas descendants de la
  // barre, donc la souris qui y entre déclencherait la fermeture en mode épuré.
  // On maintient explicitement la zone ouverte tant que l'un est affiché.
  useZoneHold('left', 'app-menu', Boolean(menu || multiMenu || folderMenu));

  // Glisser-déposer : id de l'app déplacée + cible survolée (app, dossier, fin)
  const [dragId, setDragId] = useState(null);
  const dragIdRef = useRef(null);
  const dragProfileRef = useRef(null);
  const [overId, setOverId] = useState(null);
  const [overPlacement, setOverPlacement] = useState('before');
  // Dossier survolé : déposer sur son en-tête range l'app dedans.
  const [overFolder, setOverFolder] = useState(null);

  const openContextMenu = (e, app) => {
    e.preventDefault();
    // Clic droit SUR une sélection de plusieurs apps → menu de groupe. Sur une
    // app hors sélection, on repart d'une sélection propre : le menu ne doit
    // jamais agir sur des apps qu'on ne voit plus sélectionnées.
    if (selectedSet.has(app.id) && selectedApps.length > 1) {
      setMultiMenu({ ids: selectedApps.map((a) => a.id), x: e.clientX, y: e.clientY });
      return;
    }
    if (selection.length) clearSelection();
    setMenu({ appId: app.id, x: e.clientX, y: e.clientY });
  };

  const openFolderMenu = (e, folder) => {
    e.preventDefault();
    e.stopPropagation();
    if (selection.length) clearSelection();
    setFolderMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
  };

  // Sélectionne d'un coup toutes les apps d'un dossier (depuis son menu).
  const selectFolderApps = (id) => {
    const ids = folderAppIds(storedApps, id);
    selectionAnchor.current = ids[0] || null;
    setSelection(ids);
  };

  // --- Réordonner par glisser-déposer -------------------------------------
  const handleDragStart = (e, appId) => {
    dragIdRef.current = appId;
    dragProfileRef.current = activeProfile;
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
    if (!dragIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setOverFolder(null);
    setOverId(targetId);
    if (targetId !== '__end__' && targetId !== dragIdRef.current) {
      const bounds = e.currentTarget.getBoundingClientRect();
      setOverPlacement(e.clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before');
    }
  };

  const handleDragOverFolder = (e, id) => {
    if (!dragIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setOverId(null);
    setOverFolder(id);
  };

  // Dépose l'app en cours de glisser `beforeId` (ou à la fin) et la range dans
  // `folderId` (vide = hors dossier). Ordre et rangement sont deux écritures
  // distinctes du store : l'interface se recompose une fois pour les deux.
  const applyDrop = (targetId, folderId, placement = 'before') => {
    const movingId = dragIdRef.current;
    if (
      !movingId ||
      dragProfileRef.current !== activeProfile ||
      !flatApps.some((app) => app.id === movingId)
    ) {
      handleDragEnd();
      return;
    }
    const next = reorderIdsByDrop(flatApps.map((a) => a.id), movingId, targetId, placement);
    reorderApps(activeProfile, next);
    setAppFolder(movingId, folderId, activeProfile);
    dragIdRef.current = null;
    dragProfileRef.current = null;
    setDragId(null);
    setOverId(null);
    setOverPlacement('before');
    setOverFolder(null);
  };

  const handleDrop = (e, targetApp) => {
    const movingId = dragIdRef.current;
    if (!movingId) return;
    e.preventDefault();
    e.stopPropagation();
    if (movingId === targetApp.id) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const placement = e.clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before';
    // La moitié supérieure insère avant, la moitié inférieure après : le
    // déplacement vers une app voisine ne retombe donc pas à sa place initiale.
    // Une app épinglée peut garder un folderId alors qu'elle est affichée en
    // haut. Ne pas ranger l'autre app dans ce dossier invisible par accident.
    const movingApp = apps.find((app) => app.id === movingId);
    const targetFolderId = isPinned(targetApp) || isPinned(movingApp)
      ? movingApp?.folderId
      : targetApp.folderId;
    applyDrop(targetApp.id, targetFolderId, placement);
  };

  const handleDropOnFolder = (e, folder) => {
    if (!dragIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    applyDrop(null, folder.id);
  };

  const handleDropInAppGroup = (e) => {
    const movingId = dragIdRef.current;
    if (!movingId) return;
    e.preventDefault();
    e.stopPropagation();
    const candidates = [...e.currentTarget.querySelectorAll('[data-app-id]')]
      .filter((element) => element.dataset.appId !== movingId)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return { id: element.dataset.appId, center: bounds.top + bounds.height / 2 };
      });
    const nearest = candidates.reduce(
      (best, candidate) =>
        !best || Math.abs(candidate.center - e.clientY) < Math.abs(best.center - e.clientY)
          ? candidate
          : best,
      null
    );
    if (!nearest) {
      applyDrop(null, undefined);
      return;
    }
    const targetApp = apps.find((app) => app.id === nearest.id);
    const placement = e.clientY >= nearest.center ? 'after' : 'before';
    applyDrop(nearest.id, targetApp?.folderId, placement);
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    dragProfileRef.current = null;
    setDragId(null);
    setOverId(null);
    setOverPlacement('before');
    setOverFolder(null);
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


  // Une ligne d'app. Extraite en fonction parce qu'elle est rendue trois fois :
  // apps épinglées, apps rangées dans un dossier, apps libres.
  const renderApp = (app) => {
    const isSelected = selectedSet.has(app.id);
    return (
    <button
      key={app.id}
      data-app-id={app.id}
      onClick={(e) => handleAppClick(app, e)}
      onContextMenu={(e) => openContextMenu(e, app)}
      draggable
      onDragStart={(e) => handleDragStart(e, app.id)}
      onDragOver={(e) => handleDragOver(e, app.id)}
      onDrop={(e) => handleDrop(e, app)}
      onDragEnd={handleDragEnd}
      onMouseEnter={(e) => showMemPopup(app, e)}
      onMouseLeave={hideMemPopup}
      className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${
        settings.compactMode ? 'px-2 py-1.5' : 'px-3 py-2'
      } rounded-lg transition-all group relative cursor-pointer active:cursor-grabbing ${
        // Sélection multiple : elle prime visuellement sur l'app active, sinon
        // on ne saurait plus ce qui est coché.
        isSelected
          ? 'bg-accent-primary/20 ring-1 ring-inset ring-accent-primary/60 text-text-primary'
          : app.id === activeApp
            ? 'bg-accent-primary/10 text-accent-primary'
            : 'hover:bg-bg-hover text-text-secondary'
      } ${app.sleeping ? 'opacity-50' : ''} ${
        dragId === app.id ? 'opacity-50' : ''
      } ${
        overId === app.id
          ? overPlacement === 'after'
            ? 'border-b-2 border-accent-primary'
            : 'border-t-2 border-accent-primary'
          : ''
      }`}
      title={`${app.name} — glisser-déposer pour réorganiser`}
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
            title={t('sb.sleeping')}
          >
            <Moon size={9} className="text-text-muted" />
          </span>
        )}
        {/* Pastille du conteneur (multi-comptes) */}
        {app.containerId && (
          <span
            className="absolute -bottom-1 -left-1 w-3 h-3 rounded-full border-2 border-bg-secondary"
            style={{
              backgroundColor:
                containers.find((c) => c.id === app.containerId)?.color || '#f59e0b',
            }}
            title={`Conteneur : ${containers.find((c) => c.id === app.containerId)?.name || ''}`}
          />
        )}
      </div>
      {!collapsed && (
        <>
          <span className="font-medium text-sm flex-1 text-left truncate">{app.name}</span>
          <GripVertical
            size={14}
            className="flex-shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-60"
            aria-hidden="true"
          />
          {/* Son : apparaît quand l'app joue un média ou qu'elle est
              coupée → clic pour couper/réactiver (comme un onglet). */}
          {(media[app.id]?.playing || media[app.id]?.audioMuted) && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                toggleAppAudio(app.id);
              }}
              className={`flex-shrink-0 transition-colors ${
                media[app.id]?.audioMuted
                  ? 'text-error hover:text-error'
                  : 'text-accent-primary hover:text-accent-hover'
              }`}
              title={media[app.id]?.audioMuted ? t('sb.unmute') : t('sb.mute')}
            >
              {media[app.id]?.audioMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </span>
          )}
          {app.scope === 'all' && (
            <Globe size={13} className="text-text-muted flex-shrink-0" title={t('sb.allProfiles')} />
          )}
          {app.muted && (
            <BellOff size={13} className="text-text-muted flex-shrink-0" title={t('sb.notifMuted')} />
          )}
          {/* Session perdue : l'app est retombée sur sa page de
              connexion. Signalé ici pour ne pas le découvrir en
              cliquant dessus (voir WebView → 'session-lost'). */}
          {app.signedOut && !app.sleeping && (
            <LogIn
              size={13}
              className="text-warning flex-shrink-0"
              title={t('sb.signedOut')}
            />
          )}
          {app.unread > 0 && !app.sleeping && (
            <span className="badge flex-shrink-0">{app.unread > 99 ? '99+' : app.unread}</span>
          )}
        </>
      )}
      {collapsed && app.unread > 0 && !app.sleeping && (
        <div className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full bg-accent-primary border-2 border-bg-secondary"></div>
      )}
      {collapsed && app.signedOut && !app.sleeping && (
        <div
          className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full bg-warning border-2 border-bg-secondary"
          title={t('sb.signedOut')}
        ></div>
      )}
    </button>
    );
  };

  // En-tête d'un dossier : cliquer dessus PLIE/déplie (le geste le plus
  // fréquent), clic droit pour le menu (renommer, icône, dissocier…). Déposer
  // une app dessus l'y range.
  const renderFolder = ({ folder, apps: folderApps }) => {
    const unread = countUnread(folderApps);
    const hidden = collapsed || folder.collapsed;
    return (
      <div key={folder.id}>
        <button
          onClick={() => {
            if (selection.length) clearSelection();
            toggleFolderCollapsed(folder.id);
          }}
          onContextMenu={(e) => openFolderMenu(e, folder)}
          onDragOver={(e) => handleDragOverFolder(e, folder.id)}
          onDrop={(e) => handleDropOnFolder(e, folder)}
          title={folder.collapsed ? t('fold.expand') : t('fold.collapse')}
          className={`w-full flex items-center relative ${
            collapsed ? 'justify-center' : 'gap-2'
          } ${settings.compactMode ? 'px-2 py-1.5' : 'px-3 py-2'} rounded-lg transition-colors ${
            overFolder === folder.id
              ? 'ring-2 ring-accent-primary ring-inset'
              : 'hover:bg-bg-hover text-text-secondary'
          }`}
        >
          <span className="w-4 flex-shrink-0 flex items-center justify-center">
            {folder.collapsed ? (
              <ChevronRight size={14} className="text-text-muted" />
            ) : (
              <ChevronDown size={14} className="text-text-muted" />
            )}
          </span>
          <span className="text-base leading-none flex-shrink-0">{folder.emoji}</span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left text-sm font-medium truncate">{folder.name}</span>
              {hidden && unread > 0 && (
                <span className="badge flex-shrink-0" title={t('sb.folderUnread', { count: unread })}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              {!hidden && (
                <span className="text-[10px] tabular-nums text-text-muted flex-shrink-0">
                  {folderApps.length}
                </span>
              )}
            </>
          )}
          {collapsed && unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full bg-accent-primary border-2 border-bg-secondary"
              title={t('sb.folderUnread', { count: unread })}
            />
          )}
        </button>
        {!folder.collapsed && (
          <div
            className={
              collapsed
                ? 'space-y-1 mt-1'
                : 'mt-1 ml-3 pl-2 border-l border-border space-y-1'
            }
            onDragOver={(e) => {
              if (e.target === e.currentTarget && dragIdRef.current) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              if (e.target === e.currentTarget) handleDropInAppGroup(e);
            }}
          >
            {folderApps.map((app) => renderApp(app))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={`fixed left-0 bg-bg-secondary border-r border-border flex flex-col ${
        collapsed ? 'w-16' : 'w-[17.5rem]'
      } ${
        // En mode épuré, seule la translation s'anime : animer `width` en même
        // temps rendrait le glissement saccadé.
        autoHidden
          ? 'transition-transform duration-200 ease-out shadow-2xl'
          : 'transition-all duration-300'
      }`}
      // La barre du bas court sur TOUTE la largeur : la sidebar s'arrête
      // au-dessus, sinon elle recouvrait la zone gauche de cette barre et les
      // modules qu'on y place restaient invisibles.
      style={{
        top: topOffset,
        bottom: bottomOffset,
        // Masquable → elle passe au-dessus du contenu (qui ne lui réserve plus
        // de place) et glisse hors de l'écran quand rien ne la retient.
        zIndex: autoHidden ? REVEALED_BAR_Z : 10,
        transform: autoHidden && !revealed ? 'translateX(-100%)' : 'translateX(0)',
      }}
      {...revealHandlers}
    >
      {/* Header : profil actif + dépliage de la liste.
          UNE SEULE LIGNE tant que la liste est repliée : avec plusieurs
          profils, la liste complète occupait une dizaine de lignes en
          permanence. Cliquer sur le profil déplie la liste DANS LE FLUX
          (pas en surimpression) → les apps descendent au lieu d'être
          recouvertes. Les raccourcis (Alt+Maj+Page ↑/↓, Alt+Maj+P) ne
          dépendent pas de ce pliage : ils restent disponibles. */}
      <div ref={profilesRef} className="border-b border-border">
        <div className={`h-14 flex items-center ${collapsed ? 'px-2' : 'px-4'} gap-1`}>
          <button
            onClick={() => setSidebarProfilesOpen(!sidebarProfilesOpen)}
            className={`flex items-center min-w-0 hover:opacity-80 transition-opacity ${
              collapsed ? 'flex-1 justify-center py-1' : 'gap-3 flex-1'
            }`}
            title={t('sb.switchProfile')}
            aria-expanded={Boolean(sidebarProfilesOpen)}
          >
            <div className={`${collapsed ? 'text-xl' : 'text-2xl'} flex-shrink-0`}>
              {currentProfile?.emoji}
            </div>
            {!collapsed && (
              <>
                <div className="flex-1 text-left min-w-0">
                  <h2 className="font-semibold text-sm truncate">{currentProfile?.name}</h2>
                  <p className="text-xs text-text-muted">{apps.length} apps</p>
                </div>
                {currentProfile && profileShowsLock(currentProfile.id) && (
                  <Lock size={13} className="text-text-muted flex-shrink-0" title={t('sb.profileLocked')} />
                )}
                <ChevronDown
                  size={16}
                  className={`flex-shrink-0 text-text-muted transition-transform ${
                    sidebarProfilesOpen ? 'rotate-180' : ''
                  }`}
                />
              </>
            )}
          </button>
          <button
            onClick={onToggle}
            className={`btn-icon ${collapsed ? 'w-8 h-8' : ''}`}
            title={collapsed ? t('sb.expand') : t('sb.collapse')}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {sidebarProfilesOpen && (
          <div className={`${padding} pb-2 animate-fade-in`}>
            <div
              className={`space-y-1 ${spacing}`}
              onDragOver={(e) => {
                if (e.target === e.currentTarget && dragIdRef.current) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                if (e.target === e.currentTarget) handleDropInAppGroup(e);
              }}
            >
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => {
                    setActiveProfile(profile.id);
                    closeProfiles();
                  }}
                  className={`relative w-full flex items-center ${
                    collapsed ? 'justify-center' : 'gap-3'
                  } ${settings.compactMode ? 'px-2 py-1.5' : 'px-3 py-2'} rounded-lg transition-all ${
                    profile.id === activeProfile
                      ? 'bg-accent-primary/10 text-accent-primary'
                      : 'hover:bg-bg-hover text-text-secondary'
                  }`}
                  title={collapsed ? profile.name : undefined}
                >
                  <span className="text-xl flex-shrink-0">{profile.emoji}</span>
                  {!collapsed && (
                    <>
                      <span className="font-medium text-sm flex-1 text-left truncate">
                        {profile.name}
                      </span>
                      {profileShowsLock(profile.id) && (
                        <Lock
                          size={13}
                          className="text-text-muted flex-shrink-0"
                          title={t('sb.profileLocked')}
                        />
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
            {/* Gérer les profils : reste accessible sans quitter la liste
                (le raccourci Alt+Maj+P et le pied de la barre le font aussi). */}
            <button
              onClick={onOpenProfileManager}
              className={`w-full flex items-center ${
                collapsed ? 'justify-center' : 'gap-2'
              } mt-2 px-2 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors`}
              title={t('sb.manageProfiles')}
            >
              <User size={14} />
              {!collapsed && <span className="truncate">{t('sb.manageProfiles')}</span>}
            </button>
          </div>
        )}
      </div>

      {assistantChatEnabled && assistantChatSidebarEnabled && <div
        className={`relative border-b border-border ${collapsed ? 'px-2 py-2' : 'px-3 py-2'}`}
        onMouseEnter={() => {
          clearTimeout(assistantFlyoutTimer.current);
          if (collapsed) setAssistantFlyout(true);
        }}
        onMouseLeave={scheduleAssistantFlyoutClose}
      >
        <button
          type="button"
          onClick={() => {
            if (collapsed) {
              setAssistantFlyout(false);
            }
            window.dispatchEvent(new Event('orbit:assistant-chat-open'));
          }}
          onFocus={() => collapsed && setAssistantFlyout(true)}
          aria-label={t('assistant.chat.title')}
          aria-expanded={collapsed ? assistantFlyout : undefined}
          title={collapsed ? t('assistant.chat.title') : undefined}
          className={`flex w-full items-center rounded-lg py-2 text-sm transition-colors ${
            collapsed ? 'justify-center' : 'gap-3 px-3'
          } ${
            assistantFlyout
              ? 'bg-accent-primary/10 text-accent-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <MessageCircle size={collapsed ? 19 : 17} />
          {!collapsed && <span className="truncate">{t('assistant.chat.title')}</span>}
        </button>

        {collapsed && assistantFlyout && (
          <section
            aria-label={t('assistant.history.title')}
            className="absolute left-full top-0 z-[100] ml-2 flex max-h-[min(70vh,520px)] w-80 flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-2xl"
            onMouseEnter={() => clearTimeout(assistantFlyoutTimer.current)}
            onMouseLeave={scheduleAssistantFlyoutClose}
          >
            <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                <MessageCircle size={14} className="text-accent-primary" />
                {t('assistant.history.title')}
              </span>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new Event('orbit:assistant-chat-open'));
                  setAssistantFlyout(false);
                }}
                className="rounded-md px-2 py-1 text-[11px] text-accent-primary hover:bg-accent-primary/10"
              >
                {t('assistant.history.new')}
              </button>
            </header>
            <div className="min-h-0 overflow-y-auto p-2">
              {assistantSessions.length === 0 ? (
                <p className="px-2 py-5 text-center text-xs text-text-muted">
                  {t('assistant.history.empty')}
                </p>
              ) : assistantSessions.slice(0, 10).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => openAssistantConversation(session.id)}
                  className="flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-hover"
                >
                  <span className="w-full truncate text-xs font-medium text-text-primary">
                    {session.title || t('assistant.history.untitled')}
                  </span>
                  <span className="flex w-full items-center justify-between gap-2 text-[10px] text-text-muted">
                    <span className="truncate">
                      {t(`assistant.history.category.${session.category || 'discussion'}`)}
                    </span>
                    <span className="shrink-0">
                      {Array.isArray(session.messages) ? session.messages.length : 0}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>}

      {/* Applications */}
      <div
        className={`flex-1 overflow-y-auto ${padding}`}
        // Clic dans le vide de la liste : on abandonne la sélection.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && selection.length) clearSelection();
        }}
      >
        {/* Bandeau de sélection multiple (Ctrl/Cmd+clic). Il reste COLLÉ en
            haut pendant qu'on fait défiler : on garde toujours sous les yeux
            ce qui est coché et ce qu'on peut en faire. */}
        {!collapsed && selectedApps.length > 0 && (
          <div className="sticky top-0 z-[1] mb-2 rounded-lg border border-accent-primary/40 bg-bg-elevated/95 backdrop-blur px-2 py-1.5 text-xs shadow-lg">
            {namingOpen ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={naming.name}
                  onChange={(e) => setNaming((n) => ({ ...n, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createGroupFromSelection();
                    if (e.key === 'Escape') setNaming((n) => ({ ...n, open: false }));
                  }}
                  placeholder={t('fold.namePlaceholder')}
                  maxLength={60}
                  className="input !py-1 !px-2 text-xs flex-1 min-w-0"
                />
                <button
                  onClick={createGroupFromSelection}
                  className="btn btn-primary btn-sm !px-2 !py-1"
                  title={t('fold.create')}
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => setNaming((n) => ({ ...n, open: false }))}
                  className="btn btn-secondary btn-sm !px-2 !py-1"
                  title={t('common.cancel')}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate font-medium text-accent-primary">
                  {t('sb.selected', { count: selectedApps.length })}
                </span>
                <button
                  onClick={() =>
                    setNaming({ profileId: activeProfile, open: true, name: '' })
                  }
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 transition-colors"
                  title={t('sb.groupSelected')}
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  onClick={clearSelection}
                  className="px-1.5 py-0.5 rounded-md hover:bg-bg-hover text-text-muted transition-colors"
                  title={t('sb.deselect')}
                >
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Épinglés : mêmes lignes que les autres apps (nom, badges, pastille
            de non-lus), simplement remontées en haut et retirées de la liste
            ci-dessous. Un séparateur marque la frontière plutôt qu'un second
            titre quand la barre est réduite. */}
        {pinned.length > 0 && (
          <div className="mb-3">
            {!collapsed && (
              <div className="text-xs font-semibold text-text-muted uppercase mb-2 px-2">
                {t('sb.pinned')}
              </div>
            )}
            <div className={`space-y-1 ${spacing}`}>
              {pinned.map((app) => renderApp(app))}
            </div>
            {collapsed && <div className="mt-3 mx-2 border-t border-border"></div>}
          </div>
        )}
        {!collapsed && (groups.length > 0 || loose.length > 0) && (
          <div
            className="text-xs font-semibold text-text-muted uppercase mb-2 px-2"
            title={t('sb.multiHint')}
          >
            {t('sb.applications')}
          </div>
        )}
        {apps.length === 0 ? (
          !collapsed && (
            <div className="text-center py-8 text-text-muted text-sm">
              <div className="text-3xl mb-2">📦</div>
              <p>{t('sb.noApps')}</p>
              <button onClick={onOpenStore} className="btn btn-primary btn-sm mt-3">
                <Plus size={14} />
                Ajouter
              </button>
            </div>
          )
        ) : (
          <>
            {/* Dossiers : un en-tête pliable + ses apps encadrées. Le rangement
                se fait par glisser-déposer (sur l'en-tête ou sur une app du
                dossier) ou depuis le menu de sélection multiple. */}
            <div className="space-y-2">{groups.map((group) => renderFolder(group))}</div>

            {/* Apps hors dossier. En mode réduit, ce conteneur sert aussi de
                zone de dépôt « tout en bas » — y déposer une app la SORT de
                son dossier. */}
            <div
              className={`space-y-1 ${spacing} ${groups.length ? 'mt-2' : ''} ${
                dragId ? 'min-h-6 pb-1' : ''
              } ${
                overId === '__end__' ? 'ring-2 ring-accent-primary ring-inset rounded-lg' : ''
              }`}
              // « __end__ » = zone vide sous la dernière app (déposer tout en bas).
              // Ne réagit que si la cible est le conteneur lui-même (pas un bouton
              // d'app : les événements remontent et déclencheraient un double drop).
              onDragOver={(e) => {
                if (e.target === e.currentTarget) handleDragOver(e, '__end__');
              }}
              onDrop={(e) => {
                if (e.target === e.currentTarget) handleDropInAppGroup(e);
              }}
            >
              {loose.map((app) => renderApp(app))}
            </div>
          </>
        )}

        {/* Pages volantes : des URL ouvertes à la volée depuis Alt+K. Section
            à part, sous un trait pointillé — ce ne sont pas des apps
            installées, et elles disparaîtront à la fermeture d'Orbit. */}
        {flyPages.length > 0 && (
          <div className="mt-3 pt-3 border-t border-dashed border-border">
            {!collapsed && (
              <div className="flex items-center justify-between px-3 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {t('fly.section')}
                </span>
                <button
                  onClick={closeAllFlyPages}
                  className="text-[10px] text-text-muted hover:text-error transition-colors"
                  title={t('fly.closeAll')}
                >
                  {t('fly.closeAll')}
                </button>
              </div>
            )}
            <div className={collapsed ? 'space-y-1 px-2' : 'space-y-0.5 px-2'}>
              {flyPages.map((page) => (
                <div
                  key={page.id}
                  onClick={() => onSelectApp?.(page.id)}
                  onContextMenu={(e) => onFlyPageMenu?.(e, page)}
                  onMouseEnter={(e) => showMemPopup(page, e)}
                  onMouseLeave={hideMemPopup}
                  title={`${page.private ? `${t('fly.privateBadge')} — ` : ''}${collapsed ? page.name : page.url}`}
                  className={`w-full flex items-center gap-2 ${
                    settings.compactMode ? 'px-2 py-1.5' : 'px-2 py-1.5'
                  } rounded-lg cursor-pointer transition-all group relative border border-dashed ${
                    page.id === activeApp
                      ? page.private
                        ? 'bg-violet-500/15 text-violet-400 border-violet-500/50'
                        : 'bg-accent-primary/10 text-accent-primary border-accent-primary/40'
                      : page.private
                        ? 'border-violet-500/40 hover:bg-violet-500/10 text-text-secondary'
                        : 'border-border/60 hover:bg-bg-hover text-text-secondary'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-bg-elevated relative">
                    <AppIcon app={page} className="w-4 h-4 rounded" />
                    {/* Pastille « privé » : on doit savoir d'un coup d'œil que
                        cette page ne garde rien (et ne voit pas nos comptes). */}
                    {page.private && (
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-violet-600 text-white flex items-center justify-center ring-2 ring-bg-secondary">
                        <EyeOff size={8} />
                      </span>
                    )}
                  </div>
                  {!collapsed && (
                    <>
                      <span className="flex-1 min-w-0 truncate text-xs">{page.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // sans ça, le clic sélectionnerait la page
                          closeFlyPage(page.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-error/20 hover:text-error transition-all flex-shrink-0"
                        title={t('fly.close')}
                      >
                        <X size={12} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
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
              title={t('sb.store')}
            >
              <Grid size={16} />
              {t('sb.storeShort')}
            </button>
            <div className="flex gap-2">
              <button
                onClick={onOpenProfileManager}
                className={`flex-1 btn btn-secondary ${settings.compactMode ? 'text-xs py-1.5' : 'text-xs'}`}
                title={t('sb.manageProfiles')}
              >
                <User size={14} />
                {t('sb.profilesShort')}
              </button>
              <button
                onClick={onOpenSettings}
                className={`flex-1 btn btn-secondary ${settings.compactMode ? 'text-xs py-1.5' : 'text-xs'}`}
                title={t('common.settings')}
              >
                <Settings size={14} />
                {t('sb.settingsShort')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={onOpenStore}
              className="w-full btn-icon flex items-center justify-center"
              title={t('sb.storeShort')}
            >
              <Grid size={18} />
            </button>
            <button
              onClick={onOpenSettings}
              className="w-full btn-icon flex items-center justify-center"
              title={t('common.settings')}
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

      {/* Menu d'une SÉLECTION MULTIPLE. Le fermer abandonne la sélection : on
          ne laisse jamais des apps cochées derrière un menu disparu (sans quoi
          le prochain clic droit agirait sur des apps qu'on ne vise plus). */}
      {multiMenu &&
        createPortal(
          <MultiSelectionMenu
            ids={multiMenu.ids}
            x={multiMenu.x}
            y={multiMenu.y}
            onClose={() => {
              setMultiMenu(null);
              clearSelection();
            }}
          />,
          document.body
        )}

      {/* Menu d'un DOSSIER (clic droit sur son en-tête). */}
      {folderMenu &&
        createPortal(
          <AppFolderMenu
            folderId={folderMenu.folderId}
            x={folderMenu.x}
            y={folderMenu.y}
            onSelectApps={selectFolderApps}
            onClose={() => setFolderMenu(null)}
          />,
          document.body
        )}

      {/* Bulle mémoire — portail à la racine du document pour la même raison
          que le menu contextuel : la sidebar crée un contexte d'empilement
          (z-10) qui piégerait la bulle sous les webviews. */}
      {memPopup &&
        createPortal(
          <div
            className="fixed z-[9999] w-64 pointer-events-none rounded-xl border border-border bg-bg-elevated shadow-2xl p-3 text-xs"
            style={{ top: memPopup.top, left: memPopup.left }}
          >
            <div className="font-semibold truncate mb-1.5">{memPopup.name}</div>
            {memPopup.sleeping ? (
              <p className="text-text-muted">{t('sb.memSleeping')}</p>
            ) : !memPopup.mounted ? (
              <p className="text-text-muted">{t('sb.memUnloaded')}</p>
            ) : memData[memPopup.appId] ? (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold text-accent-primary tabular-nums">
                  {fmtMem(memData[memPopup.appId].residentSet)}
                </span>
                {memData[memPopup.appId].cpu != null && (
                  <span className="text-text-muted tabular-nums">
                    CPU {memData[memPopup.appId].cpu}%
                  </span>
                )}
              </div>
            ) : (
              <p className="text-text-muted">{t('sb.memLoading')}</p>
            )}

            {memRanked.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-text-muted mb-1">
                  <span>{t('sb.memTop')}</span>
                  <span className="tabular-nums normal-case">{fmtMem(memTotal)}</span>
                </div>
                <ul className="space-y-0.5">
                  {memRanked.map((r) => (
                    <li
                      key={r.id}
                      className={`flex items-center gap-2 ${
                        r.id === memPopup.appId ? 'text-accent-primary' : 'text-text-secondary'
                      }`}
                    >
                      <span className="flex-1 truncate">{r.name}</span>
                      <span className="tabular-nums">{fmtMem(r.kb)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>,
          document.body
        )}
    </aside>
  );
}
