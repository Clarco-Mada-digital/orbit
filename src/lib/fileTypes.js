// ---------------------------------------------------------------------------
// Nature d'un fichier ou d'une URL de document — LOGIQUE PURE, partagée.
//
// POURQUOI CE MODULE EXISTE
//
// Chromium décide tout seul comment afficher une ressource, et sa règle ne
// dépend PAS de l'extension : elle dépend du `Content-Type` et du
// `Content-Disposition` renvoyés. Mesuré sur Electron 43 :
//
//   • text/plain, text/markdown, application/json  → la page s'affiche (en
//     TEXTE BRUT : ni titre markdown, ni JSON indenté, ni tableau CSV) ;
//   • application/octet-stream, ou tout `Content-Disposition: attachment`
//     (ce que renvoient la plupart des NAS, serveurs statiques et webmails
//     pour un .md/.json/.csv) → la navigation devient un TÉLÉCHARGEMENT : le
//     <webview> ne reçoit aucun document et reste BLANC.
//
// D'où le partage de responsabilité : à partir d'ici, Orbit ne délègue plus
// l'affichage des documents TEXTE au moteur — il les lit et les met en forme
// lui-même. Les types que le moteur affiche nativement et correctement (page
// HTML, PDF, image, média) continuent de passer par le <webview>.
//
// Ce module ne dépend ni d'Electron ni de React : le processus principal et
// l'interface s'y réfèrent, et il est testable sous `node --test`.
// ---------------------------------------------------------------------------

// Nature d'un document. C'est elle qui décide de la façon de l'afficher.
export const KIND = {
  page: 'page', // page HTML ou adresse web → <webview>
  pdf: 'pdf', // PDF → <webview> (visionneuse native du moteur)
  image: 'image', // image → <webview>
  media: 'media', // audio / vidéo → <webview>
  markdown: 'markdown', // → visionneuse Orbit (rendu markdown)
  json: 'json', // → visionneuse Orbit (indenté)
  csv: 'csv', // → visionneuse Orbit (tableau)
  code: 'code', // → visionneuse Orbit (monospace + numéros de ligne)
  text: 'text', // → visionneuse Orbit (monospace)
  unknown: 'unknown', // ni affichable, ni lisible → on propose, on ne devine pas
};

// Types qu'Orbit met en forme lui-même (texte). Le reste est « natif ».
const VIEWER_KINDS = new Set([KIND.markdown, KIND.json, KIND.csv, KIND.code, KIND.text]);
const NATIVE_KINDS = new Set([KIND.page, KIND.pdf, KIND.image, KIND.media]);

const byExtension = (kinds) => {
  const map = new Map();
  for (const [kind, exts] of Object.entries(kinds)) {
    for (const ext of exts.split(' ')) if (ext) map.set(ext, kind);
  }
  return map;
};

// Table unique extension → nature. Une extension absente est « inconnue » :
// on ne devine JAMAIS d'après le contenu avant de l'avoir lu (voir main.js).
const EXTENSION_KIND = byExtension({
  [KIND.page]: 'html htm xhtml shtml',
  [KIND.pdf]: 'pdf',
  [KIND.image]: 'png jpg jpeg gif webp bmp ico avif svg',
  [KIND.media]:
    'mp3 wav ogg oga opus m4a flac aac weba mp4 m4v webm mkv mov ogv avi',
  [KIND.markdown]: 'md markdown mkd mdx',
  [KIND.json]: 'json jsonc json5 geojson ipynb webmanifest',
  [KIND.csv]: 'csv tsv',
  [KIND.code]:
    'js mjs cjs jsx ts tsx mts cts vue svelte astro css scss sass less styl ' +
    'py pyw rb php go rs java kt kts scala clj cljs c h cpp cxx cc hpp hh cs ' +
    'swift dart lua pl pm r sql sh bash zsh fish ps1 bat cmd ini toml cfg conf ' +
    'properties env gradle xml xsl xslt yaml yml tex latex rst adoc org reg ' +
    'proto graphql gql tf hcl nix vim el vhdl asm s',
  [KIND.text]:
    'txt text log nfo readme license copying authors news diff patch srt vtt ' +
    'sub asc pem pub crt csr gitignore gitattributes editorconfig mail',
});

// Fichiers sans extension qu'on sait lire comme du texte (les plus courants
// autour d'un projet ou d'un dossier téléchargé).
const TEXT_BASENAMES = new Set([
  'readme',
  'license',
  'licence',
  'copying',
  'authors',
  'changelog',
  'changes',
  'install',
  'notice',
  'todo',
  'makefile',
  'dockerfile',
  'procfile',
  'rakefile',
  'gemfile',
  'cmakelists.txt',
  'requirements.txt',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.env',
  '.env.local',
  '.npmrc',
  '.babelrc',
  '.eslintrc',
  '.prettierrc',
]);

// Nom de fichier seul, sans requête ni fragment (marche pour un chemin local
// comme pour une URL), décodé (les espaces arrivent en %20 dans une URL).
export function basenameOf(pathOrUrl) {
  let s = String(pathOrUrl || '').split('#')[0].split('?')[0];
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash !== -1) s = s.slice(slash + 1);
  try {
    s = decodeURIComponent(s);
  } catch {
    /* nom déjà en clair : on le garde tel quel */
  }
  return s;
}

// Extension en minuscules, sans le point ('' s'il n'y en a pas). Un fichier
// dont le nom COMMENCE par un point (.gitignore, .env) n'a pas d'extension : le
// point initial fait partie du nom (ces fichiers sont traités comme du texte
// plus bas, par leur nom complet).
export function extensionOf(pathOrUrl) {
  const name = basenameOf(pathOrUrl);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function kindForExtension(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  return EXTENSION_KIND.get(e) || KIND.unknown;
}

// Nature d'un chemin ou d'une URL, par son NOM (jamais par son contenu).
export function kindForPath(pathOrUrl) {
  const name = basenameOf(pathOrUrl).toLowerCase();
  if (TEXT_BASENAMES.has(name)) return KIND.text;
  return kindForExtension(extensionOf(name));
}

// Orbit met-il ce document en forme lui-même ? (texte : md, json, csv, code…)
export function isViewerKind(kind) {
  return VIEWER_KINDS.has(kind);
}

// Le moteur affiche-t-il ce document correctement tout seul ? (page, PDF…)
export function isNativeKind(kind) {
  return NATIVE_KINDS.has(kind);
}

// Extensions dont on accepte l'ouverture depuis le système (« Ouvrir avec ») :
// tout ce qu'on sait afficher, d'une manière ou d'une autre. `unknown` est
// volontairement exclu — ouvrir un .docx dans Orbit n'aurait aucun sens.
export function isSupportedPath(pathOrUrl) {
  const kind = kindForPath(pathOrUrl);
  return kind !== KIND.unknown;
}

// Langages qui, côté serveur, PRODUISENT une page : un .php local est un
// fichier de code source, mais `https://site/page.php` est une page web. Seule
// la deuxième lecture compte pour une adresse http(s).
const SERVER_SCRIPT_EXT = new Set([
  'php', 'phtml', 'php3', 'php4', 'php5', 'phps', 'asp', 'aspx', 'ashx', 'asmx',
  'jsp', 'jspx', 'do', 'action', 'cgi', 'cfm', 'cfc', 'pl', 'py', 'rb', 'lua',
  'shtml', 'phtml',
]);

// Nature d'une ADRESSE WEB. Différences assumées avec un chemin local :
//   • pas d'extension → PAGE (c'est le cas de la quasi-totalité des liens ; on
//     ne refuse pas un site parce que son URL ne finit pas par « .html ») ;
//   • extension de script serveur (.php, .asp…) → PAGE (le serveur l'exécute) ;
//   • extension de TÉLÉCHARGEMENT (.docx, .zip, .exe…) → « inconnu » : le
//     moteur en ferait un téléchargement silencieux, donc un cadre BLANC. On
//     préfère le dire et proposer de l'ouvrir ailleurs.
export function kindForUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(s)) return kindForPath(s);
  const kind = kindForPath(s);
  const ext = extensionOf(s);
  if (SERVER_SCRIPT_EXT.has(ext)) return KIND.page;
  if (kind !== KIND.unknown) return kind;
  return ext ? KIND.unknown : KIND.page;
}

// Étiquette lisible pour l'en-tête de la visionneuse (badge de format).
const LANGUAGE_LABELS = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JSX',
  ts: 'TypeScript', tsx: 'TSX', py: 'Python', rb: 'Ruby', php: 'PHP',
  go: 'Go', rs: 'Rust', java: 'Java', c: 'C', h: 'C', cpp: 'C++', cs: 'C#',
  sh: 'Shell', bash: 'Shell', zsh: 'Zsh', ps1: 'PowerShell', bat: 'Batch',
  sql: 'SQL', yml: 'YAML', yaml: 'YAML', toml: 'TOML', ini: 'INI',
  conf: 'Config', cfg: 'Config', env: 'Env', xml: 'XML', css: 'CSS',
  scss: 'SCSS', less: 'Less', vue: 'Vue', svelte: 'Svelte', swift: 'Swift',
  kt: 'Kotlin', dart: 'Dart', lua: 'Lua', r: 'R', pl: 'Perl', tex: 'TeX',
  rst: 'reStructuredText', adoc: 'AsciiDoc', md: 'Markdown',
  markdown: 'Markdown', json: 'JSON', csv: 'CSV', tsv: 'TSV', txt: 'Texte',
  log: 'Journal', diff: 'Diff', patch: 'Patch',
};

export function languageLabel(pathOrUrl) {
  const ext = extensionOf(pathOrUrl);
  return LANGUAGE_LABELS[ext] || (ext ? ext.toUpperCase() : '');
}

// Types MIME à déclarer au système pour ce qu'on sait ouvrir (fichiers
// .desktop Linux, associations macOS, documentation des réglages). Un seul
// endroit à mettre à jour quand une extension s'ajoute ci-dessus.
export const OPENABLE_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/xml',
  'application/json',
  'application/pdf',
];
