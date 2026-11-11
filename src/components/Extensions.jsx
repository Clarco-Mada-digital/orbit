import { useState, useEffect, useCallback } from 'react';
import { Puzzle, FolderOpen, Trash2, Loader2, Info, Globe, Download, Settings2, AlertTriangle, RotateCw, Dice6, Check, X, Upload, Smartphone, CloudOff, WifiOff, Search, FileJson } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { getRegisteredWebviews } from '../lib/webviewRegistry';
import { appPartition } from '../lib/session';
import { reloadUrlFor } from '../lib/urls';
import { useT } from '../lib/i18n';
import { loadExtensionInfo, clearExtensionInfoCache } from '../lib/extensionInfo';
import { bundledInstallState } from '../lib/extensionCatalog';
import { usePhoneStore } from '../lib/phoneStore';

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

// L'icône d'une extension est son vrai logo (manifeste `icons`), pas le même
// puzzle pour tout le monde : le main process la renvoie en data URL. Les infos
// sont partagées avec la barre d'extensions via `lib/extensionInfo`.
function ExtIcon({ ext, enabled }) {
  const [icon, setIcon] = useState(null);
  useEffect(() => {
    let alive = true;
    loadExtensionInfo(ext).then((info) => {
      if (alive && info?.iconUrl) setIcon(info.iconUrl);
    });
    return () => {
      alive = false;
    };
  }, [ext.id, ext.path]);

  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        className={`h-6 w-6 object-contain transition-opacity ${enabled ? '' : 'opacity-40'}`}
        draggable={false}
      />
    );
  }
  return <Puzzle size={18} className={enabled ? 'text-accent-primary' : 'text-text-muted'} />;
}

// Une extension peut fournir une app native (`orbit.nativeApp`) : après
// installation, l'app est créée dans le store — ce bouton l'ouvre directement,
// sinon il faut la chercher dans la barre latérale.
function NativeAppLauncher({ ext, enabled }) {
  const [kind, setKind] = useState(null);
  useEffect(() => {
    let alive = true;
    loadExtensionInfo(ext).then((info) => {
      if (alive) setKind(info?.nativeApp || null);
    });
    return () => {
      alive = false;
    };
  }, [ext.id, ext.path]);

  if (kind !== 'phone' || !enabled) return null;
  return (
    <button
      type="button"
      onClick={() => {
        // Le Téléphone s'ouvre depuis la barre : on l'ouvre directement, sans
        // créer d'app dans le sidebar.
        if (kind === 'phone') usePhoneStore.getState().setOpen(true);
      }}
      className="btn btn-secondary flex-shrink-0 text-xs"
      title="Ouvrir l'app fournie par cette extension"
    >
      Ouvrir
    </button>
  );
}

// Infos d'une extension : version du manifeste (V2/V3) + avertissements
// (fonctionnalités non supportées par Electron). Chargés via le main process.
function ExtWarnings({ ext }) {
  const t = useT();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let mounted = true;
    loadExtensionInfo(ext).then((res) => {
      if (mounted && res) setInfo(res);
    });
    return () => {
      mounted = false;
    };
  }, [ext.id, ext.path]);

  if (!info) return null;
  const isV3 = info.manifestVersion === 3;
  const warnings = info.warnings || [];

  return (
    <div className="mt-1.5 space-y-1">
      {/* Une extension « native » ne contient pas de code : elle active une app
          intégrée d'Orbit. Le badge évite de la croire inutile. */}
      {info.nativeApp ? (
        <span className="mr-1 inline-flex items-center rounded bg-accent-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-primary">
          App native
        </span>
      ) : null}
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

// Types de champs configurables, dans l'ordre d'affichage. Les clés sont
// exactement celles que le remplissage 🎲 demande (`detectFieldKind`) : tout
// autre type peut être ajouté par le JSON, sans case dédiée ici.
const FAKE_FIELD_KEYS = [
  { key: 'firstName', label: 'fake.firstName' },
  { key: 'lastName', label: 'fake.lastName' },
  { key: 'fullName', label: 'fake.fullName' },
  { key: 'email', label: 'fake.email' },
  { key: 'username', label: 'fake.username' },
  { key: 'phone', label: 'fake.phone' },
  { key: 'birthdate', label: 'fake.birthdate' },
  { key: 'gender', label: 'fake.gender' },
  { key: 'avatar', label: 'fake.avatar' },
  { key: 'image', label: 'fake.image' },
  { key: 'address', label: 'fake.address' },
  { key: 'zip', label: 'fake.zip' },
  { key: 'city', label: 'fake.city' },
  { key: 'region', label: 'fake.region' },
  { key: 'country', label: 'fake.country' },
  { key: 'company', label: 'fake.company' },
  { key: 'jobTitle', label: 'fake.jobTitle' },
  { key: 'iban', label: 'fake.iban' },
  { key: 'subject', label: 'fake.subject' },
  { key: 'text', label: 'fake.text' },
];

// Les valeurs d'un type, telles qu'on les écrit dans les Réglages : une par
// ligne. Le format stocké accepte aussi bien ce texte qu'un tableau (import
// JSON) ou une valeur unique (ancien format) — le remplissage lit les trois.
const fakeLinesOf = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '')).join('\n');
  return typeof value === 'string' ? value : '';
};

const fakeValuesOf = (value) =>
  fakeLinesOf(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

// Un document JSON pour tous les types : `{ "city": ["Lyon", "Nantes"] }`.
// Les valeurs uniques (chaîne) et les nombres sont acceptés et normalisés.
function normalizeFakeLists(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('le document doit être un objet { type: [valeurs] }');
  }
  const source = parsed.lists && typeof parsed.lists === 'object' ? parsed.lists : parsed;
  const lists = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'source' || key === 'photos' || key === 'lists') continue;
    const values = Array.isArray(value)
      ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
      : fakeValuesOf(value);
    if (values.length) lists[key] = values;
  }
  if (!Object.keys(lists).length) throw new Error('aucune valeur trouvée dans ce document');
  return lists;
}

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
  const [fakeDataSaved, setFakeDataSaved] = useState(false);
  // Zone JSON des listes : `null` = fermée, une chaîne = en cours d'édition.
  const [fakeJsonDraft, setFakeJsonDraft] = useState(null);
  const [fakeJsonError, setFakeJsonError] = useState(null);
  const [nativeConfigOpen, setNativeConfigOpen] = useState(null); // id de l'extension dont le panneau inline est ouvert
  const [extQuery, setExtQuery] = useState('');
  // Archives optionnelles présentes à côté de l'application. Il n'y en a plus
  // dans les paquets publiés : ce chemin ne sert qu'en développement et aux
  // anciennes installations.
  const [bundled, setBundled] = useState([]);
  // Catalogue publié : la liste des extensions disponibles, téléchargées à la
  // demande. `stale` dit qu'on affiche une copie en cache (hors ligne).
  const [catalog, setCatalog] = useState({
    extensions: [],
    fetchedAt: 0,
    stale: false,
    error: null,
    loading: true,
  });

  const fakeDataDisabled = settings.fakeDataDisabled || false;
  const fakeDataRemoved = settings.fakeDataRemoved || false;

  // Appliquer l'état au preload au montage + quand il change
  useEffect(() => {
    window.electronAPI?.setFakeDataEnabled?.(!fakeDataDisabled);
  }, [fakeDataDisabled]);

  // Catalogue des extensions optionnelles embarquées (lecture unique au montage)
  useEffect(() => {
    const pending = window.electronAPI?.listBundledExtensions?.();
    if (!pending?.then) return;
    pending
      .then((res) => {
        if (res?.success) setBundled(Array.isArray(res.extensions) ? res.extensions : []);
      })
      .catch(() => {});
  }, []);

  // Catalogue publié. `refresh` force le tour par le réseau ; sans lui, une
  // copie de moins de six heures répond sans rien demander.
  const loadCatalog = useCallback(async (refresh = false) => {
    if (!window.electronAPI?.extensionCatalog) {
      setCatalog((state) => ({ ...state, loading: false }));
      return;
    }
    setCatalog((state) => ({ ...state, loading: true }));
    try {
      const res = await window.electronAPI.extensionCatalog({ refresh });
      setCatalog({
        extensions: Array.isArray(res?.extensions) ? res.extensions : [],
        fetchedAt: Number(res?.fetchedAt) || 0,
        stale: !!res?.stale,
        error: res?.success === false ? res?.error || 'catalogue indisponible' : res?.error || null,
        loading: false,
      });
    } catch (err) {
      setCatalog((state) => ({
        ...state,
        loading: false,
        error: String(err?.message || err),
      }));
    }
  }, []);

  useEffect(() => {
    loadCatalog(false);
  }, [loadCatalog]);

  // Ce que le magasin propose. Le catalogue en ligne fait foi ; les archives
  // locales ne complètent que ce qu'il ne connaît pas — en développement, ou
  // sur une installation plus ancienne qui en embarquait encore.
  // Le catalogue est fait pour grossir : sans filtre, une centaine
  // d'extensions deviendrait une liste qu'on parcourt à la molette.
  const [storeQuery, setStoreQuery] = useState('');
  const allStoreItems = [
    ...catalog.extensions.map((item) => ({ ...item, source: 'catalog' })),
    ...bundled
      .filter((item) => !catalog.extensions.some((remote) => remote.name === item.name))
      .map((item) => ({ ...item, source: 'bundled' })),
  ];
  const storeNeedle = storeQuery.trim().toLowerCase();
  const storeItems = storeNeedle
    ? allStoreItems.filter((item) =>
        `${item.name} ${item.description || ''}`.toLowerCase().includes(storeNeedle)
      )
    : allStoreItems;

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

  // ── Listes de valeurs Fake Data ───────────────────────────────────────────
  // Un type de champ = une liste de valeurs (une par ligne) où le 🎲 pioche au
  // hasard. Le texte saisi est stocké TEL QUEL (découpé au remplissage) : rien
  // ne bouge sous le curseur pendant la frappe.
  const fakeData = settings.fakeData || {};
  const fakeLists = fakeData.lists || {};
  const fakeBuiltinOnly = fakeData.source === 'builtin';

  const applyFakeData = (next, { save = true } = {}) => {
    updateSettings({ fakeData: next });
    if (save) saveFakeDataSettings(next);
  };

  const setFakeList = (key, text, { save = false } = {}) => {
    const lists = { ...fakeLists };
    if (text.trim()) lists[key] = text;
    else delete lists[key];
    // L'ancien format (une valeur unique à la racine) ferait doublon avec la
    // liste : on le retire dès que l'utilisateur touche au type.
    const next = { ...fakeData, lists };
    delete next[key];
    applyFakeData(next, { save });
  };

  const setFakeSource = (source) => applyFakeData({ ...fakeData, source });

  // Import d'un document JSON : `{ "city": ["Lyon"], "firstName": [...] }`.
  // Lu dans le renderer (FileReader), donc sans passer par le disque côté main.
  const importFakeJson = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const lists = normalizeFakeLists(JSON.parse(String(reader.result || '')));
        const next = { ...fakeData, source: 'custom', lists: { ...fakeLists, ...lists } };
        for (const key of Object.keys(lists)) delete next[key];
        applyFakeData(next);
        setFakeJsonError(null);
        setFakeJsonDraft(null);
      } catch (err) {
        setFakeJsonError(String(err?.message || err));
      }
    };
    reader.onerror = () => setFakeJsonError(t('fake.jsonUnreadable'));
    reader.readAsText(file);
  };

  // Le JSON de toutes les listes, y compris les types qui n'ont pas de case
  // dédiée dans l'interface (iban, cvc, un type inventé par l'utilisateur…).
  const fakeListsJson = () => {
    const out = {};
    for (const [key, value] of Object.entries(fakeLists)) {
      const values = fakeValuesOf(value);
      if (values.length) out[key] = values;
    }
    for (const { key } of FAKE_FIELD_KEYS) {
      if (!out[key] && typeof fakeData[key] === 'string' && fakeData[key].trim()) {
        out[key] = [fakeData[key].trim()];
      }
    }
    return JSON.stringify(out, null, 2);
  };

  const applyFakeJsonDraft = () => {
    try {
      const lists = normalizeFakeLists(JSON.parse(fakeJsonDraft || '{}'));
      const next = { ...fakeData, lists };
      for (const { key } of FAKE_FIELD_KEYS) delete next[key];
      applyFakeData(next);
      setFakeJsonError(null);
      setFakeJsonDraft(null);
    } catch (err) {
      setFakeJsonError(String(err?.message || err));
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
  // Partie commune aux deux chemins d'installation (archive locale choisie par
  // l'utilisateur, ou archive téléchargée depuis le catalogue) : ce qui suit
  // l'arrivée de l'extension dans Orbit est le même travail.
  const finishInstall = async (res) => {
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
  };

  const handleInstallFromZip = async (file) => {
    setBusy('zip');
    setError(null);
    try {
      await finishInstall(await window.electronAPI?.installExtensionFromZip?.(file));
    } catch (err) {
      console.error('[orbit-ui] Erreur installation ZIP:', err);
      setError(String(err?.message || err || 'Erreur inconnue'));
    } finally {
      setBusy(null);
    }
  };

  // Installation depuis le catalogue : le processus principal télécharge
  // l'archive, vérifie sa taille et son empreinte, puis l'installe. Le
  // renderer ne transmet qu'un nom de fichier.
  const handleInstallFromCatalog = async (item) => {
    setBusy(`catalog:${item.file}`);
    setError(null);
    try {
      await finishInstall(await window.electronAPI?.installExtensionFromCatalog?.(item.file));
    } catch (err) {
      console.error('[orbit-ui] Erreur installation depuis le catalogue:', err);
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
    // Le manifeste a pu changer (réinstallation ZIP, autre dossier) : on
    // repart d'un cache vide pour l'icône, le badge et les avertissements.
    clearExtensionInfoCache();
    try {
      const res = await window.electronAPI?.syncExtensions?.(nextList);
      // Apps natives (`orbit.nativeApp`) : présentes seulement si l'extension
      // qui les déclare est active — installation ET désinstallation passent ici.
      if (res?.nativeApps) useStore.getState().syncNativeApps(res.nativeApps);
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

  // Filtre local : avec une dizaine d'extensions, retrouver « Téléphone » ou un
  // bloqueur demandait de tout relire. Le tri reste l'ordre du store.
  const needle = extQuery.trim().toLowerCase();
  const shownExtensions = needle
    ? visibleExtensions.filter((ext) => String(ext.name || '').toLowerCase().includes(needle))
    : visibleExtensions;

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

      {/* Magasin d'extensions. Les archives ne sont PAS dans l'application :
          le catalogue est lu en ligne et chaque extension est téléchargée au
          moment où on l'installe. Les archives locales (développement,
          anciennes installations) servent de repli. */}
      {allStoreItems.length || catalog.loading || catalog.error ? (
        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Puzzle size={18} className="text-accent-primary" />
            <h4 className="font-semibold">Extensions Orbit</h4>
            {catalog.loading ? <Loader2 size={14} className="animate-spin text-text-muted" /> : null}
            <button
              type="button"
              onClick={() => loadCatalog(true)}
              disabled={catalog.loading}
              className="btn btn-secondary ml-auto flex-shrink-0 text-xs"
              title="Relire le catalogue en ligne"
            >
              <RotateCw size={13} /> Actualiser
            </button>
          </div>
          <p className="text-sm text-text-muted mb-3">
            Téléchargées à la demande : rien n'est embarqué dans Orbit, et une extension n'est
            active qu'une fois installée.
          </p>

          {allStoreItems.length > 6 ? (
            <div className="relative mb-3">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={storeQuery}
                onChange={(e) => setStoreQuery(e.target.value)}
                placeholder={`Rechercher parmi ${allStoreItems.length} extensions…`}
                className="w-full rounded-lg border border-border bg-bg-secondary py-1.5 pl-8 pr-8 text-xs outline-none placeholder:text-text-muted focus:border-accent-primary"
              />
              {storeQuery ? (
                <button
                  type="button"
                  onClick={() => setStoreQuery('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:text-text-primary"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Hors ligne, la liste reste affichée — mais datée. Mentir sur sa
              fraîcheur ferait chercher une extension publiée entre-temps. */}
          {catalog.stale && allStoreItems.length ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-yellow-500/25 bg-yellow-500/10 p-2.5 text-xs text-yellow-600 dark:text-yellow-400">
              <CloudOff size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Catalogue hors ligne
                {catalog.fetchedAt
                  ? ` — copie du ${new Date(catalog.fetchedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
                  : ''}
                . Les extensions déjà décrites ici restent installables si le serveur répond.
              </span>
            </div>
          ) : null}
          {!storeItems.length && storeNeedle ? (
            <p className="rounded-lg border border-border bg-bg-secondary p-3 text-xs text-text-muted">
              Aucune extension ne correspond à « {storeQuery} ».
            </p>
          ) : null}
          {!allStoreItems.length && !catalog.loading ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-bg-secondary p-3 text-xs text-text-muted">
              <WifiOff size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Catalogue injoignable{catalog.error ? ` (${catalog.error})` : ''}. Vérifiez la
                connexion, puis « Actualiser » — ou installez une extension depuis un fichier ZIP.
              </span>
            </div>
          ) : null}

          <div className="space-y-2">
            {storeItems.map((item) => {
              // Une version plus récente livrée avec Orbit doit pouvoir
              // s'installer PAR-DESSUS l'ancienne : sans ça, l'extension
              // continue de tourner dans sa version précédente sans qu'aucun
              // écran ne le dise.
              const { state, installedVersion } = bundledInstallState(item, extensions);
              const installed = state === 'installed';
              const updatable = state === 'update';
              return (
                <div
                  key={item.file}
                  className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary p-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-bg-elevated border border-border flex items-center justify-center flex-shrink-0">
                    {item.nativeApp === 'phone' ? (
                      <Smartphone size={17} className="text-accent-primary" />
                    ) : (
                      <Puzzle size={17} className="text-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{item.name}</span>
                      {item.nativeApp ? (
                        <span className="flex-shrink-0 rounded bg-accent-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-primary">
                          App native
                        </span>
                      ) : null}
                    </div>
                    {item.description ? (
                      <p className="line-clamp-2 text-xs text-text-muted">{item.description}</p>
                    ) : null}
                  </div>
                  <span className="flex-shrink-0 text-right text-xs text-text-muted">
                    v{item.version}
                    {updatable ? (
                      <span className="block text-[10px] text-accent-primary">
                        installée : v{installedVersion}
                      </span>
                    ) : null}
                    {/* Le poids a sa place ici : c'est un téléchargement, et
                        sur une connexion lente ça se décide avant de cliquer. */}
                    {!installed && item.size ? (
                      <span className="block text-[10px]">{Math.max(1, Math.round(item.size / 1024))} Ko</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      item.source === 'catalog'
                        ? handleInstallFromCatalog(item)
                        : handleInstallFromZip(item.zipPath)
                    }
                    disabled={installed || !!busy}
                    className={`btn flex-shrink-0 text-xs ${updatable ? 'btn-primary' : 'btn-secondary'}`}
                    title={
                      item.source === 'catalog'
                        ? 'Télécharger puis installer cette extension'
                        : 'Installer depuis l’archive locale'
                    }
                  >
                    {busy === `catalog:${item.file}` || (busy === 'zip' && !installed) ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Download size={13} />
                    )}
                    {installed ? 'Installée' : updatable ? 'Mettre à jour' : 'Installer'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Liste des extensions installées (y compris Fake Data natif) */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Puzzle size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('ex.installedTitle')}</h4>
          <span className="text-xs text-text-muted">({shownExtensions.length})</span>
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

        {visibleExtensions.length > 4 ? (
          <div className="relative mb-3">
            <Puzzle size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={extQuery}
              onChange={(e) => setExtQuery(e.target.value)}
              placeholder="Rechercher une extension…"
              className="input pl-9 text-sm"
            />
          </div>
        ) : null}

        {visibleExtensions.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-sm">
            <div className="text-3xl mb-2">🧩</div>
            <p>{t('ex.none')}</p>
          </div>
        ) : shownExtensions.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">
            Aucune extension ne correspond à « {extQuery.trim()} ».
          </p>
        ) : (
          <div className="space-y-3">
            {shownExtensions.map((ext) => (
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
                      <ExtIcon ext={ext} enabled={ext.enabled} />
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
                  <NativeAppLauncher ext={ext} enabled={ext.enabled} />
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
                      {/* Photos : seules valeurs qui passent par un service
                          externe (portraits de stock / Lorem Picsum). */}
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={fakeData.photos !== 'off'}
                          onChange={(e) =>
                            applyFakeData({
                              ...fakeData,
                              photos: e.target.checked ? 'on' : 'off',
                            })
                          }
                          className="mt-0.5 accent-accent-primary"
                        />
                        <span>
                          <span className="block text-xs text-text-primary">{t('fake.photos')}</span>
                          <span className="block text-xs text-text-muted">{t('fake.photosHint')}</span>
                        </span>
                      </label>
                      {/* Source des valeurs : les listes de l'utilisateur ou
                          celles intégrées à Orbit. Basculer ne SUPPRIME rien —
                          les listes restent enregistrées. */}
                      <div>
                        <p className="text-xs text-text-primary mb-1">{t('fake.sourceTitle')}</p>
                        <div className="flex gap-2">
                          {[
                            { value: 'custom', label: 'fake.sourceCustom' },
                            { value: 'builtin', label: 'fake.sourceBuiltin' },
                          ].map((option) => (
                            <button
                              key={option.value}
                              onClick={() => setFakeSource(option.value)}
                              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                                (option.value === 'builtin') === fakeBuiltinOnly
                                  ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                                  : 'border-border text-text-muted hover:bg-bg-hover'
                              }`}
                            >
                              {t(option.label)}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-text-muted mt-1">
                          {t(fakeBuiltinOnly ? 'fake.sourceBuiltinHint' : 'fake.sourceCustomHint')}
                        </p>
                      </div>

                      {/* Listes de valeurs : une par ligne, tirage au hasard. */}
                      <div
                        className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${
                          fakeBuiltinOnly ? 'opacity-50' : ''
                        }`}
                      >
                        {FAKE_FIELD_KEYS.map(({ key, label }) => {
                          const lines = fakeLinesOf(fakeLists[key] ?? fakeData[key]);
                          const count = fakeValuesOf(lines).length;
                          return (
                            <div key={key} className="block">
                              <label className="flex items-center gap-1 text-xs text-text-muted mb-1">
                                {t(label)}
                                {count > 0 && (
                                  <span className="text-emerald-500 flex items-center gap-0.5">
                                    <Check size={10} />
                                    {count > 1 && <span>{t('fake.valueCount', { count })}</span>}
                                  </span>
                                )}
                              </label>
                              <div className="flex gap-2">
                                <textarea
                                  rows={Math.min(6, Math.max(2, count))}
                                  value={lines}
                                  disabled={fakeBuiltinOnly}
                                  onChange={(e) => setFakeList(key, e.target.value)}
                                  onBlur={(e) => setFakeList(key, e.target.value, { save: true })}
                                  placeholder={t('fake.listPlaceholder')}
                                  className="input flex-1 text-sm font-mono resize-y"
                                />
                                {count > 0 && (
                                  <button
                                    onClick={() => setFakeList(key, '', { save: true })}
                                    className="btn-icon p-1.5 text-error hover:bg-error/10 rounded self-start"
                                    title={t('fake.clear')}
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Document JSON : importer un jeu de données complet, ou
                          régler des types qui n'ont pas de case ci-dessus. */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <label className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1 cursor-pointer">
                            <Upload size={12} />
                            {t('fake.importJson')}
                            <input
                              type="file"
                              accept="application/json,.json"
                              className="hidden"
                              onChange={(e) => {
                                importFakeJson(e.target.files?.[0]);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          <button
                            onClick={() =>
                              setFakeJsonDraft(fakeJsonDraft === null ? fakeListsJson() : null)
                            }
                            className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
                          >
                            <FileJson size={12} />
                            {t(fakeJsonDraft === null ? 'fake.showJson' : 'fake.hideJson')}
                          </button>
                        </div>
                        <p className="text-xs text-text-muted">{t('fake.jsonHint')}</p>
                        {fakeJsonDraft !== null && (
                          <div className="space-y-2">
                            <textarea
                              rows={10}
                              value={fakeJsonDraft}
                              onChange={(e) => setFakeJsonDraft(e.target.value)}
                              spellCheck={false}
                              className="input w-full text-xs font-mono resize-y"
                            />
                            <div className="flex gap-2">
                              <button onClick={applyFakeJsonDraft} className="btn-primary text-xs">
                                {t('fake.applyJson')}
                              </button>
                              <button
                                onClick={() => {
                                  setFakeJsonDraft(null);
                                  setFakeJsonError(null);
                                }}
                                className="btn-secondary text-xs"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                        {fakeJsonError && (
                          <p className="text-xs text-error flex items-center gap-1">
                            <AlertTriangle size={12} />
                            {fakeJsonError}
                          </p>
                        )}
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