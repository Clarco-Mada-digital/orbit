// ---------------------------------------------------------------------------
// Moteurs de recherche et résolution d'une saisie libre.
//
// Deux endroits d'Orbit reçoivent du texte tapé à la main sans savoir ce que
// c'est : la palette (Alt+K) et le champ d'adresse (Alt+L). Jusqu'ici chacun
// faisait sa propre supposition — la palette ne rendait RIEN quand la saisie
// ne ressemblait à aucune app, et le champ d'adresse exigeait « https:// » en
// toutes lettres, ce qui est exactement ce qu'on ne tape pas.
//
// La décision vit donc ici, une seule fois : `resolveOmniInput` répond
// « c'est une adresse » ou « c'est une recherche », et avec quel moteur.
//
// Module SANS DÉPENDANCE (testé par test/searchEngines.test.js, qui tourne
// sans node_modules) : pas de React, pas de store, pas d'Electron.
// ---------------------------------------------------------------------------
import { detectUrl } from './urls.js';

// Moteurs fournis d'origine. Le `keyword` est ce qu'on tape après « @ » :
// « @g chat » → Google. Les raccourcis courts sont ceux qu'on a dans les
// doigts (@g, @d, @w), les plus longs servent d'alias lisibles.
//
// `url` contient {q} — remplacé par les termes encodés. Rien d'autre n'est
// substitué : un moteur est une URL, pas un langage de modèle.
export const BUILTIN_ENGINES = [
  {
    id: 'google',
    name: 'Google',
    keyword: 'g',
    aliases: ['google'],
    url: 'https://www.google.com/search?q={q}',
    color: '#4285f4',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    keyword: 'd',
    aliases: ['ddg', 'duck', 'duckduckgo'],
    url: 'https://duckduckgo.com/?q={q}',
    color: '#de5833',
  },
  {
    id: 'startpage',
    name: 'Startpage',
    keyword: 'sp',
    aliases: ['startpage'],
    url: 'https://www.startpage.com/sp/search?query={q}',
    color: '#6576ff',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    keyword: 'br',
    aliases: ['brave'],
    url: 'https://search.brave.com/search?q={q}',
    color: '#fb542b',
  },
  {
    id: 'qwant',
    name: 'Qwant',
    keyword: 'qw',
    aliases: ['qwant'],
    url: 'https://www.qwant.com/?q={q}',
    color: '#f82b60',
  },
  {
    id: 'ecosia',
    name: 'Ecosia',
    keyword: 'ec',
    aliases: ['ecosia'],
    url: 'https://www.ecosia.org/search?q={q}',
    color: '#0d9488',
  },
  {
    id: 'bing',
    name: 'Bing',
    keyword: 'b',
    aliases: ['bing'],
    url: 'https://www.bing.com/search?q={q}',
    color: '#008373',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    keyword: 'pp',
    aliases: ['perplexity', 'ia', 'ai'],
    url: 'https://www.perplexity.ai/search?q={q}',
    color: '#20808d',
  },
  {
    id: 'wikipedia',
    name: 'Wikipédia',
    keyword: 'w',
    aliases: ['wiki', 'wikipedia'],
    // {lang} est remplacé par la langue de l'interface (voir `engineUrl`)
    url: 'https://{lang}.wikipedia.org/w/index.php?search={q}',
    color: '#636466',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    keyword: 'yt',
    aliases: ['youtube', 'video'],
    url: 'https://www.youtube.com/results?search_query={q}',
    color: '#ff0000',
  },
  {
    id: 'github',
    name: 'GitHub',
    keyword: 'gh',
    aliases: ['github', 'git'],
    url: 'https://github.com/search?q={q}',
    color: '#8b949e',
  },
  {
    id: 'npm',
    name: 'npm',
    keyword: 'npm',
    aliases: ['node'],
    url: 'https://www.npmjs.com/search?q={q}',
    color: '#cb3837',
  },
  {
    id: 'mdn',
    name: 'MDN',
    keyword: 'mdn',
    aliases: ['doc', 'web'],
    url: 'https://developer.mozilla.org/{lang}/search?q={q}',
    color: '#8b5cf6',
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    keyword: 'so',
    aliases: ['stack', 'stackoverflow'],
    url: 'https://stackoverflow.com/search?q={q}',
    color: '#f48024',
  },
  {
    id: 'maps',
    name: 'Google Maps',
    keyword: 'm',
    aliases: ['map', 'maps', 'carte'],
    url: 'https://www.google.com/maps/search/{q}',
    color: '#34a853',
  },
  {
    id: 'translate',
    name: 'Google Traduction',
    keyword: 'tr',
    aliases: ['trad', 'translate', 'traduire'],
    url: 'https://translate.google.com/?sl=auto&tl={lang}&text={q}&op=translate',
    color: '#1a73e8',
  },
];

export const DEFAULT_ENGINE_ID = 'google';

// Préfixes reconnus devant un raccourci de moteur. « @ » est celui d'Orbit
// (c'est le geste documenté) ; « ! » est accepté parce que c'est le réflexe
// de qui vient de DuckDuckGo, et le reconnaître ne coûte rien.
const BANG_PREFIXES = ['@', '!'];

// Un moteur personnalisé n'est utilisable que s'il a de quoi chercher : un
// nom, un raccourci, et une URL qui contient bien l'emplacement des termes.
// Sans {q}, chaque recherche ouvrirait la même page — un réglage qui ne
// prévient pas est pire qu'un réglage refusé.
export function isValidEngine(engine) {
  if (!engine) return false;
  const url = String(engine.url || '');
  return (
    Boolean(String(engine.name || '').trim()) &&
    Boolean(normalizeKeyword(engine.keyword)) &&
    /^https?:\/\//i.test(url) &&
    (url.includes('{q}') || url.includes('%s'))
  );
}

// Raccourci normalisé : minuscules, sans le « @ » que l'utilisateur recopie
// souvent dans le champ, sans espace.
export function normalizeKeyword(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[@!]+/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

// Liste complète des moteurs disponibles : les intégrés non masqués, puis
// ceux de l'utilisateur. Un moteur personnalisé qui reprend le raccourci d'un
// intégré gagne — c'est son réglage, il doit l'emporter sur le nôtre.
export function allEngines(search = {}) {
  const hidden = new Set(search.hiddenEngines || []);
  const custom = (search.customEngines || [])
    .filter(isValidEngine)
    .map((e) => ({ ...e, keyword: normalizeKeyword(e.keyword), custom: true }));
  const customKeywords = new Set(custom.map((e) => e.keyword));
  const builtin = BUILTIN_ENGINES.filter(
    (e) => !hidden.has(e.id) && !customKeywords.has(e.keyword)
  );
  return [...builtin, ...custom];
}

// Moteur par défaut : celui choisi dans les réglages, sinon Google, sinon le
// premier disponible — la palette ne doit jamais se retrouver sans moteur
// parce qu'un id pointe vers un moteur supprimé.
export function defaultEngine(search = {}) {
  const engines = allEngines(search);
  return (
    engines.find((e) => e.id === search.engine) ||
    engines.find((e) => e.id === DEFAULT_ENGINE_ID) ||
    engines[0] ||
    BUILTIN_ENGINES[0]
  );
}

export function engineByKeyword(engines, keyword) {
  const k = normalizeKeyword(keyword);
  if (!k) return null;
  return (
    engines.find((e) => normalizeKeyword(e.keyword) === k) ||
    engines.find((e) => (e.aliases || []).includes(k)) ||
    null
  );
}

// Moteurs dont le raccourci COMMENCE par ce qui est tapé : c'est la liste de
// complétion affichée pendant la saisie de « @… ». Un préfixe vide rend tout.
export function matchEngines(engines, prefix) {
  const p = normalizeKeyword(prefix);
  if (!p) return engines;
  const starts = [];
  const contains = [];
  for (const e of engines) {
    const k = normalizeKeyword(e.keyword);
    const names = [k, ...(e.aliases || []), String(e.name || '').toLowerCase()];
    if (names.some((n) => n.startsWith(p))) starts.push(e);
    else if (names.some((n) => n.includes(p))) contains.push(e);
  }
  return [...starts, ...contains];
}

// URL de recherche d'un moteur. `{q}` (ou `%s`, la convention des
// navigateurs) reçoit les termes encodés ; `{lang}` la langue de l'interface,
// pour que Wikipédia et MDN répondent dans la bonne langue.
export function engineUrl(engine, terms, lang = 'fr') {
  if (!engine) return null;
  const q = String(terms || '').trim();
  if (!q) return null;
  const encoded = encodeURIComponent(q);
  return String(engine.url)
    .split('{q}')
    .join(encoded)
    .split('%s')
    .join(encoded)
    .split('{lang}')
    .join(lang === 'en' ? 'en' : 'fr');
}

// Découpe « @g mes termes » en { prefix, keyword, terms, complete }.
//
// `complete` dit si le raccourci est refermé par une espace : « @g » seul est
// encore en train d'être tapé (on propose la liste des moteurs), « @g  » ou
// « @g chat » est un choix fait (on cherche). C'est ce qui permet au Tab de
// transformer une saisie en cours en moteur retenu.
export function parseBang(input) {
  const s = String(input || '');
  const prefix = BANG_PREFIXES.find((p) => s.startsWith(p));
  if (!prefix) return null;
  const rest = s.slice(prefix.length);
  // « @ » suivi d'une espace ou de rien : la liste complète des moteurs
  const m = rest.match(/^([\w-]*)(\s+([\s\S]*))?$/);
  if (!m) return null;
  return {
    prefix,
    keyword: m[1].toLowerCase(),
    terms: (m[3] || '').trim(),
    complete: Boolean(m[2]),
  };
}

// --- Le cœur : que faire d'une saisie libre ? -----------------------------
//
// Renvoie toujours un objet, jamais null, pour que l'appelant n'ait pas à
// redevenir le juge :
//   { kind: 'empty' }                               rien de saisi
//   { kind: 'engines', engines, keyword, terms }    « @… » en cours de frappe
//   { kind: 'url', url }                            une adresse
//   { kind: 'search', url, engine, terms, bang }    une recherche
//
// Ordre des décisions, et pourquoi :
//   1. un raccourci explicite gagne sur tout — « @g github.com » veut bien
//      dire « cherche cette chaîne », pas « ouvre ce site » ;
//   2. une adresse reconnaissable s'ouvre (c'est le cas le plus coûteux à
//      rater : chercher « mon-intranet.local » sur Google ne sert à rien) ;
//   3. le reste est une recherche.
export function resolveOmniInput(input, { search = {}, lang = 'fr' } = {}) {
  const raw = String(input || '');
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  const engines = allEngines(search);
  const bang = parseBang(trimmed);

  if (bang) {
    const engine = engineByKeyword(engines, bang.keyword);
    const candidates = matchEngines(engines, bang.keyword);
    // Raccourci encore en cours de frappe, ou inconnu mais qui ressemble à
    // quelque chose : on propose la liste plutôt que de chercher « @gg ».
    //
    // S'il ne ressemble à RIEN en revanche (« !important css »), ce n'était
    // pas un raccourci : on laisse la saisie suivre son cours normal. Afficher
    // une liste vide serait un cul-de-sac, exactement ce qu'on vient corriger.
    if ((!engine || !bang.complete) && candidates.length) {
      return {
        kind: 'engines',
        engines: candidates,
        keyword: bang.keyword,
        terms: bang.terms,
        prefix: bang.prefix,
        engine: engine || null,
      };
    }
    // Moteur retenu mais pas encore de termes : on attend la suite.
    if (engine && !bang.terms) {
      return { kind: 'engines', engines: [engine], keyword: bang.keyword, terms: '', prefix: bang.prefix, engine };
    }
    if (engine) {
      return {
        kind: 'search',
        url: engineUrl(engine, bang.terms, lang),
        engine,
        terms: bang.terms,
        bang: true,
      };
    }
    // Aucun moteur derrière ce « @ » / « ! » : on continue comme pour n'importe
    // quelle autre saisie (ci-dessous), ponctuation comprise.
  }

  const url = detectUrl(trimmed);
  if (url) return { kind: 'url', url };

  const engine = defaultEngine(search);
  return {
    kind: 'search',
    url: engineUrl(engine, trimmed, lang),
    engine,
    terms: trimmed,
    bang: false,
  };
}
