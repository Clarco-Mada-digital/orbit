import { create } from 'zustand';

// « Lecture en cours » par app (audio/vidéo). Hors du store persisté : l'état
// de lecture n'a aucun sens au redémarrage. Alimenté par WebView.jsx à partir
// des événements média du <webview> (media-started-playing / media-paused) et
// des métadonnées Media Session (titre, artiste, pochette) lues dans la page.
export const useMediaStore = create((set) => ({
  // { [appId]: { playing, hasMedia, title, artist, artwork } }
  media: {},

  setMedia: (appId, patch) =>
    set((state) => ({
      media: { ...state.media, [appId]: { ...(state.media[appId] || {}), ...patch } },
    })),

  clearMedia: (appId) =>
    set((state) => {
      if (!state.media[appId]) return state;
      const next = { ...state.media };
      delete next[appId];
      return { media: next };
    }),
}));
