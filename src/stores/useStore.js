import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { recipes } from '../lib/recipes.js';
import { flyPageTarget, outsideFallbackFor } from '../lib/urls.js';
import { DEFAULT_TOPBAR, DEFAULT_BOTTOMBAR } from '../lib/topbarLayout.js';
import { stampSync, NO_STAMP } from '../lib/syncStamp.js';
import { reconcileLocal } from '../lib/syncMerge.js';
import {
  makeFolder,
  pruneEmptyFolders,
  normalizeFolderName,
  withoutFolderId,
  folderForProfile,
  orderForProfile,
  withFolderForProfile,
} from '../lib/appGroups.js';
import { KIND } from '../lib/fileTypes.js';
import {
  upsertAssistantSession,
  removeAssistantSession,
  setSessionTitle,
} from '../lib/assistantSessions.js';
import { stripNativeApps, withPhoneModule } from '../lib/phone.js';

// Compteur d'identifiants de pages volantes (voir `openFlyPage`).
let flySeq = 0;

// Apparence d'une page volante selon la NATURE du document (voir
// lib/fileTypes.js) : l'icône de la barre latérale annonce ce qu'on va voir.
const FLY_PAGE_LOOKS = {
  page: { icon: '🌐', color: '#64748b' },
  markdown: { icon: '📝', color: '#8b5cf6' },
  json: { icon: '🧾', color: '#f59e0b' },
  csv: { icon: '📊', color: '#10b981' },
  code: { icon: '💻', color: '#06b6d4' },
  text: { icon: '📄', color: '#64748b' },
  pdf: { icon: '📕', color: '#ef4444' },
  image: { icon: '🖼️', color: '#0ea5e9' },
  media: { icon: '🎬', color: '#f97316' },
};

// Hostname d'une URL (pour la migration des favicons)
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Portée d'une app : par défaut elle n'existe que dans son profil. Avec
// `scope: 'all'`, elle est visible depuis TOUS les profils — une seule app, une
// seule session, pas une copie par profil (c'est toute la différence avec le
// fait de l'installer deux fois : on garderait deux comptes séparés).
export function appVisibleIn(app, profileId) {
  return app.profileId === profileId || app.scope === 'all';
}

// Paramètres par défaut — utilisés pour la migration des anciennes données
export const defaultSettings = {
  // Fournisseur actif de l’assistant : l’IA locale reste le choix initial.
  assistantProvider: 'local',
  assistantProviderModels: {},
  assistantCloudConsent: {},
  assistantChatEnabled: true,
  assistantChatSidebarEnabled: true,
  assistantChatShortcutEnabled: true,
  assistantChatShortcutKey: 'a',
  assistantAgentId: 'writer',
  assistantAgentFavorites: [],
  proofreaderEngine: 'local',
  theme: 'dark', // dark | light | auto
  language: 'auto', // auto | fr | en
  accentColor: '#6366f1',
  sidebarPosition: 'left',
  // Mode épuré : quelles barres se masquent et réapparaissent au survol du
  // bord de l'écran. Remplace l'ancien `autoHideTopbar`, qui n'était branché
  // à rien.
  autoHide: { top: false, left: false, bottom: false },
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
  // Extension Fake Data Filler : désactivée pour cacher le bouton 🎲
  fakeDataDisabled: false,
  // Extension Fake Data Filler : supprimée de l'interface (bouton 🎲 caché)
  fakeDataRemoved: false,
  // Extensions « épinglées » dans la barre (id → true) : affichées en icônes
  // directes ; les autres se replient derrière la pastille 🧩 de la barre.
  pinnedExtensions: {},
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
  // Téléchargements : dossier d'enregistrement personnalisé.
  // '' (par défaut) = le dossier Téléchargements du système. Un choix nul ou
  // composé d'espaces revient au même : un réglage ne doit JAMAIS empêcher
  // d'enregistrer (voir src/lib/downloadPath.js).
  downloadDir: '',
  // Ouvrir la boîte d'enregistrement du système à chaque téléchargement.
  // Désactivé par défaut : la majorité des fichiers vont au même endroit et
  // une question à chaque fois devient vite un réflexe d'acquiescement.
  askDownloadPath: false,
  // Menu contextuel des apps : celui d'Orbit par défaut, celui du système en
  // repli pour qui le préfère (ou si le nôtre pose problème).
  nativeContextMenu: false,
  // Lecture vocale : moteur du système par défaut (immédiat, aucun
  // téléchargement). 'piper' n'est utilisé que si l'utilisateur l'installe.
  tts: { engine: 'system', voiceId: '' },
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
  // Quelle source d'identifiants Orbit interroge dans les pages :
  //   'both'    → KeePassXC + trousseaux intégrés (défaut)
  //   'keepass' → KeePassXC seul
  //   'vault'   → trousseaux intégrés seuls
  //   'none'    → aucune proposition dans les pages
  // `keepass.enabled` en découle : il n'est plus réglé séparément.
  credentials: { source: 'both' },

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

  // Page d'accueil : ce qu'on voit dans un profil quand aucune app n'est
  // ouverte (fond personnalisable, champ de recherche Alt+K, petits widgets).
  // Voir src/lib/home.js pour les fonds proposés et la normalisation.
  home: {
    background: 'accent', // id d'un fond de HOME_BACKGROUNDS
    imageUrl: '', // image personnalisée (URL ou data URL) — prime sur le fond
    blur: 0, // 0-24 px de flou sur l'image
    dim: 30, // 0-80 % de voile sombre sur le fond
    widgets: { clock: true, weather: true, apps: true },
  },
};

// Store principal pour gérer les profils, apps, et l'état global
export const useStore = create(
  persist(
    // `stampSync` s'intercale ici : il horodate les entités modifiées et pose
    // les pierres tombales des suppressions, quelle que soit l'action appelée
    // (voir src/lib/syncStamp.js). Placé SOUS `persist` pour que ses
    // corrections soient enregistrées comme le reste.
    stampSync((set, get) => ({
      // Profils
      profiles: [
        { id: 'work', name: 'Travail', emoji: '💼', color: '#6366f1' },
        { id: 'personal', name: 'Personnel', emoji: '🏠', color: '#10b981' },
      ],
      activeProfile: 'work',

      // Capacités natives fournies par les extensions installées (ex. 'phone').
      // Ce n'est PAS une app de la barre latérale : le Téléphone s'ouvre depuis
      // un bouton de barre, et rien n'existe sans son extension.
      nativeApps: [],

      // Applications installées (aucune app native ici).
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

      // Dossiers d'apps (rangement visuel) : un dossier appartient à UN profil
      // et les apps le rejoignent en portant son `folderId` (voir lib/appGroups.js).
      // Aucune app n'est « contenue » ici : supprimer un dossier ne peut donc
      // jamais supprimer une app. [{ id, name, profileId, emoji, color, order, collapsed }]
      folders: [],

      // Sidebar réduite (persisté : on la retrouve au prochain lancement)
      sidebarCollapsed: false,

      // Liste des profils dépliée dans la barre latérale ? Repliée par défaut :
      // avec plusieurs profils, la liste occupait une dizaine de lignes en
      // permanence. Préférence PUREMENT locale (elle ne voyage pas avec la
      // synchronisation) : chaque machine garde son propre pliage.
      sidebarProfilesOpen: false,

      // Écran partagé : deux apps affichées en même temps
      // { appIds: [idA, idB], direction: 'row' (côte à côte) | 'col' (haut/bas) }
      splitView: null,

      // Espaces de travail enregistrés : profil + app active + disposition (split)
      // { id, name, profileId, activeApp, splitView }
      workspaces: [],

      // Automatisations : règles « quand X, fais Y » (voir src/lib/rules.js).
      // Persistées ET synchronisées : une règle de routage de liens a autant
      // de sens sur le portable que sur le fixe.
      rules: [],

      // Pages volantes : des URL ouvertes à la volée depuis la palette Alt+K.
      // Ce ne sont PAS des apps — on veut consulter un lien sans polluer la
      // liste d'apps installées. D'où trois différences assumées :
      //   - éphémères : exclues de la persistance (voir `partialize`), donc
      //     elles disparaissent à la fermeture d'Orbit ;
      //   - session jetable : partition `fly:<id>`, purgée à la fermeture, rien
      //     ne traîne dans les cookies d'une vraie app ;
      //   - promouvables : « Ajouter comme application » les transforme en app
      //     normale, avec toute la configuration qui va avec.
      // Leur forme imite celle d'une app pour traverser le MÊME rendu
      // (<WebView>, recherche dans la page, zoom, écran partagé).
      flyPages: [],

      // Onboarding : écran de bienvenue au tout premier lancement
      onboarded: false,

      // Historique des conversations de l’assistant : une entrée par
      // discussion ou action rapide (voir lib/assistantSessions.js).
      // PUREMENT LOCAL — les sessions ne partent pas dans la synchronisation
      // entre machines : elles contiennent des textes personnels et grossissent
      // vite, contrairement aux réglages.
      assistantSessions: [],

      // Settings
      settings: { ...defaultSettings },

      // --- Synchronisation entre machines ---------------------------------
      // Quand les réglages ont-ils changé pour la dernière fois ? Ils voyagent
      // en BLOC (voir syncMerge.js), donc un seul horodatage suffit.
      settingsUpdatedAt: 0,
      // Pierres tombales { id: date de suppression }. Sans elles, une
      // suppression ne se propagerait pas : la machine d'en face conclurait
      // simplement « il me manque cette app » et la réinstallerait.
      tombstones: {},

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
            apps: state.apps
              .filter((a) => a.profileId !== profileId)
              .map((app) => {
                if (app.scope !== 'all') return app;
                const hasOrder = Object.hasOwn(app.orderByProfile || {}, profileId);
                const hasFolder = Object.hasOwn(app.folderByProfile || {}, profileId);
                if (!hasOrder && !hasFolder) return app;
                const { [profileId]: _removedOrder, ...orderByProfile } = app.orderByProfile || {};
                const { [profileId]: _removedFolder, ...folderByProfile } = app.folderByProfile || {};
                return { ...app, orderByProfile, folderByProfile };
              }),
            // Les dossiers du profil partent avec lui : sans ça, ils
            // resteraient en base et réapparaîtraient à la reconnexion d'un
            // dossier de sauvegarde.
            folders: state.folders.filter((f) => f.profileId !== profileId),
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

      // Réconcilie les capacités natives avec les extensions RÉELLEMENT
      // actives. `kinds` vient du processus principal après `syncExtensions`
      // (il lit les manifestes) : c'est la seule source fiable, un ancien état
      // persisté peut encore contenir l'app alors que l'extension est partie.
      syncNativeApps: (kinds) =>
        set((state) => {
          const next = [...new Set((Array.isArray(kinds) ? kinds : []).filter((k) => k === 'phone'))];
          const patch = {};
          const current = Array.isArray(state.nativeApps) ? state.nativeApps : [];
          if (current.length !== next.length || current.some((k, i) => k !== next[i])) {
            patch.nativeApps = next;
          }

          // L'ancienne app « Téléphone » de la barre latérale est retirée une
          // bonne fois pour toutes (y compris si elle était ouverte).
          const stripped = stripNativeApps(state.apps);
          if (stripped) {
            patch.apps = stripped.apps;
            if (stripped.removedIds.includes(state.activeApp)) patch.activeApp = null;
            if (state.splitView?.appIds?.some((id) => stripped.removedIds.includes(id))) {
              patch.splitView = null;
            }
          }

          // Extension présente → le bouton rejoint la barre du haut s'il n'y a
          // jamais été placé. Retirée → le bouton disparaît de lui-même (il ne
          // s'affiche que si la capacité existe).
          if (next.includes('phone')) {
            const topbar = withPhoneModule(state.settings?.topbar);
            if (topbar) patch.settings = { ...state.settings, topbar };
          }

          return patch;
        }),

      // Met à jour une app OU une page volante : <WebView> appelle cette
      // fonction pour le titre, le favicon, l'URL courante… sans avoir à
      // savoir sur quel type d'élément il est branché.
      updateApp: (appId, updates) =>
        set((state) =>
          state.flyPages.some((p) => p.id === appId)
            ? { flyPages: state.flyPages.map((p) => (p.id === appId ? { ...p, ...updates } : p)) }
            : { apps: state.apps.map((a) => (a.id === appId ? { ...a, ...updates } : a)) }
        ),

      // Désinstalle une app → la place dans la CORBEILLE (sa session/cookies
      // sont conservés tant qu'elle y est → restauration possible telle quelle).
      deleteApp: (appId) =>
        set((state) => {
          const app = state.apps.find((a) => a.id === appId);
          const apps = state.apps.filter((a) => a.id !== appId);
          return {
            apps,
            activeApp: state.activeApp === appId ? null : state.activeApp,
            trash: app
              ? [{ ...app, deletedAt: Date.now() }, ...state.trash].slice(0, 30)
              : state.trash,
            // Dernière app du dossier → le dossier vide est retiré (sinon il
            // resterait une ligne fantôme, invisible et impossible à purger).
            folders: pruneEmptyFolders(state.folders, apps),
          };
        }),

      // Désinstalle PLUSIEURS apps d'un coup (menu de sélection multiple) —
      // une seule écriture, donc un seul rendu de la liste.
      deleteApps: (appIds) =>
        set((state) => {
          const ids = new Set(appIds || []);
          if (!ids.size) return state;
          const removed = state.apps.filter((a) => ids.has(a.id));
          if (!removed.length) return state;
          const apps = state.apps.filter((a) => !ids.has(a.id));
          const idsSet = new Set(removed.map((a) => a.id));
          return {
            apps,
            activeApp: idsSet.has(state.activeApp) ? null : state.activeApp,
            splitView: state.splitView?.appIds?.some((i) => idsSet.has(i))
              ? null
              : state.splitView,
            trash: [
              ...removed.map((a) => ({ ...a, deletedAt: Date.now() })),
              ...state.trash,
            ].slice(0, 30),
            folders: pruneEmptyFolders(state.folders, apps),
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
          // Le dossier d'origine a pu disparaître pendant que l'app était dans
          // la corbeille (supprimé à la main, ou vidé en la désinstallant) : on
          // retire alors le `folderId` orphelin plutôt que de le garder.
          const restored = state.folders.some((f) => f.id === app.folderId)
            ? app
            : withoutFolderId(app);
          return {
            apps: [...state.apps, { ...restored, profileId, order }],
            trash: state.trash.filter((a) => a.id !== appId),
          };
        }),

      // Applique les mêmes changements à plusieurs apps (veille, épingle,
      // sourdine…) depuis le menu de sélection multiple.
      bulkUpdateApps: (appIds, updates) =>
        set((state) => {
          const ids = new Set(appIds || []);
          if (!ids.size) return state;
          return {
            apps: state.apps.map((a) => (ids.has(a.id) ? { ...a, ...updates } : a)),
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

      // Déplace PLUSIEURS apps vers un profil (menu de sélection multiple).
      // Chacune quitte son dossier au passage : un dossier n'existe que dans un
      // profil, l'y laisser la rangerait dans un dossier invisible depuis son
      // nouveau profil (elle disparaîtrait de l'interface).
      moveAppsToProfile: (appIds, targetProfileId) =>
        set((state) => {
          const ids = new Set(appIds || []);
          if (!ids.size || !state.profiles.some((p) => p.id === targetProfileId)) return state;
          const moved = state.apps.filter((a) => ids.has(a.id) && a.profileId !== targetProfileId);
          if (!moved.length) return state;
          let order = state.apps.filter((a) => a.profileId === targetProfileId).length;
          const apps = state.apps.map((a) => {
            if (!ids.has(a.id) || a.profileId === targetProfileId) return a;
            return { ...a, profileId: targetProfileId, order: order++, folderId: undefined };
          });
          return {
            apps,
            activeApp: moved.some((a) => a.id === state.activeApp) ? null : state.activeApp,
            splitView: state.splitView?.appIds?.some((i) => ids.has(i)) ? null : state.splitView,
            folders: pruneEmptyFolders(state.folders, apps),
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

      // --- Dossiers -------------------------------------------------------
      // Crée un dossier dans le profil courant et y range les apps sélectionnées
      // d'un coup. Le dossier et l'affectation sont écrits en UN seul `set` :
      // deux écritures laisseraient entrevoir une ligne vide le temps d'un rendu.
      createFolderWithApps: (name, appIds, { emoji, color, fallbackName, profileId } = {}) =>
        set((state) => {
          const ids = new Set(appIds || []);
          const selected = state.apps.filter((a) => ids.has(a.id));
          if (!selected.length) return state;
          const targetProfileId = profileId || state.activeProfile;
          const order = state.folders.filter((f) => f.profileId === targetProfileId).length;
          const folder = makeFolder({
            name,
            profileId: targetProfileId,
            emoji,
            color,
            order,
            fallbackName: fallbackName || normalizeFolderName(name),
          });
          return {
            folders: [...state.folders, folder],
            apps: state.apps.map((app) =>
              ids.has(app.id) ? withFolderForProfile(app, targetProfileId, folder.id) : app
            ),
          };
        }),

      // Range des apps dans un dossier existant — ou les en sort (`folderId`
      // vide, on retire aussi le champ pour ne pas laisser de résidu).
      assignAppsToFolder: (appIds, folderId, profileId = get().activeProfile) =>
        set((state) => {
          const ids = new Set(appIds || []);
          if (!ids.size) return state;
          const target =
            folderId &&
            state.folders.some((folder) => folder.id === folderId && folder.profileId === profileId)
              ? folderId
              : undefined;
          const apps = state.apps.map((a) => {
            if (!ids.has(a.id)) return a;
            return withFolderForProfile(a, profileId, target);
          });
          return { apps, folders: pruneEmptyFolders(state.folders, apps) };
        }),

      // Range UNE app (glisser-déposer) — même contrat que ci-dessus.
      setAppFolder: (appId, folderId, profileId = get().activeProfile) =>
        set((state) => {
          const target =
            folderId &&
            state.folders.some((folder) => folder.id === folderId && folder.profileId === profileId)
              ? folderId
              : undefined;
          const apps = state.apps.map((a) => {
            if (a.id !== appId) return a;
            return withFolderForProfile(a, profileId, target);
          });
          return { apps, folders: pruneEmptyFolders(state.folders, apps) };
        }),

      renameFolder: (id, name) =>
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === id ? { ...f, name: normalizeFolderName(name, f.name) } : f
          ),
        })),

      updateFolder: (id, updates) =>
        set((state) => ({
          folders: state.folders.map((f) => (f.id === id ? { ...f, ...updates } : f)),
        })),

      // Plier / déplier un dossier (état d'affichage, non synchronisé).
      toggleFolderCollapsed: (id) =>
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === id ? { ...f, collapsed: !f.collapsed } : f
          ),
        })),

      setFolderCollapsed: (id, collapsed) =>
        set((state) => ({
          folders: state.folders.map((f) => (f.id === id ? { ...f, collapsed: !!collapsed } : f)),
        })),

      // Supprime LE DOSSIER (pas les apps) : elles redeviennent libres.
      deleteFolder: (id) =>
        set((state) => {
          const folder = state.folders.find((item) => item.id === id);
          if (!folder) return state;
          return {
            folders: state.folders.filter((item) => item.id !== id),
            apps: state.apps.map((app) => {
              if (app.scope !== 'all') {
                return app.folderId === id ? withoutFolderId(app) : app;
              }
              const folderByProfile = { ...(app.folderByProfile || {}) };
              let changed = app.folderId === id;
              for (const [profileId, folderId] of Object.entries(folderByProfile)) {
                if (folderId === id) {
                  folderByProfile[profileId] = null;
                  changed = true;
                }
              }
              if (!changed) return app;
              const next = app.folderId === id ? withoutFolderId(app) : app;
              return { ...next, folderByProfile };
            }),
          };
        }),

      // Déplie / replie la liste des profils de la barre latérale.
      setSidebarProfilesOpen: (open) => set({ sidebarProfilesOpen: open !== false }),

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
        set((state) => {
          const adjust = (a) => {
            if (a.id !== appId) return a;
            const current = typeof a.zoom === 'number' ? a.zoom : 1;
            return {
              ...a,
              zoom: Math.min(3, Math.max(0.5, Math.round((current + delta) * 100) / 100)),
            };
          };
          return {
            apps: state.apps.map(adjust),
            flyPages: state.flyPages.map(adjust),
          };
        }),

      resetAppZoom: (appId) =>
        set((state) => {
          const reset = (a) => (a.id === appId ? { ...a, zoom: 1 } : a);
          return {
            apps: state.apps.map(reset),
            flyPages: state.flyPages.map(reset),
          };
        }),

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

      // --- Pages volantes -------------------------------------------------
      // Ouvre une URL à la volée et l'affiche. Réutilise une page déjà ouverte
      // sur la même adresse plutôt que d'en empiler une seconde.
      //
      // `{ private: true }` : navigation privée. La partition n'a pas de
      // préfixe `persist:` (voir lib/session.js), donc Electron la garde en
      // mémoire : ni cookies, ni cache, ni stockage sur le disque, pas
      // d'extensions, pas d'historique. Une page privée ne réutilise jamais une
      // page normale (et inversement) : ce serait mélanger les deux sessions.
      //
      // `filePath` : chemin réel d'un fichier local ouvert depuis le système.
      // Il est transmis tel quel au processus principal, qui ne lit QUE les
      // fichiers que l'utilisateur a lui-même ouverts (voir documents:read).
      openFlyPage: (rawUrl, { private: isPrivate = false, filePath } = {}) => {
        // `flyPageTarget` (lib/urls.js) tranche : adresse web, ou page HTML
        // locale ouverte depuis le système. Le reste est refusé.
        const target = flyPageTarget(rawUrl);
        if (!target) {
          // JAMAIS SILENCIEUX : refuser un document qu'on ne sait pas afficher
          // est juste (.docx, .zip, .exe → le moteur en ferait une page
          // blanche), mais rester muet donne exactement le même symptôme. On
          // rend donc la main au navigateur du système, qui le téléchargera —
          // le retour de `openFlyPage` reste `null` : aucun onglet n'a été
          // ouvert, l'appelant n'a rien à faire.
          if (outsideFallbackFor(rawUrl) === 'browser') {
            globalThis.window?.electronAPI?.openOutside?.(String(rawUrl).trim());
          }
          return null;
        }
        const url = target.url;
        const existing = get().flyPages.find(
          (p) => Boolean(p.private) === isPrivate && (p.url === url || p.homeUrl === url)
        );
        if (existing) {
          set({ activeApp: existing.id });
          return existing.id;
        }
        // Compteur monotone en plus de l'horodatage : plusieurs documents
        // peuvent être ouverts dans la MÊME milliseconde (le système passe
        // plusieurs fichiers d'un coup dans les arguments de lancement), et
        // deux pages portant le même identifiant se fermeraient ensemble,
        // casseraient les clés React et doubleraient les lignes du menu.
        flySeq += 1;
        const id = `${isPrivate ? 'priv' : 'fly'}-${Date.now()}-${flySeq}`;
        // Nom affiché : le domaine du site, ou le nom du fichier local.
        const host = target.name;
        set((state) => ({
          flyPages: [
            ...state.flyPages,
            {
              id,
              // Portée « tous les profils » : une page volante n'est pas une
              // application, elle n'appartient à aucun profil. La montrer dans
              // chaque profil (et non seulement celui au moment de l'ouverture)
              // est la seule chose cohérente — sinon basculer de profil
              // faisait disparaître une page qu'on est en train de lire.
              scope: 'all',
              // Partition jetable, distincte de toute app : consulter un lien
              // ne doit pas toucher aux cookies d'un compte connecté.
              sessionKey: `${isPrivate ? 'priv' : 'fly'}:${id}`,
              ephemeral: true,
              private: isPrivate,
              // NATURE du document : elle décide de l'affichage — visionneuse
              // Orbit pour les formats texte, <webview> pour le reste.
              kind: target.kind,
              // Chemin réel d'un fichier local (null pour une adresse web).
              filePath: target.local ? filePath || null : null,
              name: host,
              url,
              homeUrl: url,
              // Une page HTML LOCALE reste un document : icône de feuille, pas de
              // globe (le globe est réservé aux adresses web).
              icon: isPrivate
                ? '🕶️'
                : target.local && target.kind === KIND.page
                  ? '📄'
                  : FLY_PAGE_LOOKS[target.kind]?.icon || (target.local ? '📄' : '🌐'),
              color: isPrivate ? '#7c3aed' : FLY_PAGE_LOOKS[target.kind]?.color || '#64748b',
              unread: 0,
              sleeping: false,
              zoom: 1,
              order: state.flyPages.length,
              createdAt: Date.now(),
            },
          ],
          activeApp: id,
        }));
        return id;
      },

      closeFlyPage: (id) =>
        set((state) => {
          const page = state.flyPages.find((p) => p.id === id);
          if (page) {
            // Session jetable : on la purge à la fermeture, sinon les cookies
            // des pages consultées s'accumuleraient sur le disque sans que
            // rien dans l'interface n'en garde trace.
            window.electronAPI?.clearAppSession?.({
              sessionKey: page.sessionKey,
              profileId: page.profileId,
              appId: page.id,
            });
          }
          const rest = state.flyPages.filter((p) => p.id !== id);
          return {
            flyPages: rest,
            activeApp: state.activeApp === id ? null : state.activeApp,
            // Une page volante fermée ne doit pas laisser un panneau vide dans
            // l'écran partagé.
            splitView: state.splitView?.appIds?.includes(id) ? null : state.splitView,
          };
        }),

      closeAllFlyPages: () =>
        set((state) => {
          state.flyPages.forEach((p) =>
            window.electronAPI?.clearAppSession?.({
              sessionKey: p.sessionKey,
              profileId: p.profileId,
              appId: p.id,
            })
          );
          const ids = new Set(state.flyPages.map((p) => p.id));
          return {
            flyPages: [],
            activeApp: ids.has(state.activeApp) ? null : state.activeApp,
            splitView: state.splitView?.appIds?.some((i) => ids.has(i)) ? null : state.splitView,
          };
        }),

      // --- Automatisations -------------------------------------------------
      addRule: (rule) =>
        set((state) => ({
          rules: [...state.rules, { id: `rule-${Date.now()}`, enabled: true, ...rule }],
        })),
      updateRule: (id, updates) =>
        set((state) => ({
          rules: state.rules.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),
      deleteRule: (id) => set((state) => ({ rules: state.rules.filter((r) => r.id !== id) })),
      // L'ordre décide : la PREMIÈRE règle qui correspond l'emporte.
      moveRule: (id, delta) =>
        set((state) => {
          const i = state.rules.findIndex((r) => r.id === id);
          const j = i + delta;
          if (i === -1 || j < 0 || j >= state.rules.length) return state;
          const rules = [...state.rules];
          [rules[i], rules[j]] = [rules[j], rules[i]];
          return { rules };
        }),

      setOnboarded: (v) => set({ onboarded: v !== false }),

      reorderApps: (profileId, appIds) =>
        set((state) => ({
          apps: state.apps.map((app) => {
            const newOrder = appIds.indexOf(app.id);
            if (newOrder !== -1 && app.scope === 'all') {
              return {
                ...app,
                orderByProfile: { ...(app.orderByProfile || {}), [profileId]: newOrder },
              };
            }
            if (newOrder !== -1 && app.profileId === profileId) {
              return { ...app, order: newOrder };
            }
            return app;
          }),
        })),

      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),

      // --- Historique de l’assistant ---------------------------------------
      saveAssistantSession: (session) =>
        set((state) => ({
          assistantSessions: upsertAssistantSession(state.assistantSessions, session),
        })),
      renameAssistantSession: (id, title) =>
        set((state) => ({
          assistantSessions: state.assistantSessions.map((session) =>
            session.id === id ? setSessionTitle(session, title) : session
          ),
        })),
      deleteAssistantSession: (id) =>
        set((state) => ({
          assistantSessions: removeAssistantSession(state.assistantSessions, id),
        })),
      clearAssistantSessions: () => set({ assistantSessions: [] }),

      // Helpers
      getProfileApps: (profileId) => {
        return get()
          .apps.filter((a) => appVisibleIn(a, profileId))
          .map((app) => ({
            ...app,
            order: orderForProfile(app, profileId),
            folderId: folderForProfile(app, profileId),
          }))
          .sort((a, b) => a.order - b.order);
      },

      getActiveProfileApps: () => {
        const { activeProfile, apps } = get();
        return apps
          .filter((a) => a.profileId === activeProfile)
          .sort((a, b) => a.order - b.order);
      },

      // Applique un instantané fusionné venu de la synchronisation.
      // On écrit en UN SEUL `set` : deux écritures successives laisseraient
      // l'interface dans un état intermédiaire incohérent (apps d'une machine,
      // profils de l'autre) le temps d'un rendu.
      applySyncSnapshot: (snap) =>
        set((state) => {
          const next = {
            // Les `updatedAt` de cet instantané viennent d'être arbitrés entre
            // machines : le middleware ne doit surtout pas les réécrire.
            [NO_STAMP]: true,
            // `reconcileLocal` superpose les champs synchronisés sur les
            // entités locales : sans lui, chaque synchronisation effacerait la
            // page courante, les non-lus, les icônes téléversées et l'état de
            // veille (l'instantané ne les transporte pas).
            profiles: reconcileLocal(state.profiles, snap.profiles),
            apps: reconcileLocal(state.apps, snap.apps),
            folders: reconcileLocal(state.folders, snap.folders || []),
            containers: reconcileLocal(state.containers, snap.containers),
            workspaces: reconcileLocal(state.workspaces, snap.workspaces),
            rules: reconcileLocal(state.rules, snap.rules),
            settings: { ...defaultSettings, ...(snap.settings || {}) },
            settingsUpdatedAt: snap.settingsUpdatedAt,
            tombstones: snap.tombstones || {},
          };
          // Le profil actif a pu disparaître (supprimé sur l'autre machine) :
          // on se replie sur le premier disponible plutôt que d'afficher le
          // vide.
          if (!next.profiles.some((p) => p.id === state.activeProfile)) {
            next.activeProfile = next.profiles[0]?.id;
            next.activeApp = null;
            next.splitView = null;
          } else if (state.activeApp && !next.apps.some((a) => a.id === state.activeApp)) {
            // Idem pour l'app affichée, si elle a été désinstallée ailleurs.
            next.activeApp = null;
            next.splitView = null;
          }
          return next;
        }),
    })),
    {
      name: 'orbit-storage',
      // Les pages volantes ne sont PAS persistées : c'est précisément ce qui
      // les rend éphémères. Fermer Orbit les efface, comme des onglets de
      // navigation privée. Tout le reste de l'état est enregistré comme avant.
      partialize: (state) => {
        const { flyPages: _flyPages, ...rest } = state;
        return rest;
      },
      // v9 : nouveaux réglages (en-tête configurable, horloge, météo,
      // minuteur, style des fenêtres secondaires).
      // v10 : sons du minuteur + volume global. Le bump de version suffit :
      // la fusion avec `defaultSettings` en tête de `migrate` les ajoute aux
      // installations existantes.
      // v13 : page d'accueil (`settings.home`). Ajoutée par la même fusion —
      // les installations existantes ont un `home` par défaut (fond accent).
      // v14 : dossiers d'applications (`folders`) + pliage de la liste des
      // profils. Rien à convertir : une installation existante n'a simplement
      // aucun dossier, et la liste des profils démarre repliée.
      // v15 : app native « Téléphone ». Rien à convertir non plus — on l'ajoute
      // si elle manque, avec `scope: 'all'` pour qu'elle suive dans tous les
      // profils. L'appartenir au profil actif évite qu'une installation neuve
      // la crée dans un profil verrouillé.
      // v16 : historique des conversations de l’assistant (`assistantSessions`).
      // Une installation existante démarre simplement avec un historique vide.
      version: 16,
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
        // v11 : masquage automatique par zone. L'ancien interrupteur
        // `autoHideTopbar` existait dans les réglages mais n'était lu nulle
        // part — s'il était activé, on honore enfin l'intention.
        if (version < 11) {
          const legacy = Boolean(next.settings?.autoHideTopbar);
          const { autoHideTopbar: _drop, ...rest } = next.settings || {};
          next = {
            ...next,
            settings: { ...rest, autoHide: { top: legacy, left: false, bottom: false } },
          };
        }
        // v12 : source des identifiants unifiée. Avant, seul KeePassXC avait
        // un interrupteur (`keepass.enabled`) et le coffre intégré était
        // toujours interrogé. On traduit l'ancien état sans rien perdre :
        // KeePassXC coupé → coffre seul, sinon les deux.
        if (version < 12) {
          const kpOff = next.settings?.keepass?.enabled === false;
          next = {
            ...next,
            settings: {
              ...next.settings,
              credentials: { source: kpOff ? 'vault' : 'both' },
            },
          };
        }
        // v14 : dossiers d'applications. On garantit un tableau (des données
        // restaurées à la main pourraient l'avoir perdu) et des `folderId`
        // pointant sur un dossier existant — sinon une app se retrouverait
        // rangée « nulle part » sans que rien ne l'explique.
        if (version < 14) {
          const folders = Array.isArray(next.folders) ? next.folders : [];
          const known = new Set(folders.map((f) => f?.id));
          next = {
            ...next,
            folders,
            sidebarProfilesOpen: false,
            // Une app rangée dans un dossier introuvable redevient libre :
            // sans ce nettoyage elle s'afficherait « nulle part ».
            apps: (next.apps || []).map((a) =>
              a.folderId && !known.has(a.folderId) ? withoutFolderId(a) : a
            ),
          };
        }
        // v15 : le Téléphone n'est plus une app du sidebar. On retire toute
        // app native restée d'un état antérieur ; `nativeApps` (capacités des
        // extensions) est réconcilié au démarrage par `syncNativeApps`.
        if (version < 15) {
          const stripped = stripNativeApps(next.apps);
          next = {
            ...next,
            apps: stripped ? stripped.apps : next.apps || [],
            nativeApps: [],
          };
        }
        // v16 : une session aux données abîmées ne doit pas faire planter la
        // fenêtre de discussion au démarrage — on garantit un tableau.
        if (version < 16) {
          next = {
            ...next,
            assistantSessions: Array.isArray(next.assistantSessions)
              ? next.assistantSessions
              : [],
          };
        }
        return next;
      },
    }
  )
);
