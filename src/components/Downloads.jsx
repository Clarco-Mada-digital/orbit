import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, X, CheckCircle2, AlertCircle, Trash2, File } from 'lucide-react';
import { useDownloadsStore } from '../lib/downloadsStore';

// Octets → format lisible (Ko, Mo…)
function humanSize(bytes) {
  if (!bytes || bytes < 0) return '';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// Bouton + panneau de téléchargements (comme un navigateur). Le point d'entrée
// des événements 'orbit:download' vit ici : la Topbar monte ce composant une
// seule fois.
export default function Downloads() {
  const { downloads, upsert, remove, clearFinished } = useDownloadsStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Abonnement aux événements de téléchargement du main process
  useEffect(() => {
    const off = window.electronAPI?.onDownload?.((payload) => {
      upsert(payload);
      // Ouvre le panneau automatiquement au démarrage d'un téléchargement
      if (payload.event === 'started') setOpen(true);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [upsert]);

  // Fermer en cliquant à l'extérieur
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  const active = downloads.filter((d) => d.state === 'progressing');
  // Rien à montrer et aucun historique → pas de bouton (évite l'encombrement)
  if (downloads.length === 0) return null;

  return (
    <div className="relative app-no-drag" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`btn-icon relative ${open ? 'bg-bg-hover' : ''}`}
        title="Téléchargements"
      >
        <Download size={18} className={active.length > 0 ? 'text-accent-primary' : undefined} />
        {active.length > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-accent-primary text-white text-[10px] font-bold flex items-center justify-center">
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden z-50 animate-scale-in">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="font-semibold text-sm">Téléchargements</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => window.electronAPI?.openDownloadsFolder?.()}
                className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
                title="Ouvrir le dossier Téléchargements"
              >
                <FolderOpen size={13} /> Dossier
              </button>
              {downloads.some((d) => d.state !== 'progressing') && (
                <button
                  onClick={clearFinished}
                  className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1"
                  title="Effacer la liste (les fichiers restent sur le disque)"
                >
                  <Trash2 size={13} /> Effacer
                </button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {downloads.map((d) => {
              const pct =
                d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : null;
              const done = d.state === 'completed';
              const failed = d.state === 'cancelled' || d.state === 'interrupted';
              return (
                <div key={d.id} className="px-4 py-3 border-b border-border/60 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-bg-secondary border border-border flex items-center justify-center flex-shrink-0">
                      {done ? (
                        <CheckCircle2 size={16} className="text-emerald-500" />
                      ) : failed ? (
                        <AlertCircle size={16} className="text-error" />
                      ) : (
                        <File size={16} className="text-accent-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => done && window.electronAPI?.openDownload?.(d.id)}
                        disabled={!done}
                        className={`block w-full text-left font-medium text-sm truncate ${
                          done ? 'hover:text-accent-primary cursor-pointer' : 'cursor-default'
                        }`}
                        title={done ? 'Ouvrir le fichier' : d.filename}
                      >
                        {d.filename}
                      </button>
                      <div className="text-xs text-text-muted truncate">
                        {done
                          ? humanSize(d.totalBytes || d.receivedBytes)
                          : failed
                            ? 'Téléchargement interrompu'
                            : pct !== null
                              ? `${humanSize(d.receivedBytes)} / ${humanSize(d.totalBytes)} · ${pct}%`
                              : humanSize(d.receivedBytes)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {done && (
                        <button
                          onClick={() => window.electronAPI?.revealDownload?.(d.id)}
                          className="btn-icon w-8 h-8"
                          title="Afficher dans le dossier"
                        >
                          <FolderOpen size={15} />
                        </button>
                      )}
                      {d.state === 'progressing' ? (
                        <button
                          onClick={() => window.electronAPI?.cancelDownload?.(d.id)}
                          className="btn-icon w-8 h-8 text-error"
                          title="Annuler"
                        >
                          <X size={15} />
                        </button>
                      ) : (
                        <button
                          onClick={() => remove(d.id)}
                          className="btn-icon w-8 h-8 text-text-muted"
                          title="Retirer de la liste"
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Barre de progression (couleur d'accent du thème) */}
                  {d.state === 'progressing' && (
                    <div className="mt-2 h-1 rounded-full bg-bg-hover overflow-hidden">
                      <div
                        className="h-full bg-accent-primary transition-[width] duration-200"
                        style={{ width: pct !== null ? `${pct}%` : '40%' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
