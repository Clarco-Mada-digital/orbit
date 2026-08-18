// ---------------------------------------------------------------------------
// Composition de l'en-tête : QUOI afficher et OÙ (gauche / centre / droite).
//
// L'ordre du tableau = l'ordre à l'écran. Les contrôles de fenêtre
// (réduire / agrandir / fermer) ne sont pas configurables : ils restent
// collés à droite, comme dans n'importe quel système.
// ---------------------------------------------------------------------------

export const TOPBAR_ZONES = ['left', 'center', 'right'];

// Disposition d'origine — celle d'Orbit avant que l'en-tête ne devienne
// configurable, pour que rien ne bouge à la mise à jour.
export const DEFAULT_TOPBAR = {
  left: ['logo', 'nav', 'appTitle', 'zoom'],
  center: ['search'],
  right: ['extensions', 'split', 'workspaces', 'favorite', 'nowPlaying', 'downloads', 'notifications'],
};

// Catalogue complet. `labelKey` / `descKey` sont des clés i18n.
export const TOPBAR_MODULES = [
  { id: 'logo', labelKey: 'tbm.logo', descKey: 'tbm.logo.desc' },
  { id: 'nav', labelKey: 'tbm.nav', descKey: 'tbm.nav.desc' },
  { id: 'appTitle', labelKey: 'tbm.appTitle', descKey: 'tbm.appTitle.desc' },
  { id: 'zoom', labelKey: 'tbm.zoom', descKey: 'tbm.zoom.desc' },
  { id: 'search', labelKey: 'tbm.search', descKey: 'tbm.search.desc' },
  { id: 'profile', labelKey: 'tbm.profile', descKey: 'tbm.profile.desc' },
  { id: 'extensions', labelKey: 'tbm.extensions', descKey: 'tbm.extensions.desc' },
  { id: 'split', labelKey: 'tbm.split', descKey: 'tbm.split.desc' },
  { id: 'workspaces', labelKey: 'tbm.workspaces', descKey: 'tbm.workspaces.desc' },
  { id: 'favorite', labelKey: 'tbm.favorite', descKey: 'tbm.favorite.desc' },
  { id: 'nowPlaying', labelKey: 'tbm.nowPlaying', descKey: 'tbm.nowPlaying.desc' },
  { id: 'downloads', labelKey: 'tbm.downloads', descKey: 'tbm.downloads.desc' },
  { id: 'notifications', labelKey: 'tbm.notifications', descKey: 'tbm.notifications.desc' },
  { id: 'clock', labelKey: 'tbm.clock', descKey: 'tbm.clock.desc' },
  { id: 'weather', labelKey: 'tbm.weather', descKey: 'tbm.weather.desc' },
  { id: 'battery', labelKey: 'tbm.battery', descKey: 'tbm.battery.desc' },
  { id: 'focus', labelKey: 'tbm.focus', descKey: 'tbm.focus.desc' },
  { id: 'system', labelKey: 'tbm.system', descKey: 'tbm.system.desc' },
  { id: 'divider', labelKey: 'tbm.divider', descKey: 'tbm.divider.desc', repeatable: true },
];

const MODULE_IDS = new Set(TOPBAR_MODULES.map((m) => m.id));
const REPEATABLE = new Set(TOPBAR_MODULES.filter((m) => m.repeatable).map((m) => m.id));

export const moduleById = (id) => TOPBAR_MODULES.find((m) => m.id === id) || null;

// Nettoie une disposition venue du disque : ids inconnus supprimés (une
// version antérieure a pu en enregistrer), doublons retirés (sauf séparateurs),
// zones manquantes complétées.
export function normalizeTopbar(layout) {
  const seen = new Set();
  const out = {};
  for (const zone of TOPBAR_ZONES) {
    const list = Array.isArray(layout?.[zone]) ? layout[zone] : DEFAULT_TOPBAR[zone];
    out[zone] = list.filter((id) => {
      if (!MODULE_IDS.has(id)) return false;
      if (REPEATABLE.has(id)) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  return out;
}

// Modules encore disponibles (pas déjà placés), pour le menu « Ajouter »
export function availableModules(layout) {
  const used = new Set(TOPBAR_ZONES.flatMap((z) => layout[z] || []));
  return TOPBAR_MODULES.filter((m) => m.repeatable || !used.has(m.id));
}
