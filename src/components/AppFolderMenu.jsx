import { useEffect, useRef, useState } from 'react';
import {
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Pencil,
  MousePointerClick,
  FolderMinus,
  Trash2,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';
import { useGuestDismiss } from '../lib/useDismiss';
import { FOLDER_COLORS, FOLDER_EMOJIS } from '../lib/appGroups';

// ---------------------------------------------------------------------------
// Menu contextuel d'un DOSSIER (clic droit sur son en-tête).
//
// Un dossier n'étant qu'un rangement, la ligne rouge est ailleurs : rien dans
// ce menu ne doit pouvoir supprimer une app par surprise. « Dissocier » les
// libère, et « supprimer le dossier et ses apps » demande confirmation en
// rappelant leur nombre.
// ---------------------------------------------------------------------------
export default function AppFolderMenu({ folderId, x, y, onClose, onSelectApps }) {
  const { folders, apps, renameFolder, updateFolder, toggleFolderCollapsed, deleteFolder, deleteApps } =
    useStore();
  const t = useT();
  const menuRef = useRef(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const folder = folders.find((f) => f.id === folderId);
  const folderApps = apps.filter((a) => a.folderId === folderId);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (renaming) setRenaming(false);
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
  }, [onClose, renaming]);

  useGuestDismiss(true, onClose);

  if (!folder) return null;

  const width = 260;
  const rowH = 34;
  const height = renaming ? 150 : rowH * 8 + 90;
  const style = {
    width,
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };

  const saveRename = () => {
    renameFolder(folderId, name);
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
            {t('fold.renameOf', { name: folder.name })}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename();
            }}
            placeholder={t('fold.namePlaceholder')}
            className="input text-sm"
            autoFocus
            maxLength={60}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={saveRename} className="flex-1 btn btn-primary btn-sm">
              <Check size={14} /> {t('common.save')}
            </button>
            <button onClick={() => setRenaming(false)} className="btn btn-secondary btn-sm">
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-1.5 mb-0.5 border-b border-border flex items-center gap-2">
            <span className="text-base leading-none">{folder.emoji}</span>
            <span className="text-xs font-semibold truncate">{folder.name}</span>
            <span className="ml-auto text-[10px] tabular-nums text-text-muted">
              {folderApps.length}
            </span>
          </div>

          <button
            onClick={() => {
              setName(folder.name);
              setRenaming(true);
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <Pencil size={15} /> {t('fold.rename')}
          </button>
          <button
            onClick={() => {
              toggleFolderCollapsed(folderId);
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            {folder.collapsed ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            {folder.collapsed ? t('fold.expand') : t('fold.collapse')}
          </button>
          <button
            onClick={() => {
              onSelectApps?.(folderId);
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <MousePointerClick size={15} /> {t('fold.selectApps')}
          </button>

          {/* Apparence : deux rangées compactes, on tranche en un clic. */}
          <div className="px-3 pt-2 pb-1">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
              {t('fold.icon')}
            </div>
            <div className="flex flex-wrap gap-1">
              {FOLDER_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => updateFolder(folderId, { emoji })}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-base transition-colors ${
                    folder.emoji === emoji ? 'bg-accent-primary/20' : 'hover:bg-bg-hover'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="px-3 pt-1 pb-2">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
              {t('fold.color')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FOLDER_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => updateFolder(folderId, { color })}
                  className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                    folder.color === color ? 'ring-2 ring-offset-1 ring-offset-bg-elevated ring-white/70' : ''
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="my-1 border-t border-border"></div>
          <button
            onClick={() => {
              deleteFolder(folderId);
              onClose();
            }}
            title={t('fold.dissolveHint')}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
          >
            <FolderMinus size={15} /> {t('fold.dissolve')}
          </button>
          <button
            onClick={() => {
              if (
                confirm(
                  t('fold.deleteAllConfirm', { name: folder.name, count: folderApps.length })
                )
              ) {
                deleteApps(folderApps.map((a) => a.id));
              }
              onClose();
            }}
            disabled={folderApps.length === 0}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors disabled:opacity-40"
          >
            <Trash2 size={15} /> {t('fold.deleteAll')}
          </button>
        </>
      )}
    </div>
  );
}
