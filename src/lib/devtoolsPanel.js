// Inspecteur intégré — logique pure (testable sans React ni Electron).

// Le panneau est une vue NATIVE posée par-dessus l'interface : elle passerait
// au-dessus de toute boîte de dialogue, de tout menu ou de toute bulle d'Orbit
// qui déborde sur sa zone. Plutôt que de deviner ce qui compte comme « menu »
// (beaucoup n'ont aucun rôle ARIA), on teste la GÉOMÉTRIE : on sonde une
// grille de points de la zone ; si l'élément du dessus n'est pas la zone
// elle-même, quelque chose la recouvre, et la vue native doit s'effacer.
export function overlayPoints(rect, cols = 8, rows = 4) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return [];
  const points = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      points.push({
        x: rect.left + ((c + 0.5) * rect.width) / cols,
        y: rect.top + ((r + 0.5) * rect.height) / rows,
      });
    }
  }
  // Près des quatre coins : un menu qui ne mord que sur un coin. Pas tout à
  // fait AU coin — celui de la fenêtre est arrondi, et le point y tomberait
  // hors de toute zone.
  const inset = 10;
  points.push(
    { x: rect.left + inset, y: rect.top + inset },
    { x: rect.left + rect.width - inset, y: rect.top + inset },
    { x: rect.left + inset, y: rect.top + rect.height - inset },
    { x: rect.left + rect.width - inset, y: rect.top + rect.height - inset }
  );
  return points;
}

// `topAt(x, y)` rend l'élément au-dessus en ce point (document.elementFromPoint).
// Le fond du document (<body>, <html>) ne recouvre rien : c'est ce qu'on
// trouve dans un coin arrondi de la fenêtre, pas un menu.
export function isAreaCovered(area, topAt, cols, rows) {
  if (!area || typeof topAt !== 'function') return false;
  return overlayPoints(area.getBoundingClientRect(), cols, rows).some(({ x, y }) => {
    const top = topAt(x, y);
    if (!top || top === area || area.contains(top)) return false;
    return top.tagName !== 'BODY' && top.tagName !== 'HTML';
  });
}

export const DEVTOOLS_MIN_HEIGHT = 120;
export const DEVTOOLS_DEFAULT_RATIO = 0.42;
// La page doit rester utilisable au-dessus du panneau.
export const DEVTOOLS_MIN_PAGE = 120;

// Ancré à droite, le panneau doit garder la place pour sa barre d'outils.
export const DEVTOOLS_MIN_WIDTH = 320;

// Taille du panneau (hauteur ancré en bas, largeur ancré à droite), bornée
// par la place disponible. `wanted` absent ou invalide → part par défaut.
export function clampDevtoolsSize(wanted, available, min = DEVTOOLS_MIN_HEIGHT) {
  const room = Math.max(0, Number(available) || 0);
  const max = Math.max(min, room - DEVTOOLS_MIN_PAGE);
  const value = Number(wanted);
  const base = Number.isFinite(value) && value > 0 ? value : Math.round(room * DEVTOOLS_DEFAULT_RATIO);
  return Math.round(Math.min(max, Math.max(min, base)));
}

export function clampDevtoolsHeight(wanted, available) {
  return clampDevtoolsSize(wanted, available, DEVTOOLS_MIN_HEIGHT);
}

export function clampDevtoolsWidth(wanted, available) {
  return clampDevtoolsSize(wanted, available, DEVTOOLS_MIN_WIDTH);
}

// Rectangle d'un élément du DOM → rectangle de la vue native, en points de la
// zone de contenu de la fenêtre. Arrondi vers l'intérieur : un pixel de trop
// et la vue native mord sur la bordure de l'interface.
export function viewBoundsFromRect(rect) {
  if (!rect) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.ceil(Number(rect.left) || 0);
  const y = Math.ceil(Number(rect.top) || 0);
  const right = Math.floor((Number(rect.left) || 0) + (Number(rect.width) || 0));
  const bottom = Math.floor((Number(rect.top) || 0) + (Number(rect.height) || 0));
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}
