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
