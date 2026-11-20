// ---------------------------------------------------------------------------
// Écran partagé par glisser-déposer.
//
// On attrape une app (ou un lien libre) dans la barre latérale et on la lâche
// sur la zone de contenu : près d'un BORD, elle se range de ce côté-là de
// l'app affichée (écran partagé) ; au CENTRE, elle remplace simplement l'app
// affichée. Un aperçu montre la moitié qu'elle va occuper avant de lâcher.
//
// Module SANS DÉPENDANCE (testé par test/splitDrop.test.js).
// ---------------------------------------------------------------------------

// Part de la largeur / hauteur qui compte comme « bord ».
export const EDGE_RATIO = 0.28;
export const MAX_SPLIT = 4;

// Zone visée par le pointeur dans `rect` : 'left' | 'right' | 'top' |
// 'bottom' | 'center'. Quand deux bords se recouvrent (un coin), le plus
// proche l'emporte.
export function dropZoneAt(x, y, rect, edge = EDGE_RATIO) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return 'center';
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const candidates = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ].filter(([, d]) => d < edge);
  if (!candidates.length) return 'center';
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

const before = (zone) => zone === 'left' || zone === 'top';
const directionOf = (zone) => (zone === 'top' || zone === 'bottom' ? 'col' : 'row');

// Nouvel état après le dépôt de `droppedId` sur la zone `zone`, l'app
// affichée étant `anchorId`. Renvoie { splitView, activeApp } — `splitView`
// vaut `undefined` quand il ne doit pas changer — ou null si rien à faire.
export function splitForDrop(splitView, anchorId, droppedId, zone) {
  if (!droppedId) return null;
  if (zone === 'center' || !anchorId) {
    return { splitView: undefined, activeApp: droppedId };
  }
  if (droppedId === anchorId && !(splitView?.appIds || []).includes(anchorId)) return null;

  const current = splitView?.appIds?.includes(anchorId) ? splitView : null;

  // Pas encore de partage : l'app affichée et l'app déposée, côte à côte
  // (gauche/droite) ou l'une sur l'autre (haut/bas).
  if (!current) {
    if (droppedId === anchorId) return null;
    return {
      splitView: {
        appIds: before(zone) ? [droppedId, anchorId] : [anchorId, droppedId],
        direction: directionOf(zone),
        sizes: [0.5, 0.5],
      },
      activeApp: droppedId,
    };
  }

  // Partage existant. L'app y est déjà : on la déplace du côté demandé.
  let ids = current.appIds.filter((id) => id !== droppedId);
  const wasIn = ids.length !== current.appIds.length;
  if (!wasIn && ids.length >= MAX_SPLIT) {
    // Plein : l'app déposée prend la place de la dernière qui n'est pas
    // l'app affichée.
    const drop = [...ids].reverse().find((id) => id !== anchorId);
    ids = ids.filter((id) => id !== drop);
  }
  if (before(zone)) ids.unshift(droppedId);
  else ids.push(droppedId);

  const next = { ...current, appIds: ids };
  if (ids.length === 2) {
    next.direction = directionOf(zone);
    next.sizes = [0.5, 0.5];
  } else {
    // Le nombre de panneaux change (ou l'ordre) : les tailles et pistes
    // mémorisées ne correspondent plus.
    delete next.sizes;
    delete next.cols;
    delete next.rows;
  }
  return { splitView: next, activeApp: droppedId };
}

// Rectangle d'aperçu (en fractions 0-1 du conteneur) pour une zone.
export function previewRect(zone) {
  switch (zone) {
    case 'left':
      return { left: 0, top: 0, width: 0.5, height: 1 };
    case 'right':
      return { left: 0.5, top: 0, width: 0.5, height: 1 };
    case 'top':
      return { left: 0, top: 0, width: 1, height: 0.5 };
    case 'bottom':
      return { left: 0, top: 0.5, width: 1, height: 0.5 };
    default:
      return { left: 0, top: 0, width: 1, height: 1 };
  }
}
