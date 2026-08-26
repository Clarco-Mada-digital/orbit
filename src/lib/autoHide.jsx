import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Masquage automatique des barres (mode épuré)
//
// Le piège de ce genre de fonctionnalité, c'est de piloter la visibilité
// directement au survol : on vise un menu déroulant, la souris quitte le
// rectangle de la barre pendant deux pixels, tout se referme, et le menu est
// inatteignable. C'est le défaut classique de tous les menus « au survol ».
//
// Ici, la visibilité n'est jamais pilotée par un événement mais par un
// ENSEMBLE DE RAISONS de rester ouvert : la souris est dessus, un panneau
// déroulant est ouvert, le focus clavier est dedans, l'utilisateur l'a appelée
// au clavier. La barre se referme quand l'ensemble se vide — et seulement
// après un DÉLAI DE GRÂCE, qui absorbe les trajets en diagonale.
//
// Conséquence pratique : un composant qui ouvre un panneau n'a rien à savoir
// du masquage, il déclare juste `useZoneHold(zone, 'notifications', ouvert)`.
// Aucun cas particulier par panneau, aucune coordination à maintenir.
// ---------------------------------------------------------------------------

export const AUTO_HIDE_ZONES = ['top', 'left', 'bottom'];

// 320 ms : assez pour traverser un espace vide entre une barre et son menu,
// assez court pour ne pas donner l'impression que la barre « colle ».
const GRACE_MS = 320;

const emptyHolds = () => ({ top: {}, left: {}, bottom: {} });

export const useAutoHideStore = create((set) => ({
  // { top: { hover: true, notifications: true }, left: {}, bottom: {} }
  holds: emptyHolds(),
  hold: (zone, reason) =>
    set((s) =>
      s.holds[zone]?.[reason]
        ? s
        : { holds: { ...s.holds, [zone]: { ...s.holds[zone], [reason]: true } } }
    ),
  release: (zone, reason) =>
    set((s) => {
      if (!s.holds[zone]?.[reason]) return s;
      const next = { ...s.holds[zone] };
      delete next[reason];
      return { holds: { ...s.holds, [zone]: next } };
    }),
  // Appel clavier : ouvre (ou referme) toutes les zones d'un coup.
  toggleSummon: () =>
    set((s) => {
      const on = AUTO_HIDE_ZONES.some((z) => s.holds[z]?.summon);
      const holds = { ...s.holds };
      for (const z of AUTO_HIDE_ZONES) {
        const next = { ...holds[z] };
        if (on) delete next.summon;
        else next.summon = true;
        holds[z] = next;
      }
      return { holds };
    }),
  clearSummon: () =>
    set((s) => {
      const holds = { ...s.holds };
      for (const z of AUTO_HIDE_ZONES) {
        const next = { ...holds[z] };
        delete next.summon;
        holds[z] = next;
      }
      return { holds };
    }),
}));

export const holdZone = (zone, reason) => useAutoHideStore.getState().hold(zone, reason);
export const releaseZone = (zone, reason) => useAutoHideStore.getState().release(zone, reason);

// Maintient une zone ouverte tant que `active` est vrai. À utiliser depuis
// tout composant qui ouvre un panneau au-dessus d'une barre masquable.
export function useZoneHold(zone, reason, active) {
  useEffect(() => {
    if (!zone || !active) return undefined;
    holdZone(zone, reason);
    return () => releaseZone(zone, reason);
  }, [zone, reason, active]);
}

// Visibilité d'une zone + les gestionnaires à poser sur la barre elle-même.
// `enabled` faux → la barre est toujours visible et rien n'est intercepté.
export function useAutoHide(zone, enabled) {
  const held = useAutoHideStore((s) => Object.keys(s.holds[zone] || {}).length > 0);
  const [visible, setVisible] = useState(() => !enabled);

  useEffect(() => {
    if (!enabled || held) {
      setVisible(true);
      return undefined;
    }
    const timer = setTimeout(() => setVisible(false), GRACE_MS);
    return () => clearTimeout(timer);
  }, [held, enabled]);

  const handlers = useMemo(
    () =>
      enabled
        ? {
            onMouseEnter: () => holdZone(zone, 'hover'),
            onMouseLeave: () => releaseZone(zone, 'hover'),
            // onFocus/onBlur de React remontent (focusin/focusout) : tabuler
            // dans la barre suffit à la garder ouverte, sans souris.
            onFocus: () => holdZone(zone, 'focus'),
            onBlur: () => releaseZone(zone, 'focus'),
          }
        : {},
    [zone, enabled]
  );

  return { visible, handlers };
}

// Bande sensible collée au bord de l'écran : c'est elle qui fait réapparaître
// la barre. Deux détails la rendent fiable :
//   • elle a sa PROPRE raison ('edge') plutôt que 'hover' — sinon le passage
//     bande → barre dépendrait de l'ordre des événements de sortie/entrée ;
//   • elle est placée SOUS la barre dans l'ordre d'empilement. Une fois la
//     barre révélée, celle-ci recouvre la bande et reçoit les événements ; la
//     bande ne peut donc pas voler les clics destinés à la barre.
// Contrepartie assumée : quand la barre est masquée, ces 6 pixels de bord
// n'appartiennent plus à la page embarquée.
export const REVEAL_STRIP_Z = 600;
export const REVEALED_BAR_Z = 650;

export function RevealStrip({ zone, enabled, offset = 0 }) {
  if (!enabled) return null;
  const geometry = {
    top: { top: 0, left: 0, right: 0, height: 6 },
    bottom: { bottom: 0, left: 0, right: 0, height: 6 },
    left: { left: 0, top: offset, bottom: 0, width: 6 },
  }[zone];
  return (
    <div
      style={{ position: 'fixed', zIndex: REVEAL_STRIP_Z, ...geometry }}
      onMouseEnter={() => holdZone(zone, 'edge')}
      onMouseLeave={() => releaseZone(zone, 'edge')}
      aria-hidden="true"
    />
  );
}
