// ---------------------------------------------------------------------------
// Sauvegarde : ce qu'on peut exporter, catégorie par catégorie.
//
// Avant, l'export ne prenait que l'espace de travail et les réglages : tout ce
// qui a été ajouté depuis (historique, conversations de l'assistant, API,
// bases de données, autorisations des sites, boucliers) restait sur la
// machine. Chaque catégorie se coche ou se décoche, à l'export comme à la
// restauration — on peut ainsi ne transférer QUE ses collections d'API, ou
// tout sauf l'historique.
//
// Logique pure : la lecture et l'écriture des stores sont faites par
// l'appelant (BackupSettings.jsx), le processus principal gère ses fichiers.
// ---------------------------------------------------------------------------

// `main` : fichiers tenus par le processus principal (noms whitelistés côté
// main.js, jamais un chemin venu du fichier de sauvegarde).
export const BACKUP_CATEGORIES = [
  { id: 'workspace', label: 'Espace de travail', detail: 'Profils, applications, dossiers, conteneurs, espaces de travail', required: true, default: true },
  { id: 'automations', label: 'Automatisations', detail: 'Règles « Quand / Si / Alors » et routage des liens', default: true },
  { id: 'settings', label: 'Réglages', detail: 'Apparence, barres, raccourcis, accueil, assistant…', default: true },
  { id: 'extensions', label: 'Extensions', detail: 'Liste des extensions installées', default: true },
  { id: 'assistant', label: 'Conversations de l’assistant', detail: 'Historique des discussions avec l’assistant Orbit', default: true },
  { id: 'history', label: 'Historique de navigation', detail: 'Pages visitées (recherche de la palette)', default: false },
  { id: 'api', label: 'API', detail: 'Collections, environnements et historique de l’app API', default: true },
  { id: 'database', label: 'Base de données', detail: 'Connexions épinglées (sans mots de passe), requêtes favorites, diagrammes', default: true, main: ['dbConnections'] },
  { id: 'sites', label: 'Autorisations et boucliers', detail: 'Choix par site : caméra, micro, notifications, bloqueur, HTTPS…', default: true, main: ['permissions', 'shields'] },
];

export const MAIN_FILE_NAMES = ['dbConnections', 'permissions', 'shields'];

export function defaultSelection() {
  return Object.fromEntries(BACKUP_CATEGORIES.map((c) => [c.id, Boolean(c.default || c.required)]));
}

export function mainFilesFor(selection) {
  return BACKUP_CATEGORIES.filter((c) => selection[c.id] && c.main).flatMap((c) => c.main);
}

// Catégories présentes dans un fichier de sauvegarde. Un fichier ancien
// (orbitBackup 2) n'a que l'espace de travail, les réglages, les extensions
// et les automatisations.
export function categoriesIn(data) {
  if (!data || typeof data !== 'object') return [];
  const has = (k) => data[k] !== undefined && data[k] !== null;
  const found = [];
  if (Array.isArray(data.profiles) && Array.isArray(data.apps)) found.push('workspace');
  if (Array.isArray(data.rules)) found.push('automations');
  if (has('settings')) found.push('settings');
  if (Array.isArray(data.extensions)) found.push('extensions');
  if (Array.isArray(data.assistantSessions)) found.push('assistant');
  if (has('history')) found.push('history');
  if (has('api')) found.push('api');
  if (has('dbUi') || data.mainFiles?.dbConnections) found.push('database');
  if (data.mainFiles?.permissions || data.mainFiles?.shields) found.push('sites');
  return found;
}

// Taille lisible d'une catégorie dans le fichier (aperçu avant restauration).
export function describeCategory(id, data) {
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  switch (id) {
    case 'workspace':
      return `${n(data.profiles)} profil(s), ${n(data.apps)} app(s)`;
    case 'automations':
      return `${n(data.rules)} règle(s)`;
    case 'extensions':
      return `${n(data.extensions)} extension(s)`;
    case 'assistant':
      return `${n(data.assistantSessions)} conversation(s)`;
    case 'history':
      return `${n(data.history?.entries || data.history?.items)} page(s)`;
    case 'api':
      return `${n(data.api?.collections)} collection(s), ${n(data.api?.environments)} environnement(s)`;
    case 'database':
      return `${n(data.mainFiles?.dbConnections?.connections)} connexion(s)`;
    default:
      return '';
  }
}

// Connexions de base de données exportables : les mots de passe sont
// chiffrés par le trousseau de CETTE machine et illisibles ailleurs — on les
// retire, la connexion demandera le mot de passe sur l'autre ordinateur.
export function portableDbConnections(file) {
  const list = Array.isArray(file?.connections) ? file.connections : [];
  return {
    version: 1,
    connections: list.map(({ passwordEnc: _drop, passwordUnsaved: _drop2, ...rest }) => rest),
  };
}

// Fusion à la restauration : les connexions importées s'ajoutent ; une
// connexion déjà présente (même id) garde son mot de passe local.
export function mergeDbConnections(local, incoming) {
  const mine = new Map((local?.connections || []).map((c) => [c.id, c]));
  for (const c of incoming?.connections || []) {
    if (!c || typeof c !== 'object' || !c.id || !c.driver) continue;
    const prev = mine.get(c.id);
    mine.set(c.id, prev ? { ...c, passwordEnc: prev.passwordEnc } : c);
  }
  return { version: 1, connections: [...mine.values()] };
}

// Autorisations : les choix importés s'ajoutent site par site (ils priment
// sur ceux de la machine pour un même site), le mode général est repris.
export function mergePermissions(local, incoming) {
  const sites = { ...(local?.sites || {}) };
  for (const [origin, perms] of Object.entries(incoming?.sites || {})) {
    if (!/^https?:\/\/[^/]+$/.test(origin) || !perms || typeof perms !== 'object') continue;
    sites[origin] = { ...(sites[origin] || {}), ...perms };
  }
  const mode = ['ask', 'allow', 'deny'].includes(incoming?.mode) ? incoming.mode : local?.mode || 'ask';
  return { mode, sites };
}
