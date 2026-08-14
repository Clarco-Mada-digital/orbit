import { create } from 'zustand';

// État de chargement des apps — volontairement HORS du store persisté
// (useStore) : un « en cours de chargement » n'a aucun sens au redémarrage,
// et un état figé à true laisserait le bouton Actualiser tourner sans fin.
export const useLoadingStore = create((set) => ({
  // { [appId]: true } — seules les apps en cours de chargement y figurent
  loadingApps: {},

  setAppLoading: (appId, loading) =>
    set((state) => {
      const current = !!state.loadingApps[appId];
      if (current === !!loading) return state;
      const next = { ...state.loadingApps };
      if (loading) next[appId] = true;
      else delete next[appId];
      return { loadingApps: next };
    }),
}));
