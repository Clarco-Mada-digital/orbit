import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { recipes } from '../lib/recipes';

// Hostname d'une URL (pour la migration des favicons)
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Paramètres par défaut — utilisés pour la migration des anciennes données
export const defaultSettings = {
  theme: 'dark', // dark | light | auto
  accentColor: '#6366f1',
  sidebarPosition: 'left',
  autoHideTopbar: false,
  notifications: true,
  startMinimized: false,
  fontSize: 'medium', // small | medium | large | xlarge
  fontFamily: 'Inter',
  uiScale: 100, // 80-120%
  compactMode: false,
  showAppIcons: true,
  animationsEnabled: true,
  // Picture-in-Picture automatique : sortir la vidéo en mini-fenêtre quand on
  // quitte l'app (activé par défaut)
  autoPictureInPicture: true,
  // Touches média globales du clavier (⏯ ⏭ ⏮) — désactivé par défaut pour ne
  // pas voler les touches à un éventuel lecteur natif
  globalMediaKeys: false,
  // Bloqueur de pub / traceurs natif (activé par défaut)
  adblock: true,
  // Traduction (menu contextuel « Traduire la sélection »)
  translateTarget: 'fr',
  translateEngine: 'google', // 'google' | 'libretranslate'
  libreTranslateUrl: '', // ex. http://localhost:5000
  libreTranslateApiKey: '',
  // KeePassXC : auto-remplissage des identifiants (activé par défaut)
  keepass: { enabled: true },
};

// Store principal pour gérer les profils, apps, et l'état global
export const useStore = create(
  persist(
    (set, get) => ({
      // Profils
      profiles: [
        { id: 'work', name: 'Travail', emoji: '💼', color: '#6366f1' },
        { id: 'personal', name: 'Personnel', emoji: '🏠', color: '#10b981' },
      ],
      activeProfile: 'work',

      // Applications installées
      apps: [
        // Exemples pré-installés pour le profil "work"
        {
          id: 'gmail-work',
          profileId: 'work',
          sessionKey: 'work:gmail-work',
          recipeId: 'gmail',
          name: 'Gmail',
          url: 'https://mail.google.com',
          // URL « maison » : celle de la recette — l'URL courante peut être
          // une page de connexion persistée (on n'y redémarre jamais).
          homeUrl: 'https://mail.google.com',
          icon: '📧',
          color: '#EA4335',
          unread: 0,
          sleeping: false,
          zoom: 1,
          order: 0,
        },
        {
          id: 'slack-work',
          profileId: 'work',
          sessionKey: 'work:slack-work',
          recipeId: 'slack',
          name: 'Slack',
          url: 'https://app.slack.com',
          homeUrl: 'https://app.slack.com',
          icon: '💬',
          color: '#4A154B',
          unread: 0,
          sleeping: false,
          zoom: 1,
          order: 1,
        },
      ],

      // Application active
      activeApp: null,

      // Extensions Chrome installées [{ id, name, version, path, managed, enabled }]
      extensions: [],

      // Sidebar réduite (persisté : on la retrouve au prochain lancement)
      sidebarCollapsed: false,

      // Écran partagé : deux apps affichées en même temps
      // { appIds: [idA, idB], direction: 'row' (côte à côte) | 'col' (haut/bas) }
      splitView: null,

      // Settings
      settings: { ...defaultSettings },

      // Actions
      setActiveProfile: (profileId) => set({ activeProfile: profileId }),

      setActiveApp: (appId) => set({ activeApp: appId }),

      addProfile: (profile) =>
        set((state) => ({
          profiles: [...state.profiles, { ...profile, id: `profile-${Date.now()}` }],
        })),

      updateProfile: (profileId, updates) =>
        set((state) => ({
          profiles: state.profiles.map((p) => (p.id === profileId ? { ...p, ...updates } : p)),
        })),

      deleteProfile: (profileId) =>
        set((state) => {
          // Retire aussi un éventuel verrou associé à ce profil (main process)
          window.electronAPI?.security?.dropProfile?.(profileId);
          return {
            profiles: state.profiles.filter((p) => p.id !== profileId),
            apps: state.apps.filter((a) => a.profileId !== profileId),
            activeProfile:
              state.activeProfile === profileId ? state.profiles[0]?.id : state.activeProfile,
          };
        }),

      addApp: (app) =>
        set((state) => {
          const id = `app-${Date.now()}`;
          return {
            apps: [
              ...state.apps,
              {
                ...app,
                id,
                // Clé de session STABLE : identifie la partition Electron
                // (cookies + cache) de cette app. Fixée à la création et JAMAIS
                // modifiée ensuite — ainsi déplacer l'app vers un autre profil
                // conserve le compte connecté et le cache (la partition ne
                // dépend plus du profil).
                sessionKey: `${app.profileId}:${id}`,
                // URL de démarrage stable (recette/base) — distincte de l'URL
                // courante qui peut être une page de connexion au moment du
                // redémarrage.
                homeUrl: app.homeUrl || app.url,
                unread: 0,
                sleeping: false,
                zoom: 1, // zoom d'affichage de l'app (persisté)
                order: state.apps.filter((a) => a.profileId === app.profileId).length,
              },
            ],
          };
        }),

      updateApp: (appId, updates) =>
        set((state) => ({
          apps: state.apps.map((a) => (a.id === appId ? { ...a, ...updates } : a)),
        })),

      deleteApp: (appId) =>
        set((state) => ({
          apps: state.apps.filter((a) => a.id !== appId),
          activeApp: state.activeApp === appId ? null : state.activeApp,
        })),

      // Déplace une app vers un autre profil SANS perdre son compte ni son
      // cache : la partition Electron est indexée par `sessionKey` (stable),
      // pas par le profil. On ne change donc que le rattachement au profil et
      // l'ordre (placée en fin de liste du profil cible).
      moveAppToProfile: (appId, targetProfileId) =>
        set((state) => {
          const app = state.apps.find((a) => a.id === appId);
          if (!app || app.profileId === targetProfileId) return state;
          const order = state.apps.filter((a) => a.profileId === targetProfileId).length;
          return {
            apps: state.apps.map((a) =>
              a.id === appId ? { ...a, profileId: targetProfileId, order } : a
            ),
            // Si l'app déplacée était active, elle n'est plus dans le profil
            // courant → on désélectionne pour éviter un état incohérent.
            activeApp: state.activeApp === appId ? null : state.activeApp,
          };
        }),

      // Veille : ferme l'app (la page est détruite) mais la garde installée.
      // L'icône apparaît grisée dans la sidebar.
      toggleAppSleep: (appId) =>
        set((state) => ({
          apps: state.apps.map((a) =>
            a.id === appId ? { ...a, sleeping: !a.sleeping } : a
          ),
        })),

      markAllRead: () =>
        set((state) => ({
          apps: state.apps.map((a) => ({ ...a, unread: 0 })),
        })),

      // Extensions Chrome
      updateExtensions: (extensions) => set({ extensions }),

      // Zoom d'affichage d'une app (0.5 → 3, pas de 0.1) — persisté
      adjustAppZoom: (appId, delta) =>
        set((state) => ({
          apps: state.apps.map((a) => {
            if (a.id !== appId) return a;
            const current = typeof a.zoom === 'number' ? a.zoom : 1;
            return {
              ...a,
              zoom: Math.min(3, Math.max(0.5, Math.round((current + delta) * 100) / 100)),
            };
          }),
        })),

      resetAppZoom: (appId) =>
        set((state) => ({
          apps: state.apps.map((a) => (a.id === appId ? { ...a, zoom: 1 } : a)),
        })),

      // Sidebar réduite / dépliée
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Écran partagé
      setSplitView: (splitView) => set({ splitView }),
      clearSplitView: () => set({ splitView: null }),
      toggleSplitDirection: () =>
        set((state) => ({
          splitView: state.splitView
            ? {
                ...state.splitView,
                direction: state.splitView.direction === 'row' ? 'col' : 'row',
              }
            : null,
        })),

      reorderApps: (profileId, appIds) =>
        set((state) => ({
          apps: state.apps.map((app) => {
            if (app.profileId === profileId) {
              const newOrder = appIds.indexOf(app.id);
              return { ...app, order: newOrder !== -1 ? newOrder : app.order };
            }
            return app;
          }),
        })),

      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),

      // Helpers
      getProfileApps: (profileId) => {
        return get()
          .apps.filter((a) => a.profileId === profileId)
          .sort((a, b) => a.order - b.order);
      },

      getActiveProfileApps: () => {
        const { activeProfile, apps } = get();
        return apps
          .filter((a) => a.profileId === activeProfile)
          .sort((a, b) => a.order - b.order);
      },
    }),
    {
      name: 'orbit-storage',
      version: 8,
      migrate: (persistedState, version) => {
        // Fusionne les anciennes données avec les paramètres par défaut
        // (évite les champs manquants → bug "input non contrôlé")
        const base = persistedState || {};
        let next = {
          ...base,
          settings: { ...defaultSettings, ...(base.settings || {}) },
        };
        // v3 : nouveau champ `sleeping` sur les apps (veille)
        if (version < 3) {
          next = {
            ...next,
            apps: (next.apps || []).map((a) => ({ ...a, sleeping: false })),
          };
        }
        // v4 : sidebar réduite persistée
        if (version < 4) {
          next = { ...next, sidebarCollapsed: false };
        }
        // v5 : zoom d'affichage par app
        if (version < 5) {
          next = {
            ...next,
            apps: (next.apps || []).map((a) => ({ ...a, zoom: 1 })),
          };
        }
        // v6 : favicons stockés mis à jour — Google s2 renvoie un placeholder
        // générique pour certains sites (ex. web.whatsapp.com → 404 → image
        // 16×16 de secours). On bascule les favicons sauvegardés vers
        // icon.horse (vraies icônes de marque). Les apps déjà installées
        // (WhatsApp…) retrouvent leur vrai logo.
        if (version < 6) {
          next = {
            ...next,
            apps: (next.apps || []).map((a) => {
              if (!a.favicon) return a;
              // Recalcule l'URL via icon.horse si c'était un ancien Google s2
              if (a.favicon.includes('google.com/s2/favicons')) {
                const host = hostnameOf(a.url || a.homeUrl || '');
                return host ? { ...a, favicon: `https://icon.horse/icon/${host}` } : a;
              }
              return a;
            }),
          };
        }
        // v7 : icônes de marque officielles des recettes (Google Drive ≠
        // Gmail : les favicons .google.com sont tous le même « G »).
        // Les apps installées (Drive, Gmail…) passent à leur vraie icône.
        if (version < 7) {
          next = {
            ...next,
            apps: (next.apps || []).map((a) => {
              const recipe = a.recipeId ? recipes[a.recipeId] : null;
              if (recipe?.brandIcon) return { ...a, favicon: recipe.brandIcon };
              return a;
            }),
          };
        }
        // v8 : clé de session stable. On la fixe à l'ANCIEN schéma
        // (`profileId:appId`) pour que les apps déjà installées gardent
        // EXACTEMENT leur partition actuelle (donc leur session/cache). Elle
        // ne bougera plus, même si l'app change de profil ensuite.
        if (version < 8) {
          next = {
            ...next,
            apps: (next.apps || []).map((a) =>
              a.sessionKey ? a : { ...a, sessionKey: `${a.profileId}:${a.id}` }
            ),
          };
        }
        return next;
      },
    }
  )
);
