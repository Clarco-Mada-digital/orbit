// ---------------------------------------------------------------------------
// Catalogue de raccourcis de recherche (« bangs ») : « @amz casque » cherche
// sur Amazon, « @mdn grid » sur MDN… plus de 10 000 sites.
//
// Source : la liste maintenue par Helium (https://services.helium.imput.net/
// bangs.json), elle-même dérivée de celle de Kagi — licence MIT. Elle est
// livrée avec Orbit sous forme d'instantané (src/lib/bangsData.js, généré par
// scripts/update-bangs.js) et chargée À LA DEMANDE : rien n'est lu tant qu'on
// ne tape pas « @ » ou « ! ».
//
// Ordre de priorité, du plus fort au plus faible :
//   1. les moteurs personnalisés de l'utilisateur ;
//   2. les moteurs intégrés d'Orbit (searchEngines.js) ;
//   3. ce catalogue.
// Un raccourci du catalogue ne remplace donc jamais un choix de l'utilisateur,
// et l'utilisateur peut « personnaliser » n'importe quelle entrée : elle est
// alors copiée dans ses moteurs, où il la modifie librement.
//
// Module SANS DÉPENDANCE (testé par test/bangs.test.js).
// ---------------------------------------------------------------------------

// Format compact d'une entrée de l'instantané : [nom, url, [raccourcis…]].
// L'URL utilise `{q}`, la convention d'Orbit (searchEngines.js).
const NAME = 0;
const URL_TEMPLATE = 1;
const KEYWORDS = 2;

// Raccourci utilisable : ce que `parseBang` sait lire (lettres, chiffres,
// tiret, souligné). Les raccourcis en cyrillique du catalogue ne seraient
// jamais atteints : on ne les garde pas.
const KEYWORD_RE = /^[a-z0-9_-]{1,40}$/;

// --- Lecture de la source (utilisée par le script de mise à jour) ---------

// Le fichier publié n'est pas du JSON strict : un en-tête de commentaires
// `//` et des virgules finales. On les retire avant de le lire.
export function parseBangsSource(text) {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  if (start < 0) throw new Error('liste de raccourcis introuvable');
  const body = raw
    .slice(start)
    .replace(/,(\s*[\]}])/g, '$1');
  const list = JSON.parse(body);
  if (!Array.isArray(list)) throw new Error('la source n’est pas une liste');
  return list;
}

// Une entrée de la source → entrée compacte, ou null si elle est inutilisable.
// Garde-fous : https uniquement, un seul emplacement pour les termes, pas de
// caractère qui casserait l'URL une fois les termes insérés.
export function compactBang(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = String(entry.s || '').trim().slice(0, 80);
  const url = String(entry.u || '').trim();
  if (!name || !/^https:\/\/[^\s"'<>]+$/i.test(url)) return null;
  if (url.split('{searchTerms}').length !== 2) return null;
  const keywords = [];
  for (const k of Array.isArray(entry.ts) ? entry.ts : []) {
    const kw = String(k || '').trim().toLowerCase();
    if (KEYWORD_RE.test(kw) && !keywords.includes(kw)) keywords.push(kw);
  }
  if (!keywords.length) return null;
  return [name, url.replace('{searchTerms}', '{q}'), keywords];
}

export function compactBangs(list) {
  const out = [];
  const seen = new Set();
  for (const entry of list || []) {
    const c = compactBang(entry);
    if (!c) continue;
    // Un raccourci appartient à la PREMIÈRE entrée qui le déclare (la source
    // est triée par popularité) : les suivantes le perdent.
    const keywords = c[KEYWORDS].filter((k) => !seen.has(k));
    if (!keywords.length) continue;
    keywords.forEach((k) => seen.add(k));
    out.push([c[NAME], c[URL_TEMPLATE], keywords]);
  }
  return out;
}

// --- Index et recherche ---------------------------------------------------

// Construit l'index une fois : raccourci → entrée, plus la liste triée des
// raccourcis pour la complétion par préfixe (recherche dichotomique).
export function buildBangIndex(data) {
  const byKeyword = new Map();
  for (const entry of data || []) {
    for (const k of entry[KEYWORDS] || []) {
      if (!byKeyword.has(k)) byKeyword.set(k, entry);
    }
  }
  const keywords = [...byKeyword.keys()].sort();
  return { byKeyword, keywords, size: (data || []).length };
}

// Entrée du catalogue → moteur au format de searchEngines.js. Le raccourci
// principal est celui qu'on a tapé s'il appartient à l'entrée : « @amz »
// affiche « @amz », pas « @a ».
export function bangToEngine(entry, typed) {
  if (!entry) return null;
  const keywords = entry[KEYWORDS];
  const keyword = keywords.includes(typed) ? typed : keywords[0];
  return {
    id: `bang:${keywords[0]}`,
    name: entry[NAME],
    keyword,
    aliases: keywords.filter((k) => k !== keyword),
    url: entry[URL_TEMPLATE],
    color: '#64748b',
    catalog: true,
  };
}

export function lookupBang(index, keyword) {
  if (!index) return null;
  const k = String(keyword || '').toLowerCase();
  const entry = index.byKeyword.get(k);
  return entry ? bangToEngine(entry, k) : null;
}

// Moteurs du catalogue dont un raccourci commence par `prefix` — la
// complétion de « @am… ». Le raccourci exact d'abord, puis les plus courts
// (les plus « canoniques »), une seule ligne par site.
export function matchBangs(index, prefix, limit = 8) {
  if (!index) return [];
  const p = String(prefix || '').toLowerCase();
  if (!p) return [];
  const { keywords, byKeyword } = index;
  let lo = 0;
  let hi = keywords.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keywords[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  const hits = [];
  for (let i = lo; i < keywords.length && keywords[i].startsWith(p); i += 1) {
    hits.push(keywords[i]);
    if (hits.length > limit * 20) break;
  }
  hits.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  const out = [];
  const seenEntries = new Set();
  for (const k of hits) {
    const entry = byKeyword.get(k);
    if (seenEntries.has(entry)) continue;
    seenEntries.add(entry);
    out.push(bangToEngine(entry, k));
    if (out.length >= limit) break;
  }
  return out;
}

// Recherche libre dans le catalogue (réglages) : par raccourci exact, puis
// par nom ou domaine contenant le texte.
export function searchBangCatalog(data, query, limit = 30) {
  const q = String(query || '').trim().toLowerCase().replace(/^[@!]+/, '');
  if (!q) return [];
  const exact = [];
  const starts = [];
  const contains = [];
  for (const entry of data || []) {
    const name = entry[NAME].toLowerCase();
    const keywords = entry[KEYWORDS];
    if (keywords.includes(q)) exact.push(entry);
    else if (name.startsWith(q) || keywords.some((k) => k.startsWith(q))) starts.push(entry);
    else if (name.includes(q) || entry[URL_TEMPLATE].toLowerCase().includes(q)) contains.push(entry);
    if (exact.length + starts.length >= limit) break;
  }
  return [...exact, ...starts, ...contains].slice(0, limit).map((e) => bangToEngine(e, q));
}
