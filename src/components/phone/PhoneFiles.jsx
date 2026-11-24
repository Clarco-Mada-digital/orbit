import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Upload, ChevronRight, Download, Eye, EyeOff, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, Folder, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { PHONE_FS_ROOT, PHONE_FS_SHORTCUTS, phoneParentPath, formatPhoneSize } from '../../lib/phone';

// ---------------------------------------------------------------------------
// Téléphone → ordinateur : parcourir le stockage du téléphone et récupérer
// fichiers ou dossiers. Fonctionne en USB comme sans fil (adb pull).
// ---------------------------------------------------------------------------

function iconFor(entry) {
  if (entry.dir) return Folder;
  const ext = entry.name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext)) return FileImage;
  if (['mp4', 'mkv', 'mov', '3gp', 'webm', 'avi'].includes(ext)) return FileVideo;
  if (['mp3', 'm4a', 'ogg', 'opus', 'wav', 'aac', 'flac'].includes(ext)) return FileAudio;
  if (['zip', 'rar', '7z', 'apk', 'tar', 'gz'].includes(ext)) return FileArchive;
  if (['pdf', 'txt', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'md'].includes(ext)) return FileText;
  return File;
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

export default function PhoneFiles({ api, serial }) {
  const [dir, setDir] = useState(PHONE_FS_ROOT);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(
    async (target) => {
      if (!api || !serial) return;
      setLoading(true);
      setError('');
      const r = await api.listDir({ serial, path: target });
      setLoading(false);
      if (!r?.success) {
        setError(r?.error || 'Dossier illisible.');
        return;
      }
      setDir(r.path);
      setEntries(r.entries || []);
      setSelected(new Set());
    },
    [api, serial]
  );

  useEffect(() => {
    // Différé d'une tâche : aucun setState pendant l'effet lui-même.
    const t = setTimeout(() => load(PHONE_FS_ROOT), 0);
    return () => clearTimeout(t);
  }, [load]);

  const visible = useMemo(() => entries.filter((e) => showHidden || !e.hidden), [entries, showHidden]);
  const crumbs = useMemo(() => {
    const parts = dir.replace(PHONE_FS_ROOT, '').split('/').filter(Boolean);
    return [{ label: 'Stockage', path: PHONE_FS_ROOT }, ...parts.map((p, i) => ({ label: p, path: `${PHONE_FS_ROOT}/${parts.slice(0, i + 1).join('/')}` }))];
  }, [dir]);

  const toggle = (p) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const pull = async (paths) => {
    if (!paths.length || busy) return;
    setBusy(true);
    setResult(null);
    const r = await api.pullFiles({ serial, paths });
    setBusy(false);
    if (r?.cancelled) return;
    setResult(r);
    if (r?.received?.length) setSelected(new Set());
  };

  // Glisser-déposer depuis l'ordinateur : envoi dans le dossier AFFICHÉ.
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onDragOver = (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  };
  const onDrop = async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length || busy) return;
    setBusy(true);
    setResult(null);
    const r = await api.pushDropped(files, { serial, remoteDir: dir });
    setBusy(false);
    setResult({
      success: r?.success,
      sentCount: r?.sent?.length || 0,
      error: r?.success ? undefined : r?.error || 'Envoi impossible.',
    });
    load(dir);
  };

  const selectedSize = visible.filter((e) => selected.has(e.path)).reduce((n, e) => n + e.size, 0);
  const parent = phoneParentPath(dir);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragOver || (busy && !selected.size) ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent-primary bg-bg-primary/90 text-sm">
          {busy ? <Loader2 size={28} className="animate-spin text-accent-primary" /> : <Upload size={28} className="text-accent-primary" />}
          <span className="font-medium">{busy ? 'Envoi vers le téléphone…' : 'Déposer pour envoyer sur le téléphone'}</span>
          <span className="max-w-full truncate px-6 font-mono text-xs text-text-muted">{dir}</span>
        </div>
      ) : null}
      {/* Raccourcis */}
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-3 py-2">
        {PHONE_FS_SHORTCUTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => load(s.path)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${dir.startsWith(s.path) ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Chemin + actions */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button type="button" disabled={!parent || loading} onClick={() => parent && load(parent)} className="rounded-md p-1 hover:bg-bg-hover disabled:opacity-40" aria-label="Dossier parent" title="Dossier parent">
          <ArrowLeft size={15} />
        </button>
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs" aria-label="Chemin">
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex shrink-0 items-center gap-0.5">
              {i ? <ChevronRight size={12} className="text-text-muted" /> : null}
              <button type="button" onClick={() => load(c.path)} className={`rounded px-1 py-0.5 hover:bg-bg-hover ${i === crumbs.length - 1 ? 'font-medium' : 'text-text-muted'}`}>
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <button type="button" onClick={() => setShowHidden((v) => !v)} className="rounded-md p-1 text-text-muted hover:bg-bg-hover" title={showHidden ? 'Masquer les fichiers cachés' : 'Afficher les fichiers cachés'} aria-label="Fichiers cachés">
          {showHidden ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button type="button" onClick={() => load(dir)} className="rounded-md p-1 text-text-muted hover:bg-bg-hover" title="Actualiser" aria-label="Actualiser">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Barre de sélection */}
      {selected.size ? (
        <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-accent-primary/10 px-3 py-1.5 text-xs">
          <span className="flex-1">
            {selected.size} élément{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
            {selectedSize ? ` · ${formatPhoneSize(selectedSize)}` : ''}
          </span>
          <button type="button" onClick={() => setSelected(new Set())} className="rounded-md px-2 py-0.5 hover:bg-bg-hover">
            Désélectionner
          </button>
          <button type="button" disabled={busy} onClick={() => pull([...selected])} className="flex items-center gap-1.5 rounded-md bg-accent-primary px-2.5 py-1 font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Récupérer sur l’ordinateur
          </button>
        </div>
      ) : null}

      {result ? (
        <div className={`mx-3 mb-2 shrink-0 rounded-lg px-3 py-1.5 text-xs ${result.success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
          {result.sentCount ? (
            <>
              {result.sentCount} élément{result.sentCount > 1 ? 's' : ''} envoyé{result.sentCount > 1 ? 's' : ''} sur le téléphone.
            </>
          ) : null}
          {result.received?.length ? (
            <>
              {result.received.length} élément{result.received.length > 1 ? 's' : ''} récupéré{result.received.length > 1 ? 's' : ''}.{' '}
              <button type="button" onClick={() => api.showReceived(result.received[0])} className="underline">
                Afficher dans le dossier
              </button>
            </>
          ) : null}
          {result.error ? <span> {result.error}</span> : null}
        </div>
      ) : null}

      {/* Liste */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {error ? <p className="py-6 text-center text-sm text-red-500">{error}</p> : null}
        {!error && !loading && visible.length === 0 ? <p className="py-6 text-center text-sm text-text-muted">Dossier vide.</p> : null}
        {!error ? (
          <p className="mb-2 text-center text-[11px] text-text-muted">Glissez des fichiers ou des dossiers de l’ordinateur ici pour les envoyer dans ce dossier.</p>
        ) : null}
        <ul className="divide-y divide-border rounded-xl border border-border">
          {visible.map((e) => {
            const Icon = e.dir ? (selected.has(e.path) ? FolderOpen : Folder) : iconFor(e);
            const on = selected.has(e.path);
            return (
              <li key={e.path} className={`group flex items-center gap-2 px-2.5 py-1.5 text-sm ${on ? 'bg-accent-primary/5' : 'hover:bg-bg-hover'}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Sélectionner ${e.name}`}
                  onClick={() => toggle(e.path)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-accent-primary bg-accent-primary text-white' : 'border-border'}`}
                >
                  {on ? <Check size={11} /> : null}
                </button>
                <Icon size={16} className={e.dir ? 'shrink-0 text-accent-primary' : 'shrink-0 text-text-muted'} />
                <button
                  type="button"
                  onClick={() => (e.dir ? load(e.path) : toggle(e.path))}
                  onDoubleClick={() => !e.dir && pull([e.path])}
                  className={`min-w-0 flex-1 truncate text-left ${e.hidden ? 'text-text-muted' : ''}`}
                  title={e.dir ? 'Ouvrir' : 'Cliquer : sélectionner · double-clic : récupérer'}
                >
                  {e.name}
                </button>
                <span className="hidden w-24 shrink-0 text-right text-xs text-text-muted sm:block">{e.mtime ? dateFmt.format(new Date(e.mtime)) : ''}</span>
                <span className="w-16 shrink-0 text-right text-xs text-text-muted">{e.dir ? '' : formatPhoneSize(e.size)}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pull([e.path])}
                  className="shrink-0 rounded-md p-1 text-text-muted opacity-0 hover:bg-bg-hover hover:text-text-primary group-hover:opacity-100 focus:opacity-100"
                  title="Récupérer sur l’ordinateur"
                  aria-label={`Récupérer ${e.name}`}
                >
                  <Download size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
