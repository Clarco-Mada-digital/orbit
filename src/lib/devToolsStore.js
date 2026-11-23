// ---------------------------------------------------------------------------
// États des outils développeur (« Base de données » et « API »).
//
//   • useDevToolsStore : quel outil est ouvert (volatile, comme le Téléphone) ;
//   • useApiStore      : collections, environnements, historique du client
//                        API (persistés : c'est le travail de l'utilisateur) ;
//   • useDbUiStore     : historique des requêtes SQL et requêtes favorites,
//                        par connexion (persistés). Les connexions elles-mêmes
//                        vivent dans le processus principal (mots de passe
//                        chiffrés), jamais ici.
// ---------------------------------------------------------------------------
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { emptyRequest, newId } from './httpRequests';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

export const useDevToolsStore = create(
  persist(
    (set) => ({
      open: null, // null | 'database' | 'api'
      // Zoom de l'affichage, propre à chaque outil (comme le zoom par app).
      zoom: { database: 1, api: 1 },
      setOpen: (open) => set({ open: open || null }),
      toggle: (kind) => set((s) => ({ open: s.open === kind ? null : kind })),
      // action : 'zoom-in' | 'zoom-out' | 'zoom-reset', ou un facteur absolu.
      setZoom: (kind, action) =>
        set((s) => {
          const cur = s.zoom?.[kind] || 1;
          let next = typeof action === 'number' ? action : cur;
          if (action === 'zoom-in') next = cur + 0.1;
          if (action === 'zoom-out') next = cur - 0.1;
          if (action === 'zoom-reset') next = 1;
          next = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100;
          return { zoom: { ...s.zoom, [kind]: next } };
        }),
    }),
    // Seul le zoom survit au redémarrage : rouvrir Orbit sur un outil ouvert
    // surprendrait plus qu'il n'aiderait.
    { name: 'orbit-devtools-view', version: 1, partialize: (s) => ({ zoom: s.zoom }) }
  )
);

const HISTORY_MAX = 100;

export const useApiStore = create(
  persist(
    (set) => ({
      // Collections : { id, name, variables: {k: v}, requests: [...] }
      collections: [],
      // Environnements : { id, name, variables: {k: v} }
      environments: [],
      activeEnvId: null,
      // Historique : requêtes envoyées (sans la réponse complète)
      history: [],
      // Réponses nommées (# @name x) réutilisables : {{x.response.body.$.id}}
      namedResponses: {},

      addCollection: (col) => {
        const id = newId('c');
        set((s) => ({
          collections: [
            ...s.collections,
            {
              id,
              name: col?.name || 'Nouvelle collection',
              variables: col?.variables || {},
              requests: (col?.requests || []).map((r) => ({ ...r, id: r.id || newId() })),
            },
          ],
        }));
        return id;
      },
      updateCollection: (id, patch) =>
        set((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      removeCollection: (id) => set((s) => ({ collections: s.collections.filter((c) => c.id !== id) })),
      saveRequest: (collectionId, request) =>
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId) return c;
            const exists = c.requests.some((r) => r.id === request.id);
            return {
              ...c,
              requests: exists
                ? c.requests.map((r) => (r.id === request.id ? request : r))
                : [...c.requests, request],
            };
          }),
        })),
      removeRequest: (collectionId, requestId) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId ? { ...c, requests: c.requests.filter((r) => r.id !== requestId) } : c
          ),
        })),

      addEnvironment: (name) => {
        const id = newId('e');
        set((s) => ({
          environments: [...s.environments, { id, name: name || 'Environnement', variables: {} }],
          activeEnvId: s.activeEnvId || id,
        }));
        return id;
      },
      updateEnvironment: (id, patch) =>
        set((s) => ({ environments: s.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      removeEnvironment: (id) =>
        set((s) => ({
          environments: s.environments.filter((e) => e.id !== id),
          activeEnvId: s.activeEnvId === id ? null : s.activeEnvId,
        })),
      setActiveEnv: (id) => set({ activeEnvId: id || null }),

      pushHistory: (entry) =>
        set((s) => ({ history: [{ ...entry, at: Date.now() }, ...s.history].slice(0, HISTORY_MAX) })),
      clearHistory: () => set({ history: [] }),
      setNamedResponse: (name, value) =>
        set((s) => ({ namedResponses: { ...s.namedResponses, [name]: value } })),
    }),
    {
      name: 'orbit-api-client',
      version: 1,
      // Les réponses nommées peuvent être volumineuses : on n'en garde que
      // l'essentiel (corps tronqué) d'une session à l'autre.
      partialize: (s) => ({
        collections: s.collections,
        environments: s.environments,
        activeEnvId: s.activeEnvId,
        history: s.history,
        namedResponses: Object.fromEntries(
          Object.entries(s.namedResponses || {}).map(([k, v]) => [
            k,
            {
              response: {
                ...v.response,
                body: String(v.response?.body || '').slice(0, 200_000),
              },
            },
          ])
        ),
      }),
    }
  )
);

export function newScratchRequest() {
  return emptyRequest({ name: 'Nouvelle requête' });
}

export const useDbUiStore = create(
  persist(
    (set) => ({
      history: {}, // connectionId → [{ sql, at, ms, rows, error }]
      // Diagramme : position des cartes et cadrage, par connexion — on
      // retrouve le schéma tel qu'on l'a rangé.
      layouts: {}, // connectionId → { positions: {clé: {x, y}}, view: {x, y, k} }
      setLayout: (connId, patch) =>
        set((s) => ({ layouts: { ...s.layouts, [connId]: { ...(s.layouts[connId] || {}), ...patch } } })),
      favorites: {}, // connectionId → [{ id, name, sql }]
      pushHistory: (connId, entry) =>
        set((s) => {
          const list = [{ ...entry, at: Date.now() }, ...(s.history[connId] || [])]
            .filter((e, i, arr) => arr.findIndex((x) => x.sql === e.sql) === i)
            .slice(0, HISTORY_MAX);
          return { history: { ...s.history, [connId]: list } };
        }),
      clearHistory: (connId) =>
        set((s) => {
          const next = { ...s.history };
          delete next[connId];
          return { history: next };
        }),
      addFavorite: (connId, name, sql) =>
        set((s) => ({
          favorites: {
            ...s.favorites,
            [connId]: [...(s.favorites[connId] || []), { id: newId('q'), name, sql }],
          },
        })),
      removeFavorite: (connId, id) =>
        set((s) => ({
          favorites: { ...s.favorites, [connId]: (s.favorites[connId] || []).filter((f) => f.id !== id) },
        })),
      // Connexion jetable supprimée : son historique part avec elle.
      forgetConnection: (connId) =>
        set((s) => {
          const history = { ...s.history };
          const favorites = { ...s.favorites };
          const layouts = { ...s.layouts };
          delete history[connId];
          delete favorites[connId];
          delete layouts[connId];
          return { history, favorites, layouts };
        }),
    }),
    { name: 'orbit-db-ui', version: 1 }
  )
);
