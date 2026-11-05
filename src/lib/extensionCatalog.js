// ---------------------------------------------------------------------------
// Catalogue des extensions livrées avec Orbit — LOGIQUE PURE.
//
// Le catalogue listait l'état « Installer » / « Installée » en comparant les
// seuls NOMS, et désactivait le bouton dès qu'une extension du même nom était
// installée. Conséquence : une version plus récente livrée avec Orbit était
// invisible et impossible à installer depuis l'interface — l'ancienne continuait
// de tourner, avec ses anciens raccourcis, sans le moindre indice.
//
// C'est cette décision-là qui vit ici, et que `node --test` verrouille.
// ---------------------------------------------------------------------------

// Comparaison de versions « 1.10.0 » > « 1.9.3 » (chaque segment est un
// nombre, les segments manquants valent 0). Un suffixe non numérique
// (« 1.2.0-beta ») est ignoré : au pire, les deux versions sont dites égales,
// et on n'invente pas une mise à jour.
export function compareExtensionVersions(a, b) {
  const parse = (value) =>
    String(value || '')
      .trim()
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .filter((part) => Number.isFinite(part));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// État d'une entrée du catalogue face aux extensions installées.
//
//   'install'   → absente, bouton actif
//   'update'    → installée dans une version PLUS ANCIENNE, bouton actif
//   'installed' → à jour (ou plus récente que l'archive), bouton inerte
//
// Le rapprochement se fait par nom : l'identifiant d'une extension non
// empaquetée est dérivé du dossier d'extraction, il change à chaque
// installation et ne peut donc pas servir de repère.
export function bundledInstallState(item, installed = []) {
  const name = String(item?.name || '');
  const match = (Array.isArray(installed) ? installed : []).find(
    (candidate) => candidate?.name && candidate.name === name
  );
  if (!match) return { state: 'install', installedVersion: null };
  const installedVersion = match.version || null;
  const newer = compareExtensionVersions(item?.version, installedVersion) > 0;
  return { state: newer ? 'update' : 'installed', installedVersion };
}
