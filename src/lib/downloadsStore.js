import { create } from 'zustand';

// État des téléchargements — HORS du store persisté : une progression n'a
// aucun sens au redémarrage. Alimenté par les événements 'orbit:download'
// envoyés par le main process (voir electron/main.js → setupDownloads).
export const useDownloadsStore = create((set) => ({
  // Plus récents en premier. { id, filename, savePath, url, totalBytes,
  // receivedBytes, state: 'progressing'|'completed'|'cancelled'|'interrupted' }
  downloads: [],

  upsert: (d) =>
    set((state) => {
      const idx = state.downloads.findIndex((x) => x.id === d.id);
      if (idx === -1) return { downloads: [d, ...state.downloads].slice(0, 50) };
      const next = state.downloads.slice();
      next[idx] = { ...next[idx], ...d };
      return { downloads: next };
    }),

  remove: (id) =>
    set((state) => ({ downloads: state.downloads.filter((x) => x.id !== id) })),

  // Retire tout ce qui n'est plus en cours (garde les téléchargements actifs)
  clearFinished: () =>
    set((state) => ({ downloads: state.downloads.filter((x) => x.state === 'progressing') })),
}));
