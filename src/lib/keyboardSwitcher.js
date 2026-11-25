// ---------------------------------------------------------------------------
// Sélecteur au clavier (Alt+Page↓ / Alt+Page↑, avec ⇧ pour les profils).
//
// Avant : chaque appui ACTIVAIT l'app suivante. Pour aller trois apps plus
// loin, on en ouvrait deux pour rien — chacune montée, chargée, peinte. Le
// sélecteur, lui, ne fait que DÉSIGNER : une carte avance à chaque appui, et
// seule la cible est activée, quand on relâche Alt, qu'on tape Entrée ou
// qu'on s'arrête un instant.
//
// Ce module ne connaît ni React ni le DOM : la liste et le pas sont testés à
// part (test/keyboardSwitcher.test.js).
// ---------------------------------------------------------------------------
// Même règle que `appVisibleIn` du magasin, recopiée pour garder ce module
// testable sans charger zustand.
const visibleIn = (app, profileId) => app.profileId === profileId || app.scope === 'all';

// Délai d'inactivité avant de valider la carte désignée.
export const COMMIT_DELAY_MS = 1200;

// Pas circulaire : `step` peut être négatif.
export function stepIndex(length, index, step) {
  if (!length) return -1;
  const from = index < 0 ? (step > 0 ? -1 : 0) : index;
  return (((from + step) % length) + length) % length;
}

// Apps parcourues : celles du profil actif, hors veille, dans l'ordre de la
// barre latérale — exactement celles que parcourait l'ancien raccourci.
export function appCycleList({ apps, activeProfile }) {
  return (apps || [])
    .filter((a) => visibleIn(a, activeProfile) && !a.sleeping)
    .sort((a, b) => a.order - b.order);
}

export function profileCycleList({ profiles }) {
  return Array.isArray(profiles) ? profiles : [];
}

// État de départ quand le raccourci est pressé : la carte désignée est déjà
// celle d'APRÈS l'élément actif (le premier appui avance d'un cran, comme
// avant).
export function openSwitcher(kind, items, currentId, step) {
  const ids = items.map((i) => i.id);
  if (ids.length < 2) return null;
  const current = ids.indexOf(currentId);
  return { kind, ids, currentId, index: stepIndex(ids.length, current, step), steps: 1 };
}

export function moveSwitcher(state, step) {
  if (!state) return state;
  return { ...state, index: stepIndex(state.ids.length, state.index, step), steps: state.steps + 1 };
}
