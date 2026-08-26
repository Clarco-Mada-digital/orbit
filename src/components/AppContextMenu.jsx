import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Moon,
  Trash2,
  Edit3,
  Check,
  X,
  ExternalLink,
  Pencil,
  ArrowRightLeft,
  ChevronRight,
  Bell,
  BellOff,
  Layers,
  Eraser,
  MoreHorizontal,
  AppWindow,
  Pin,
  PinOff,
  ShieldBan,
  Check as CheckIcon,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { getWebview } from '../lib/webviewRegistry';
import { reloadUrlFor } from '../lib/urls';
import { appPartition } from '../lib/session';
import { useT } from '../lib/i18n';
import EditAppModal from './EditAppModal';
import { useGuestDismiss } from '../lib/useDismiss';

// Menu contextuel (clic droit) sur une app de la sidebar :
// ouvrir / mettre en veille / réveiller / renommer / désinstaller.
// NB : window.prompt n'existe pas dans Electron → le renommage se fait
// via un petit formulaire inline affiché à la place du menu.
export default function AppContextMenu({ appId, x, y, onClose }) {
  const {
    apps,
    profiles,
    activeApp,
    setActiveApp,
    toggleAppSleep,
    deleteApp,
    updateApp,
    moveAppToProfile,
    containers,
    setAppContainer,
    createContainerForApp,
    settings,
  } = useStore();
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [containing, setContaining] = useState(false);
  const [newCtn, setNewCtn] = useState('');
  const [name, setName] = useState('');
  const [showMore, setShowMore] = useState(false);
  const t = useT();
  const app = apps.find((a) => a.id === appId);
  const menuRef = useRef(null);

  // Fermer au clic EN DEHORS du menu, à la molette, à Échap, ou au redimensionnement.
  // On écoute 'mousedown' (et PAS 'click') : cliquer « Déplacer » ou « Renommer »
  // re-rend le menu et retire le bouton du DOM ; un écouteur 'click' se
  // déclencherait alors avec une cible DÉTACHÉE (plus contenue dans le menu) et
  // fermerait le menu à tort. Au 'mousedown', la cible est encore en place, donc
  // `contains` répond correctement.
  useEffect(() => {
    const close = (e) => {
      // Pendant l'édition, le modal gère sa propre fermeture (clic sur le fond)
      if (editing) return;
      if (menuRef.current && e && e.target && menuRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      // Échap annule le renommage / le sous-menu de déplacement d'abord,
      // sinon ferme le menu
      if (e.key === 'Escape') {
        if (renaming) {
          setRenaming(false);
          setName(app?.name || '');
        } else if (moving) {
          setMoving(false);
        } else if (containing) {
          setContaining(false);
        } else {
          onClose();
        }
      }
    };
    const onScroll = () => {
      if (!editing) onClose();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose, renaming, editing, moving, containing, app?.name]);

  // Clic DANS une app embarquée : invisible depuis l'interface sans ce relais.
  // Le menu restait donc ouvert alors qu'on avait cliqué ailleurs.
  useGuestDismiss(!editing, onClose);

  if (!app) return null;

  // Édition complète (nom, URL, icône, couleur…) — modal à la place du menu
  if (editing) {
    return <EditAppModal app={app} onClose={onClose} />;
  }

  const isActive = activeApp === appId;
  // Le bloqueur est-il ACTIF sur cette app ? Réglage propre à l'app s'il
  // existe, sinon le réglage global.
  const adblockActive =
    app.adblock === 'on' ? true : app.adblock === 'off' ? false : settings.adblock !== false;

  // Profils de destination possibles (tous sauf celui de l'app)
  const otherProfiles = profiles.filter((p) => p.id !== app.profileId);

  // Garder le menu entièrement visible dans la fenêtre (même sidebar réduite)
  const width = renaming ? 256 : 240;
  const height = renaming
    ? 150
    : moving
      ? 130 + otherProfiles.length * 44
      : containing
        ? 180 + containers.length * 40
        : showMore
          ? 510
          : 300;
  const style = {
    width,
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };

  const startRename = () => {
    setName(app.name);
    setRenaming(true);
  };

  const saveRename = () => {
    const trimmed = name.trim();
    if (trimmed) {
      updateApp(appId, { name: trimmed });
    }
    onClose();
  };

  const handleUninstall = () => {
    if (
      confirm(
        t('ctx.confirmUninstall', { name: app.name })
      )
    ) {
      // Déplacé vers la corbeille — la session est conservée tant qu'on ne
      // vide pas la corbeille (restauration possible telle quelle).
      deleteApp(appId);
    }
    onClose();
  };

  const handleMove = (targetProfileId) => {
    moveAppToProfile(appId, targetProfileId);
    onClose();
  };

  const openDetached = () => {
    const sharedSession = !!profiles.find((p) => p.id === app.profileId)?.sharedSession;
    window.electronAPI?.openDetached?.({
      appId,
      url: app.url,
      partition: appPartition(app, sharedSession),
      title: app.name,
    });
    onClose();
  };

  const handleClearData = () => {
    if (
      confirm(
        t('ctx.confirmClear', { name: app.name })
      )
    ) {
      window.electronAPI?.clearAppSession?.({
        sessionKey: app.sessionKey || `${app.profileId}:${appId}`,
        profileId: app.profileId,
        appId,
      });
      try {
        // Session purgée → l'URL courante (jeton CSRF…) est forcément périmée
        const wv = getWebview(appId);
        const clean = reloadUrlFor(app.url);
        if (clean) wv?.loadURL(clean);
        else wv?.reload();
      } catch {
        /* ignore */
      }
    }
    onClose();
  };

  const assignContainer = (containerId) => {
    setAppContainer(appId, containerId);
    onClose();
  };
  const createContainer = () => {
    const n = newCtn.trim();
    if (!n) return;
    createContainerForApp(appId, n);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-bg-elevated border border-border rounded-xl shadow-2xl py-1.5 animate-scale-in max-h-[calc(100vh-16px)] overflow-y-auto"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      {renaming ? (
        <div className="px-3 py-2">
          <label className="text-xs text-text-muted block mb-1.5">
            Renommer « {app.name} »
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename();
            }}
            placeholder={t('ctx.newName')}
            className="input text-sm"
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button onClick={saveRename} className="flex-1 btn btn-primary btn-sm">
              <Check size={14} /> {t('common.save')}
            </button>
            <button
              onClick={() => {
                setRenaming(false);
                setName(app.name);
              }}
              className="btn btn-secondary btn-sm"
            >
              <X size={14} /> {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : moving ? (
        <div className="py-0.5">
          <div className="px-3 py-1.5 text-xs text-text-muted flex items-center gap-2 border-b border-border mb-0.5">
            <ArrowRightLeft size={13} className="flex-shrink-0" />
            <span className="truncate">
              {t('ctx.moveTo', { name: app.name })}
            </span>
          </div>
          {otherProfiles.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">{t('ctx.noOtherProfile')}</div>
          ) : (
            otherProfiles.map((p) => (
              <button
                key={p.id}
                onClick={() => handleMove(p.id)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
              >
                <span className="text-base flex-shrink-0">{p.emoji}</span>
                <span className="flex-1 text-left truncate">{p.name}</span>
              </button>
            ))
          )}
          <div className="my-1 border-t border-border"></div>
          <button
            onClick={() => setMoving(false)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <X size={15} /> {t('common.back')}
          </button>
        </div>
      ) : containing ? (
        <div className="py-0.5">
          <div className="px-3 py-1.5 text-xs text-text-muted flex items-center gap-2 border-b border-border mb-0.5">
            <Layers size={13} className="flex-shrink-0" />
            <span className="truncate">{t('ctx.containerOf', { name: app.name })}</span>
          </div>
          <button
            onClick={() => assignContainer(null)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <span className="w-3 h-3 rounded-full border border-border flex-shrink-0" />
            <span className="flex-1 text-left">{t('ctx.none')}</span>
            {!app.containerId && <CheckIcon size={14} className="text-accent-primary" />}
          </button>
          {containers.map((c) => (
            <button
              key={c.id}
              onClick={() => assignContainer(c.id)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: c.color }}
              />
              <span className="flex-1 text-left truncate">{c.name}</span>
              {app.containerId === c.id && <CheckIcon size={14} className="text-accent-primary" />}
            </button>
          ))}
          <div className="my-1 border-t border-border"></div>
          <div className="px-3 py-2">
            <input
              type="text"
              value={newCtn}
              onChange={(e) => setNewCtn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createContainer();
              }}
              placeholder={t('ctx.newContainer')}
              className="input text-sm"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={createContainer} className="flex-1 btn btn-primary btn-sm">
                <Check size={14} /> {t('ctx.createAssign')}
              </button>
              <button onClick={() => setContaining(false)} className="btn btn-secondary btn-sm">
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* En-tête : rappelle de QUELLE app il s'agit (les actions ci-dessous
              — renommer, déplacer… — s'appliquent à cette app). */}
          <div className="px-3 py-1.5 mb-0.5 border-b border-border flex items-center gap-2">
            <span
              className="w-4 h-4 rounded flex-shrink-0"
              style={{ backgroundColor: `${app.color || '#6366f1'}` }}
            />
            <span className="text-xs font-semibold truncate">{app.name}</span>
          </div>
          {!isActive && (
            <button
              onClick={() => {
                setActiveApp(appId);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
            >
              <Play size={15} /> {t('ctx.open')}
            </button>
          )}
          <button
            onClick={() => {
              toggleAppSleep(appId);
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <Moon size={15} />
            {app.sleeping ? t('ctx.wake') : t('ctx.sleep')}
          </button>
          <button
            onClick={() => {
              updateApp(appId, { muted: !app.muted });
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            {app.muted ? <Bell size={15} /> : <BellOff size={15} />}
            {app.muted ? t('ctx.unmute') : t('ctx.mute')}
          </button>
          <button
            onClick={() => {
              updateApp(appId, { isFavorite: !app.isFavorite });
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            {app.isFavorite ? <PinOff size={15} /> : <Pin size={15} />}
            {app.isFavorite ? t('ctx.unpin') : t('ctx.pin')}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <Pencil size={15} /> {t('ctx.editApp')}
          </button>

          {/* Actions secondaires, repliées par défaut pour alléger le menu */}
          {showMore && (
            <>
              <button
                onClick={startRename}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
              >
                <Edit3 size={15} /> {t('ctx.rename')}
              </button>
              <button
                onClick={openDetached}
                disabled={!app.url}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors disabled:opacity-40"
              >
                <AppWindow size={15} /> {t('ctx.openWindow')}
              </button>
              <button
                onClick={() => {
                  // Le main process redirige window.open vers le navigateur système
                  if (app.url) window.open(app.url, '_blank');
                  onClose();
                }}
                disabled={!app.url}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors disabled:opacity-40"
              >
                <ExternalLink size={15} /> {t('ctx.openBrowser')}
              </button>
              {profiles.length > 1 && (
                <button
                  onClick={() => setMoving(true)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
                >
                  <ArrowRightLeft size={15} /> {t('ctx.moveProfile')}
                  <ChevronRight size={14} className="ml-auto text-text-muted" />
                </button>
              )}
              <button
                onClick={() => setContaining(true)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
              >
                <Layers size={15} /> {t('ctx.container')}
                <ChevronRight size={14} className="ml-auto text-text-muted" />
              </button>
              {/* Bloqueur de pub sur CE site : bascule immédiate (un clic pose
                  une exception explicite pour l'app, dans un sens ou dans
                  l'autre). Les trois états — dont « suivre le réglage global »
                  — sont dans Modifier l'app. */}
              <button
                onClick={() => {
                  updateApp(appId, { adblock: adblockActive ? 'off' : 'on' });
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
              >
                <ShieldBan size={15} />
                <span className="flex-1 text-left">{t('ctx.adblockHere')}</span>
                {adblockActive && <CheckIcon size={14} className="text-accent-primary" />}
              </button>
              <button
                onClick={handleClearData}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
              >
                <Eraser size={15} /> {t('ctx.clearData')}
              </button>
            </>
          )}

          <button
            onClick={() => setShowMore((v) => !v)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-muted hover:bg-bg-hover transition-colors"
          >
            <MoreHorizontal size={15} />
            {showMore ? t('ctx.less') : t('ctx.more')}
          </button>

          <div className="my-1 border-t border-border"></div>
          <button
            onClick={handleUninstall}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors"
          >
            <Trash2 size={15} /> {t('common.uninstall')}
          </button>
        </>
      )}
    </div>
  );
}
