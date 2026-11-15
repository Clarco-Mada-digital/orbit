// ---------------------------------------------------------------------------
// Disposition en ORBITE : des apps en cercle autour d'un centre.
//
// C'est la signature du thème Tech sur la page d'accueil — et le seul endroit
// où un thème change la DISPOSITION et non seulement l'habillage. Le nom de
// l'application y prend son sens : les apps tournent autour du centre.
//
// Pourquoi un module à part. Le placement est de la trigonométrie, et la
// trigonométrie se vérifie : un signe inversé met les apps en miroir, un
// décalage d'un quart de tour les fait commencer à droite au lieu du haut.
// Rien de tout cela n'est visible en relisant du JSX, et tout se voit
// immédiatement dans un test qui compare des coordonnées.
//
// Module SANS DÉPENDANCE (ni React, ni DOM). Testé par test/orbitLayout.test.js.
// ---------------------------------------------------------------------------

// Au-delà, les pastilles se chevauchent : à douze apps sur un cercle, il reste
// 30° entre deux voisines, ce qui est déjà serré. Les suivantes vont sur une
// seconde orbite, plus large.
export const PER_RING = 8;
export const MAX_ORBITED = 16;

// Position d'un élément sur un cercle, en POURCENTAGES du conteneur.
//
// Le repère est celui du CSS : x vers la droite, y vers le BAS. Le premier
// élément est placé en haut (midi) et les suivants tournent dans le sens des
// aiguilles d'une montre — c'est le sens que tout le monde attend d'une
// horloge, et la page d'accueil en porte une.
export function orbitPosition(index, count, radiusPercent, angleOffset = 0) {
  if (!Number.isFinite(count) || count <= 0) return null;
  // -90° pour partir de midi plutôt que de trois heures (0° en trigonométrie).
  const angle = (index / count) * 2 * Math.PI - Math.PI / 2 + angleOffset;
  return {
    // 50 % = le centre du conteneur
    left: 50 + Math.cos(angle) * radiusPercent,
    top: 50 + Math.sin(angle) * radiusPercent,
    angle,
  };
}

// Place une liste d'apps sur une ou deux orbites.
//
// Rend un tableau de { app, left, top, ring, delay } — `delay` sert à faire
// apparaître les apps l'une après l'autre, dans le sens de rotation, ce qui
// donne l'impression d'un système qui se met en marche. Les apps au-delà de
// MAX_ORBITED ne sont PAS placées : elles sont rendues par l'appelant sous
// forme de liste classique, car un cercle surchargé n'est plus lisible.
export function orbitLayout(apps, { innerRadius = 33, outerRadius = 46 } = {}) {
  const list = Array.isArray(apps) ? apps.slice(0, MAX_ORBITED) : [];
  if (list.length === 0) return [];

  // Une seule orbite tant qu'on tient : deux cercles pour trois apps serait
  // une complication sans raison.
  const inner = list.slice(0, Math.min(list.length, PER_RING));
  const outer = list.slice(PER_RING);

  // L'orbite extérieure est décalée d'un DEMI-PAS. Sans ce décalage, les deux
  // anneaux commencent tous deux à midi et leurs éléments s'alignent
  // radialement : on voit des rayons plutôt qu'un système, et la première app
  // de l'anneau extérieur se pose juste au-dessus de celle de l'intérieur.
  // Constaté à l'écran, pas en lisant le code.
  const place = (items, radius, ring, offset, angleOffset = 0) =>
    items.map((app, i) => {
      const position = orbitPosition(i, items.length, radius, angleOffset);
      return {
        app,
        left: position.left,
        top: position.top,
        angle: position.angle,
        ring,
        // 60 ms entre deux voisines : assez pour qu'on perçoive le sens de
        // rotation, assez peu pour que la dernière n'attende pas une seconde.
        delay: (offset + i) * 60,
      };
    });

  return [
    ...place(inner, innerRadius, 0, 0),
    ...place(outer, outerRadius, 1, inner.length, outer.length ? Math.PI / outer.length : 0),
  ];
}

// Les apps qui ne tiennent pas en orbite, à afficher autrement.
export function overflowApps(apps) {
  return (Array.isArray(apps) ? apps : []).slice(MAX_ORBITED);
}

// Le thème demande-t-il la disposition en orbite ?
//
// Déclaré ici et non dans themes.js : c'est une question de MISE EN PAGE, que
// seule la page d'accueil se pose. Un thème importé peut la demander en
// reprenant la texture « grid » — c'est le signe qu'il cherche le même esprit,
// et ça évite d'ajouter un jeton que personne ne devinerait.
export function wantsOrbit(theme) {
  return theme?.skin === 'tech' || theme?.traits?.texture === 'grid';
}
