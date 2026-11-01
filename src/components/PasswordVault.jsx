import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Lock,
  Unlock,
  Plus,
  Search,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  Pencil,
  ShieldCheck,
  ShieldAlert,
  Download,
  Upload,
  RefreshCw,
  KeyRound,
  Timer,
  X,
  Check,
  Settings2,
  Database,
  Archive,
  Loader2,
  ArrowDownUp,
} from 'lucide-react';
import { useT } from '../lib/i18n';
import CredentialSource from './CredentialSource';
import VaultBackupSettings from './VaultBackupSettings';

// ---------------------------------------------------------------------------
// Coffre-fort de mots de passe (Réglages → Mots de passe)
//
// Rien de sensible ne vit dans cet écran : le processus principal détient la
// clé et les entrées. On lui demande la liste SANS les mots de passe, et on ne
// récupère un secret qu'au moment où l'utilisateur clique « afficher ». La
// copie, elle, ne passe même pas par ici — c'est le principal qui écrit dans le
// presse-papiers et le vide 30 s plus tard.
// ---------------------------------------------------------------------------
const api = () => window.electronAPI?.vault;

const STRENGTH_LABELS = ['—', 'Faible', 'Moyen', 'Bon', 'Excellent'];
const STRENGTH_COLORS = ['bg-border', 'bg-error', 'bg-warning', 'bg-accent-primary', 'bg-success'];

// Champ secret avec bascule d'affichage. Indispensable pour un mot de passe
// MAÎTRE : on le saisit une seule fois, il n'existe nulle part ailleurs, et une
// faute de frappe invisible rend le trousseau inaccessible pour toujours. C'est
// encore plus vrai avec une phrase de passe générée, qu'on veut pouvoir relire
// pour la recopier ailleurs.
function SecretInput({ value, onChange, placeholder, autoFocus, onEnter, className = '' }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`input pr-10 ${shown ? 'font-mono' : ''}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        title={t('pv.toggleShow')}
        aria-label={t('pv.toggleShow')}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
      >
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function StrengthBar({ score }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-bg-primary overflow-hidden flex gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`flex-1 transition-colors ${i <= score ? STRENGTH_COLORS[score] : 'bg-border'}`}
          />
        ))}
      </div>
      <span className="text-xs text-text-muted w-20">{STRENGTH_LABELS[score] || '—'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Création d'un trousseau
// ---------------------------------------------------------------------------
function CreateVault({ onDone, onCancel }) {
  const t = useT();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🔐');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [score, setScore] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!password) {
      setScore(0);
      return;
    }
    let alive = true;
    api()
      ?.strength(password)
      .then((r) => alive && setScore(r?.score || 0));
    return () => {
      alive = false;
    };
  }, [password]);

  const suggest = async () => {
    const r = await api()?.generate({ passphrase: true, words: 5 });
    if (r?.password) {
      setPassword(r.password);
      setConfirm(r.password);
    }
  };

  const submit = async () => {
    setError('');
    if (password !== confirm) {
      setError(t('pv.err.mismatch'));
      return;
    }
    setBusy(true);
    const res = await api()?.create({ name, password, icon });
    setBusy(false);
    if (!res?.success) {
      setError(res?.error === 'weak-master' ? t('pv.err.weakMaster') : t('pv.err.nameRequired'));
      return;
    }
    onDone(res.id);
  };

  return (
    <div className="card space-y-4">
      <div>
        <h4 className="font-semibold">{t('pv.newVault')}</h4>
        <p className="text-sm text-text-muted mt-1">{t('pv.newVaultDesc')}</p>
      </div>

      <div className="flex gap-2">
        <input
          value={icon}
          onChange={(e) => setIcon(e.target.value.slice(0, 2))}
          className="input w-14 text-center text-lg"
          aria-label={t('pv.icon')}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('pv.namePlaceholder')}
          className="input flex-1"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <SecretInput
            value={password}
            onChange={setPassword}
            placeholder={t('pv.masterPassword')}
            className="flex-1"
          />
          <button onClick={suggest} className="btn btn-secondary btn-sm" title={t('pv.suggestPassphrase')}>
            <RefreshCw size={14} />
          </button>
        </div>
        <StrengthBar score={score} />
        <SecretInput value={confirm} onChange={setConfirm} placeholder={t('pv.confirmMaster')} />
      </div>

      {/* Avertissement non négociable : sans le mot de passe maître, le
          contenu est définitivement illisible — c'est le principe même du
          chiffrement, pas une limite qu'on pourrait contourner. */}
      <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-lg p-3">
        {t('pv.noRecovery')}
      </div>

      {error && <div className="text-sm text-error">{error}</div>}

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn btn-primary flex-1">
          <Check size={16} /> {t('pv.create')}
        </button>
        <button onClick={onCancel} className="btn btn-secondary">
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Déverrouillage
// ---------------------------------------------------------------------------
function UnlockVault({ vault, onUnlocked }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Mémoriser le mot de passe sur cet appareil : coché ICI, au moment où on
  // le saisit, plutôt que dans un écran de réglages où il faudrait le retaper.
  const [remember, setRemember] = useState(false);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    setError('');
    const res = await api()?.unlock(vault.id, password);
    if (res?.success && remember) {
      // Mémorisation après un déverrouillage réussi : le mot de passe est donc
      // déjà vérifié. Un refus (pas de trousseau système) ne doit pas annuler
      // le déverrouillage, qui a bien eu lieu.
      const kept = await api()?.remember(vault.id, password);
      if (!kept?.success) setError(t('pv.remember.failed'));
    }
    setBusy(false);
    setPassword('');
    if (!res?.success) {
      setError(t('pv.err.badPassword'));
      return;
    }
    onUnlocked();
  };

  // Déverrouillage sans saisie : le mot de passe vient du trousseau de l'OS,
  // il ne passe pas par cet écran.
  const unlockRemembered = async () => {
    setBusy(true);
    setError('');
    const res = await api()?.unlockRemembered(vault.id);
    setBusy(false);
    if (!res?.success) {
      setError(t(res?.error === 'not-remembered' ? 'pv.remember.gone' : 'pv.err.badPassword'));
      onUnlocked(); // rafraîchit l'état : la mémorisation a pu être effacée
      return;
    }
    onUnlocked();
  };

  return (
    <div className="card max-w-md mx-auto text-center space-y-4 mt-8">
      <div className="text-4xl">{vault.icon}</div>
      <div>
        <h4 className="font-semibold">{vault.name}</h4>
        <p className="text-sm text-text-muted mt-1">{t('pv.lockedDesc')}</p>
      </div>

      {vault.remembered && (
        <>
          <button onClick={unlockRemembered} disabled={busy} className="btn btn-primary w-full">
            <Unlock size={16} /> {busy ? t('pv.unlocking') : t('pv.remember.unlock')}
          </button>
          <button
            onClick={async () => {
              await api()?.forgetRemembered(vault.id);
              onUnlocked();
            }}
            className="btn btn-ghost btn-sm"
          >
            {t('pv.remember.forget')}
          </button>
          <div className="text-xs text-text-muted">{t('pv.remember.orType')}</div>
        </>
      )}

      <SecretInput
        value={password}
        onChange={setPassword}
        onEnter={submit}
        autoFocus={!vault.remembered}
        placeholder={t('pv.masterPassword')}
      />
      {error && <div className="text-sm text-error">{error}</div>}
      <button
        onClick={submit}
        disabled={busy || !password}
        className={`btn w-full ${vault.remembered ? 'btn-secondary' : 'btn-primary'}`}
      >
        <Unlock size={16} /> {busy ? t('pv.unlocking') : t('pv.unlock')}
      </button>

      {!vault.remembered && (
        <label className="flex items-start gap-2 text-left text-xs text-text-muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 accent-accent-primary"
          />
          <span>
            <span className="block font-medium text-text-secondary">{t('pv.remember.label')}</span>
            {t('pv.remember.warning')}
          </span>
        </label>
      )}

      <p className="text-xs text-text-muted">{t('pv.unlockSlowHint')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Éditeur d'entrée
// ---------------------------------------------------------------------------
function EntryEditor({ vaultId, entry, categories, onSaved, onCancel }) {
  const t = useT();
  const [form, setForm] = useState({
    title: entry?.title || '',
    url: entry?.url || '',
    username: entry?.username || '',
    password: '',
    totp: '',
    notes: entry?.notes || '',
    category: entry?.category || '',
  });
  // Sur une entrée existante, laisser les champs secrets VIDES signifie « ne
  // pas y toucher » : on ne les charge pas depuis le coffre pour ne pas les
  // faire transiter sans raison.
  const [touchedPassword, setTouchedPassword] = useState(!entry);
  const [touchedTotp, setTouchedTotp] = useState(!entry);
  const [show, setShow] = useState(false);
  const [score, setScore] = useState(0);
  const [genOpen, setGenOpen] = useState(false);
  const [genOpts, setGenOpts] = useState({ length: 20, symbols: true });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.password) {
      setScore(0);
      return;
    }
    let alive = true;
    api()
      ?.strength(form.password)
      .then((r) => alive && setScore(r?.score || 0));
    return () => {
      alive = false;
    };
  }, [form.password]);

  const generate = async (opts) => {
    const r = await api()?.generate(opts);
    if (r?.password) {
      set('password', r.password);
      setTouchedPassword(true);
      setShow(true);
    }
  };

  const save = async () => {
    const payload = {
      id: entry?.id,
      title: form.title,
      url: form.url,
      username: form.username,
      notes: form.notes,
      category: form.category,
    };
    // `undefined` = inchangé côté processus principal.
    if (touchedPassword) payload.password = form.password;
    if (touchedTotp) payload.totp = form.totp;
    const res = await api()?.saveEntry(vaultId, payload);
    if (res?.success) onSaved();
  };

  return (
    <div className="fixed inset-0 z-[10001] bg-black/60 flex items-center justify-center animate-fade-in p-6">
      <div className="w-full max-w-lg bg-bg-secondary border border-border rounded-2xl shadow-2xl animate-scale-in max-h-full flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold">{entry ? t('pv.editEntry') : t('pv.newEntry')}</h3>
          <button onClick={onCancel} className="btn-icon">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.title')}</label>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} className="input" autoFocus />
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.url')}</label>
            <input
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://exemple.com"
              className="input"
            />
            <p className="text-xs text-text-muted mt-1">{t('pv.f.urlHint')}</p>
          </div>
          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.username')}</label>
            <input value={form.username} onChange={(e) => set('username', e.target.value)} className="input" />
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.password')}</label>
            <div className="flex gap-2">
              <input
                type={show ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => {
                  set('password', e.target.value);
                  setTouchedPassword(true);
                }}
                placeholder={entry ? t('pv.f.passwordKeep') : ''}
                className="input flex-1 font-mono"
              />
              <button onClick={() => setShow((v) => !v)} className="btn btn-secondary btn-sm" title={t('pv.toggleShow')}>
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                onClick={() => setGenOpen((v) => !v)}
                className="btn btn-secondary btn-sm"
                title={t('pv.generate')}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {touchedPassword && form.password && <div className="mt-2"><StrengthBar score={score} /></div>}

            {genOpen && (
              <div className="mt-2 p-3 rounded-lg bg-bg-primary border border-border space-y-2">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-text-muted flex-shrink-0">{t('pv.gen.length')}</label>
                  <input
                    type="range"
                    min="10"
                    max="48"
                    value={genOpts.length}
                    onChange={(e) => setGenOpts((o) => ({ ...o, length: Number(e.target.value) }))}
                    className="flex-1"
                  />
                  <span className="text-xs font-mono w-6 text-right">{genOpts.length}</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={genOpts.symbols}
                    onChange={(e) => setGenOpts((o) => ({ ...o, symbols: e.target.checked }))}
                  />
                  {t('pv.gen.symbols')}
                </label>
                <div className="flex gap-2">
                  <button onClick={() => generate(genOpts)} className="btn btn-primary btn-sm flex-1">
                    {t('pv.gen.random')}
                  </button>
                  <button
                    onClick={() => generate({ passphrase: true, words: 4 })}
                    className="btn btn-secondary btn-sm flex-1"
                  >
                    {t('pv.gen.passphrase')}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.totp')}</label>
            <input
              value={form.totp}
              onChange={(e) => {
                set('totp', e.target.value);
                setTouchedTotp(true);
              }}
              placeholder={entry?.hasTotp ? t('pv.f.totpKeep') : 'JBSWY3DPEHPK3PXP  ·  otpauth://…'}
              className="input font-mono text-sm"
            />
            <p className="text-xs text-text-muted mt-1">{t('pv.f.totpHint')}</p>
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.category')}</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className="input">
              <option value="">{t('pv.f.noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.notes')}</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="input resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex gap-2">
          <button onClick={save} className="btn btn-primary flex-1">
            <Check size={16} /> {t('common.save')}
          </button>
          <button onClick={onCancel} className="btn btn-secondary">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ligne d'entrée
// ---------------------------------------------------------------------------
function EntryRow({ vaultId, entry, categories, onEdit, onDeleted, onToast }) {
  const t = useT();
  const [revealed, setRevealed] = useState('');
  const [totp, setTotp] = useState(null);
  const category = categories.find((c) => c.id === entry.category);

  // Le code TOTP change toutes les 30 s : on le rafraîchit tant qu'il est
  // affiché, et on l'oublie dès que la ligne est repliée.
  useEffect(() => {
    if (!totp) return undefined;
    const timer = setInterval(async () => {
      const r = await api()?.totp(vaultId, entry.id);
      if (r?.success) setTotp(r);
    }, 1000);
    return () => clearInterval(timer);
  }, [totp && totp.code, vaultId, entry.id]);

  const reveal = async () => {
    if (revealed) {
      setRevealed('');
      return;
    }
    const r = await api()?.reveal(vaultId, entry.id, 'password');
    if (r?.success) setRevealed(r.value);
  };

  const copy = async (field) => {
    const r = await api()?.copy(vaultId, entry.id, field);
    onToast(r?.success ? t('pv.copied') : t('pv.copyFailed'));
  };

  const showTotp = async () => {
    if (totp) {
      setTotp(null);
      return;
    }
    const r = await api()?.totp(vaultId, entry.id);
    if (r?.success) setTotp(r);
  };

  const remove = async () => {
    const res = await api()?.deleteEntry(vaultId, entry.id);
    if (res?.success) onDeleted();
  };

  return (
    <div className="rounded-lg border border-border bg-bg-primary p-3 hover:border-accent-primary/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{entry.title}</span>
            {category && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: `${category.color}25`, color: category.color }}
              >
                {category.name}
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted truncate mt-0.5">
            {entry.username || t('pv.noUsername')}
            {entry.url ? ` · ${entry.url.replace(/^https?:\/\//, '')}` : ''}
          </div>
          {revealed && (
            <div className="mt-2 font-mono text-sm bg-bg-elevated border border-border rounded px-2 py-1 break-all select-all">
              {revealed}
            </div>
          )}
          {totp && (
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-lg tracking-widest">{totp.code}</span>
              <span className="text-xs text-text-muted">{totp.secondsLeft}s</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {entry.hasTotp && (
            <button onClick={showTotp} className="btn-icon" title={t('pv.showTotp')}>
              <Timer size={15} className={totp ? 'text-accent-primary' : ''} />
            </button>
          )}
          {entry.username && (
            <button onClick={() => copy('username')} className="btn-icon" title={t('pv.copyUser')}>
              <span className="text-[11px] font-semibold">@</span>
            </button>
          )}
          <button onClick={() => copy('password')} className="btn-icon" title={t('pv.copyPassword')}>
            <Copy size={15} />
          </button>
          <button onClick={reveal} className="btn-icon" title={t('pv.toggleShow')}>
            {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button onClick={onEdit} className="btn-icon" title={t('common.edit')}>
            <Pencil size={15} />
          </button>
          <button onClick={remove} className="btn-icon text-error" title={t('common.delete')}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu « Importer / Exporter »
// ---------------------------------------------------------------------------
// Quatre actions rares (import fichier, rapatriement KeePassXC, restauration
// d'archive, export) partagent un seul bouton : alignées dans la barre, elles
// faisaient sept icônes à la suite, que plus personne ne distingue.
function TransferMenu({ busy, onImportFile, onImportKeepass, onRestoreArchive, onExport }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Fermeture au clic EXTÉRIEUR.
  //
  // Surtout pas en phase capture sur `window` : le clic sur une entrée du menu
  // passerait d'abord par ce gestionnaire, qui démonterait l'entrée avant que
  // React ne lui délivre son `onClick`. Le menu se refermait alors sans rien
  // exécuter — exactement le symptôme « je clique, il ne se passe rien ».
  //
  // On écoute donc `mousedown` en phase de bulle, et on ne ferme que si le
  // clic est tombé hors du menu.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const items = [
    { id: 'importFile', icon: Upload, label: t('pv.import'), run: onImportFile },
    { id: 'importKeepass', icon: Database, label: t('pv.kpImport.action'), run: onImportKeepass },
    { id: 'restore', icon: Archive, label: t('pv.restoreArchive'), run: onRestoreArchive },
    { id: 'export', icon: Download, label: t('pv.export'), run: onExport },
  ];

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn btn-secondary btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('pv.transfer')}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownUp size={14} />}
        {t('pv.transfer')}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-elevated shadow-lg p-1"
        >
          {items.map(({ id, icon: Icon, label, run }) => (
            <button
              key={id}
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                run();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left hover:bg-bg-hover disabled:opacity-50"
            >
              <Icon size={14} className="flex-shrink-0 text-text-muted" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panneau principal
// ---------------------------------------------------------------------------
export default function PasswordVault() {
  const t = useT();
  const [vaults, setVaults] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [creating, setCreating] = useState(false);
  const [entries, setEntries] = useState([]);
  const [entriesError, setEntriesError] = useState('');
  const [categories, setCategories] = useState([]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editing, setEditing] = useState(null); // { entry } | { entry: null }
  const [toast, setToast] = useState('');
  const [showEntries, setShowEntries] = useState(false);
  const [audit, setAudit] = useState(null);
  const [auditError, setAuditError] = useState('');
  const [auditing, setAuditing] = useState(false);
  const [breachAudit, setBreachAudit] = useState(null);
  const [breachError, setBreachError] = useState('');
  const [checkingBreaches, setCheckingBreaches] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportError, setExportError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [keepassImport, setKeepassImport] = useState(null); // { done, total } pendant le rapatriement
  const [keepassError, setKeepassError] = useState('');
  const [keepassReport, setKeepassReport] = useState(null);
  const [managing, setManaging] = useState(false);
  const entriesRequestRef = useRef(0);

  const refreshVaults = useCallback(async () => {
    const state = await api()?.state();
    const list = state?.vaults || [];
    setVaults(list);
    setActiveId((cur) => (list.some((v) => v.id === cur) ? cur : list[0]?.id || ''));
    return list;
  }, []);

  const active = vaults.find((v) => v.id === activeId);

  const refreshEntries = useCallback(async (id) => {
    if (!id) return;
    const requestId = ++entriesRequestRef.current;
    setEntriesError('');
    try {
      const res = await api()?.entries(id);
      if (requestId !== entriesRequestRef.current) return;
      if (!res?.success) {
        console.error('[vault] chargement des identifiants échoué:', res?.error || 'unknown');
        setEntriesError('pv.entriesLoadFailed');
        setEntries([]);
        setCategories([]);
        return;
      }
      setEntries(res.entries);
      setCategories(res.categories || []);
    } catch (error) {
      if (requestId !== entriesRequestRef.current) return;
      console.error('[vault] chargement des identifiants échoué:', error);
      setEntriesError('pv.entriesLoadFailed');
      setEntries([]);
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    refreshVaults();
  }, [refreshVaults]);

  useEffect(() => {
    if (active?.unlocked && showEntries) {
      refreshEntries(active.id);
    } else {
      entriesRequestRef.current += 1;
      setEntriesError('');
      setEntries([]);
      setCategories([]);
    }
    if (!active?.unlocked) {
      setAudit(null);
      setAuditError('');
      setBreachAudit(null);
      setBreachError('');
    }
  }, [active?.id, active?.unlocked, showEntries, refreshEntries]);

  // Un trousseau se referme tout seul après inactivité : sans ce rappel,
  // l'écran continuerait d'afficher une liste qui n'est plus déverrouillée.
  useEffect(() => {
    const timer = setInterval(refreshVaults, 20000);
    return () => clearInterval(timer);
  }, [refreshVaults]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => categoryFilter === 'all' || (e.category || '') === (categoryFilter === 'none' ? '' : categoryFilter))
      .filter(
        (e) =>
          !q ||
          e.title.toLowerCase().includes(q) ||
          (e.username || '').toLowerCase().includes(q) ||
          (e.url || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [entries, query, categoryFilter]);

  const lock = async (id) => {
    entriesRequestRef.current += 1;
    setShowEntries(false);
    setEntriesError('');
    setEntries([]);
    setCategories([]);
    setAudit(null);
    setBreachAudit(null);
    setKeepassReport(null);
    setKeepassError('');
    setRestoring(false);
    setRestorePassphrase('');
    setExporting(false);
    setExportPassword('');
    setExportPassphrase('');
    await api()?.lock(id);
    refreshVaults();
  };

  const runAudit = async () => {
    if (audit) {
      setAudit(null);
      setBreachAudit(null);
      return;
    }
    setAuditing(true);
    setAuditError('');
    setBreachAudit(null);
    setBreachError('');
    try {
      const res = await api()?.audit(activeId);
      if (res?.success) setAudit(res);
      else setAuditError(t('pv.auditFailed'));
    } catch (error) {
      console.error('[vault] audit local échoué:', error);
      setAuditError(t('pv.auditFailed'));
    } finally {
      setAuditing(false);
    }
  };

  const runBreachAudit = async () => {
    setCheckingBreaches(true);
    setBreachError('');
    setBreachAudit(null);
    try {
      const res = await api()?.auditBreaches(activeId);
      if (res?.success) setBreachAudit(res);
      else setBreachError(t('pv.auditFailed'));
    } catch (error) {
      console.error('[vault] vérification des fuites échouée:', error);
      setBreachError(t('pv.breachUnavailable'));
    } finally {
      setCheckingBreaches(false);
    }
  };

  const doImport = async () => {
    const res = await api()?.importFile(activeId);
    if (res?.success) {
      setToast(
        t('pv.imported', {
          n: res.imported,
          merged: res.merged || 0,
          overwritten: res.overwritten || 0,
          skipped: res.skipped,
        })
      );
      setAudit(null);
      setBreachAudit(null);
      if (showEntries) refreshEntries(activeId);
    } else if (res?.error && res.error !== 'canceled') {
      setToast(t('pv.importFailed'));
    }
  };

  // Rapatriement de la base KeePassXC ouverte vers ce trousseau. Les mots de
  // passe ne traversent pas cet écran : le processus principal parle à
  // KeePassXC et écrit directement dans le trousseau chiffré, on n'en reçoit
  // qu'un compte-rendu chiffré en nombres.
  const doKeepassImport = async () => {
    setKeepassError('');
    setKeepassReport(null);
    setKeepassImport({ done: 0, total: 0 });
    const stop = api()?.onKeepassImportProgress?.((p) => setKeepassImport(p));
    try {
      const res = await api()?.importKeepass(activeId);
      if (res?.success) {
        setKeepassReport(res);
        setAudit(null);
        setBreachAudit(null);
        if (showEntries) refreshEntries(activeId);
      } else if (res?.error && res.error !== 'canceled') {
        setKeepassError(
          res.error === 'all-entries-denied'
            ? t('pv.kpImport.denied')
            : res.error === 'database-locked-or-empty'
              ? t('pv.kpImport.dbLocked')
              : res.error === 'not-associated'
                ? t('pv.kpImport.notAssociated')
                : res.error === 'locked'
                  ? t('pv.err.locked')
                  : res.error
        );
      }
    } catch (error) {
      console.error('[vault] rapatriement KeePassXC échoué:', error);
      setKeepassError(String(error?.message || error));
    } finally {
      stop?.();
      setKeepassImport(null);
    }
  };

  const doExport = async (format) => {
    setExportError('');
    // Vérifié ici AUSSI pour ne pas faire retaper le mot de passe maître (que
    // l'appel efface) à cause d'une phrase de passe trop courte.
    if (format === 'archive' && exportPassphrase && exportPassphrase.length < 8) {
      setExportError(t('pv.err.weakPassphrase'));
      return;
    }
    const res = await api()?.exportFile(
      activeId,
      exportPassword,
      format,
      format === 'archive' ? exportPassphrase : undefined
    );
    setExportPassword('');
    setExportPassphrase('');
    if (res?.success) {
      setExporting(false);
      setToast(t(res.encrypted ? 'pv.archiveSaved' : 'pv.exported', { n: res.count }));
    } else if (res?.error === 'bad-password') {
      setExportError(t('pv.err.badPassword'));
    } else if (res?.error === 'weak-passphrase') {
      setExportError(t('pv.err.weakPassphrase'));
    } else if (res?.error !== 'canceled') {
      setExporting(false);
    }
  };

  const doRestore = async () => {
    setRestoreError('');
    const res = await api()?.importArchive(activeId, restorePassphrase);
    if (res?.success) {
      setRestoring(false);
      setRestorePassphrase('');
      setToast(
        t('pv.imported', {
          n: res.imported,
          merged: res.merged || 0,
          overwritten: res.overwritten || 0,
          skipped: res.skipped || 0,
        })
      );
      setAudit(null);
      setBreachAudit(null);
      if (showEntries) refreshEntries(activeId);
    } else if (res?.error === 'bad-passphrase') {
      setRestoreError(t('pv.err.badPassphrase'));
    } else if (res?.error === 'not-an-archive') {
      setRestoreError(t('pv.err.notAnArchive'));
    } else if (res?.error === 'unsupported-version') {
      setRestoreError(t('pv.err.archiveTooNew'));
    } else if (res?.error && res.error !== 'canceled') {
      setRestoreError(t('pv.importFailed'));
    }
  };

  // -------------------------------------------------------------------------
  if (creating) {
    return (
      <CreateVault
        onDone={async (id) => {
          setCreating(false);
          entriesRequestRef.current += 1;
          setShowEntries(false);
          setEntries([]);
          setCategories([]);
          setAudit(null);
          setBreachAudit(null);
          await refreshVaults();
          setActiveId(id);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  if (vaults.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <KeyRound size={18} /> {t('pv.title')}
          </h3>
          <p className="text-sm text-text-muted">{t('pv.desc')}</p>
        </div>
        <div className="card text-center py-10">
          <div className="text-4xl mb-3">🔐</div>
          <p className="text-sm text-text-muted mb-4 max-w-md mx-auto">{t('pv.emptyState')}</p>
          <button onClick={() => setCreating(true)} className="btn btn-primary">
            <Plus size={16} /> {t('pv.newVault')}
          </button>
        </div>
        <CredentialSource />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <KeyRound size={18} /> {t('pv.title')}
          </h3>
          <p className="text-sm text-text-muted">{t('pv.desc')}</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn btn-secondary btn-sm flex-shrink-0">
          <Plus size={14} /> {t('pv.newVault')}
        </button>
      </div>

      {/* Sélecteur de trousseau : l'état ouvert/fermé est visible d'un coup
          d'œil, c'est l'information la plus utile de cet écran. */}
      <div className="flex flex-wrap gap-2">
        {vaults.map((v) => (
          <button
            key={v.id}
            onClick={() => {
              if (v.id !== activeId) {
                entriesRequestRef.current += 1;
                setShowEntries(false);
                setEntries([]);
                setCategories([]);
                setAudit(null);
                setAuditError('');
                setBreachAudit(null);
                setBreachError('');
                setKeepassReport(null);
                setKeepassError('');
                setRestoring(false);
                setRestorePassphrase('');
                setRestoreError('');
                setExporting(false);
                setExportPassword('');
                setExportPassphrase('');
                setExportError('');
              }
              setActiveId(v.id);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors border ${
              v.id === activeId
                ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                : 'border-border hover:bg-bg-hover text-text-secondary'
            }`}
          >
            <span>{v.icon}</span>
            <span className="font-medium">{v.name}</span>
            {v.unlocked ? (
              <Unlock size={13} className="text-success" />
            ) : (
              <Lock size={13} className="text-text-muted" />
            )}
          </button>
        ))}
      </div>

      {!active ? null : !active.unlocked ? (
        <UnlockVault vault={active} onUnlocked={refreshVaults} />
      ) : (
        <>
          {/* Barre d'outils */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('pv.search')}
                className="input pl-9"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="input w-auto"
            >
              <option value="all">{t('pv.allCategories')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">{t('pv.f.noCategory')}</option>
            </select>
            <button onClick={() => setEditing({ entry: null })} className="btn btn-primary btn-sm">
              <Plus size={14} /> {t('pv.addEntry')}
            </button>
            <button
              onClick={() => {
                if (showEntries) {
                  entriesRequestRef.current += 1;
                  setShowEntries(false);
                  setEntries([]);
                  setCategories([]);
                } else {
                  setShowEntries(true);
                }
              }}
              className="btn btn-secondary btn-sm"
              title={t(showEntries ? 'pv.entries.hide' : 'pv.entries.show')}
              aria-expanded={showEntries}
            >
              {showEntries ? <EyeOff size={14} /> : <Eye size={14} />}
              {t(showEntries ? 'pv.entries.hide' : 'pv.entries.show')}
            </button>
            <button
              onClick={runAudit}
              disabled={auditing}
              className="btn btn-secondary btn-sm"
              title={t('pv.audit')}
            >
              {audit ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
              {t(auditing ? 'pv.auditRunning' : 'pv.audit')}
            </button>
            {/* Import et export derrière UN seul menu : quatre icônes de plus
                dans la barre devenaient indéchiffrables, et ce sont des gestes
                rares comparés à la recherche ou à l'ajout d'une entrée. */}
            <TransferMenu
              busy={Boolean(keepassImport)}
              onImportFile={doImport}
              onImportKeepass={doKeepassImport}
              onRestoreArchive={() => setRestoring((v) => !v)}
              onExport={() => setExporting(true)}
            />
            <button onClick={() => setManaging((v) => !v)} className="btn btn-secondary btn-sm" title={t('pv.vaultSettings')}>
              <Settings2 size={14} />
            </button>
            <button onClick={() => lock(active.id)} className="btn btn-secondary btn-sm" title={t('pv.lock')}>
              <Lock size={14} />
            </button>
          </div>

          {managing && <VaultSettings vault={active} onChanged={refreshVaults} onClose={() => setManaging(false)} />}

          {auditError && <p className="text-sm text-error">{auditError}</p>}
          {audit && (
            <AuditPanel
              audit={audit}
              breachAudit={breachAudit}
              breachError={breachError}
              checkingBreaches={checkingBreaches}
              onCheckBreaches={runBreachAudit}
            />
          )}

          {/* Rapatriement KeePassXC : avancement, puis compte-rendu. Une base
              de 300 entrées prend un moment (une requête par site), l'écran ne
              doit pas rester muet pendant ce temps. */}
          {keepassImport && (
            <div className="card flex items-center gap-3">
              <Loader2 size={16} className="animate-spin text-accent-primary flex-shrink-0" />
              <div className="text-sm">
                <div className="font-medium">{t('pv.kpImport.running')}</div>
                <p className="text-xs text-text-muted">
                  {keepassImport.total
                    ? t('pv.kpImport.progress', { done: keepassImport.done, total: keepassImport.total })
                    : t('pv.kpImport.scanning')}
                </p>
              </div>
            </div>
          )}
          {keepassError && (
            <div className="card text-sm text-error">{keepassError}</div>
          )}
          {keepassReport && (
            <div className="card space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium flex items-center gap-2">
                    <Database size={14} /> {t('pv.kpImport.doneTitle')}
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    {t('pv.kpImport.summary', {
                      scanned: keepassReport.scanned || 0,
                      n: keepassReport.imported || 0,
                      merged: keepassReport.merged || 0,
                      overwritten: keepassReport.overwritten || 0,
                    })}
                  </p>
                  {/* Une entrée KeePassXC sans URL est injoignable par le
                      protocole : on la nomme au lieu de la perdre en silence. */}
                  {keepassReport.withoutUrl?.length > 0 && (
                    <p className="text-xs text-warning mt-2">
                      {t('pv.kpImport.withoutUrl', { n: keepassReport.withoutUrl.length })}{' '}
                      {keepassReport.withoutUrl.slice(0, 8).join(', ')}
                      {keepassReport.withoutUrl.length > 8 ? '…' : ''}
                    </p>
                  )}
                  {keepassReport.failed > 0 && (
                    <p className="text-xs text-warning mt-1">
                      {t('pv.kpImport.failed', { n: keepassReport.failed })}
                    </p>
                  )}
                </div>
                <button onClick={() => setKeepassReport(null)} className="btn btn-secondary btn-sm">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Restauration d'une archive chiffrée */}
          {restoring && (
            <div className="card space-y-3">
              <div>
                <h4 className="font-semibold text-sm">{t('pv.restoreArchive')}</h4>
                <p className="text-xs text-text-muted mt-1">{t('pv.restoreArchiveHint')}</p>
              </div>
              <SecretInput
                value={restorePassphrase}
                onChange={setRestorePassphrase}
                placeholder={t('pv.archivePassphrase')}
                onEnter={restorePassphrase ? doRestore : undefined}
              />
              {restoreError && <div className="text-sm text-error">{restoreError}</div>}
              <div className="flex gap-2">
                <button onClick={doRestore} disabled={!restorePassphrase} className="btn btn-primary btn-sm flex-1">
                  <Archive size={14} /> {t('pv.chooseArchive')}
                </button>
                <button
                  onClick={() => { setRestoring(false); setRestorePassphrase(''); setRestoreError(''); }}
                  className="btn btn-secondary btn-sm"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}

          {exporting && (
            <div className="card space-y-3">
              <div>
                <h4 className="font-semibold text-sm">{t('pv.export')}</h4>
                <p className="text-xs text-text-muted mt-1">{t('pv.exportIntro')}</p>
              </div>
              <SecretInput
                value={exportPassword}
                onChange={setExportPassword}
                placeholder={t('pv.masterPassword')}
              />

              {/* Sauvegarde chiffrée : le choix par défaut. Elle garde tout le
                  trousseau (catégories, historique) et se relit dans Orbit. */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-sm font-medium flex items-center gap-2">
                  <Archive size={14} /> {t('pv.exportArchive')}
                </div>
                <p className="text-xs text-text-muted">{t('pv.exportArchiveHint')}</p>
                <SecretInput
                  value={exportPassphrase}
                  onChange={setExportPassphrase}
                  placeholder={t('pv.archivePassphraseOptional')}
                />
                <button
                  onClick={() => doExport('archive')}
                  disabled={!exportPassword}
                  className="btn btn-primary btn-sm w-full"
                >
                  {t('pv.exportArchiveAction')}
                </button>
              </div>

              {/* CSV / JSON : utiles pour MIGRER vers un autre gestionnaire,
                  en clair par construction — d'où l'avertissement. */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="text-sm font-medium">{t('pv.exportPlain')}</div>
                <p className="text-xs text-warning">{t('pv.exportWarning')}</p>
                <div className="flex gap-2">
                  <button onClick={() => doExport('csv')} disabled={!exportPassword} className="btn btn-secondary btn-sm flex-1">
                    CSV
                  </button>
                  <button onClick={() => doExport('json')} disabled={!exportPassword} className="btn btn-secondary btn-sm flex-1">
                    JSON
                  </button>
                </div>
              </div>

              {exportError && <div className="text-sm text-error">{exportError}</div>}
              <button
                onClick={() => { setExporting(false); setExportPassword(''); setExportPassphrase(''); setExportError(''); }}
                className="btn btn-secondary btn-sm w-full"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}

          {showEntries ? (
            <div className="space-y-2">
              {entriesError ? (
                <div className="text-center py-10 text-sm text-error">{t(entriesError)}</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-10 text-sm text-text-muted">
                  {entries.length === 0 ? t('pv.noEntries') : t('pv.noMatch')}
                </div>
              ) : (
                filtered.map((e) => (
                  <EntryRow
                    key={e.id}
                    vaultId={active.id}
                    entry={e}
                    categories={categories}
                    onEdit={() => setEditing({ entry: e })}
                    onDeleted={() => {
                      setAudit(null);
                      setBreachAudit(null);
                      refreshEntries(active.id);
                    }}
                    onToast={setToast}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="card flex items-center justify-between gap-3">
              <span className="text-sm text-text-muted">{t('pv.entries.hidden')}</span>
              <button onClick={() => setShowEntries(true)} className="btn btn-secondary btn-sm">
                <Eye size={14} /> {t('pv.entries.show')}
              </button>
            </div>
          )}

          <p className="text-xs text-text-muted">
            {t('pv.footerNote', { minutes: active.autoLockMinutes || 0 })}
          </p>
        </>
      )}

      {editing && (
        <EntryEditor
          vaultId={activeId}
          entry={editing.entry}
          categories={categories}
          onSaved={() => {
            setEditing(null);
            setAudit(null);
            setBreachAudit(null);
            if (showEntries) refreshEntries(activeId);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Le même choix qu'à l'onglet KeePassXC : on ne décide pas à deux
          endroits différents ce qu'Orbit propose dans les pages. */}
      <CredentialSource />

      <VaultBackupSettings />

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10002] px-4 py-2 rounded-lg bg-bg-elevated border border-border shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Réglages d'un trousseau (nom, verrouillage auto, mot de passe maître, suppression)
// ---------------------------------------------------------------------------
function VaultSettings({ vault, onChanged, onClose }) {
  const t = useT();
  const [name, setName] = useState(vault.name);
  const [autoLock, setAutoLock] = useState(vault.autoLockMinutes ?? 15);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveMeta = async () => {
    await api()?.update(vault.id, { name, autoLockMinutes: Number(autoLock) });
    setMessage(t('pv.saved'));
    onChanged();
  };

  const changeMaster = async () => {
    const res = await api()?.changeMaster(vault.id, current, next);
    setCurrent('');
    setNext('');
    setMessage(
      res?.success
        ? t('pv.masterChanged')
        : res?.error === 'weak-master'
          ? t('pv.err.weakMaster')
          : t('pv.err.badPassword')
    );
  };

  const remove = async () => {
    const res = await api()?.remove(vault.id, deletePassword);
    setDeletePassword('');
    if (res?.success) {
      onChanged();
      onClose();
    } else {
      setMessage(t('pv.err.badPassword'));
    }
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">{t('pv.vaultSettings')}</h4>
        <button onClick={onClose} className="btn-icon">
          <X size={14} />
        </button>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs text-text-muted block mb-1.5">{t('pv.f.name')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div>
          <label className="text-xs text-text-muted block mb-1.5">{t('pv.autoLock')}</label>
          <select value={autoLock} onChange={(e) => setAutoLock(e.target.value)} className="input w-auto">
            <option value="0">{t('pv.autoLockNever')}</option>
            <option value="5">5 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">60 min</option>
          </select>
        </div>
        <button onClick={saveMeta} className="btn btn-primary btn-sm">
          <Check size={14} />
        </button>
      </div>

      <div className="border-t border-border pt-3">
        <label className="text-xs text-text-muted block mb-1.5">{t('pv.changeMaster')}</label>
        <div className="flex gap-2">
          <SecretInput
            value={current}
            onChange={setCurrent}
            placeholder={t('pv.currentMaster')}
            className="flex-1"
          />
          <SecretInput
            value={next}
            onChange={setNext}
            placeholder={t('pv.newMaster')}
            className="flex-1"
          />
          <button onClick={changeMaster} disabled={!current || !next} className="btn btn-secondary btn-sm">
            <Check size={14} />
          </button>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="text-sm text-error hover:underline">
            {t('pv.deleteVault')}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-error">{t('pv.deleteVaultWarning')}</p>
            <div className="flex gap-2">
              <SecretInput
                value={deletePassword}
                onChange={setDeletePassword}
                placeholder={t('pv.masterPassword')}
                className="flex-1"
              />
              <button onClick={remove} disabled={!deletePassword} className="btn btn-sm bg-error text-white">
                <Trash2 size={14} />
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn btn-secondary btn-sm">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {message && <div className="text-sm text-text-secondary">{message}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
function AuditPanel({
  audit,
  breachAudit,
  breachError,
  checkingBreaches,
  onCheckBreaches,
}) {
  const t = useT();
  const groups = [
    { key: 'reused', label: t('pv.audit.reused'), items: audit.reused, tone: 'text-error' },
    { key: 'weak', label: t('pv.audit.weak'), items: audit.weak, tone: 'text-warning' },
    { key: 'old', label: t('pv.audit.old'), items: audit.old, tone: 'text-text-secondary' },
    { key: 'empty', label: t('pv.audit.empty'), items: audit.empty, tone: 'text-text-muted' },
    {
      key: 'breached',
      label: t('pv.audit.breached'),
      items: breachAudit?.compromised || [],
      tone: 'text-error',
    },
  ].filter((g) => g.items && g.items.length > 0);

  return (
    <div className="card space-y-3">
      <div>
        <h4 className="font-semibold text-sm">{t('pv.audit')}</h4>
        <p className="text-xs text-text-muted mt-1">{t('pv.auditDesc')}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: t('pv.audit.total'), value: audit.total },
          { label: t('pv.audit.weak'), value: audit.weak.length, tone: 'text-warning' },
          { label: t('pv.audit.moderate'), value: audit.moderate, tone: 'text-accent-primary' },
          { label: t('pv.audit.strong'), value: audit.strong, tone: 'text-success' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg bg-bg-primary border border-border p-2">
            <div className={`text-lg font-semibold ${stat.tone || ''}`}>{stat.value}</div>
            <div className="text-[11px] text-text-muted">{stat.label}</div>
          </div>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="text-sm text-success">{t('pv.auditClean', { n: audit.total })}</div>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div className={`text-xs font-semibold mb-1 ${g.tone}`}>
              {g.label} — {g.items.length}
            </div>
            <div className="text-xs text-text-muted space-y-0.5">
              {g.items.slice(0, 8).map((it) => (
                <div key={it.id} className="truncate">
                  {it.title}
                  {it.username ? ` · ${it.username}` : ''}
                  {g.key === 'breached' && ` · ${t('pv.breachCount', { n: it.count })}`}
                </div>
              ))}
              {g.items.length > 8 && <div>+{g.items.length - 8}…</div>}
            </div>
          </div>
        ))
      )}
      {!breachAudit ? (
        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs text-text-muted">{t('pv.breachPrivacy')}</p>
          {breachError && <p className="text-xs text-error">{breachError}</p>}
          <button
            onClick={onCheckBreaches}
            disabled={checkingBreaches}
            className="btn btn-secondary btn-sm"
          >
            <ShieldCheck size={14} />
            {t(checkingBreaches ? 'pv.breachChecking' : 'pv.breachCheck')}
          </button>
        </div>
      ) : (
        <div className="border-t border-border pt-3 text-sm">
          {breachAudit.failed > 0 && (
            <p className="text-warning mb-2">
              {t('pv.breachPartial', {
                checked: breachAudit.checked,
                failed: breachAudit.failed,
              })}
            </p>
          )}
          {breachAudit.checked === 0 && breachAudit.failed === 0 ? (
            <p className="text-text-muted">{t('pv.breachNoPasswords')}</p>
          ) : breachAudit.compromised.length === 0 && breachAudit.failed === 0 ? (
            <p className="text-success">
              {t('pv.breachClean', { n: breachAudit.checked })}
            </p>
          ) : null}
          <p className="text-[11px] text-text-muted mt-2">{t('pv.generatorHint')}</p>
        </div>
      )}
    </div>
  );
}
