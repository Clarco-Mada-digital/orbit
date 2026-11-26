// ---------------------------------------------------------------------------
// Onglets libres récemment fermés — de quoi les rouvrir (Ctrl+Maj+T, bulle
// « Onglet fermé · Rouvrir », palette). LOGIQUE PURE, testable sans zustand.
//
// Ce qu'on garde : l'adresse (ou le fichier local) et le titre. Rien d'autre,
// et seulement EN MÉMOIRE : les onglets libres sont jetables par principe,
// fermer Orbit oublie aussi cette liste. Une page PRIVÉE n'y entre jamais —
// rouvrir ce qu'on a choisi de ne pas garder trahirait la promesse.
// ---------------------------------------------------------------------------

export const CLOSED_TABS_LIMIT = 10;

export function closedEntryFor(page, now = Date.now()) {
  if (!page || page.private) return null;
  const url = page.url || page.homeUrl || '';
  if (!url && !page.filePath) return null;
  return {
    url,
    filePath: page.filePath || null,
    title: page.title || page.name || url,
    closedAt: now,
  };
}

// Ajoute en tête ; une même adresse n'apparaît qu'une fois.
export function pushClosed(list, page, limit = CLOSED_TABS_LIMIT, now = Date.now()) {
  const entry = closedEntryFor(page, now);
  if (!entry) return list;
  const rest = (list || []).filter((e) => e.url !== entry.url || e.filePath !== entry.filePath);
  return [entry, ...rest].slice(0, limit);
}

// Retire et renvoie la plus récente : { entry, rest }.
export function popClosed(list) {
  const [entry = null, ...rest] = list || [];
  return { entry, rest };
}
