import { useEffect, useRef, useState } from 'react';
import {
  Check,
  X,
  Pin,
  PinOff,
  Moon,
  Sun,
  FolderPlus,
  FolderInput,
  FolderMinus,
  ArrowRightLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';
import { useGuestDismiss } from '../lib/useDismiss';
import { foldersFor } from '../lib/appGroups';

// ---------------------------------------------------------------------------
// Menu contextuel d'une SÉLECTION MULTIPLE (Ctrl/Cmd+clic, Maj+clic).
//
// Volontairement distinct du menu d'une seule app : les actions qui n'ont de
// sens que sur un objet (renommer, changer d'URL, ouvrir une fenêtre, effacer
// les données du site) disparaissent, et les actions de masse apparaissent.
// Proposer « effacer les données du site » sur douze apps d'un coup serait une
// invitation à l'accident.
//
// Deux règles de sûreté :
//   - un dossier créé n'est jamais vide (l'action est refusée sans sélection) ;
//   - les suppressions passent par une confirmation qui rappelle le NOMBRE.
// ---------------------------------------------------------------------------
export default function MultiSelectionMenu({ ids, x, y, onClose }) {
  const {
    apps,
    profiles,
    folders,
    activeProfile,
    createFolderWithApps,
    assignAppsToFolder,
    bulkUpdateApps,
    deleteApps,
    moveAppsToProfile,
  } = useStore();
  const t = useT();
  const menuRef = useRef(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [moving, setMoving] = useState(false);
  const [adding, setAdding] = useState(false);

  // Échap annule d'abord le sous-écran en cours, sinon ferme le menu (même
  // logique que le menu d'une app : on ne perd pas une saisie par réflexe).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (naming) {
        setNaming(false);
        setName('');
      } else if (moving) setMoving(false);
      else if (adding) setAdding(false);
      else onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose, naming, moving, adding]);

  // Un clic DANS une app embarquée est invisible depuis l'interface : sans ce
  // relais, le menu resterait ouvert alors qu'on a cliqué ailleurs.
  useGuestDismiss(true, onClose);

  const selected = apps.filter((a) => ids.includes(a.id));
  if (!selected.length) return null;

  const count = selected.length;
  const allFavorite = selected.every((a) => a.isFavorite);
  const allSleeping = selected.every((a) => a.sleeping);
  const otherProfiles = profiles.filter((p) => p.id !== activeProfile);
  const availableFolders = foldersFor(folders, activeProfile);
  // Dossier commun à TOUTE la sélection : seule situation où « retirer du
  // dossier » a un sens explicite.
  const commonFolderId =
    selected.length > 1 && selected.every((a) => a.folderId === selected[0].folderId)
      ? selected[0].folderId
      : null;
  const commonFolder = commonFolderId
    ? folders.find((f) => f.id === commonFolderId)
    : null;

  const width = 260;
  const rowH = 36;
  let rows = 2 + 3 + 1 + 1; // titre, groupe/dossier, épingler, veille, déplacer, désinstaller
  if (commonFolder) rows += 1;
  if (moving) rows = 1 + otherProfiles.length + 1;
  if (adding) rows = 1 + Math.max(availableFolders.length, 1) + 1;
  if (naming) rows = 3;
  const height = rows * rowH + 24;
  const style = {
    width,
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };

  const createFolder = () => {
    createFolderWithApps(name, ids, { fallbackName: t('fold.untitled') });
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-bg-elevated border border-border rounded-xl shadow-2xl py-1.5 animate-scale-in max-h-[calc(100vh-16px)] overflow-y-auto"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      {naming ? (
        <div className="px-3 py-2">
          <label className="text-xs text-text-muted block mb-1.5">
            {t('sb.groupSelected')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createFolder();
            }}
            placeholder={t('fold.namePlaceholder')}
            className="input text-sm"
            autoFocus
            maxLength={60}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={createFolder} className="flex-1 btn btn-primary btn-sm">
              <Check size={14} /> {t('fold.create')}
            </button>
            <button onClick={() => setNaming(false)} className="btn btn-secondary btn-sm">
              <X size={14} />
            </button>
          </div>
        </div>
      ) : moving ? (
        <div className="py-0.5">
          <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border mb-0.5">
            {t('ctx.moveProfile')}
          </div>
          {otherProfiles.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">{t('ctx.noOtherProfile')}</div>
          ) : (
            otherProfiles.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  moveAppsToProfile(ids, p.id);
                  onClose();
                }}
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
      ) : adding ? (
        <div className="py-0.5">
          <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border mb-0.5">
            {t('multi.addToFolder')}
          </div>
          {availableFolders.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">{t('multi.noFolder')}</div>
          ) : (
            availableFolders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  assignAppsToFolder(ids, f.id, activeProfile);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
              >
                <span className="text-base flex-shrink-0">{f.emoji}</span>
                <span className="flex-1 text-left truncate">{f.name}</span>
              </button>
            ))
          )}
          <div className="my-1 border-t border-border"></div>
          <button
            onClick={() => setAdding(false)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <X size={15} /> {t('common.back')}
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 py-1.5 mb-0.5 border-b border-border flex items-center gap-2">
            <span className="text-xs font-semibold truncate">{t('multi.title', { count })}</span>
          </div>
          <button
            onClick={() => setNaming(true)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <FolderPlus size={15} /> {t('sb.groupSelected')}
          </button>
          {availableFolders.length > 0 && (
            <button
              onClick={() => setAdding(true)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
            >
              <FolderInput size={15} /> {t('multi.addToFolder')}
              <ChevronRight size={14} className="ml-auto text-text-muted" />
            </button>
          )}
          {commonFolder && (
            <button
              onClick={() => {
                assignAppsToFolder(ids, null, activeProfile);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
            >
              <FolderMinus size={15} />
              <span className="flex-1 text-left truncate">
                {t('multi.removeFromFolder', { name: commonFolder.name })}
              </span>
            </button>
          )}
          <button
            onClick={() => {
              bulkUpdateApps(ids, { isFavorite: !allFavorite });
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            {allFavorite ? <PinOff size={15} /> : <Pin size={15} />}
            {allFavorite ? t('ctx.unpin') : t('ctx.pin')}
          </button>
          <button
            onClick={() => {
              bulkUpdateApps(ids, { sleeping: !allSleeping });
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            {allSleeping ? <Sun size={15} /> : <Moon size={15} />}
            {allSleeping ? t('ctx.wake') : t('ctx.sleep')}
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
          <div className="my-1 border-t border-border"></div>
          <button
            onClick={() => {
              if (confirm(t('multi.uninstallConfirm', { count }))) deleteApps(ids);
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors"
          >
            <Trash2 size={15} /> {t('multi.uninstall', { count })}
          </button>
        </>
      )}
    </div>
  );
}
