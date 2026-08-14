import { useState, useEffect } from 'react';
import { Puzzle, FolderOpen, FileArchive, Trash2, Loader2, Info, Globe, Download, Settings2, AlertTriangle, RotateCw } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { getAllWebviews } from '../lib/webviewRegistry';

// Recharge toutes les apps ouvertes : indispensable après un changement
// d'extensions, car les content scripts ne s'injectent que sur une navigation
// POSTÉRIEURE au chargement de l'extension (limite d'Electron).
function reloadAllApps() {
  for (const wv of getAllWebviews()) {
    try {
      wv.reload();
    } catch {
      /* ignore */
    }
  }
}

// Infos d'une extension : version du manifeste (V2/V3) + avertissements
// (fonctionnalités non supportées par Electron). Chargés via le main process.
function ExtWarnings({ ext }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let mounted = true;
    const p = window.electronAPI?.getExtensionInfo?.({ id: ext.id, path: ext.path });
    if (p && typeof p.then === 'function') {
      p.then((res) => {
        if (mounted && res?.success && res.info) setInfo(res.info);
      }).catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [ext.id, ext.path]);

  if (!info) return null;
  const isV3 = info.manifestVersion === 3;
  const warnings = info.warnings || [];

  return (
    <div className="mt-1.5 space-y-1">
      {/* Badge de version du manifeste : indique tout de suite si c'est une
          extension « récente » (V3, souvent bridée dans Electron) ou « classique »
          (V2, la mieux supportée). */}
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
          isV3 ? 'bg-yellow-500/15 text-yellow-500' : 'bg-emerald-500/15 text-emerald-500'
        }`}
        title={
          isV3
            ? 'Manifest V3 (récent) : certaines fonctions peuvent ne pas marcher dans Orbit'
            : 'Manifest V2 (classique) : le mieux supporté'
        }
      >
        {isV3 ? 'Manifest V3' : 'Manifest V2'}
      </span>
      {warnings.map((w, i) => (
        <div key={i} className="text-xs text-yellow-500/90 flex items-start gap-1">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

// Gestion des extensions Chrome : installation (Chrome Web Store, dossier
// dépaqueté ou .crx), activation/désactivation et désinstallation.
// Les extensions sont injectées dans toutes les sessions (profils) via le
// main process.
export default function Extensions() {
  const { extensions, updateExtensions } = useStore();
  const [busy, setBusy] = useState(null); // 'webstore' | 'folder' | 'crx' | null
  const [storeUrl, setStoreUrl] = useState('');
  const [error, setError] = useState(null);

  // Applique une nouvelle liste d'extensions, ATTEND que le main process les
  // (dé)charge dans les sessions, puis recharge les apps pour que l'effet soit
  // immédiat (sinon « l'extension ne fait rien » tant qu'on n'a pas rechargé).
  const applyExtensions = async (nextList, { reload } = {}) => {
    updateExtensions(nextList);
    try {
      await window.electronAPI?.syncExtensions?.(nextList);
    } catch {
      /* ignore */
    }
    if (reload) reloadAllApps();
  };

  // Source d'affichage d'une extension
  const sourceLabel = (ext) =>
    ext.source === 'webstore'
      ? 'Chrome Web Store'
      : ext.source === 'crx' || ext.managed
        ? 'fichier .crx'
        : 'dossier';

  // ---- Installation depuis le Chrome Web Store (URL ou ID) ----
  const handleWebStore = async () => {
    setBusy('webstore');
    setError(null);
    try {
      const res = await window.electronAPI?.installWebStoreExtension?.(storeUrl);
      if (!res || !res.success) {
        setError(res?.error || "Impossible d'installer cette extension depuis le Chrome Web Store");
        return;
      }
      const ext = res.extension;
      if (extensions.some((e) => e.id === ext.id)) {
        setError('Cette extension est déjà installée.');
        return;
      }
      // Recharge les apps ouvertes pour activer l'extension immédiatement
      await applyExtensions([...extensions, { ...ext, enabled: true }], { reload: true });
      setStoreUrl('');
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(null);
    }
  };

  // ---- Installation depuis un dossier ou un fichier .crx ----
  const handleAdd = async (kind) => {
    setBusy(kind);
    setError(null);
    try {
      const picked =
        kind === 'folder'
          ? await window.electronAPI?.pickExtensionFolder?.()
          : await window.electronAPI?.pickExtensionCrx?.();
      if (!picked) return;

      const res = await window.electronAPI?.installExtension?.({ kind, path: picked });
      if (!res || !res.success) {
        setError(res?.error || "Impossible d'installer cette extension");
        return;
      }
      const ext = res.extension;
      if (!extensions.some((e) => e.id === ext.id)) {
        await applyExtensions([...extensions, { ...ext, enabled: true }], { reload: true });
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(null);
    }
  };

  const handleToggle = (ext) => {
    const nextEnabled = !ext.enabled;
    // Recharger seulement à l'ACTIVATION (pour injecter les content scripts) ;
    // à la désactivation, recharger aussi pour que la page cesse d'être affectée.
    applyExtensions(
      extensions.map((e) => (e.id === ext.id ? { ...e, enabled: nextEnabled } : e)),
      { reload: true }
    );
  };

  const handleRemove = async (ext) => {
    if (!confirm(`Désinstaller l'extension « ${ext.name} » ?`)) return;
    await window.electronAPI?.uninstallExtension?.({
      id: ext.id,
      path: ext.path,
      managed: ext.managed,
    });
    await applyExtensions(extensions.filter((e) => e.id !== ext.id), { reload: true });
  };

  // Ouvre la page d'options de l'extension dans une fenêtre Orbit
  const openOptions = async (ext) => {
    setError(null);
    const res = await window.electronAPI?.openExtensionOptions?.({ id: ext.id, path: ext.path });
    if (res && !res.success && res.error) {
      setError(res.error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Installation depuis le Chrome Web Store */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Globe size={18} className="text-accent-primary" />
          <h4 className="font-semibold">Installer depuis le Chrome Web Store</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">
          Collez le lien de l'extension (ex.{' '}
          <span className="text-text-secondary">
            chromewebstore.google.com/detail/u-block-origin/cjpalh…
          </span>{' '}
          ) ou son ID. Orbit télécharge et installe automatiquement.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Download className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
            <input
              type="text"
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleWebStore()}
              placeholder="https://chromewebstore.google.com/detail/…"
              className="input pl-10"
            />
          </div>
          <button
            onClick={handleWebStore}
            disabled={busy || !storeUrl.trim()}
            className="btn btn-primary whitespace-nowrap"
          >
            {busy === 'webstore' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Installer
          </button>
        </div>
      </div>

      {/* Méthodes alternatives */}
      <div className="card">
        <h4 className="font-semibold mb-2">Méthodes alternatives</h4>
        <p className="text-sm text-text-muted mb-4">
          Un dossier d'extension dépaqueté (celui qui contient{' '}
          <code className="px-1 py-0.5 bg-bg-secondary border border-border rounded text-xs">manifest.json</code>{' '}
          ) ou un fichier <code className="px-1 py-0.5 bg-bg-secondary border border-border rounded text-xs">.crx</code>{' '}
          téléchargé ailleurs.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => handleAdd('folder')}
            disabled={!!busy}
            className="btn btn-secondary"
          >
            {busy === 'folder' ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
            Depuis un dossier…
          </button>
          <button
            onClick={() => handleAdd('crx')}
            disabled={!!busy}
            className="btn btn-secondary"
          >
            {busy === 'crx' ? <Loader2 size={16} className="animate-spin" /> : <FileArchive size={16} />}
            Depuis un fichier .crx…
          </button>
        </div>
        {error && (
          <p className="text-sm text-error mt-3 bg-error/10 border border-error/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Liste des extensions installées */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Puzzle size={18} className="text-accent-primary" />
          <h4 className="font-semibold">Extensions installées</h4>
          <span className="text-xs text-text-muted">({extensions.length})</span>
          {extensions.length > 0 && (
            <button
              onClick={reloadAllApps}
              className="ml-auto text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
              title="Recharger toutes les apps ouvertes pour (ré)appliquer les extensions"
            >
              <RotateCw size={13} /> Recharger les apps
            </button>
          )}
        </div>

        {extensions.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm">
            <div className="text-3xl mb-2">🧩</div>
            <p>Aucune extension installée</p>
          </div>
        ) : (
          <div className="space-y-3">
            {extensions.map((ext) => (
              <div
                key={ext.id}
                className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                  ext.enabled
                    ? 'bg-bg-secondary border-border'
                    : 'bg-bg-secondary border-border opacity-60'
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-bg-elevated border border-border flex items-center justify-center flex-shrink-0">
                  <Puzzle size={18} className={ext.enabled ? 'text-accent-primary' : 'text-text-muted'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{ext.name}</div>
                  <div className="text-xs text-text-muted">
                    v{ext.version} · {sourceLabel(ext)}
                    {' '}
                    {ext.enabled ? '· activée' : '· désactivée'}
                  </div>
                  <ExtWarnings ext={ext} />
                </div>
                <button
                  onClick={() => openOptions(ext)}
                  className="btn-icon flex-shrink-0"
                  title="Ouvrir la page d'options de l'extension"
                >
                  <Settings2 size={16} />
                </button>
                <label className="flex items-center cursor-pointer flex-shrink-0" title="Activer / Désactiver">
                  <input
                    type="checkbox"
                    checked={ext.enabled}
                    onChange={() => handleToggle(ext)}
                    className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                  />
                </label>
                <button
                  onClick={() => handleRemove(ext)}
                  className="btn-icon text-error flex-shrink-0"
                  title="Désinstaller"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Limites du support natif */}
      <div className="card border-accent-primary/30">
        <div className="flex gap-3">
          <Info size={18} className="text-accent-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm text-text-muted space-y-2">
            <p className="font-medium text-text-primary">Limites du support des extensions</p>
            <p>
              Orbit utilise le support natif d'Electron : les <strong>content scripts</strong>, le{' '}
              <strong>stockage local</strong> et le <strong>webRequest</strong> fonctionnent
              (bloqueurs de publicité comme uBlock Origin, Dark Reader…).
            </p>
            <p>
              En revanche, les <strong>popups de barre d'outils</strong> (icône cliquable de
              l'extension) et le <strong>native messaging</strong> (connexion à une application
              locale) ne sont pas disponibles dans les webviews. Les extensions qui en ont
              besoin (gestionnaires de mots de passe) affichent un <strong>avertissement ⚠️</strong>
              dans la liste et ne pourront pas se connecter à l'application locale.
              <strong>Bon à savoir</strong> : pour KeePassXC, Orbit intègre un <strong>pont natif</strong>
              (onglet KeePassXC des Paramètres) qui remplace l'extension — association en un
              clic et remplissage automatique des identifiants dans les apps.
              Les extensions sont appliquées à <strong>tous les profils</strong>.
            </p>
            <p>
              Les extensions qui ont une page d'options (uBlock Origin, Dark Reader…) se
              configurent avec le bouton <strong>⚙️</strong> de la liste ci-dessus.
            </p>
            <p>
              Une extension installée ne s'applique qu'aux pages <strong>rechargées après</strong> son
              installation : utilisez le bouton ⟳ de la barre d'URL pour recharger une app déjà
              ouverte.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
