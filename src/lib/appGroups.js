// ---------------------------------------------------------------------------
// Dossiers d'applications + sélection multiple — LOGIQUE PURE, sans React.
//
// Un dossier n'est PAS un conteneur d'objets : les apps gardent leur identité,
// leur session, leur compte et leur ordre ; elles portent simplement un
// `folderId`. Trois conséquences volontaires :
//
//   1. Ranger/déranger une app ne touche à rien d'autre qu'un champ — donc
//      aucune session n'est perdue, aucun <webview> n'est remonté.
//   2. Un dossier sans plus aucune app est retiré (pruneEmptyFolders), sinon
//      resteraient des dossiers vides invisibles et impossibles à supprimer.
//   3. Un `folderId` orphelin (dossier supprimé sur l'autre machine, synchro en
//      retard) est traité comme « pas de dossier » : l'app redevient visible
//      dans la liste, jamais perdue.
//
// Ce fichier ne dépend ni du store ni du DOM → directement testable.
// ---------------------------------------------------------------------------

export const DEFAULT_FOLDER_EMOJI = '📁';

// Choix proposés dans le menu d'un dossier. Volontairement courts : c'est un
// rangement, pas une décoration — on veut trancher en un clic.
export const FOLDER_EMOJIS = ['📁', '🗂️', '📦', '⭐', '🎯', '💼', '🎨', '🔧'];

export const FOLDER_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#64748b',
];

// Un nom de dossier vient d'un champ de saisie : on le normalise (espaces
// multiples, espaces de bord) et on le borne, sinon une ligne de la barre
// latérale peut être poussée hors de l'écran par un nom de 400 caractères.
const MAX_NAME_LENGTH = 60;

export function normalizeFolderName(name, fallback = 'Dossier') {
  const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  return (clean || fallback).slice(0, MAX_NAME_LENGTH);
}

export function folderId(now = Date.now(), salt = '') {
  return `fld-${now}${salt}`;
}

// Fabrique un dossier complet. `id`/`now` sont injectables pour les tests.
export function makeFolder({
  id,
  name,
  profileId,
  emoji,
  color,
  order = 0,
  fallbackName = 'Dossier',
} = {}) {
  return {
    id: id || folderId(),
    name: normalizeFolderName(name, fallbackName),
    profileId,
    emoji: emoji || DEFAULT_FOLDER_EMOJI,
    color: color || FOLDER_COLORS[0],
    order,
    // État d'affichage, volontairement NON synchronisé : plier un dossier sur
    // le portable ne doit pas le plier sur le fixe.
    collapsed: false,
  };
}

// Dossiers d'un profil, dans l'ordre d'affichage (création).
export function foldersFor(folders, profileId) {
  return (folders || [])
    .filter((f) => f && f.id && f.profileId === profileId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

// Répartit des apps en dossiers (avec leurs apps, dans l'ordre reçu) + apps
// libres. Les dossiers vides sont écartés de l'affichage : ils n'apportent
// aucune information et donneraient l'impression d'une ligne fantôme.
export function groupByFolder(apps, folders) {
  const buckets = new Map();
  for (const folder of folders || []) {
    if (folder && folder.id) buckets.set(folder.id, { folder, apps: [] });
  }
  const loose = [];
  for (const app of apps || []) {
    if (!app) continue;
    const bucket = app.folderId ? buckets.get(app.folderId) : null;
    // Dossier inconnu → l'app redevient libre plutôt que de disparaître.
    if (bucket) bucket.apps.push(app);
    else loose.push(app);
  }
  return { groups: [...buckets.values()].filter((g) => g.apps.length > 0), loose };
}

export function reorderIdsByDrop(ids, draggedId, targetId, placement = 'before') {
  const next = (ids || []).filter((id) => id !== draggedId);
  if (!draggedId) return next;
  if (draggedId === targetId) return [...ids];
  const targetIndex = targetId ? next.indexOf(targetId) : -1;
  const index =
    targetIndex === -1 ? next.length : targetIndex + (placement === 'after' ? 1 : 0);
  next.splice(index, 0, draggedId);
  return next;
}

// Retire les dossiers que plus aucune app ne référence. Renvoie la MÊME
// référence si rien ne change : inutile de faire re-rendre la liste pour rien.
export function pruneEmptyFolders(folders, apps) {
  const list = folders || [];
  const used = new Set((apps || []).map((a) => a && a.folderId).filter(Boolean));
  const kept = list.filter((f) => f && used.has(f.id));
  return kept.length === list.length ? list : kept;
}

// Renvoie une copie de l'app SANS son `folderId` (sortie de dossier). On
// supprime le champ au lieu de le poser à `undefined` : sinon il traînerait
// dans les données sauvegardées et dans les instantanés de synchronisation.
// Renvoie l'app telle quelle si elle n'était pas rangée (pas de copie inutile).
export function withoutFolderId(app) {
  if (!app || !app.folderId) return app;
  const { folderId: _removed, ...rest } = app;
  return rest;
}

// Identifiants des apps rangées dans un dossier (pour « supprimer le dossier
// et ses apps », ou pour sélectionner tout un dossier d'un coup).
export function folderAppIds(apps, folderIdValue) {
  return (apps || []).filter((a) => a && a.folderId === folderIdValue).map((a) => a.id);
}

// Total des non-lus d'un ensemble d'apps — affiché sur un dossier plié (ou
// quand la barre est réduite) pour ne pas rater une notification cachée.
export function countUnread(apps) {
  return (apps || []).reduce((sum, a) => sum + (a && a.unread > 0 ? a.unread : 0), 0);
}

// --- Sélection multiple (Ctrl/Cmd+clic, Maj+clic) --------------------------

// Vrai si l'événement souris est un « ajout à la sélection ».
export function isToggleClick(e) {
  return Boolean(e && (e.ctrlKey || e.metaKey));
}

// Ajoute ou retire un identifiant. Renvoie un NOUVEAU tableau (état React).
export function toggleId(ids, id) {
  const list = ids || [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// Plage inclusive entre deux identifiants, dans l'ordre AFFICHÉ (dossiers
// compris). Sans ancre valide, on se contente de la cible : une plage
// silencieusement vide serait déroutante.
export function selectRange(orderedIds, anchorId, targetId) {
  const order = orderedIds || [];
  const to = order.indexOf(targetId);
  if (to === -1) return [targetId];
  const from = anchorId ? order.indexOf(anchorId) : -1;
  if (from === -1) return [targetId];
  const [start, end] = from <= to ? [from, to] : [to, from];
  return order.slice(start, end + 1);
}
