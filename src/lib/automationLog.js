// Journal des automatisations : les dernières exécutions (en mémoire, non
// persisté) et l'exécuteur actif, pour le bouton « Tester » des réglages.
import { create } from 'zustand';

const MAX_ENTRIES = 40;

export const useAutomationLog = create((set) => ({
  entries: [], // plus récente d'abord
  lastByRule: {}, // id → dernière entrée
  push: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
      lastByRule: { ...state.lastByRule, [entry.ruleId]: entry },
    })),
  clear: () => set({ entries: [], lastByRule: {} }),
}));

let activeRunner = null;
export const setActiveRunner = (runner) => {
  activeRunner = runner;
};
export const getActiveRunner = () => activeRunner;
