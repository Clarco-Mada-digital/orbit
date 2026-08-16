// ---------------------------------------------------------------------------
// i18n léger, sans dépendance. Dictionnaires fr/en + hook réactif useT().
//
// Usage : const t = useT(); t('welcome.title'); t('key', { name: 'X' })
// La langue vient de settings.language ('auto' | 'fr' | 'en') ; 'auto' se base
// sur la langue du système. Le fr sert toujours de repli.
//
// La migration des chaînes se fait composant par composant : toute clé absente
// retombe sur le français, donc rien ne casse en cours de route.
// ---------------------------------------------------------------------------
import { useStore } from '../stores/useStore';

export const fr = {
  // Général
  'common.cancel': 'Annuler',
  'common.save': 'Enregistrer',
  'common.close': 'Fermer',
  'common.start': 'Commencer',

  // Bienvenue (onboarding)
  'welcome.title': 'Bienvenue dans Orbit 🛰',
  'welcome.subtitle': 'Toutes vos apps web dans une seule fenêtre. Voici l’essentiel pour démarrer.',
  'welcome.apps.title': 'Ajoutez vos apps',
  'welcome.apps.text': 'Bouton « + » de la barre latérale → choisissez parmi le catalogue ou une URL.',
  'welcome.profiles.title': 'Profils & comptes',
  'welcome.profiles.text':
    'Séparez pro et perso ; les conteneurs permettent plusieurs comptes d’un même service.',
  'welcome.palette.title': 'Palette de commandes',
  'welcome.palette.text':
    'Ctrl/Cmd + K : aller à une app, un espace, ou lancer une action. Tapez « help » pour les raccourcis.',
  'welcome.find.title': 'Rechercher dans la page',
  'welcome.find.text': 'Ctrl/Cmd + F cherche à l’intérieur de l’app affichée.',
  'welcome.context.title': 'Clic droit sur une app',
  'welcome.context.text': 'Veille, favori, fenêtre détachée, conteneur, effacer les données…',
  'welcome.cta.addApp': 'Ajouter ma première app',

  // À propos
  'about.tagline': 'Toutes vos apps web réunies dans une seule fenêtre — Windows, macOS et Linux.',
  'about.version': 'Version {version}',
  'about.github': 'GitHub',
  'about.releaseNotes': 'Notes de version',
  'about.checkUpdates': 'Vérifier les mises à jour',
  'about.checking': 'Vérification…',
  'about.features': 'Ce qu’Orbit sait faire',
  'about.tech': 'Technologies',

  // Mise à jour
  'update.ready': 'Mise à jour prête',
  'update.readyDesc': 'Redémarre Orbit pour l’installer.',
  'update.restart': 'Redémarrer et installer',
  'update.later': 'Plus tard',
  'update.downloading': 'Téléchargement de la mise à jour… {percent}%',
  'update.available': 'Mise à jour {version} disponible',

  // Réglages — langue
  'settings.language': 'Langue',
  'settings.language.auto': 'Automatique (système)',

  // Communs
  'common.remove': 'Supprimer',
  'common.settings': 'Paramètres',

  // Topbar
  'tb.back': 'Retour',
  'tb.forward': 'Avancer',
  'tb.reload': 'Actualiser',
  'tb.loading': 'Chargement…',
  'tb.zoomOut': 'Zoom arrière (Alt − / ⌘ −)',
  'tb.zoomReset': 'Réinitialiser le zoom (Alt 0 / ⌘ 0)',
  'tb.zoomIn': 'Zoom avant (Alt + / ⌘ +)',
  'tb.search': 'Rechercher des apps, onglets, actions... ⌘K',
  'tb.split': 'Écran partagé',
  'tb.sideBySide': 'Côte à côte',
  'tb.topBottom': 'Haut / bas',
  'tb.splitAddRemove': 'Cliquez pour ajouter ou retirer ({n}/4)',
  'tb.splitChoose': 'Choisissez une app à afficher en même temps',
  'tb.splitExit': 'Quitter le partage',
  'tb.workspaces': 'Espaces de travail',
  'tb.workspacesEmpty': 'Aucun espace. Enregistre la disposition actuelle ci-dessous.',
  'tb.saveLayout': 'Enregistrer la disposition actuelle',
  'tb.workspacePrompt': 'Nom de l’espace de travail :',
  'tb.workspaceDefault': 'Mon espace',
  'tb.favAdd': 'Ajouter aux favoris',
  'tb.favRemove': 'Retirer des favoris',
  'tb.notifications': 'Notifications',
  'tb.dnd': 'Ne pas déranger',
  'tb.dndOn': 'DND activé',
  'tb.readShort': 'Tout lire',
  'tb.noNotifications': 'Aucune notification',
  'tb.minimize': 'Réduire',
  'tb.maximize': 'Agrandir / Restaurer',

  // Sidebar
  'sb.manageProfiles': 'Gérer les profils',
  'sb.expand': 'Développer la sidebar',
  'sb.collapse': 'Réduire la sidebar',
  'sb.profiles': 'Profils',
  'sb.profileLocked': 'Profil verrouillé',
  'sb.favorites': 'Favoris',
  'sb.applications': 'Applications',
  'sb.noApps': 'Aucune application',
  'sb.sleeping': 'En veille',
  'sb.unmute': 'Réactiver le son',
  'sb.mute': 'Couper le son',
  'sb.notifMuted': 'Notifications coupées',
  'sb.store': 'Boutique d’applications',
  'sb.storeShort': 'Boutique',

  // Palette de commandes (QuickSwitcher)
  'qs.help': 'Aide & raccourcis',
  'qs.helpSub': 'Tout savoir sur les raccourcis clavier',
  'qs.settingsSub': 'Thème, polices, KeePassXC…',
  'qs.storeSub': 'Installer de nouvelles apps',
  'qs.profilesSub': 'Créer, renommer, supprimer des profils',
  'qs.sleep': 'Mettre « {name} » en veille',
  'qs.sleepSub': 'Fermer l’app pour économiser les ressources',
  'qs.zoomIn': 'Zoom avant',
  'qs.zoomInSub': 'Agrandir l’affichage de l’app active',
  'qs.zoomOut': 'Zoom arrière',
  'qs.zoomOutSub': 'Réduire l’affichage de l’app active',
  'qs.zoomReset': 'Réinitialiser le zoom',
  'qs.zoomResetSub': 'Revenir à 100 %',
  'qs.unsplit': 'Quitter le partage d’écran',
  'qs.unsplitSub': 'Revenir à une seule app affichée',
  'qs.readall': 'Tout marquer comme lu',
  'qs.readallSub': 'Effacer tous les badges de notifications',
  'qs.workspaceName': 'Espace : {name}',
  'qs.workspaceSub': 'Ouvrir cet espace de travail',
  'qs.switchProfile': 'Changer de profil',
  'qs.placeholder': 'Rechercher apps, profils, actions… (tapez « help » pour l’aide)',
  'qs.helpTitle': 'Aide & raccourcis clavier',
  'qs.helpSubtitle': 'Tout ce qu’il faut savoir pour aller vite dans Orbit',
  'qs.shortcutsLabel': 'Raccourcis clavier',
  'qs.noResults': 'Aucun résultat pour « {query} »',
  'qs.tryHelp': 'Essayez « help » pour l’aide des raccourcis',
  'qs.hintSelect': 'sélectionner',
  'qs.hintNavigate': 'naviguer',
  'qs.hintHelp': 'aide',
  'qs.hintClose': 'fermer',
  'qs.tips': 'Astuces',
  'qs.sidebarExpand': 'Étendre la sidebar',
  'qs.sidebarCollapse': 'Réduire la sidebar',
  'qs.sidebarExpandSub': 'Afficher les noms des apps',
  'qs.sidebarCollapseSub': 'Ne garder que les icônes',
  'qs.tip1': 'Clic droit sur une app : ouvrir, veille, renommer, modifier, désinstaller…',
  'qs.tip2': 'Glisser-déposer une app pour la réordonner dans la sidebar',
  'qs.tip3': 'Bouton ⧉ en haut : écran partagé (2 apps côte à côte ou haut / bas)',
  'qs.tip4': 'Tapez « help » ici pour revoir cette aide à tout moment',
};

export const en = {
  // General
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.close': 'Close',
  'common.start': 'Get started',

  // Welcome (onboarding)
  'welcome.title': 'Welcome to Orbit 🛰',
  'welcome.subtitle': 'All your web apps in a single window. Here are the essentials to get going.',
  'welcome.apps.title': 'Add your apps',
  'welcome.apps.text': 'The “+” button in the sidebar → pick from the catalog or enter a URL.',
  'welcome.profiles.title': 'Profiles & accounts',
  'welcome.profiles.text':
    'Separate work and personal; containers let you use several accounts of the same service.',
  'welcome.palette.title': 'Command palette',
  'welcome.palette.text':
    'Ctrl/Cmd + K: jump to an app, a workspace, or run an action. Type “help” for shortcuts.',
  'welcome.find.title': 'Find in page',
  'welcome.find.text': 'Ctrl/Cmd + F searches inside the current app.',
  'welcome.context.title': 'Right-click an app',
  'welcome.context.text': 'Sleep, favorite, detached window, container, clear data…',
  'welcome.cta.addApp': 'Add my first app',

  // About
  'about.tagline': 'All your web apps in one window — Windows, macOS and Linux.',
  'about.version': 'Version {version}',
  'about.github': 'GitHub',
  'about.releaseNotes': 'Release notes',
  'about.checkUpdates': 'Check for updates',
  'about.checking': 'Checking…',
  'about.features': 'What Orbit can do',
  'about.tech': 'Technologies',

  // Update
  'update.ready': 'Update ready',
  'update.readyDesc': 'Restart Orbit to install it.',
  'update.restart': 'Restart and install',
  'update.later': 'Later',
  'update.downloading': 'Downloading update… {percent}%',
  'update.available': 'Update {version} available',

  // Settings — language
  'settings.language': 'Language',
  'settings.language.auto': 'Automatic (system)',

  // Common
  'common.remove': 'Remove',
  'common.settings': 'Settings',

  // Topbar
  'tb.back': 'Back',
  'tb.forward': 'Forward',
  'tb.reload': 'Reload',
  'tb.loading': 'Loading…',
  'tb.zoomOut': 'Zoom out (Alt − / ⌘ −)',
  'tb.zoomReset': 'Reset zoom (Alt 0 / ⌘ 0)',
  'tb.zoomIn': 'Zoom in (Alt + / ⌘ +)',
  'tb.search': 'Search apps, tabs, actions... ⌘K',
  'tb.split': 'Split screen',
  'tb.sideBySide': 'Side by side',
  'tb.topBottom': 'Top / bottom',
  'tb.splitAddRemove': 'Click to add or remove ({n}/4)',
  'tb.splitChoose': 'Choose an app to show alongside',
  'tb.splitExit': 'Exit split',
  'tb.workspaces': 'Workspaces',
  'tb.workspacesEmpty': 'No workspace yet. Save the current layout below.',
  'tb.saveLayout': 'Save current layout',
  'tb.workspacePrompt': 'Workspace name:',
  'tb.workspaceDefault': 'My workspace',
  'tb.favAdd': 'Add to favorites',
  'tb.favRemove': 'Remove from favorites',
  'tb.notifications': 'Notifications',
  'tb.dnd': 'Do not disturb',
  'tb.dndOn': 'DND on',
  'tb.readShort': 'Read all',
  'tb.noNotifications': 'No notifications',
  'tb.minimize': 'Minimize',
  'tb.maximize': 'Maximize / Restore',

  // Sidebar
  'sb.manageProfiles': 'Manage profiles',
  'sb.expand': 'Expand sidebar',
  'sb.collapse': 'Collapse sidebar',
  'sb.profiles': 'Profiles',
  'sb.profileLocked': 'Profile locked',
  'sb.favorites': 'Favorites',
  'sb.applications': 'Applications',
  'sb.noApps': 'No application',
  'sb.sleeping': 'Sleeping',
  'sb.unmute': 'Unmute',
  'sb.mute': 'Mute',
  'sb.notifMuted': 'Notifications muted',
  'sb.store': 'App store',
  'sb.storeShort': 'Store',

  // Command palette (QuickSwitcher)
  'qs.help': 'Help & shortcuts',
  'qs.helpSub': 'Everything about keyboard shortcuts',
  'qs.settingsSub': 'Theme, fonts, KeePassXC…',
  'qs.storeSub': 'Install new apps',
  'qs.profilesSub': 'Create, rename, delete profiles',
  'qs.sleep': 'Put “{name}” to sleep',
  'qs.sleepSub': 'Close the app to save resources',
  'qs.zoomIn': 'Zoom in',
  'qs.zoomInSub': 'Enlarge the active app',
  'qs.zoomOut': 'Zoom out',
  'qs.zoomOutSub': 'Shrink the active app',
  'qs.zoomReset': 'Reset zoom',
  'qs.zoomResetSub': 'Back to 100%',
  'qs.unsplit': 'Exit split screen',
  'qs.unsplitSub': 'Back to a single app',
  'qs.readall': 'Mark all as read',
  'qs.readallSub': 'Clear all notification badges',
  'qs.workspaceName': 'Workspace: {name}',
  'qs.workspaceSub': 'Open this workspace',
  'qs.switchProfile': 'Switch profile',
  'qs.placeholder': 'Search apps, profiles, actions… (type “help” for help)',
  'qs.helpTitle': 'Help & keyboard shortcuts',
  'qs.helpSubtitle': 'Everything you need to move fast in Orbit',
  'qs.shortcutsLabel': 'Keyboard shortcuts',
  'qs.noResults': 'No result for “{query}”',
  'qs.tryHelp': 'Try “help” for shortcut help',
  'qs.hintSelect': 'select',
  'qs.hintNavigate': 'navigate',
  'qs.hintHelp': 'help',
  'qs.hintClose': 'close',
  'qs.tips': 'Tips',
  'qs.sidebarExpand': 'Expand sidebar',
  'qs.sidebarCollapse': 'Collapse sidebar',
  'qs.sidebarExpandSub': 'Show app names',
  'qs.sidebarCollapseSub': 'Keep icons only',
  'qs.tip1': 'Right-click an app: open, sleep, rename, edit, uninstall…',
  'qs.tip2': 'Drag and drop an app to reorder it in the sidebar',
  'qs.tip3': 'The ⧉ button at the top: split screen (2 apps side by side or top/bottom)',
  'qs.tip4': 'Type “help” here to see this help again anytime',
};

const dicts = { fr, en };

export function resolveLang(setting) {
  if (setting === 'fr' || setting === 'en') return setting;
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'fr')
    .toLowerCase();
  return nav.startsWith('en') ? 'en' : 'fr';
}

export function translate(lang, key, vars) {
  const d = dicts[lang] || dicts.fr;
  let s = d[key] ?? dicts.fr[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.split(`{${k}}`).join(String(vars[k]));
    }
  }
  return s;
}

// Hook réactif : se re-rend quand la langue (settings.language) change.
export function useT() {
  const setting = useStore((s) => s.settings?.language);
  const lang = resolveLang(setting);
  return (key, vars) => translate(lang, key, vars);
}
