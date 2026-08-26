import { useEffect } from 'react';

// ---------------------------------------------------------------------------
// Fermeture des menus et panneaux flottants
//
// Chaque composant réimplémentait sa propre règle, avec deux défauts récurrents :
//
//  1. `click` au lieu de `mousedown`. Cliquer sur un bouton qui supprime sa
//     propre ligne (retirer un téléchargement) détache l'élément du DOM AVANT
//     que le `click` ne remonte : `contains(e.target)` répondait alors « non »
//     et le panneau se fermait tout seul. Il fallait le rouvrir pour supprimer
//     la ligne suivante. Au `mousedown`, la cible est encore en place.
//
//  2. Le clic dans une app embarquée n'était jamais vu. Un <webview> a son
//     propre processus de rendu : ses événements souris n'atteignent pas le
//     document de l'interface. Résultat, un menu ouvert restait affiché tant
//     qu'on ne cliquait pas sur Orbit lui-même — alors que du point de vue de
//     l'utilisateur, il avait bel et bien cliqué ailleurs. Le preload des apps
//     relaie donc ces clics (voir `orbit:guest-interact`).
//
// Un seul abonnement IPC est partagé par tous les composants : on ne crée pas
// un écouteur par menu.
// ---------------------------------------------------------------------------

const guestListeners = new Set();
let unsubscribeGuest = null;

function subscribeGuest(fn) {
  guestListeners.add(fn);
  if (!unsubscribeGuest) {
    unsubscribeGuest =
      window.electronAPI?.onGuestInteract?.(() => {
        for (const listener of [...guestListeners]) listener();
      }) || null;
  }
  return () => {
    guestListeners.delete(fn);
    if (guestListeners.size === 0 && unsubscribeGuest) {
      unsubscribeGuest();
      unsubscribeGuest = null;
    }
  };
}

/**
 * Ferme un élément flottant sur : clic hors de `ref`, clic dans une app,
 * Échap, perte de focus de la fenêtre, redimensionnement.
 *
 * @param ref       référence de l'élément qui ne doit PAS déclencher la fermeture
 * @param active    le panneau est-il ouvert ?
 * @param onDismiss appelé pour fermer
 * @param options   { escape } — passer `false` quand le composant gère Échap
 *                  lui-même (sous-menus, édition en cours…)
 */
export function useDismiss(ref, active, onDismiss, { escape = true } = {}) {
  useEffect(() => {
    if (!active) return undefined;

    const outside = (e) => {
      const node = ref?.current;
      if (node && e?.target && node.contains(e.target)) return;
      onDismiss();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onDismiss();
    };

    // 'mousedown' en phase de CAPTURE : on décide avant que React n'ait pu
    // retirer la cible du DOM en réaction au clic.
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('blur', onDismiss);
    window.addEventListener('resize', onDismiss);
    if (escape) window.addEventListener('keydown', onKey, true);
    const offGuest = subscribeGuest(onDismiss);

    return () => {
      window.removeEventListener('mousedown', outside, true);
      window.removeEventListener('blur', onDismiss);
      window.removeEventListener('resize', onDismiss);
      if (escape) window.removeEventListener('keydown', onKey, true);
      offGuest();
    };
  }, [ref, active, onDismiss, escape]);
}

// Variante sans élément de référence : pour les composants qui gèrent déjà
// leur clic extérieur et ne veulent que le relais des clics dans une app.
export function useGuestDismiss(active, onDismiss) {
  useEffect(() => {
    if (!active) return undefined;
    return subscribeGuest(onDismiss);
  }, [active, onDismiss]);
}
