import { create } from 'zustand';

// Journal de diagnostic des apps — volontairement HORS du store persisté :
// c'est un outil d'observation de la session en cours, pas une donnée de
// configuration. Il répond à un besoin concret : les pannes qui comptent
// (déconnexion soudaine, page qui ne répond plus, session purgée) sont
// intermittentes, et jusqu'ici tout partait dans console.warn — invisible pour
// l'utilisateur, donc impossible à rapporter ou à corréler.
//
// Tampon circulaire : au-delà de MAX_EVENTS, les plus anciens sortent.
const MAX_EVENTS = 400;

let seq = 0;

export const useDiagnosticsStore = create((set) => ({
  // [{ id, at, appId, appName, type, message, detail }] — le plus RÉCENT en tête
  events: [],

  logEvent: (appId, appName, type, message, detail = '') =>
    set((state) => ({
      events: [
        { id: ++seq, at: Date.now(), appId, appName, type, message, detail },
        ...state.events,
      ].slice(0, MAX_EVENTS),
    })),

  // Sans appId : vide tout le journal. Avec : ne vide que cette app.
  clearEvents: (appId) =>
    set((state) => ({
      events: appId ? state.events.filter((e) => e.appId !== appId) : [],
    })),
}));

// Raccourci utilisable hors composant React (gestionnaires d'événements du
// <webview>, helpers…) sans passer par un hook.
export function logDiagnostic(appId, appName, type, message, detail = '') {
  useDiagnosticsStore.getState().logEvent(appId, appName, type, message, detail);
}

// Gravité d'un type d'événement → couleur/pictogramme côté UI.
export const DIAGNOSTIC_LEVEL = {
  'load-failed': 'error',
  crash: 'error',
  'session-lost': 'warn',
  'redirect-loop': 'warn',
  sleep: 'info',
};
