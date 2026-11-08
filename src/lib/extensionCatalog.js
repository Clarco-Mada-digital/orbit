// ---------------------------------------------------------------------------
// Catalogue des extensions d'Orbit — LOGIQUE PURE.
//
// Les archives ne sont plus EMBARQUÉES dans l'application : elles sont
// publiées à part et téléchargées à la demande. Une application qui portera
// peut-être cent extensions ne peut pas grossir de toutes celles que personne
// n'installera — et une extension corrigée ne doit pas attendre la prochaine
// version d'Orbit pour arriver.
//
// Ce qui vit ici est ce qui décide quoi télécharger, et depuis où. C'est du
// code de SÉCURITÉ : le catalogue vient du réseau, donc tout ce qu'il annonce
// est traité comme hostile jusqu'à preuve du contraire — nom de fichier,
// taille, empreinte, et l'URL de téléchargement qui ne doit pas pouvoir
// quitter le dossier du catalogue.
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

// ---------------------------------------------------------------------------
// Catalogue distant
// ---------------------------------------------------------------------------

// Le catalogue publié. GitHub Pages du dépôt : une URL stable, servie en
// HTTPS, qui se met à jour d'un simple push sur `master` — sans republier
// Orbit. `ORBIT_EXTENSIONS_URL` permet d'en viser un autre (recette, miroir
// interne, développement local).
export const EXTENSION_CATALOG_URL =
  'https://clarco-mada-digital.github.io/orbit/extensions/catalog.json';

// Un catalogue de cent extensions tient très largement dans 512 Ko ; au-delà,
// c'est que la réponse n'est pas celle qu'on croit (page d'erreur, portail
// captif) et la lire plus loin ne sert à rien.
export const MAX_CATALOG_BYTES = 512 * 1024;
// Plafond par archive. Une extension Chrome qui dépasse 32 Mo n'existe pas
// dans ce catalogue : refuser tôt évite de remplir le disque sur la foi d'un
// `content-length` annoncé par le serveur.
export const MAX_EXTENSION_BYTES = 32 * 1024 * 1024;
// Durée au bout de laquelle le catalogue en cache est considéré comme vieux.
// Il reste AFFICHÉ passé ce délai (hors ligne, on préfère une liste datée à
// une liste vide), avec la date de la copie.
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

// Nom d'archive acceptable. Il sert à construire une URL ET un chemin de
// fichier local : ni séparateur, ni remontée de dossier, ni caractère exotique
// n'y ont leur place.
export function isSafeCatalogFile(file) {
  const value = String(file || '');
  if (!value || value.length > 100) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(value)) return false;
  // `..` est déjà exclu par la classe de caractères du premier segment, mais
  // l'écrire ici rend la règle lisible sans dérouler la regex.
  return !value.includes('..');
}

// Une entrée du catalogue, ou `null` si elle ne tient pas ses promesses.
//
// L'empreinte est OBLIGATOIRE : sans elle, rien ne distingue l'archive publiée
// de celle qu'un intermédiaire aurait remplacée. Une entrée sans `sha256` est
// donc écartée du magasin plutôt qu'installable sans contrôle.
export function normalizeCatalogEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const file = String(raw.file || '');
  if (!isSafeCatalogFile(file)) return null;
  const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 100) return null;
  const version = String(raw.version || '').trim();
  if (!/^\d+(\.\d+){0,3}(-[A-Za-z0-9.]+)?$/.test(version)) return null;
  const size = Number(raw.size);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_EXTENSION_BYTES) return null;
  const sha256 = String(raw.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const nativeApp = raw.nativeApp == null ? null : String(raw.nativeApp);
  if (nativeApp !== null && !/^[a-z][a-z0-9-]{0,30}$/.test(nativeApp)) return null;
  return {
    file,
    name,
    version,
    description: String(raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    nativeApp,
    size,
    sha256,
  };
}

// Le catalogue entier. Les entrées illisibles sont ÉCARTÉES une par une : une
// extension mal publiée ne doit pas vider le magasin des autres.
export function normalizeCatalog(raw) {
  const entries = Array.isArray(raw?.extensions) ? raw.extensions : [];
  const seen = new Set();
  const extensions = [];
  for (const entry of entries) {
    const clean = normalizeCatalogEntry(entry);
    if (!clean || seen.has(clean.file)) continue;
    seen.add(clean.file);
    extensions.push(clean);
  }
  extensions.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return {
    version: Number(raw?.version) || 1,
    generatedAt: typeof raw?.generatedAt === 'string' ? raw.generatedAt : null,
    extensions,
  };
}

// URL de l'archive, résolue À CÔTÉ du catalogue.
//
// Le nom de fichier vient d'une réponse réseau : même validé, il ne décide pas
// seul de l'adresse appelée. On exige que l'URL obtenue reste sur la même
// origine ET dans le même dossier que le catalogue — un catalogue détourné ne
// peut donc pas faire télécharger son archive ailleurs.
export function extensionDownloadUrl(catalogUrl, file) {
  if (!isSafeCatalogFile(file)) return null;
  let base = null;
  try {
    base = new URL(String(catalogUrl));
  } catch {
    return null;
  }
  // HTTPS seulement, et c'est aussi tout ce que sait faire le téléchargeur :
  // les deux couches doivent dire la même chose, sinon une URL acceptée ici
  // échouerait plus loin sans explication.
  if (base.protocol !== 'https:') return null;
  const dir = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  let target = null;
  try {
    target = new URL(file, `${base.origin}${dir}`);
  } catch {
    return null;
  }
  if (target.origin !== base.origin) return null;
  if (!target.pathname.startsWith(dir)) return null;
  return target.toString();
}

// Âge d'une copie en cache, pour le dire à l'écran plutôt que de l'afficher
// comme si elle venait d'arriver.
export function catalogIsStale(fetchedAt, now = Date.now()) {
  const at = Number(fetchedAt);
  if (!Number.isFinite(at) || at <= 0) return true;
  return now - at > CATALOG_TTL_MS;
}
