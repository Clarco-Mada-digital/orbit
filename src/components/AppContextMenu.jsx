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
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import EditAppModal from './EditAppModal';

// Menu contextuel (clic droit) sur une app de la sidebar :
// ouvrir / mettre en veille / réveiller / renommer / désinstaller.
// NB : window.prompt n'existe pas dans Electron → le renommage se fait
// via un petit formulaire inline affiché à la place du menu.
export default function AppContextMenu({ appId, x, y, onClose }) {
  const { apps, profiles, activeApp, setActiveApp, toggleAppSleep, deleteApp, updateApp, moveAppToProfile } =
    useStore();
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [name, setName] = useState('');
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
        } else {
          onClose();
        }
      }
    };
    const onScroll = () => {
      if (!editing) onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose, renaming, editing, moving, app?.name]);

  if (!app) return null;

  // Édition complète (nom, URL, icône, couleur…) — modal à la place du menu
  if (editing) {
    return <EditAppModal app={app} onClose={onClose} />;
  }

  const isActive = activeApp === appId;

  // Profils de destination possibles (tous sauf celui de l'app)
  const otherProfiles = profiles.filter((p) => p.id !== app.profileId);

  // Garder le menu entièrement visible dans la fenêtre (même sidebar réduite)
  const width = renaming ? 256 : 240;
  const height = renaming ? 150 : moving ? 130 + otherProfiles.length * 44 : 380;
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
        `Désinstaller « ${app.name} » ?\nL'application sera retirée de votre profil.`
      )
    ) {
      deleteApp(appId);
      // Purge cookies/session du compte via la clé de session STABLE
      // (chaque app a sa propre partition).
      window.electronAPI?.clearAppSession?.({
        sessionKey: app.sessionKey || `${app.profileId}:${appId}`,
        profileId: app.profileId,
        appId,
      });
    }
    onClose();
  };

  const handleMove = (targetProfileId) => {
    moveAppToProfile(appId, targetProfileId);
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
            placeholder="Nouveau nom…"
            className="input text-sm"
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button onClick={saveRename} className="flex-1 btn btn-primary btn-sm">
              <Check size={14} /> Enregistrer
            </button>
            <button
              onClick={() => {
                setRenaming(false);
                setName(app.name);
              }}
              className="btn btn-secondary btn-sm"
            >
              <X size={14} /> Annuler
            </button>
          </div>
        </div>
      ) : moving ? (
        <div className="py-0.5">
          <div className="px-3 py-1.5 text-xs text-text-muted flex items-center gap-2 border-b border-border mb-0.5">
            <ArrowRightLeft size={13} className="flex-shrink-0" />
            <span className="truncate">
              Déplacer « {app.name} » vers&nbsp;:
            </span>
          </div>
          {otherProfiles.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">Aucun autre profil</div>
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
            <X size={15} /> Retour
          </button>
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
              <Play size={15} /> Ouvrir
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
            {app.sleeping ? 'Réveiller' : 'Mettre en veille'}
          </button>
          <button
            onClick={() => {
              updateApp(appId, { muted: !app.muted });
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            {app.muted ? <Bell size={15} /> : <BellOff size={15} />}
            {app.muted ? 'Réactiver les notifications' : 'Couper les notifications'}
          </button>
          <button
            onClick={startRename}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <Edit3 size={15} /> Renommer l'application
          </button>
          <button
            onClick={() => setEditing(true)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <Pencil size={15} /> Modifier (icône, URL, couleur…)
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
            <ExternalLink size={15} /> Ouvrir dans le navigateur
          </button>
          {profiles.length > 1 && (
            <button
              onClick={() => setMoving(true)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
            >
              <ArrowRightLeft size={15} /> Déplacer vers un profil
              <ChevronRight size={14} className="ml-auto text-text-muted" />
            </button>
          )}
          <div className="my-1 border-t border-border"></div>
          <button
            onClick={handleUninstall}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors"
          >
            <Trash2 size={15} /> Désinstaller
          </button>
        </>
      )}
    </div>
  );
}
