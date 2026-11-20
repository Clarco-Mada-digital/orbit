// ---------------------------------------------------------------------------
// Recettes : des automatisations toutes prêtes, à un clic.
//
// Une recette ne s'enregistre pas d'elle-même : elle OUVRE l'éditeur pré-
// rempli, pour qu'on choisisse l'app ou le profil concerné avant de valider.
// `build(ctx)` reçoit { apps, profiles, workspaces } et devine des valeurs
// raisonnables (le deuxième profil pour « Travail », la première app…).
// Module SANS DÉPENDANCE.
// ---------------------------------------------------------------------------
const WEEKDAYS = [1, 2, 3, 4, 5];

const firstApp = (ctx) => ctx.apps[0]?.id || '';
const secondApp = (ctx) => ctx.apps[1]?.id || '';
const workProfile = (ctx) => (ctx.profiles[1] || ctx.profiles[0])?.id || '';
const homeProfile = (ctx) => ctx.profiles[0]?.id || '';

export const RECIPES = [
  {
    id: 'morning',
    icon: 'Sunrise',
    build: (ctx) => ({
      trigger: 'time',
      at: '09:00',
      conditions: { days: WEEKDAYS },
      actions: [
        { type: 'switchProfile', profileId: workProfile(ctx) },
        { type: 'openApp', appId: firstApp(ctx) },
      ],
    }),
  },
  {
    id: 'evening',
    icon: 'Sunset',
    build: (ctx) => ({
      trigger: 'time',
      at: '18:30',
      conditions: { days: WEEKDAYS },
      actions: [
        { type: 'sleepOthers' },
        { type: 'switchProfile', profileId: homeProfile(ctx) },
      ],
    }),
  },
  {
    id: 'focus',
    icon: 'Target',
    build: () => ({
      trigger: 'time',
      at: '09:30',
      conditions: { days: WEEKDAYS },
      actions: [
        { type: 'setDnd', on: true },
        { type: 'sleepOthers' },
        { type: 'notify', title: 'Focus', body: '' },
      ],
    }),
  },
  {
    id: 'focusEnd',
    icon: 'Coffee',
    build: () => ({
      trigger: 'time',
      at: '12:00',
      conditions: { days: WEEKDAYS },
      actions: [{ type: 'setDnd', on: false }],
    }),
  },
  {
    id: 'darkEvening',
    icon: 'Moon',
    build: () => ({ trigger: 'time', at: '20:00', actions: [{ type: 'setThemeMode', mode: 'dark' }] }),
  },
  {
    id: 'lightMorning',
    icon: 'Sun',
    build: () => ({ trigger: 'time', at: '07:30', actions: [{ type: 'setThemeMode', mode: 'light' }] }),
  },
  {
    id: 'refresh',
    icon: 'RefreshCw',
    build: (ctx) => ({
      trigger: 'interval',
      every: 15,
      actions: [{ type: 'reloadApp', appId: firstApp(ctx) }],
    }),
  },
  {
    id: 'memory',
    icon: 'MemoryStick',
    build: () => ({ trigger: 'interval', every: 60, actions: [{ type: 'sleepOthers' }] }),
  },
  {
    id: 'reconnect',
    icon: 'Wifi',
    build: () => ({
      trigger: 'online',
      actions: [
        { type: 'reloadApp', appId: '@active' },
        { type: 'notify', title: 'Orbit', body: '' },
      ],
    }),
  },
  {
    id: 'startup',
    icon: 'Rocket',
    build: (ctx) => ({
      trigger: 'startup',
      actions: ctx.apps.length >= 2
        ? [{ type: 'split', appIds: [firstApp(ctx), secondApp(ctx)], direction: 'row' }]
        : [{ type: 'openApp', appId: firstApp(ctx) }],
    }),
  },
  {
    id: 'unreadAlert',
    icon: 'BellRing',
    build: (ctx) => ({
      trigger: 'unread',
      appId: firstApp(ctx),
      conditions: { days: WEEKDAYS, between: { from: '09:00', to: '18:00' } },
      actions: [{ type: 'notify', title: 'Orbit', body: '' }],
    }),
  },
  {
    id: 'workspace',
    icon: 'LayoutGrid',
    build: (ctx) => ({
      trigger: 'profileSwitch',
      profileId: workProfile(ctx),
      actions: ctx.workspaces[0]
        ? [{ type: 'applyWorkspace', workspaceId: ctx.workspaces[0].id }]
        : [{ type: 'openApp', appId: firstApp(ctx) }],
    }),
  },
];
