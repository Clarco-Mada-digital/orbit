// ---------------------------------------------------------------------------
// Historique de navigation, toutes apps confondues.
//
// Alimente la recherche transverse d'Alt+K (« cette page vue hier », sans se
// rappeler dans quelle app). Volontairement LOCAL : il n'entre pas dans la
// synchronisation entre machines — l'historique de navigation est ce qu'on a
// de plus personnel, et le faire voyager dans un dossier cloud serait une
// mauvaise surprise.
//
// Deux garde-fous sur ce qu'on garde :
//   • plafond d'entrées, pour que le stockage local ne gonfle pas sans fin ;
//   • pages de connexion et URL à jeton exclues — inutiles à retrouver, et on
//     évite d'écrire des jetons de session en clair dans le stockage local.
// ---------------------------------------------------------------------------
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { shouldRecord } from './historySearch.js';

// ~1500 pages : largement de quoi retrouver plusieurs semaines de navigation,
// pour quelques centaines de kilo-octets.
const MAX_ENTRIES = 1500;

// Une même page rechargée ou re-titrée en boucle ne doit pas créer dix
// entrées : sous ce délai, on met à jour la dernière au lieu d'en ajouter.
const DEDUPE_WINDOW_MS = 30 * 1000;

export const useHistoryStore = create(
  persist(
    (set, get) => ({
      // [{ url, title, appId, appName, at, visits }] — la plus récente d'abord
      entries: [],
      enabled: true,

      record: ({ url, title, appId, appName }) => {
        if (!get().enabled || !shouldRecord(url)) return;
        set((state) => {
          const now = Date.now();
          const list = state.entries;
          const i = list.findIndex((e) => e.url === url);

          if (i !== -1) {
            const prev = list[i];
            const entry = {
              ...prev,
              title: title || prev.title,
              appId: appId || prev.appId,
              appName: appName || prev.appName,
              at: now,
              // Rechargement immédiat : on ne compte pas une visite de plus.
              visits: now - prev.at > DEDUPE_WINDOW_MS ? (prev.visits || 1) + 1 : prev.visits || 1,
            };
            // Remontée en tête, sans doublon
            return { entries: [entry, ...list.slice(0, i), ...list.slice(i + 1)] };
          }

          return {
            entries: [{ url, title: title || '', appId, appName, at: now, visits: 1 }, ...list].slice(
              0,
              MAX_ENTRIES
            ),
          };
        });
      },

      // Met à jour le titre d'une page déjà enregistrée : au moment de la
      // navigation, le titre n'est pas encore connu (il arrive après).
      setTitle: (url, title) =>
        set((state) => {
          if (!title) return state;
          const i = state.entries.findIndex((e) => e.url === url);
          if (i === -1 || state.entries[i].title === title) return state;
          const entries = [...state.entries];
          entries[i] = { ...entries[i], title };
          return { entries };
        }),

      // Retire toutes les pages d'une app (utile quand on la désinstalle)
      forgetApp: (appId) =>
        set((state) => ({ entries: state.entries.filter((e) => e.appId !== appId) })),

      clear: () => set({ entries: [] }),
      setEnabled: (v) => set({ enabled: v !== false }),
    }),
    { name: 'orbit-history', version: 1 }
  )
);
