// ---------------------------------------------------------------------------
// Infos d'une extension (manifeste, icône, avertissements) — CACHE PARTAGÉ.
//
// `getExtensionInfo` lit manifest.json sur le disque et renvoie l'icône en data
// URL. La barre d'extensions, la liste repliée et la page Extensions demandaient
// chacune ces infos pour le même paquet : un aller-retour IPC + une lecture
// disque par composant, à chaque montage de menu. Ici, une seule promesse par
// extension, partagée par tous les appelants.
// ---------------------------------------------------------------------------

const CACHE = new Map(); // chemin d'installation → Promise<info|null>

function keyOf(ext) {
  return ext?.path || ext?.id || '';
}

export function loadExtensionInfo(ext) {
  const key = keyOf(ext);
  if (!key) return Promise.resolve(null);
  const cached = CACHE.get(key);
  if (cached) return cached;

  const pending = window.electronAPI?.getExtensionInfo?.({ id: ext.id, path: ext.path });
  // Pas de pont (aperçu web) : rien à mettre en cache, la prochaine tentative
  // sera peut-être la bonne.
  if (!pending?.then) return Promise.resolve(null);

  const promise = pending
    .then((res) => (res?.success && res.info ? res.info : null))
    .catch(() => null)
    .then((info) => {
      // Une lecture ratée (dossier supprimé entre-temps) ne doit pas rester en
      // cache : la prochaine tentative pourra réussir.
      if (!info) CACHE.delete(key);
      return info;
    });
  CACHE.set(key, promise);
  return promise;
}

// À appeler après une installation/désinstallation : le manifeste a pu changer.
export function clearExtensionInfoCache() {
  CACHE.clear();
}
