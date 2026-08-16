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

  // Communs (dialogues)
  'common.edit': 'Éditer',
  'common.delete': 'Supprimer',
  'common.back': 'Retour',
  'common.uninstall': 'Désinstaller',

  // Rechercher dans la page
  'find.placeholder': 'Rechercher dans la page…',
  'find.prev': 'Précédent (Maj+Entrée)',
  'find.next': 'Suivant (Entrée)',
  'find.close': 'Fermer (Échap)',

  // Verrouillage
  'lock.setTitle': 'Définir un code',
  'lock.lockedTitle': 'Orbit est verrouillé',
  'lock.confirm': 'Confirmez le code',
  'lock.choose': 'Choisissez un code (chiffres ou texte)',
  'lock.enter': 'Entrez votre code pour continuer',
  'lock.clear': 'Effacer',
  'lock.validate': 'Valider',
  'lock.tooShort': 'Code trop court (4 caractères minimum)',
  'lock.tooShort2': 'Code trop court',
  'lock.mismatch': 'Les deux codes ne correspondent pas',
  'lock.wrong': 'Code incorrect',

  // Menu contextuel d'app
  'ctx.open': 'Ouvrir',
  'ctx.wake': 'Réveiller',
  'ctx.sleep': 'Mettre en veille',
  'ctx.unmute': 'Réactiver les notifications',
  'ctx.mute': 'Couper les notifications',
  'ctx.rename': 'Renommer l’application',
  'ctx.editApp': 'Modifier (icône, URL, couleur…)',
  'ctx.openWindow': 'Ouvrir dans une fenêtre',
  'ctx.openBrowser': 'Ouvrir dans le navigateur',
  'ctx.moveProfile': 'Déplacer vers un profil',
  'ctx.container': 'Conteneur (multi-comptes)',
  'ctx.clearData': 'Effacer les données du site',
  'ctx.more': 'Voir plus…',
  'ctx.less': 'Voir moins',
  'ctx.newName': 'Nouveau nom…',
  'ctx.noOtherProfile': 'Aucun autre profil',
  'ctx.moveTo': 'Déplacer « {name} » vers :',
  'ctx.containerOf': 'Conteneur de « {name} »',
  'ctx.none': 'Aucun',
  'ctx.newContainer': 'Nouveau conteneur…',
  'ctx.createAssign': 'Créer & assigner',
  'ctx.confirmUninstall':
    'Désinstaller « {name} » ?\nL’application ira dans la corbeille (Boutique → Corbeille) et pourra être restaurée avec sa session.',
  'ctx.confirmClear':
    'Effacer les données de « {name} » ?\nCookies, cache et connexion seront supprimés, et l’app se rechargera.',

  // Gestion des profils
  'pm.title': 'Gestion des profils',
  'pm.namePlaceholder': 'Nom du profil',
  'pm.emoji': 'Emoji',
  'pm.color': 'Couleur',
  'pm.proxyLabel': 'Proxy / VPN de ce profil (vide = réglage global)',
  'pm.active': '✓ Actif',
  'pm.shareLabel': 'Partager les connexions (SSO navigateur)',
  'pm.accentLabel':
    'Couleur d’accent du profil (active « Accent par profil » dans Réglages → Apparence)',
  'pm.activate': 'Activer',
  'pm.create': 'Créer',
  'pm.newProfile': 'Nouveau profil',
  'pm.needOne': 'Vous devez avoir au moins un profil !',
  'pm.confirmDelete':
    'Êtes-vous sûr de vouloir supprimer ce profil ? Toutes les apps associées seront supprimées.',
  'pm.confirmShared':
    'Partager les connexions dans « {name} » ?\n\nLes apps de ce profil partageront un seul compte par service, comme un navigateur : connectez-vous à Google une fois → Gmail, YouTube, Drive suivent (fini la 2FA à répéter).\n\nÀ savoir : les apps vont se recharger et il faudra vous reconnecter une fois. Ce mode empêche d’avoir 2 comptes du même service dans ce profil.',

  // Modale d'édition d'app
  'edit.title': 'Modifier « {name} »',
  'edit.name': 'Nom',
  'edit.urlPlaceholder': 'exemple.com',
  'edit.icon': 'Icône',
  'edit.color': 'Couleur',
  'edit.image': 'Image…',
  'edit.uploadTitle': 'Téléverser votre propre image',
  'edit.faviconTitle': 'Utiliser le favicon du site',
  'edit.removeImage': 'Retirer l’image téléversée',
  'edit.proxyLabel': 'Proxy / VPN (vide = suit le profil / le global)',

  // Boutique d'applications
  'store.available': '{n} applications disponibles',
  'store.searchPlaceholder': 'Rechercher une application...',
  'store.addTitle': 'Ajouter une application qui n’est pas dans la liste',
  'store.addApp': 'Ajouter une app',
  'store.all': 'Toutes',
  'store.customTitle': 'Ajouter une application personnalisée',
  'store.customDesc': 'N’importe quel site web peut devenir une application Orbit',
  'store.namePlaceholder': 'Ex : Mon tableau de bord',
  'store.image': 'Image',
  'store.removeImage': 'Retirer l’image',
  'store.faviconTitle': 'Utiliser le favicon du site à la place de l’emoji',
  'store.faviconSite': 'Favicon du site',
  'store.faviconHint': 'Entrez une URL valide pour prévisualiser le favicon',
  'store.add': 'Ajouter',
  'store.trash': 'Corbeille',
  'store.emptyTrash': 'Vider la corbeille',
  'store.confirmEmptyTrash':
    'Vider la corbeille ? Les apps et leurs sessions seront supprimées définitivement.',
  'store.restore': 'Restaurer (avec sa session)',
  'store.deleteForever': 'Supprimer définitivement',
  'store.installedOne': '✓ {n} compte installé',
  'store.installedMany': '✓ {n} comptes installés',
  'store.addAccountTitle': 'Ajouter un autre compte (session séparée)',
  'store.account': 'Compte',
  'store.uninstallAccountTitle': 'Désinstaller un compte',
  'store.install': 'Installer',
  'store.noApps': 'Aucune application trouvée',

  // Réglages — onglets
  'st.tab.general': 'Général',
  'st.tab.appearance': 'Apparence',
  'st.tab.display': 'Affichage',
  'st.tab.profiles': 'Profils',
  'st.tab.shortcuts': 'Raccourcis',
  'st.tab.extensions': 'Extensions',
  'st.tab.security': 'Sécurité',
  'st.tab.privacy': 'Confidentialité',
  'st.tab.backup': 'Sauvegarde',
  'st.tab.notifications': 'Notifications',
  'st.tab.about': 'À propos',

  // Réglages — mises à jour
  'st.upd.unsupported': "Mise à jour auto indisponible dans ce mode (dispo uniquement sur l'AppImage).",
  'st.upd.cantCheck': 'Impossible de vérifier pour le moment.',
  'st.upd.available': 'Version {version} disponible — téléchargement en cours…',
  'st.upd.upToDate': 'Orbit est à jour.',
  'st.upd.check': 'Rechercher les mises à jour',
  'st.updates': 'Mises à jour',
  'st.installedVersion': 'Version installée :',

  // Réglages — Général
  'st.startup': 'Démarrage',
  'st.startMinimized': 'Démarrer minimisé',
  'st.startupApp': 'Application au démarrage',
  'st.resumeLast': 'Reprendre la dernière app',
  'st.startupNone': "Aucune (écran d'accueil)",
  'st.tray': 'Barre système (tray)',
  'st.closeToTray': 'Réduire dans la barre système',
  'st.closeToTrayDesc': 'Fermer la fenêtre garde Orbit en fond (icône du tray) au lieu de quitter',
  'st.globalHotkey': "Raccourci global d'invocation",
  'st.globalHotkeyDesc': "Afficher / masquer Orbit depuis n'importe où",
  'st.hotkeyUnavailable':
    'Ce raccourci est indisponible (déjà utilisé par le système ?). Essayez-en un autre, ex. CommandOrControl+Shift+O.',
  'st.hotkeyUnavailable2': 'Ce raccourci est indisponible. Essayez une autre combinaison.',
  'st.interface': 'Interface',
  'st.hideTopbar': 'Masquer la barre supérieure',
  'st.hideTopbarDesc': 'En mode plein écran',
  'st.autoPip': 'Picture-in-Picture automatique',
  'st.autoPipDesc': "Sort la vidéo en mini-fenêtre flottante quand vous changez d'app",
  'st.mediaKeys': 'Touches média du clavier',
  'st.mediaKeysDesc': "Les touches ⏯ ⏭ ⏮ pilotent la lecture en cours (même hors d'Orbit)",
  'st.resources': 'Ressources',
  'st.resourcesDesc':
    "Met en veille les apps inactives pour libérer la mémoire. L'app active, l'écran partagé et les apps qui jouent un son ne sont jamais mises en veille.",
  'st.autoSleep': 'Mise en veille automatique',
  'st.sleepOff': 'Désactivée',
  'st.sleep15': 'Après 15 minutes',
  'st.sleep30': 'Après 30 minutes',
  'st.sleep60': 'Après 1 heure',
  'st.sleep120': 'Après 2 heures',

  // Réglages — Affichage
  'st.fontSize': 'Taille de police',
  'st.small': 'Petite',
  'st.medium': 'Moyenne',
  'st.large': 'Grande',
  'st.xlarge': 'Très grande',
  'st.fontFamily': 'Police de caractères',
  'st.fontFamilyDesc': "Le changement s'applique instantanément à toute l'interface",
  'st.uiZoom': "Zoom de l'interface",
  'st.displayOptions': "Options d'affichage",
  'st.compact': 'Mode compact',
  'st.compactDesc': "Réduit l'espacement entre les éléments",
  'st.animations': 'Animations',
  'st.animationsDesc': 'Active les transitions et animations',
  'st.appIcons': "Icônes d'applications",
  'st.appIconsDesc': 'Affiche les icônes colorées dans la sidebar',

  // Réglages — Apparence
  'st.theme': 'Thème',
  'st.themeDark': '🌙 Sombre',
  'st.themeLight': '☀️ Clair',
  'st.themeAuto': '🌓 Auto',
  'st.accentColor': "Couleur d'accent",
  'st.accentPerProfile': 'Accent par profil',
  'st.accentPerProfileDesc':
    "L'accent suit la couleur choisie pour chaque profil (dans Profils → chaque profil a sa palette). Repère visuel pro / perso.",

  // Réglages — Profils
  'st.profilesDesc': 'Créez et gérez vos espaces de travail',
  'st.manage': 'Gérer',
  'st.profilesDesc2':
    'Les profils vous permettent de séparer vos applications en espaces distincts (Travail, Personnel, Projets, etc.)',

  // Réglages — Confidentialité
  'st.adblockTitle': 'Bloqueur de pub & traceurs',
  'st.adblockDesc':
    'Blocage natif intégré (listes type EasyList), au niveau réseau, pour toutes les apps et tous les profils — sans extension. Plus efficace et fiable que les extensions de blocage, qui ne fonctionnent pas dans Orbit.',
  'st.adblockEnable': 'Activer le blocage',
  'st.adblockEnableDesc': 'Bloque les publicités et traceurs connus',
  'st.adblockHint':
    "Après changement, rechargez une app déjà ouverte (bouton ⟳) pour que l'effet s'applique. La première activation télécharge les listes (puis elles sont mises en cache, y compris hors-ligne).",
  'st.proxyTitle': 'Proxy / VPN',
  'st.proxyDesc':
    'Fait passer le trafic par un proxy (SOCKS5 ou HTTP) — pratique pour utiliser un VPN. Proxy global ici ; surchargeable par profil (Profils) et par app (clic droit → Modifier). Vide = connexion directe.',
  'st.proxyHint':
    "Ex. socks5://host:port, http://host:port, ou avec identifiants socks5://user:pass@host:port. SOCKS5 d'un VPN, proxy local (Mullvad), ou votre propre serveur. Rechargez l'app après changement.",
  'st.translateTitle': 'Traduction & lecture vocale',
  'st.translateDesc':
    'Clic droit sur une page → « Traduire la sélection » ou « Lire à voix haute » (intégré, sans extension).',
  'st.translateLang': 'Langue de traduction',
  'st.lang.fr': 'Français',
  'st.lang.en': 'Anglais',
  'st.lang.es': 'Espagnol',
  'st.lang.de': 'Allemand',
  'st.lang.it': 'Italien',
  'st.lang.pt': 'Portugais',
  'st.lang.ar': 'Arabe',
  'st.lang.zh': 'Chinois (simplifié)',
  'st.lang.ru': 'Russe',
  'st.lang.ja': 'Japonais',
  'st.translateEngine': 'Moteur de traduction',
  'st.engineGoogleDesc': 'Rapide, sans configuration',
  'st.engineLibreDesc': 'Privé / auto-hébergé',
  'st.libreUrlPlaceholder': 'URL du serveur (ex. http://localhost:5000)',
  'st.libreKeyPlaceholder': 'Clé API (optionnelle)',
  'st.libreHint':
    'LibreTranslate est open-source et auto-hébergeable (Docker : libretranslate/libretranslate). Avec un serveur local, vos textes ne quittent pas votre machine.',
  'st.googleHint':
    'Le moteur Google envoie le texte sélectionné à Google pour la traduction. Pour un traitement privé, choisissez LibreTranslate.',

  // Réglages — Notifications
  'st.notifSystem': 'Notifications système',
  'st.notifSystemDesc':
    "Affiche une notification système quand une app reçoit de nouveaux messages (sauf si elle est ouverte ou en veille)",
  'st.dndNow': 'Activer maintenant',
  'st.dndNowDesc': 'Coupe toutes les notifications',
  'st.quietHours': 'Plages horaires silencieuses',
  'st.quietHoursDesc': 'Coupe automatiquement les notifications sur une plage (ex. la nuit)',
  'st.from': 'De',
  'st.to': 'à',
  'st.notifSound': 'Son de notification',
  'st.notifSoundDesc': "Personnalisez le son joué à la réception d'un message. Vide = son système.",
  'st.customSound': 'Son personnalisé',
  'st.systemSound': 'Son système (par défaut)',
  'st.chooseSound': 'Choisir un son…',
  'st.testSound': 'Tester',
  'st.defaultSound': 'Par défaut',
  'st.soundTooHeavy': 'Son trop lourd (max 1 Mo). Choisissez un son court.',
  'st.notifCenter': 'Centre de notifications',
  'st.notifCenterDesc':
    'Cliquez sur la cloche 🔔 dans la barre supérieure pour voir toutes vos apps avec des messages non lus et y accéder en un clic.',

  // Réglages — À propos
  'st.license': 'Licence',
  'st.licenseText': 'Orbit est un logiciel open-source sous licence MIT.',
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

  // Common (dialogs)
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.back': 'Back',
  'common.uninstall': 'Uninstall',

  // Find in page
  'find.placeholder': 'Find in page…',
  'find.prev': 'Previous (Shift+Enter)',
  'find.next': 'Next (Enter)',
  'find.close': 'Close (Esc)',

  // Lock
  'lock.setTitle': 'Set a code',
  'lock.lockedTitle': 'Orbit is locked',
  'lock.confirm': 'Confirm the code',
  'lock.choose': 'Choose a code (digits or text)',
  'lock.enter': 'Enter your code to continue',
  'lock.clear': 'Clear',
  'lock.validate': 'Confirm',
  'lock.tooShort': 'Code too short (4 characters minimum)',
  'lock.tooShort2': 'Code too short',
  'lock.mismatch': 'The two codes do not match',
  'lock.wrong': 'Wrong code',

  // App context menu
  'ctx.open': 'Open',
  'ctx.wake': 'Wake up',
  'ctx.sleep': 'Put to sleep',
  'ctx.unmute': 'Enable notifications',
  'ctx.mute': 'Mute notifications',
  'ctx.rename': 'Rename application',
  'ctx.editApp': 'Edit (icon, URL, color…)',
  'ctx.openWindow': 'Open in a window',
  'ctx.openBrowser': 'Open in browser',
  'ctx.moveProfile': 'Move to a profile',
  'ctx.container': 'Container (multi-account)',
  'ctx.clearData': 'Clear site data',
  'ctx.more': 'Show more…',
  'ctx.less': 'Show less',
  'ctx.newName': 'New name…',
  'ctx.noOtherProfile': 'No other profile',
  'ctx.moveTo': 'Move “{name}” to:',
  'ctx.containerOf': 'Container of “{name}”',
  'ctx.none': 'None',
  'ctx.newContainer': 'New container…',
  'ctx.createAssign': 'Create & assign',
  'ctx.confirmUninstall':
    'Uninstall “{name}”?\nThe app will go to the trash (Store → Trash) and can be restored with its session.',
  'ctx.confirmClear':
    'Clear data for “{name}”?\nCookies, cache and login will be removed, and the app will reload.',

  // Profile manager
  'pm.title': 'Manage profiles',
  'pm.namePlaceholder': 'Profile name',
  'pm.emoji': 'Emoji',
  'pm.color': 'Color',
  'pm.proxyLabel': 'Proxy / VPN for this profile (empty = global setting)',
  'pm.active': '✓ Active',
  'pm.shareLabel': 'Share logins (browser SSO)',
  'pm.accentLabel':
    'Profile accent color (enable “Accent per profile” in Settings → Appearance)',
  'pm.activate': 'Activate',
  'pm.create': 'Create',
  'pm.newProfile': 'New profile',
  'pm.needOne': 'You must have at least one profile!',
  'pm.confirmDelete':
    'Are you sure you want to delete this profile? All associated apps will be deleted.',
  'pm.confirmShared':
    'Share logins in “{name}”?\n\nApps in this profile will share a single account per service, like a browser: sign in to Google once → Gmail, YouTube, Drive follow (no more repeated 2FA).\n\nNote: apps will reload and you’ll need to sign in once. This mode prevents having 2 accounts of the same service in this profile.',

  // Edit app modal
  'edit.title': 'Edit “{name}”',
  'edit.name': 'Name',
  'edit.urlPlaceholder': 'example.com',
  'edit.icon': 'Icon',
  'edit.color': 'Color',
  'edit.image': 'Image…',
  'edit.uploadTitle': 'Upload your own image',
  'edit.faviconTitle': 'Use the site favicon',
  'edit.removeImage': 'Remove uploaded image',
  'edit.proxyLabel': 'Proxy / VPN (empty = follows profile / global)',

  // App store
  'store.available': '{n} apps available',
  'store.searchPlaceholder': 'Search for an app...',
  'store.addTitle': 'Add an app that is not in the list',
  'store.addApp': 'Add an app',
  'store.all': 'All',
  'store.customTitle': 'Add a custom app',
  'store.customDesc': 'Any website can become an Orbit app',
  'store.namePlaceholder': 'e.g. My dashboard',
  'store.image': 'Image',
  'store.removeImage': 'Remove image',
  'store.faviconTitle': 'Use the site favicon instead of the emoji',
  'store.faviconSite': 'Site favicon',
  'store.faviconHint': 'Enter a valid URL to preview the favicon',
  'store.add': 'Add',
  'store.trash': 'Trash',
  'store.emptyTrash': 'Empty trash',
  'store.confirmEmptyTrash':
    'Empty the trash? The apps and their sessions will be permanently deleted.',
  'store.restore': 'Restore (with its session)',
  'store.deleteForever': 'Delete permanently',
  'store.installedOne': '✓ {n} account installed',
  'store.installedMany': '✓ {n} accounts installed',
  'store.addAccountTitle': 'Add another account (separate session)',
  'store.account': 'Account',
  'store.uninstallAccountTitle': 'Uninstall an account',
  'store.install': 'Install',
  'store.noApps': 'No app found',

  // Settings — tabs
  'st.tab.general': 'General',
  'st.tab.appearance': 'Appearance',
  'st.tab.display': 'Display',
  'st.tab.profiles': 'Profiles',
  'st.tab.shortcuts': 'Shortcuts',
  'st.tab.extensions': 'Extensions',
  'st.tab.security': 'Security',
  'st.tab.privacy': 'Privacy',
  'st.tab.backup': 'Backup',
  'st.tab.notifications': 'Notifications',
  'st.tab.about': 'About',

  // Settings — updates
  'st.upd.unsupported': 'Auto-update unavailable in this mode (AppImage only).',
  'st.upd.cantCheck': 'Unable to check right now.',
  'st.upd.available': 'Version {version} available — downloading…',
  'st.upd.upToDate': 'Orbit is up to date.',
  'st.upd.check': 'Check for updates',
  'st.updates': 'Updates',
  'st.installedVersion': 'Installed version:',

  // Settings — General
  'st.startup': 'Startup',
  'st.startMinimized': 'Start minimized',
  'st.startupApp': 'App on startup',
  'st.resumeLast': 'Resume last app',
  'st.startupNone': 'None (home screen)',
  'st.tray': 'System tray',
  'st.closeToTray': 'Minimize to system tray',
  'st.closeToTrayDesc': 'Closing the window keeps Orbit in the background (tray icon) instead of quitting',
  'st.globalHotkey': 'Global summon shortcut',
  'st.globalHotkeyDesc': 'Show / hide Orbit from anywhere',
  'st.hotkeyUnavailable':
    'This shortcut is unavailable (already used by the system?). Try another one, e.g. CommandOrControl+Shift+O.',
  'st.hotkeyUnavailable2': 'This shortcut is unavailable. Try another combination.',
  'st.interface': 'Interface',
  'st.hideTopbar': 'Hide the top bar',
  'st.hideTopbarDesc': 'In fullscreen mode',
  'st.autoPip': 'Automatic Picture-in-Picture',
  'st.autoPipDesc': 'Pops the video into a floating mini-window when you switch apps',
  'st.mediaKeys': 'Keyboard media keys',
  'st.mediaKeysDesc': 'The ⏯ ⏭ ⏮ keys control current playback (even outside Orbit)',
  'st.resources': 'Resources',
  'st.resourcesDesc':
    'Puts inactive apps to sleep to free memory. The active app, split screen and apps playing sound are never put to sleep.',
  'st.autoSleep': 'Automatic sleep',
  'st.sleepOff': 'Disabled',
  'st.sleep15': 'After 15 minutes',
  'st.sleep30': 'After 30 minutes',
  'st.sleep60': 'After 1 hour',
  'st.sleep120': 'After 2 hours',

  // Settings — Display
  'st.fontSize': 'Font size',
  'st.small': 'Small',
  'st.medium': 'Medium',
  'st.large': 'Large',
  'st.xlarge': 'Very large',
  'st.fontFamily': 'Font family',
  'st.fontFamilyDesc': 'The change applies instantly across the whole interface',
  'st.uiZoom': 'Interface zoom',
  'st.displayOptions': 'Display options',
  'st.compact': 'Compact mode',
  'st.compactDesc': 'Reduces spacing between elements',
  'st.animations': 'Animations',
  'st.animationsDesc': 'Enables transitions and animations',
  'st.appIcons': 'App icons',
  'st.appIconsDesc': 'Shows colored icons in the sidebar',

  // Settings — Appearance
  'st.theme': 'Theme',
  'st.themeDark': '🌙 Dark',
  'st.themeLight': '☀️ Light',
  'st.themeAuto': '🌓 Auto',
  'st.accentColor': 'Accent color',
  'st.accentPerProfile': 'Accent per profile',
  'st.accentPerProfileDesc':
    'The accent follows the color chosen for each profile (in Profiles → each profile has its palette). Visual work/personal cue.',

  // Settings — Profiles
  'st.profilesDesc': 'Create and manage your workspaces',
  'st.manage': 'Manage',
  'st.profilesDesc2':
    'Profiles let you separate your apps into distinct spaces (Work, Personal, Projects, etc.)',

  // Settings — Privacy
  'st.adblockTitle': 'Ad & tracker blocker',
  'st.adblockDesc':
    'Built-in native blocking (EasyList-style lists), at the network level, for all apps and profiles — no extension. More effective and reliable than blocking extensions, which do not work in Orbit.',
  'st.adblockEnable': 'Enable blocking',
  'st.adblockEnableDesc': 'Blocks known ads and trackers',
  'st.adblockHint':
    'After changing this, reload an already-open app (⟳ button) for the effect to apply. The first activation downloads the lists (then they are cached, including offline).',
  'st.proxyTitle': 'Proxy / VPN',
  'st.proxyDesc':
    'Routes traffic through a proxy (SOCKS5 or HTTP) — handy for using a VPN. Global proxy here; overridable per profile (Profiles) and per app (right-click → Edit). Empty = direct connection.',
  'st.proxyHint':
    'e.g. socks5://host:port, http://host:port, or with credentials socks5://user:pass@host:port. A VPN’s SOCKS5, a local proxy (Mullvad), or your own server. Reload the app after changing.',
  'st.translateTitle': 'Translation & text-to-speech',
  'st.translateDesc':
    'Right-click a page → “Translate selection” or “Read aloud” (built-in, no extension).',
  'st.translateLang': 'Translation language',
  'st.lang.fr': 'French',
  'st.lang.en': 'English',
  'st.lang.es': 'Spanish',
  'st.lang.de': 'German',
  'st.lang.it': 'Italian',
  'st.lang.pt': 'Portuguese',
  'st.lang.ar': 'Arabic',
  'st.lang.zh': 'Chinese (simplified)',
  'st.lang.ru': 'Russian',
  'st.lang.ja': 'Japanese',
  'st.translateEngine': 'Translation engine',
  'st.engineGoogleDesc': 'Fast, no setup',
  'st.engineLibreDesc': 'Private / self-hosted',
  'st.libreUrlPlaceholder': 'Server URL (e.g. http://localhost:5000)',
  'st.libreKeyPlaceholder': 'API key (optional)',
  'st.libreHint':
    'LibreTranslate is open-source and self-hostable (Docker: libretranslate/libretranslate). With a local server, your text never leaves your machine.',
  'st.googleHint':
    'The Google engine sends the selected text to Google for translation. For private processing, choose LibreTranslate.',

  // Settings — Notifications
  'st.notifSystem': 'System notifications',
  'st.notifSystemDesc':
    'Shows a system notification when an app receives new messages (unless it is open or asleep)',
  'st.dndNow': 'Enable now',
  'st.dndNowDesc': 'Mutes all notifications',
  'st.quietHours': 'Quiet hours',
  'st.quietHoursDesc': 'Automatically mutes notifications over a time range (e.g. at night)',
  'st.from': 'From',
  'st.to': 'to',
  'st.notifSound': 'Notification sound',
  'st.notifSoundDesc': 'Customize the sound played when a message arrives. Empty = system sound.',
  'st.customSound': 'Custom sound',
  'st.systemSound': 'System sound (default)',
  'st.chooseSound': 'Choose a sound…',
  'st.testSound': 'Test',
  'st.defaultSound': 'Default',
  'st.soundTooHeavy': 'Sound too heavy (max 1 MB). Choose a short sound.',
  'st.notifCenter': 'Notification center',
  'st.notifCenterDesc':
    'Click the 🔔 bell in the top bar to see all your apps with unread messages and jump to them in one click.',

  // Settings — About
  'st.license': 'License',
  'st.licenseText': 'Orbit is open-source software under the MIT license.',
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
