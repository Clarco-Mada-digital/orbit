// ---------------------------------------------------------------------------
// Niveaux de filtrage du bloqueur de publicités — logique PURE.
//
// Un seul jeu de listes ne peut pas convenir à tout le monde :
//   • `standard` = listes « publicité + pistage ». Le compromis par défaut :
//     il retire les régies et les traqueurs sans toucher au décor des sites ;
//   • `complet`  = les mêmes, PLUS les listes de nuisances (bandeaux de
//     cookies, widgets sociaux, sondages, « abonnez-vous »). Plus efficace,
//     mais certains sites perdent un élément qui leur servait de contenu.
//
// Ce fichier ne connaît ni Electron ni le réseau : il nomme les niveaux, dit
// quel fichier de cache correspond à chacun et normalise une valeur venue du
// disque ou de l'interface. Testé sans lancer Electron — voir
// test/adblock-levels.test.js.
// ---------------------------------------------------------------------------

export const ADBLOCK_LEVELS = ['standard', 'complet'];

export const DEFAULT_ADBLOCK_LEVEL = 'standard';

// Une valeur inconnue (fichier édité à la main, version future redescendue)
// retombe sur le défaut : mieux vaut un bloqueur un peu moins strict qu'un
// moteur qui ne charge pas du tout.
export function normalizeLevel(value) {
  return ADBLOCK_LEVELS.includes(value) ? value : DEFAULT_ADBLOCK_LEVEL;
}

// Un fichier de cache PAR niveau : deux moteurs différents ne peuvent pas
// partager le même, sinon changer de niveau ferait relire les listes de
// l'autre et le réglage n'aurait aucun effet visible.
export function engineFileFor(level) {
  return normalizeLevel(level) === 'complet'
    ? 'adblocker-engine-complet.bin'
    : 'adblocker-engine.bin';
}
