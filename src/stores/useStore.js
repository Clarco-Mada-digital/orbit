import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { recipes } from '../lib/recipes';
import { DEFAULT_TOPBAR, DEFAULT_BOTTOMBAR } from '../lib/topbarLayout';

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
  language: 'auto', // auto | fr | en
  accentColor: '#6366f1',
  sidebarPosition: 'left',
  autoHideTopbar: false,
  notifications: true,
  // Son de notification personnalisé (data URL ; vide = son système)
  notificationSound: '',
  notificationSoundName: '',
  // Volume commun à tous les sons joués par Orbit (0-100)
  soundVolume: 80,
  // Sons du minuteur de concentration : un pour la fin d'une session de
  // travail, un autre pour la fin d'une pause (vide = son intégré nommé)
  focusSoundEnabled: true,
  focusWorkSound: '',
  focusWorkSoundName: 'Gong',
  focusBreakSound: '',
  focusBreakSoundName: 'Montee',
  // Ne pas déranger : coupe toutes les notifications
  dnd: false,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  startMinimized: false,
  fontSize: 'medium', // small | medium | large | xlarge
  fontFamily: 'Inter',
  uiScale: 100, // 80-120%
  compactMode: false,
  showAppIcons: true,
  animationsEnabled: true,
  // Couleur d'accent qui suit la couleur du profil actif
  accentPerProfile: false,
  // Barre système (tray) : fermer la fenêtre la réduit dans le tray (opt-in)
  closeToTray: false,
  // Raccourci global pour afficher/masquer Orbit depuis n'importe où
  globalHotkeyEnabled: false,
  globalHotkey: 'CommandOrControl+Alt+O',
  // Picture-in-Picture automatique : sortir la vidéo en mini-fenêtre quand on
  // quitte l'app (activé par défaut)
  autoPictureInPicture: true,
  // Touches média globales du clavier (⏯ ⏭ ⏮) — désactivé par défaut pour ne
  // pas voler les touches à un éventuel lecteur natif
  globalMediaKeys: false,
  // Mise en veille automatique des apps inactives (minutes ; 0 = désactivée)
  autoSleepMinutes: 0,
  // Proxy/VPN global (ex. socks5://127.0.0.1:1080 ; vide = direct)
  globalProxy: '',
  // Bloqueur de pub / traceurs natif (activé par défaut)
  adblock: true,
  // Traduction (menu contextuel « Traduire la sélection »)
  translateTarget: 'fr',
  translateEngine: 'google', // 'google' | 'libretranslate'
  libreTranslateUrl: '', // ex. http://localhost:5000
  libreTranslateApiKey: '',
  // App ouverte au démarrage : '' = reprendre la dernière, 'none' = aucune,
  // sinon l'id d'une app
  startupApp: '',
  // Verrouillage automatique après inactivité (minutes ; 0 = désactivé)
  autoLockMinutes: 0,
  // KeePassXC : auto-remplissage des identifiants (activé par défaut)
  keepass: { enabled: true },

  // Composition de l'en-tête : quels modules, dans quelle zone, dans quel
  // ordre (voir src/lib/topbarLayout.js)
  topbar: { ...DEFAULT_TOPBAR },
  // Barre du bas : désactivée par défaut, même principe de composition que
  // l'en-tête (quels modules, dans quelle zone, dans quel ordre)
  bottombarEnabled: false,
  bottombar: { ...DEFAULT_BOTTOMBAR },
  // Horloge de l'en-tête
  clock: {
    format: '24', // 24 | 12
    seconds: false,
    showDate: true,
    timezones: [], // fuseaux supplémentaires, ex. 'Europe/Paris'
  },
  // Météo de l'en-tête (Open-Meteo, sans clé d'API)
  weather: {
    city: '',
    units: 'metric', // metric | imperial
  },
  // Minuteur de concentration (Pomodoro)
  focus: {
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    autoContinue: false,
  },
  // Style des fenêtres secondaires (pop-ups d'apps : connexion Google, liens
  // ouverts dans une nouvelle fenêtre…)
  popupStyle: 'orbit', // orbit (habillage Orbit, coins arrondis) | native | external
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

      // Corbeille : apps désinstallées récemment (restaurables avec leur session)
      trash: [],

      // Conteneurs (type Firefox) : coffres à cookies nommés. Les apps d'un
      // même conteneur partagent leurs connexions (SSO), même dans un profil
      // « isolé » → permet plusieurs comptes d'un même service. [{ id, name, color }]
      containers: [],

      // Sidebar réduite (persisté : on la retrouve au prochain lancement)
      sidebarCollapsed: false,

      // Écran partagé : deux apps affichées en même temps
      // { appIds: [idA, idB], direction: 'row' (côte à côte) | 'col' (haut/bas) }
      splitView: null,

      // Espaces de travail enregistrés : profil + app active + disposition (split)
      // { id, name, profileId, activeApp, splitView }
      workspaces: [],

      // Onboarding : écran de bienvenue au tout premier lancement
      onboarded: false,

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

      // Désinstalle une app → la place dans la CORBEILLE (sa session/cookies
      // sont conservés tant qu'elle y est → restauration possible telle quelle).
      deleteApp: (appId) =>
        set((state) => {
          const app = state.apps.find((a) => a.id === appId);
          return {
            apps: state.apps.filter((a) => a.id !== appId),
            activeApp: state.activeApp === appId ? null : state.activeApp,
            trash: app
              ? [{ ...app, deletedAt: Date.now() }, ...state.trash].slice(0, 30)
              : state.trash,
          };
        }),

      // Restaure une app de la corbeille (dans son profil, ou le 1er s'il n'existe plus)
      restoreApp: (appId) =>
        set((state) => {
          const item = state.trash.find((a) => a.id === appId);
          if (!item) return state;
          const profileId = state.profiles.some((p) => p.id === item.profileId)
            ? item.profileId
            : state.profiles[0]?.id;
          const { deletedAt, ...app } = item; // eslint-disable-line no-unused-vars
          const order = state.apps.filter((a) => a.profileId === profileId).length;
          return {
            apps: [...state.apps, { ...app, profileId, order }],
            trash: state.trash.filter((a) => a.id !== appId),
          };
        }),

      // Supprime DÉFINITIVEMENT une app de la corbeille (+ purge sa session)
      purgeTrashApp: (appId) =>
        set((state) => {
          const item = state.trash.find((a) => a.id === appId);
          if (item) {
            window.electronAPI?.clearAppSession?.({
              sessionKey: item.sessionKey || `${item.profileId}:${item.id}`,
              profileId: item.profileId,
              appId: item.id,
            });
          }
          return { trash: state.trash.filter((a) => a.id !== appId) };
        }),

      // Vide toute la corbeille (+ purge les sessions)
      emptyTrash: () =>
        set((state) => {
          state.trash.forEach((item) =>
            window.electronAPI?.clearAppSession?.({
              sessionKey: item.sessionKey || `${item.profileId}:${item.id}`,
              profileId: item.profileId,
              appId: item.id,
            })
          );
          return { trash: [] };
        }),

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

      // Conteneurs multi-comptes
      addContainer: (name, color) =>
        set((state) => ({
          containers: [
            ...state.containers,
            { id: `ctn-${Date.now()}`, name: name || 'Conteneur', color: color || '#f59e0b' },
          ],
        })),
      // Crée un conteneur ET l'assigne à l'app (atomique — pratique depuis le menu)
      createContainerForApp: (appId, name, color) =>
        set((state) => {
          const id = `ctn-${Date.now()}`;
          return {
            containers: [
              ...state.containers,
              { id, name: name || 'Conteneur', color: color || '#f59e0b' },
            ],
            apps: state.apps.map((a) => (a.id === appId ? { ...a, containerId: id } : a)),
          };
        }),
      setAppContainer: (appId, containerId) =>
        set((state) => ({
          apps: state.apps.map((a) =>
            a.id === appId ? { ...a, containerId: containerId || undefined } : a
          ),
        })),
      renameContainer: (id, name) =>
        set((state) => ({
          containers: state.containers.map((c) => (c.id === id ? { ...c, name } : c)),
        })),
      deleteContainer: (id) =>
        set((state) => ({
          containers: state.containers.filter((c) => c.id !== id),
          apps: state.apps.map((a) => (a.containerId === id ? { ...a, containerId: undefined } : a)),
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

      // --- Espaces de travail --------------------------------------------
      // Capture l'état actuel (profil, app active, split) sous un nom
      saveWorkspace: (name) =>
        set((state) => ({
          workspaces: [
            ...state.workspaces,
            {
              id: `ws-${Date.now()}`,
              name: (name || 'Espace').trim() || 'Espace',
              profileId: state.activeProfile,
              activeApp: state.activeApp,
              splitView: state.splitView ? { ...state.splitView } : null,
            },
          ],
        })),
      // Restaure un espace enregistré
      applyWorkspace: (id) =>
        set((state) => {
          const ws = state.workspaces.find((w) => w.id === id);
          if (!ws) return {};
          return {
            activeProfile: ws.profileId || state.activeProfile,
            activeApp: ws.activeApp || null,
            splitView: ws.splitView ? { ...ws.splitView } : null,
          };
        }),
      deleteWorkspace: (id) =>
        set((state) => ({ workspaces: state.workspaces.filter((w) => w.id !== id) })),

      setOnboarded: (v) => set({ onboarded: v !== false }),

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
      // v9 : nouveaux réglages (en-tête configurable, horloge, météo,
      // minuteur, style des fenêtres secondaires).
      // v10 : sons du minuteur + volume global. Le bump de version suffit :
      // la fusion avec `defaultSettings` en tête de `migrate` les ajoute aux
      // installations existantes.
      version: 10,
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
        // v9 : l'en-tête devient configurable — on part de la disposition
        // par défaut, qui reproduit exactement la barre précédente.
        if (version < 9) {
          next = { ...next, settings: { ...next.settings, topbar: { ...DEFAULT_TOPBAR } } };
        }
        // v10 : barre du bas (désactivée par défaut, composition configurable)
        if (version < 10) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              bottombarEnabled: false,
              bottombar: { ...DEFAULT_BOTTOMBAR },
            },
          };
        }
        return next;
      },
    }
  )
);
