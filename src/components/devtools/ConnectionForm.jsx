import { useEffect, useState } from 'react';
import Modal from './Modal';
import { Database, FolderOpen, Loader2, Pin, PinOff, ShieldCheck, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Fenêtre « Nouvelle connexion / Modifier ».
//
// Deux façons de garder une connexion :
//   • Épinglée : retrouvée au prochain lancement ; le mot de passe est chiffré
//     par le trousseau du système (jamais en clair sur le disque) ;
//   • Jetable  : gardée en mémoire seulement, oubliée à la fermeture d'Orbit.
// ---------------------------------------------------------------------------
export const DRIVER_INFO = {
  sqlite: { label: 'SQLite', color: '#0ea5e9', hint: 'Fichier local (.sqlite, .db)' },
  mysql: { label: 'MySQL / MariaDB', color: '#f59e0b', hint: 'Port 3306 par défaut' },
  postgres: { label: 'PostgreSQL', color: '#6366f1', hint: 'Port 5432 par défaut' },
  mssql: { label: 'SQL Server', color: '#ef4444', hint: 'Pilote téléchargé à la 1re connexion' },
  oracle: { label: 'Oracle', color: '#C74634', hint: 'Port 1521 · sans Instant Client' },
};

const PORTS = { mysql: 3306, postgres: 5432, mssql: 1433, oracle: 1521 };
// Pilotes téléchargés à la demande (voir electron/db-drivers.js).
const ON_DEMAND = { mssql: 'SQL Server', oracle: 'Oracle' };

export default function ConnectionForm({ initial, onClose, onSaved }) {
  const api = window.electronAPI?.database;
  const [form, setForm] = useState(() => ({
    driver: 'postgres',
    name: '',
    host: 'localhost',
    port: '',
    user: '',
    database: '',
    file: '',
    ssl: false,
    sslVerify: true,
    readOnly: false,
    pinned: true,
    ...(initial || {}),
    password: undefined,
  }));
  const [status, setStatus] = useState(null); // { kind: 'ok'|'error'|'busy', text }
  // SQL Server : son pilote n'est pas dans Orbit, il arrive à la première
  // connexion. On le dit AVANT le clic, pour qu'une attente ne surprenne pas.
  const [driver, setDriver] = useState(null);
  const editing = Boolean(initial?.id);
  useEffect(() => {
    let alive = true;
    if (!ON_DEMAND[form.driver]) return undefined;
    api?.driverStatus?.(form.driver).then((r) => {
      if (alive && r?.success) setDriver(r);
    });
    return () => {
      alive = false;
    };
  }, [form.driver, api]);
  const needsDriver = Boolean(ON_DEMAND[form.driver]) && driver && !driver.bundled && !driver.installed;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const isFile = form.driver === 'sqlite';

  const payload = () => ({
    ...form,
    port: form.port ? Number(form.port) : PORTS[form.driver],
    // Champ laissé vide en modification = garder l'ancien mot de passe.
    password: form.password === undefined || (editing && form.password === '') ? undefined : form.password,
  });

  const test = async () => {
    setStatus({ kind: 'busy', text: needsDriver ? `Téléchargement du pilote ${ON_DEMAND[form.driver]}, puis test…` : 'Test de la connexion…' });
    const res = await api?.test(payload());
    setStatus(res?.success ? { kind: 'ok', text: `Connexion réussie (${res.ms} ms)` } : { kind: 'error', text: res?.error || 'Échec' });
  };

  const save = async () => {
    setStatus({ kind: 'busy', text: 'Enregistrement…' });
    const res = await api?.save(payload());
    if (!res?.success) {
      setStatus({ kind: 'error', text: res?.error || 'Échec' });
      return;
    }
    onSaved?.(res.connection);
  };

  const pickFile = async (create) => {
    const res = await api?.pickSqlite(create);
    if (res?.success) set({ file: res.file });
  };

  return (
    <Modal onClose={onClose} className="max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Database size={18} className="text-accent-primary" />
            {editing ? 'Modifier la connexion' : 'Nouvelle connexion'}
          </h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          {Object.entries(DRIVER_INFO).map(([id, d]) => (
            <button
              key={id}
              onClick={() => set({ driver: id, port: '' })}
              className={`rounded-lg border p-2.5 text-left transition-colors ${form.driver === id ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'}`}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                {d.label}
              </div>
              <div className="mt-0.5 text-[11px] text-text-muted">{d.hint}</div>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-text-secondary">Nom (facultatif)</span>
            <input className="input w-full" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Production, Local…" />
          </label>

          {isFile ? (
            <div>
              <span className="mb-1 block text-sm text-text-secondary">Fichier SQLite</span>
              <div className="flex gap-2">
                <input className="input min-w-0 flex-1" value={form.file} onChange={(e) => set({ file: e.target.value })} placeholder="/chemin/vers/base.sqlite" />
                <button className="btn btn-secondary btn-sm" onClick={() => pickFile(false)} title="Ouvrir un fichier existant">
                  <FolderOpen size={14} />
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => pickFile(true)}>
                  Créer…
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <label className="block flex-1 text-sm">
                  <span className="mb-1 block text-text-secondary">Hôte</span>
                  <input className="input w-full" value={form.host} onChange={(e) => set({ host: e.target.value })} />
                </label>
                <label className="block w-24 text-sm">
                  <span className="mb-1 block text-text-secondary">Port</span>
                  <input className="input w-full" value={form.port} placeholder={String(PORTS[form.driver])} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} />
                </label>
              </div>
              <div className="flex gap-2">
                <label className="block flex-1 text-sm">
                  <span className="mb-1 block text-text-secondary">Utilisateur</span>
                  <input className="input w-full" value={form.user} onChange={(e) => set({ user: e.target.value })} autoComplete="off" />
                </label>
                <label className="block flex-1 text-sm">
                  <span className="mb-1 block text-text-secondary">Mot de passe</span>
                  <input
                    className="input w-full"
                    type="password"
                    value={form.password ?? ''}
                    placeholder={editing && initial?.hasPassword ? '•••••• (inchangé)' : ''}
                    onChange={(e) => set({ password: e.target.value })}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-text-secondary">{form.driver === 'oracle' ? 'Nom de service' : 'Base de données'}</span>
                <input
                  className="input w-full"
                  value={form.database}
                  onChange={(e) => set({ database: e.target.value })}
                  placeholder={form.driver === 'postgres' ? 'postgres' : form.driver === 'oracle' ? 'FREEPDB1, ORCLPDB1, XEPDB1…' : ''}
                />
              </label>
              {needsDriver ? (
                <div className="rounded-lg bg-bg-hover px-3 py-2 text-xs text-text-muted">
                  Le pilote {ON_DEMAND[form.driver]} (≈ {Math.max(1, Math.round(driver.size / 1024 / 1024))} Mo) sera téléchargé et vérifié à la première connexion, puis gardé pour les suivantes.
                </div>
              ) : null}
              {form.driver !== 'oracle' ? (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.ssl} onChange={(e) => set({ ssl: e.target.checked })} />
                    Connexion chiffrée (SSL/TLS)
                  </label>
                  {form.ssl ? (
                    <label className="ml-6 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={form.sslVerify !== false}
                        onChange={(e) => set({ sslVerify: e.target.checked })}
                      />
                      <span>
                        Vérifier le certificat du serveur
                        <span className="block text-xs text-text-muted">
                          {form.sslVerify !== false
                            ? 'Recommandé : sans vérification, une connexion interceptée passerait inaperçue.'
                            : 'Non vérifié : à réserver à un serveur de confiance au certificat auto-signé.'}
                        </span>
                      </span>
                    </label>
                  ) : null}
                </>
              ) : null}
            </>
          )}

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.readOnly} onChange={(e) => set({ readOnly: e.target.checked })} />
            <span>
              <span className="flex items-center gap-1 font-medium">
                <ShieldCheck size={13} /> Lecture seule
              </span>
              <span className="text-xs text-text-muted">Consulter et analyser sans risque : toute requête qui modifie est refusée.</span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => set({ pinned: true })}
              className={`rounded-lg border p-2.5 text-left ${form.pinned ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'}`}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Pin size={13} /> Épinglée
              </div>
              <div className="text-[11px] text-text-muted">Retrouvée au prochain lancement, mot de passe chiffré.</div>
            </button>
            <button
              onClick={() => set({ pinned: false })}
              className={`rounded-lg border p-2.5 text-left ${!form.pinned ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'}`}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <PinOff size={13} /> Jetable
              </div>
              <div className="text-[11px] text-text-muted">Rien n’est enregistré : oubliée à la fermeture d’Orbit.</div>
            </button>
          </div>
        </div>

        {status ? (
          <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${status.kind === 'error' ? 'bg-error/10 text-error' : status.kind === 'ok' ? 'bg-success/10 text-success' : 'bg-bg-hover text-text-muted'}`}>
            {status.kind === 'busy' ? <Loader2 size={14} className="animate-spin" /> : null}
            <span className="min-w-0 break-words">{status.text}</span>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary btn-sm" onClick={test} disabled={status?.kind === 'busy'}>
            Tester
          </button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={status?.kind === 'busy'}>
            {editing ? 'Enregistrer' : 'Se connecter'}
          </button>
        </div>
    </Modal>
  );
}
