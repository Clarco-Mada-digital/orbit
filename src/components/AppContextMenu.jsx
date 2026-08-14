import { useEffect, useRef, useState } from 'react';
import { Play, Moon, Trash2, Edit3, Check, X, ExternalLink, Pencil } from 'lucide-react';
import { useStore } from '../stores/useStore';
import EditAppModal from './EditAppModal';

// Menu contextuel (clic droit) sur une app de la sidebar :
// ouvrir / mettre en veille / réveiller / renommer / désinstaller.
// NB : window.prompt n'existe pas dans Electron → le renommage se fait
// via un petit formulaire inline affiché à la place du menu.
export default function AppContextMenu({ appId, x, y, onClose }) {
  const { apps, activeApp, setActiveApp, toggleAppSleep, deleteApp, updateApp } = useStore();
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const app = apps.find((a) => a.id === appId);
  const menuRef = useRef(null);

  // Fermer au clic EN DEHORS du menu, à la molette, à Échap, ou au redimensionnement.
  // NB : un clic DANS le menu (champ de renommage, boutons…) ne doit pas le fermer
  // — c'était la cause du « renommer ne marche pas » : le menu se fermait
  // aussitôt le formulaire ouvert.
  useEffect(() => {
    const close = (e) => {
      // Pendant l'édition, le modal gère sa propre fermeture (clic sur le fond)
      if (editing) return;
      if (menuRef.current && e && menuRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      // Échap annule le renommage d'abord, sinon ferme le menu
      if (e.key === 'Escape') {
        if (renaming) {
          setRenaming(false);
          setName(app?.name || '');
        } else {
          onClose();
        }
      }
    };
    const onScroll = () => {
      if (!editing) onClose();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose, renaming, editing, app?.name]);

  if (!app) return null;

  // Édition complète (nom, URL, icône, couleur…) — modal à la place du menu
  if (editing) {
    return <EditAppModal app={app} onClose={onClose} />;
  }

  const isActive = activeApp === appId;

  // Garder le menu entièrement visible dans la fenêtre (même sidebar réduite)
  const width = renaming ? 256 : 208;
  const height = renaming ? 150 : 190;
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
      // Purge cookies/session du compte (chaque app a sa propre session)
      window.electronAPI?.clearAppSession?.(app.profileId, appId);
    }
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
      ) : (
        <>
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
            onClick={startRename}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <Edit3 size={15} /> Renommer
          </button>
          <button
            onClick={() => setEditing(true)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <Pencil size={15} /> Modifier…
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
