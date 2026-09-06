import { useState, useEffect } from 'react';
import { Puzzle, FolderOpen, Trash2, Loader2, Info, Globe, Download, Settings2, AlertTriangle, RotateCw, Dice6, Check, X, Upload } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { getRegisteredWebviews } from '../lib/webviewRegistry';
import { appPartition } from '../lib/session';
import { reloadUrlFor } from '../lib/urls';
import { useT } from '../lib/i18n';

// Recharge toutes les apps ouvertes : indispensable après un changement
// d'extensions, car les content scripts ne s'injectent que sur une navigation
// POSTÉRIEURE au chargement de l'extension (limite d'Electron).
function reloadAllApps() {
  const apps = useStore.getState().apps;
  for (const [appId, wv] of getRegisteredWebviews()) {
    try {
      // URL nettoyée de ses jetons éphémères (CSRF Roundcube…) si besoin
      const app = apps.find((a) => a.id === appId);
      const clean = reloadUrlFor(app?.url);
      if (clean) wv.loadURL(clean);
      else wv.reload();
    } catch {
      /* ignore */
    }
  }
}

// Infos d'une extension : version du manifeste (V2/V3) + avertissements
// (fonctionnalités non supportées par Electron). Chargés via le main process.
function ExtWarnings({ ext }) {
  const t = useT();
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
        title={isV3 ? t('ex.mv3title') : t('ex.mv2title')}
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

// Extension natif (intégré à Orbit, pas un vrai plugin chargé) : Fake Data.
// Représentée comme une extension installée pour unifier l'interface.
const FAKE_DATA_EXT = {
  id: '__orbit_fake_data__',
  name: 'Fake Data Filler',
  version: 'Intégré',
  source: 'native',
  native: true,
};

// Vrai si c'est Fake Data, qu'il soit natif OU installé depuis le ZIP
// (le ZIP porte le même nom « Fake Data Filler (Orbit) »).
const isFakeDataExt = (ext) => ext.native || /fake data/i.test(ext.name || '');

// Gestion des extensions Chrome : installation (ZIP, dossier, Chrome Web Store),
// activation/désactivation et désinstallation. Fake Data Filler (natif) apparaît
// dans la même liste avec les mêmes contrôles.
export default function Extensions() {
  const t = useT();
  const { extensions, updateExtensions, updateSettings, settings, activeApp, apps, profiles } = useStore();
  const [busy, setBusy] = useState(null); // 'webstore' | 'folder' | 'zip' | null
  const [storeUrl, setStoreUrl] = useState('');
  const [error, setError] = useState(null);
  const [exportingFakeData, setExportingFakeData] = useState(false);
  const [fakeDataSettingsOpen, setFakeDataSettingsOpen] = useState(false);
  const [fakeDataSaved, setFakeDataSaved] = useState(false);
  const [nativeConfigOpen, setNativeConfigOpen] = useState(null); // id de l'extension dont le panneau inline est ouvert

  const fakeDataDisabled = settings.fakeDataDisabled || false;
  const fakeDataRemoved = settings.fakeDataRemoved || false;

  // Appliquer l'état au preload au montage + quand il change
  useEffect(() => {
    window.electronAPI?.setFakeDataEnabled?.(!fakeDataDisabled);
  }, [fakeDataDisabled]);

  // Ouvrir le sélecteur de fichier via Electron dialog
  const selectZipFile = async () => {
    const result = await window.electronAPI?.pickZipFile?.();
    // Le handler du main process renvoie directement le chemin (string)
    if (result) {
      handleInstallFromZip(result);
    }
  };

  // Sauvegarde des données personnalisées Fake Data
  const saveFakeDataSettings = async (data) => {
    try {
      await window.electronAPI?.setFakeData?.(data);
      setFakeDataSaved(true);
      setTimeout(() => setFakeDataSaved(false), 2000);
    } catch (err) {
      console.error('[orbit] saveFakeData échoué:', err);
    }
  };

  // Export de l'extension Fake Data en ZIP
  const exportFakeData = async () => {
    setExportingFakeData(true);
    setError(null);
    try {
      const res = await window.electronAPI?.exportFakeDataExtension?.();
      if (!res || !res.success) {
        setError(res?.error || 'Export échoué');
        return;
      }
      // Ouvre le dossier des téléchargements
      await window.electronAPI?.revealDownload?.(res.zipPath);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setExportingFakeData(false);
    }
  };

  // Installation depuis un fichier ZIP
  const handleInstallFromZip = async (file) => {
    setBusy('zip');
    setError(null);
    try {
      const res = await window.electronAPI?.installExtensionFromZip?.(file);
      if (!res || !res.success) {
        setError(res?.error || t('ex.cantInstall') || 'Erreur inconnue');
        return;
      }
      const ext = res.extension;
      // Remplacer si une extension du même ID ou du même NOM existe déjà.
      // ID seul ne suffit pas : Electron dérive l'ID des extensions non packagées
      // du DOSSIER — réinstaller un ZIP dans un nouveau dossier donne un nouvel
      // ID, et l'ancienne version continuerait de tourner à côté.
      const sameExt = (a, b) => a.id === b.id || (a.name && b.name && a.name === b.name);
      const existing = extensions.find((e) => sameExt(e, ext));
      const nextList = existing
        ? extensions.map((e) => (sameExt(e, ext) ? { ...e, ...ext, enabled: e.enabled !== false } : e))
        : [...extensions, { ...ext, enabled: true }];
      await applyExtensions(nextList, { reload: true });
    } catch (err) {
      console.error('[orbit-ui] Erreur installation ZIP:', err);
      setError(String(err?.message || err || 'Erreur inconnue'));
    } finally {
      setBusy(null);
    }
  };

  // Toggle Fake Data (native)
  const toggleFakeData = async () => {
    const next = !fakeDataDisabled;
    updateSettings({ fakeDataDisabled: next });
    try {
      await window.electronAPI?.setFakeDataEnabled?.(next);
    } catch (err) {
      console.error('[orbit] toggleFakeData échoué:', err);
      updateSettings({ fakeDataDisabled: !next });
    }
  };

  // Supprimer Fake Data de la liste (comme une désinstallation)
  const removeFakeData = async () => {
    if (!confirm(t('fakeExt.confirmRemove'))) return;
    try {
      await window.electronAPI?.setFakeDataEnabled?.(false);
      updateSettings({ fakeDataDisabled: true, fakeDataRemoved: true });
      setNativeConfigOpen(null);
    } catch (err) {
      console.error('[orbit] removeFakeData échoué:', err);
    }
  };

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
        ? t('ex.srcCrx')
        : ext.source === 'zip'
          ? t('ex.srcZip')
          : t('ex.srcFolder');

  // ---- Installation depuis le Chrome Web Store (URL ou ID) ----
  const handleWebStore = async () => {
    setBusy('webstore');
    setError(null);
    try {
      const res = await window.electronAPI?.installWebStoreExtension?.(storeUrl);
      if (!res || !res.success) {
        setError(res?.error || t('ex.webstoreCantInstall'));
        return;
      }
      const ext = res.extension;
      if (extensions.some((e) => e.id === ext.id)) {
        setError(t('ex.alreadyInstalled'));
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

  // ---- Installation depuis un dossier ----
  const handleAddFolder = async () => {
    setBusy('folder');
    setError(null);
    try {
      const picked = await window.electronAPI?.pickExtensionFolder?.();
      if (!picked) return;

      const res = await window.electronAPI?.installExtension?.({ kind: 'folder', path: picked });
      if (!res || !res.success) {
        setError(res?.error || t('ex.cantInstall'));
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
    if (ext.native) {
      toggleFakeData();
      return;
    }
    const nextEnabled = !ext.enabled;
    // Recharger seulement à l'ACTIVATION (pour injecter les content scripts) ;
    // à la désactivation, recharger aussi pour que la page cesse d'être affectée.
    applyExtensions(
      extensions.map((e) => (e.id === ext.id ? { ...e, enabled: nextEnabled } : e)),
      { reload: true }
    );
  };

  const handleRemove = async (ext) => {
    if (ext.native) {
      removeFakeData();
      return;
    }
    if (!confirm(t('ex.confirmRemove', { name: ext.name }))) return;
    await window.electronAPI?.uninstallExtension?.({
      id: ext.id,
      path: ext.path,
      managed: ext.managed,
    });
    await applyExtensions(extensions.filter((e) => e.id !== ext.id), { reload: true });
  };

  // Ouvre la page d'options de l'extension dans une fenêtre Orbit.
  // Fake Data (natif OU installé depuis le ZIP) : le panneau de configuration
  // intégré (champs personnalisés) s'ouvre à la place — pas de page d'options.
  const openOptions = async (ext) => {
    setError(null);
    if (isFakeDataExt(ext)) {
      setNativeConfigOpen(nativeConfigOpen === ext.id ? null : ext.id);
      return;
    }
    // La fenêtre d'options partage la partition de l'app active : c'est elle
    // que les content scripts utilisent, donc le chrome.storage de la page
    // d'options sera visible dans l'app (snippets, réglages…).
    const actApp = apps.find((a) => a.id === activeApp);
    const actProfile = profiles.find((p) => p.id === actApp?.profileId);
    const partition = actApp ? appPartition(actApp, !!actProfile?.sharedSession) : undefined;
    const res = await window.electronAPI?.openExtensionOptions?.({
      id: ext.id,
      path: ext.path,
      partition,
    });
    if (res && !res.success && res.error) {
      setError(res.error);
    }
  };

  // Liste unifiée : extensions installées + Fake Data natif (si pas supprimé)
  const visibleExtensions = fakeDataRemoved
    ? extensions
    : [{ ...FAKE_DATA_EXT, enabled: !fakeDataDisabled }, ...extensions];

  return (
    <div className="space-y-6">
      {/* Erreurs globales visibles */}
      {error && (
        <p className="text-sm text-error bg-error/10 border border-error/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {/* Installation depuis le Chrome Web Store */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Globe size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('ex.webstoreTitle')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">{t('ex.webstoreDesc')}</p>
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
            {t('store.install')}
          </button>
        </div>
      </div>

      {/* Installation depuis ZIP ou dossier */}
      <div className="card">
        <h4 className="font-semibold mb-2">{t('ex.altTitle')}</h4>
        <p className="text-sm text-text-muted mb-4">{t('ex.altDesc')}</p>
        <div className="flex gap-3">
          <button onClick={selectZipFile} disabled={!!busy} className="btn btn-secondary">
            {busy === 'zip' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {t('ex.installFromZip')}
          </button>
          <button onClick={handleAddFolder} disabled={!!busy} className="btn btn-secondary">
            {busy === 'folder' ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
            {t('ex.fromFolder')}
          </button>
        </div>
      </div>

      {/* Liste des extensions installées (y compris Fake Data natif) */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Puzzle size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('ex.installedTitle')}</h4>
          <span className="text-xs text-text-muted">({visibleExtensions.length})</span>
          {visibleExtensions.length > 0 && (
            <button
              onClick={reloadAllApps}
              className="ml-auto text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
              title={t('ex.reloadAppsTitle')}
            >
              <RotateCw size={13} /> {t('ex.reloadApps')}
            </button>
          )}
        </div>

        {visibleExtensions.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm">
            <div className="text-3xl mb-2">🧩</div>
            <p>{t('ex.none')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleExtensions.map((ext) => (
              <div
                key={ext.id}
                className={`rounded-lg border transition-all ${
                  ext.enabled ? 'bg-bg-secondary border-border' : 'bg-bg-secondary border-border opacity-60'
                }`}
              >
                <div className="flex items-center gap-4 p-3">
                  <div className="w-10 h-10 rounded-lg bg-bg-elevated border border-border flex items-center justify-center flex-shrink-0">
                    {isFakeDataExt(ext) ? (
                      <Dice6 size={18} className={ext.enabled ? 'text-indigo-500' : 'text-text-muted'} />
                    ) : (
                      <Puzzle size={18} className={ext.enabled ? 'text-accent-primary' : 'text-text-muted'} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{ext.name}</div>
                    <div className="text-xs text-text-muted">
                      v{ext.version} · {sourceLabel(ext)}
                      {' '}
                      {ext.enabled ? t('ex.enabled') : t('ex.disabledLabel')}
                    </div>
                    {!ext.native && <ExtWarnings ext={ext} />}
                  </div>
                  <button
                    onClick={() => openOptions(ext)}
                    className="btn-icon flex-shrink-0"
                    title={t('ex.optionsTitle')}
                  >
                    <Settings2 size={16} />
                  </button>
                  <label className="flex items-center cursor-pointer flex-shrink-0" title={t('ex.toggleTitle')}>
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
                    title={t('common.uninstall')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                {/* Panneau de configuration inline (Fake Data, natif ou ZIP) */}
                {isFakeDataExt(ext) && nativeConfigOpen === ext.id && (
                  <div className="px-3 pb-3 pt-0">
                    <div className="border-t border-border pt-3 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-text-muted">{t('fakeExt.settingsDesc')}</p>
                        <button
                          onClick={exportFakeData}
                          disabled={exportingFakeData}
                          className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1 flex-shrink-0 ml-2"
                          title={t('fakeExt.exportTitle')}
                        >
                          {exportingFakeData ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Download size={12} />
                          )}
                          {t('fakeExt.export')}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { key: 'firstName', label: 'fake.firstName' },
                          { key: 'lastName', label: 'fake.lastName' },
                          { key: 'email', label: 'fake.email' },
                          { key: 'phone', label: 'fake.phone' },
                          { key: 'username', label: 'fake.username' },
                          { key: 'city', label: 'fake.city' },
                          { key: 'zip', label: 'fake.zip' },
                          { key: 'address', label: 'fake.address' },
                          { key: 'company', label: 'fake.company' },
                        ].map(({ key, label }) => (
                          <div key={key} className="block">
                            <label className="block text-xs text-text-muted mb-1">
                              {t(label)}
                              {settings.fakeData?.[key] && (
                                <span className="text-emerald-500 ml-1">
                                  <Check size={10} />
                                </span>
                              )}
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={settings.fakeData?.[key] || ''}
                                onChange={(e) =>
                                  updateSettings({
                                    fakeData: { ...(settings.fakeData || {}), [key]: e.target.value },
                                  })
                                }
                                onBlur={() => saveFakeDataSettings(settings.fakeData)}
                                placeholder="Laisser vide pour aléatoire"
                                className="input flex-1 text-sm"
                              />
                              {settings.fakeData?.[key] && (
                                <button
                                  onClick={() => {
                                    const updated = { ...(settings.fakeData || {}) };
                                    delete updated[key];
                                    updateSettings({ fakeData: updated });
                                    saveFakeDataSettings(updated);
                                  }}
                                  className="btn-icon p-1.5 text-error hover:bg-error/10 rounded"
                                  title="Effacer"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {fakeDataSaved && (
                        <p className="text-xs text-emerald-500 flex items-center gap-1">
                          <Check size={12} />
                          {t('fakeExt.saved')}
                        </p>
                      )}
                      <p className="text-xs text-text-muted">{t('fakeExt.usageNote')}</p>
                    </div>
                  </div>
                )}
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
            <p className="font-medium text-text-primary">{t('ex.limitsTitle')}</p>
            <p>{t('ex.limits1')}</p>
            <p>{t('ex.limits2')}</p>
            <p>{t('ex.limits3')}</p>
            <p>{t('ex.limits4')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}