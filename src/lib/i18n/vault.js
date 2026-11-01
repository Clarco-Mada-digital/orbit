// ---------------------------------------------------------------------------
// Mots de passe : coffre, KeePassXC, sauvegarde chiffrée
//
// Un morceau du dictionnaire d'Orbit. Le fichier unique avait dépassé
// 3 900 lignes : y retrouver une clé, ou voir ce qu'une fonctionnalité ajoute,
// demandait de parcourir tout le reste. Le découpage est par DOMAINE, et
// l'assemblage se fait dans ../i18n.dict.js.
//
// Règle unique : toute clé présente ici doit l'être dans les deux langues.
// `test/i18n.test.js` le vérifie, ainsi que la cohérence des variables {x}.
// ---------------------------------------------------------------------------
export const fr = {

  // Source des identifiants (KeePassXC / coffre intégré)
  'cred.title': 'Identifiants proposés dans les pages',
  'cred.desc':
    "Orbit sait puiser dans deux gestionnaires : KeePassXC et ses trousseaux intégrés. Choisissez ce qu'il interroge quand vous cliquez un champ de connexion.",
  'cred.both': 'Les deux',
  'cred.bothDesc': "KeePassXC et les trousseaux intégrés, réunis dans une seule liste.",
  'cred.keepass': 'KeePassXC seul',
  'cred.keepassDesc': "Vos mots de passe restent dans KeePassXC. Orbit n'en propose aucun d'autre et ne propose pas d'enregistrer.",
  'cred.vault': 'Trousseaux intégrés seuls',
  'cred.vaultDesc': "Aucune requête vers KeePassXC, même s'il tourne.",
  'cred.none': 'Aucune proposition',
  'cred.noneDesc': "Rien ne s'affiche dans les pages. Les trousseaux restent consultables ici.",
  'cred.totp': 'Proposer le code à usage unique (2FA) dans les pages',
  'cred.totpDesc':
    "Après un remplissage, un bouton ⏱ remplit le champ de code de la page — ou le copie si le champ n'existe pas encore. Le code est calculé par Orbit et n'est jamais remis à un site autre que celui de l'entrée.",
  // KeePassXC
  'kp.autofillTitle': 'Remplissage automatique des identifiants',
  'kp.autofillDesc':
    'Quand vous cliquez sur un champ identifiant / mot de passe dans une app, Orbit demande les identifiants à KeePassXC et remplit le formulaire.',
  'kp.enableAutofill': "Activer l'auto-remplissage",
  'kp.connection': 'Connexion à KeePassXC',
  'kp.check': 'Vérifier',
  'kp.loading': 'Chargement…',
  'kp.detected': 'KeePassXC est détecté',
  'kp.notReachable': "KeePassXC n'est pas joignable",
  'kp.notReachableHint':
    'Ouvrez KeePassXC avec votre base déverrouillée, puis dans ses Paramètres → Intégration navigateur → activez « Intégration navigateur ».',
  'kp.associatedTo': 'Associé à la base ({ids})',
  'kp.notAssociated': 'Pas encore associé à une base',
  'kp.notAssociatedHint':
    'Cliquez sur « Associer » ci-dessous, puis approuvez la demande dans KeePassXC.',
  'kp.associatedMsg': '✓ Associé à KeePassXC (identifiant : {id})',
  'kp.assocFailed':
    'Association échouée. Vérifiez que KeePassXC est ouvert avec la base déverrouillée et que « Intégration navigateur » est activée.',
  'kp.reassociate': 'Associer un autre navigateur / re-associer',
  'kp.associate': 'Associer Orbit à KeePassXC',
  'kp.needDetected': "L'association nécessite que KeePassXC soit détecté (voir ci-dessus).",
  'kp.howTitle': 'Comment ça marche',
  'kp.how1':
    'Une seule association : cliquez sur « Associer », approuvez dans KeePassXC — c’est fait, pour toujours.',
  'kp.how2':
    'Remplissage automatique : dans une app, cliquez sur le champ identifiant ou mot de passe → Orbit demande les identifiants à KeePassXC pour le site affiché et les remplit.',
  'kp.how3':
    "Aucun mot de passe stocké par Orbit : les identifiants transitent chiffrés (NaCl) entre KeePassXC et l'app, jamais écrits sur le disque.",
  'kp.how4':
    "Multi-comptes : chaque app / compte garde sa propre session ; le remplissage suit l'URL affichée.",
  'pv.title': 'Coffre-fort de mots de passe',
  'pv.desc':
    "Vos identifiants dans des trousseaux chiffrés, chacun avec son propre mot de passe maître. Orbit les propose et les remplit sur les sites de vos apps, comme KeePassXC — sans rien installer d'autre.",
  'pv.emptyState':
    "Aucun trousseau pour l'instant. Créez-en un par usage — « Boulot », « Perso » — pour n'ouvrir que celui dont vous avez besoin.",
  'pv.newVault': 'Nouveau trousseau',
  'pv.newVaultDesc':
    'Le contenu est chiffré avec ce mot de passe maître. Choisissez-en un différent de ceux que vous stockez dedans.',
  'pv.namePlaceholder': 'Nom du trousseau (ex. Boulot)',
  'pv.icon': 'Emoji',
  'pv.masterPassword': 'Mot de passe maître',
  'pv.confirmMaster': 'Confirmer le mot de passe maître',
  'pv.currentMaster': 'Mot de passe actuel',
  'pv.newMaster': 'Nouveau mot de passe',
  'pv.changeMaster': 'Changer le mot de passe maître',
  'pv.masterChanged': 'Mot de passe maître changé.',
  'pv.suggestPassphrase': 'Proposer une phrase de passe',
  'pv.noRecovery':
    "Il n'existe aucune récupération : ce mot de passe perdu, le contenu du trousseau est définitivement illisible. Notez-le ailleurs qu'ici.",
  'pv.create': 'Créer le trousseau',
  'pv.lockedDesc': 'Ce trousseau est verrouillé.',
  'pv.unlock': 'Déverrouiller',
  'pv.unlocking': 'Déverrouillage…',
  'pv.unlockSlowHint':
    'Le déverrouillage prend une fraction de seconde : ce délai est volontaire, il rend une attaque par dictionnaire coûteuse.',
  'pv.lock': 'Verrouiller maintenant',
  'pv.search': 'Rechercher un site, un identifiant…',
  'pv.entries.show': 'Afficher les identifiants',
  'pv.entries.hide': 'Masquer les identifiants',
  'pv.entries.hidden': 'Les identifiants sont masqués jusqu’à ce que vous choisissiez de les afficher.',
  'pv.entriesLoadFailed': 'Impossible de charger les identifiants. Vérifiez que le trousseau est déverrouillé.',
  'pv.allCategories': 'Toutes les catégories',
  'pv.addEntry': 'Ajouter',
  'pv.newEntry': 'Nouvelle entrée',
  'pv.editEntry': "Modifier l'entrée",
  'pv.noEntries': "Ce trousseau est vide. Ajoutez une entrée, ou importez un export de votre navigateur.",
  'pv.noMatch': 'Aucun résultat.',
  'pv.noUsername': 'Sans identifiant',
  'pv.copyUser': "Copier l'identifiant",
  'pv.copyPassword': 'Copier le mot de passe',
  'pv.copied': 'Copié — le presse-papiers sera vidé dans 30 s',
  'pv.copyFailed': 'Copie impossible',
  'pv.toggleShow': 'Afficher / masquer',
  'pv.showTotp': 'Code à usage unique',
  'pv.generate': 'Générer un mot de passe',
  'pv.gen.length': 'Longueur',
  'pv.gen.symbols': 'Inclure des symboles',
  'pv.gen.random': 'Aléatoire',
  'pv.gen.passphrase': 'Phrase de passe',
  'pv.f.title': 'Titre',
  'pv.f.name': 'Nom',
  'pv.f.url': 'Adresse du site',
  'pv.f.urlHint':
    "Le remplissage se fait sur le domaine : une entrée pour google.com sert aussi sur mail.google.com.",
  'pv.f.username': 'Identifiant',
  'pv.f.password': 'Mot de passe',
  'pv.f.passwordKeep': 'Laisser vide pour ne pas changer',
  'pv.f.totp': "Code à usage unique (2FA)",
  'pv.f.totpKeep': 'Laisser vide pour ne pas changer',
  'pv.f.totpHint': "Collez la clé secrète du QR code, ou l'URI otpauth:// complète.",
  'pv.f.category': 'Catégorie',
  'pv.f.noCategory': 'Sans catégorie',
  'pv.f.notes': 'Notes',
  'pv.vaultSettings': 'Réglages du trousseau',
  'pv.autoLock': 'Verrouillage auto',
  'pv.autoLockNever': 'Jamais',
  'pv.saved': 'Enregistré.',
  'pv.deleteVault': 'Supprimer ce trousseau',
  'pv.deleteVaultWarning':
    'Suppression définitive de toutes ses entrées. Saisissez le mot de passe maître pour confirmer.',
  'pv.transfer': 'Transférer',
  'pv.import': 'Importer (CSV / JSON)',
  'pv.imported':
    '{n} entrée(s) importée(s), {merged} fusionnée(s), {overwritten} écrasée(s), {skipped} doublon(s) ignoré(s)',
  'pv.importFailed': "Import impossible : fichier illisible ou sans colonne de mot de passe.",
  'pv.export': 'Exporter',
  'pv.exportIntro':
    'Saisissez le mot de passe maître, puis choisissez une sauvegarde chiffrée ou un export en clair pour migrer ailleurs.',
  'pv.exportWarning':
    "Ces fichiers ne sont PAS chiffrés : tous les mots de passe y sont en clair. À réserver à une migration vers un autre gestionnaire, et à supprimer juste après.",
  'pv.exportPlain': 'Export en clair (migration)',
  'pv.exportArchive': 'Sauvegarde chiffrée (recommandé)',
  'pv.exportArchiveHint':
    'Fichier .orbitvault chiffré en AES-256-GCM (clé dérivée par scrypt). Il garde tout le trousseau — catégories, URLs secondaires, historique — et se restaure dans Orbit.',
  'pv.exportArchiveAction': 'Enregistrer la sauvegarde chiffrée',
  'pv.archivePassphrase': "Phrase de passe de l'archive",
  'pv.archivePassphraseOptional':
    "Phrase de passe de l'archive (vide = mot de passe maître)",
  'pv.archiveSaved': 'Sauvegarde chiffrée créée ({n} entrée(s)).',
  'pv.restoreArchive': 'Restaurer une archive chiffrée',
  'pv.restoreArchiveHint':
    "Saisissez la phrase de passe de l'archive, puis choisissez le fichier .orbitvault. Les entrées déjà présentes ne sont pas dupliquées.",
  'pv.chooseArchive': 'Choisir le fichier…',
  'pv.exported': '{n} entrée(s) exportée(s)',
  'pv.kpImport.action': 'Rapatrier la base KeePassXC',
  'pv.kpImport.running': 'Rapatriement depuis KeePassXC…',
  'pv.kpImport.scanning': 'Lecture de la liste des entrées…',
  'pv.kpImport.progress': '{done}/{total} sites interrogés',
  'pv.kpImport.doneTitle': 'Rapatriement terminé',
  'pv.kpImport.summary':
    '{scanned} entrée(s) dans la base — {n} ajoutée(s), {merged} fusionnée(s), {overwritten} écrasée(s).',
  'pv.kpImport.withoutUrl':
    "{n} entrée(s) sans URL n'ont pas pu être récupérées (KeePassXC ne rend les mots de passe que par site) :",
  'pv.kpImport.failed': '{n} site(s) n’ont rien renvoyé (accès refusé ou base verrouillée).',
  'pv.kpImport.denied':
    'KeePassXC refuse de lister ses entrées. Cochez « Allow limited access to all entries in connected databases » dans Paramètres → Intégration navigateur → Avancé, puis réessayez.',
  'pv.kpImport.notAssociated':
    "Orbit n'est pas encore associé à une base KeePassXC. Faites-le dans Réglages → KeePassXC.",
  'pv.kpImport.dbLocked':
    'KeePassXC n’a renvoyé aucune entrée : sa base est verrouillée (ou vide). Déverrouillez-la, puis réessayez.',
  'pv.audit': 'Contrôle de santé',
  'pv.auditDesc':
    "L’estimation de robustesse et l’analyse de réutilisation restent locales. La vérification des fuites est facultative et lancée séparément.",
  'pv.auditClean': 'Rien à signaler sur {n} entrée(s).',
  'pv.auditRunning': 'Analyse…',
  'pv.auditFailed': 'L’analyse n’a pas pu aboutir. Vérifiez que le trousseau est toujours déverrouillé.',
  'pv.audit.total': 'Entrées',
  'pv.audit.moderate': 'Moyens',
  'pv.audit.strong': 'Forts',
  'pv.audit.reused': 'Mots de passe réutilisés sur plusieurs sites',
  'pv.audit.weak': 'Mots de passe faibles',
  'pv.audit.old': 'Inchangés depuis plus d’un an',
  'pv.audit.empty': 'Entrées sans mot de passe',
  'pv.audit.breached': 'Mots de passe trouvés dans des fuites connues',
  'pv.breachPrivacy':
    'Vérification facultative via Have I Been Pwned. Orbit envoie seulement les 5 premiers caractères du SHA-1 calculé localement pour chaque mot de passe unique. Le service voit toutefois votre adresse IP et l’heure de la requête ; les résultats ne sont pas enregistrés.',
  'pv.breachCheck': 'Vérifier les fuites (Internet)',
  'pv.breachChecking': 'Vérification…',
  'pv.breachUnavailable': 'Le service de vérification est injoignable. Aucun résultat de fuite n’a été enregistré.',
  'pv.breachPartial': '{checked} mot(s) vérifié(s) ; {failed} non vérifié(s) car le service était indisponible.',
  'pv.breachNoPasswords': 'Aucun mot de passe à vérifier.',
  'pv.breachClean': 'Aucun des {n} mot(s) vérifié(s) n’a été trouvé dans le corpus consulté.',
  'pv.breachCount': 'signalé {n} fois',
  'pv.generatorHint':
    'Pour remplacer un mot de passe, Orbit peut déjà en proposer un fort sur les formulaires d’inscription ou de changement de mot de passe de vos applications.',
  'pv.footerNote':
    'Verrouillage automatique après {minutes} min sans activité, et à chaque mise en veille ou verrouillage d’Orbit.',
  'pv.remember.label': 'Mémoriser ce mot de passe sur cet appareil',
  'pv.remember.warning':
    'Il sera gardé par le trousseau du système, jamais en clair sur le disque — mais quiconque ouvre une session sous votre compte pourra alors ouvrir ce trousseau sans le connaître.',
  'pv.remember.unlock': 'Déverrouiller sans saisie',
  'pv.remember.forget': 'Oublier le mot de passe mémorisé',
  'pv.remember.orType': 'ou saisissez-le',
  'pv.remember.failed':
    'Trousseau déverrouillé, mais la mémorisation a échoué : le trousseau du système n’est pas disponible ici.',
  'pv.remember.gone':
    'Le mot de passe mémorisé n’est plus utilisable (trousseau du système inaccessible, ou mot de passe maître changé). Saisissez-le.',
  // Sauvegarde automatique chiffrée des trousseaux
  'vb.title': 'Sauvegarde automatique chiffrée',
  'vb.desc':
    'Écrit à intervalle régulier une archive .orbitvault de vos trousseaux dans un dossier de votre choix. Un coffre sans sauvegarde ne se récupère pas : aucun serveur ne détient vos mots de passe.',
  'vb.loading': 'Lecture de la configuration…',
  'vb.enable': 'Activer la sauvegarde automatique',
  'vb.enableDesc': 'Nécessite un dossier et une phrase de passe ci-dessous.',
  'vb.folder': 'Dossier des sauvegardes',
  'vb.folderNone': 'Aucun dossier choisi',
  'vb.choose': 'Choisir…',
  'vb.open': 'Ouvrir',
  'vb.folderHint':
    'Les archives sont chiffrées : un dossier synchronisé (cloud, NAS) ou une clé USB conviennent. Préférez un support différent de celui d’Orbit — une sauvegarde sur le même disque ne protège pas d’une panne de ce disque.',
  'vb.passphrase': 'Phrase de passe des archives',
  'vb.passphrasePlaceholder': '8 caractères minimum',
  'vb.passphraseSave': 'Enregistrer',
  'vb.passphraseSet': 'Phrase de passe en place (gardée par le trousseau du système).',
  'vb.passphraseForget': 'L’oublier',
  'vb.passphraseWarning':
    'Notez-la ailleurs : sans elle, les archives sont définitivement illisibles — y compris par vous. Orbit ne peut pas vous la rappeler, elle est confiée au trousseau du système et jamais écrite en clair.',
  'vb.every': 'Fréquence',
  'vb.everyHours': 'Toutes les {n} heures',
  'vb.everyDays': 'Tous les {n} jour(s)',
  'vb.keep': 'Archives conservées',
  'vb.keepHint': 'Les plus anciennes sont supprimées au-delà de ce nombre, par trousseau.',
  'vb.lastRun': 'Dernière sauvegarde',
  'vb.nextRun': 'Prochaine',
  'vb.never': 'jamais',
  'vb.runNow': 'Sauvegarder maintenant',
  'vb.refresh': 'Actualiser',
  'vb.ranOk': '{n} trousseau(x) sauvegardé(s), {entries} entrée(s).',
  'vb.lockedSkipped':
    'Non sauvegardés car verrouillés : {names}. Orbit n’en a pas la clé — déverrouillez-les pour qu’ils soient inclus.',
  'vb.failed': 'Échec pour : {names}',
  'vb.err.noKeychain':
    'Le trousseau du système n’est pas disponible sur cette machine. Orbit refuse d’écrire la phrase de passe en clair à côté des archives qu’elle protège : la sauvegarde automatique reste indisponible, mais l’export manuel chiffré fonctionne.',
  'vb.err.dirRequired': 'Choisissez d’abord un dossier de sauvegarde.',
  'vb.err.passphraseRequired': 'Enregistrez d’abord une phrase de passe.',
  'vb.err.dirUnwritable': 'Impossible d’écrire dans ce dossier. Vérifiez qu’il existe et qu’il est accessible.',
  'vb.err.allLocked':
    'Aucun trousseau déverrouillé : il n’y avait rien à sauvegarder. Déverrouillez-en un et réessayez.',
  'vb.err.generic': 'La sauvegarde n’a pas abouti.',
  'pv.err.badPassword': 'Mot de passe incorrect.',
  'pv.err.badPassphrase': 'Phrase de passe incorrecte, ou fichier abîmé.',
  'pv.err.weakPassphrase': "La phrase de passe de l'archive doit faire au moins 8 caractères.",
  'pv.err.notAnArchive': "Ce fichier n'est pas une archive Orbit chiffrée.",
  'pv.err.archiveTooNew':
    'Cette archive a été créée par une version plus récente d’Orbit. Mettez Orbit à jour.',
  'pv.err.locked': 'Le trousseau s’est verrouillé entre-temps. Déverrouillez-le et réessayez.',
  'pv.err.weakMaster': 'Le mot de passe maître doit faire au moins 8 caractères.',
  'pv.err.mismatch': 'Les deux saisies ne correspondent pas.',
  'pv.err.nameRequired': 'Donnez un nom au trousseau.',
  'vs.title': 'Lecture vocale',
  'vs.desc':
    "Utilisée par « Lire la page » et « Lire à voix haute » du menu clic droit. Tout se passe sur votre machine : aucun texte n'est envoyé à un service tiers.",
  'vs.system': 'Voix du système',
  'vs.systemFound': 'Disponible via {engine}. Immédiate, aucun téléchargement — mais la voix reste synthétique.',
  'vs.systemMissing': 'Aucune voix système détectée.',
  'vs.piper': 'Piper — voix naturelles hors ligne',
  'vs.piperDesc':
    "Synthèse neuronale locale, bien plus agréable à écouter. Les voix de Chrome, elles, sont un service cloud de Google, indisponible hors de Chrome.",
  'vs.piperNotInstalled':
    "Le moteur (~26 Mo) et au moins une voix doivent être téléchargés. Rien n'est installé ni lancé tant que vous ne le demandez pas.",
  'vs.installEngine': 'Installer le moteur (~26 Mo)',
  'vs.mmsDesc':
    'Synthèse neuronale malgache hors-ligne. Modèle VITS de Meta (MMS-TTS), ~250 Mo. Idéal pour les textes en malgache.',
  'vs.mmsNotInstalled':
    'Le modèle (~250 Mo) doit être téléchargé une première fois. Rien n\'est installé ni lancé tant que vous ne le demandez pas.',
  'vs.installMms': 'Installer le modèle Malagasy (~250 Mo)',
  'vs.mmsReady': 'Modèle Malagasy prêt.',
  'vs.uninstallMms': 'Désinstaller le modèle Malagasy',
  'vs.installing': 'Installation…',
  'vs.voices': 'Voix',
  'vs.download': 'Télécharger',
  'vs.use': 'Utiliser',
  'vs.removeVoice': 'Supprimer cette voix',
  'vs.uninstall': 'Désinstaller Piper et toutes ses voix',
  'vs.preview': 'Essayer',
  'vs.stop': 'Arrêter',
  'vs.failed': 'Opération impossible.',
  'vs.note':
    "Le volume suit celui d'Orbit (Réglages → Notifications). Une voix Piper occupe de l'espace disque mais ne consomme rien tant qu'elle ne parle pas.",
};

export const en = {

  // Credential source (KeePassXC / built-in vaults)
  'cred.title': 'Credentials offered in pages',
  'cred.desc':
    'Orbit can draw from two managers: KeePassXC and its built-in vaults. Choose which ones it queries when you click a sign-in field.',
  'cred.both': 'Both',
  'cred.bothDesc': 'KeePassXC and the built-in vaults, merged into a single list.',
  'cred.keepass': 'KeePassXC only',
  'cred.keepassDesc': 'Your passwords stay in KeePassXC. Orbit offers no others and does not offer to save.',
  'cred.vault': 'Built-in vaults only',
  'cred.vaultDesc': 'No request to KeePassXC, even when it is running.',
  'cred.none': 'No suggestions',
  'cred.noneDesc': 'Nothing appears in pages. Vaults remain readable here.',
  'cred.totp': 'Offer the one-time code (2FA) in pages',
  'cred.totpDesc':
    'After a fill, a ⏱ button fills the page’s code field — or copies the code if no field exists yet. The code is computed by Orbit and is never handed to a site other than the entry’s own.',
  // KeePassXC
  'kp.autofillTitle': 'Automatic credential filling',
  'kp.autofillDesc':
    'When you click a username / password field in an app, Orbit asks KeePassXC for the credentials and fills the form.',
  'kp.enableAutofill': 'Enable auto-fill',
  'kp.connection': 'Connection to KeePassXC',
  'kp.check': 'Check',
  'kp.loading': 'Loading…',
  'kp.detected': 'KeePassXC detected',
  'kp.notReachable': 'KeePassXC is not reachable',
  'kp.notReachableHint':
    'Open KeePassXC with your database unlocked, then in its Settings → Browser Integration → enable “Browser Integration”.',
  'kp.associatedTo': 'Associated with the database ({ids})',
  'kp.notAssociated': 'Not associated with a database yet',
  'kp.notAssociatedHint': 'Click “Associate” below, then approve the request in KeePassXC.',
  'kp.associatedMsg': '✓ Associated with KeePassXC (id: {id})',
  'kp.assocFailed':
    'Association failed. Make sure KeePassXC is open with the database unlocked and that “Browser Integration” is enabled.',
  'kp.reassociate': 'Associate another browser / re-associate',
  'kp.associate': 'Associate Orbit with KeePassXC',
  'kp.needDetected': 'Association requires KeePassXC to be detected (see above).',
  'kp.howTitle': 'How it works',
  'kp.how1':
    'A single association: click “Associate”, approve in KeePassXC — done, forever.',
  'kp.how2':
    'Automatic filling: in an app, click the username or password field → Orbit asks KeePassXC for the credentials of the displayed site and fills them.',
  'kp.how3':
    'No password stored by Orbit: credentials travel encrypted (NaCl) between KeePassXC and the app, never written to disk.',
  'kp.how4':
    'Multi-account: each app / account keeps its own session; filling follows the displayed URL.',
  'pv.title': 'Password vault',
  'pv.desc':
    'Your credentials in encrypted vaults, each with its own master password. Orbit offers and fills them on your apps’ sites, like KeePassXC — with nothing else to install.',
  'pv.emptyState':
    'No vault yet. Create one per context — “Work”, “Personal” — so you only unlock the one you need.',
  'pv.newVault': 'New vault',
  'pv.newVaultDesc':
    'The contents are encrypted with this master password. Pick one you do not store inside it.',
  'pv.namePlaceholder': 'Vault name (e.g. Work)',
  'pv.icon': 'Emoji',
  'pv.masterPassword': 'Master password',
  'pv.confirmMaster': 'Confirm master password',
  'pv.currentMaster': 'Current password',
  'pv.newMaster': 'New password',
  'pv.changeMaster': 'Change master password',
  'pv.masterChanged': 'Master password changed.',
  'pv.suggestPassphrase': 'Suggest a passphrase',
  'pv.noRecovery':
    'There is no recovery: lose this password and the vault’s contents are permanently unreadable. Write it down somewhere other than here.',
  'pv.create': 'Create vault',
  'pv.lockedDesc': 'This vault is locked.',
  'pv.unlock': 'Unlock',
  'pv.unlocking': 'Unlocking…',
  'pv.unlockSlowHint':
    'Unlocking takes a fraction of a second on purpose — that delay is what makes a dictionary attack expensive.',
  'pv.lock': 'Lock now',
  'pv.search': 'Search a site, a username…',
  'pv.entries.show': 'Show passwords',
  'pv.entries.hide': 'Hide passwords',
  'pv.entries.hidden': 'Your passwords stay hidden until you choose to show them.',
  'pv.entriesLoadFailed': 'Could not load the entries. Make sure the vault is unlocked.',
  'pv.allCategories': 'All categories',
  'pv.addEntry': 'Add',
  'pv.newEntry': 'New entry',
  'pv.editEntry': 'Edit entry',
  'pv.noEntries': 'This vault is empty. Add an entry, or import an export from your browser.',
  'pv.noMatch': 'No results.',
  'pv.noUsername': 'No username',
  'pv.copyUser': 'Copy username',
  'pv.copyPassword': 'Copy password',
  'pv.copied': 'Copied — the clipboard clears in 30 s',
  'pv.copyFailed': 'Could not copy',
  'pv.toggleShow': 'Show / hide',
  'pv.showTotp': 'One-time code',
  'pv.generate': 'Generate a password',
  'pv.gen.length': 'Length',
  'pv.gen.symbols': 'Include symbols',
  'pv.gen.random': 'Random',
  'pv.gen.passphrase': 'Passphrase',
  'pv.f.title': 'Title',
  'pv.f.name': 'Name',
  'pv.f.url': 'Site address',
  'pv.f.urlHint': 'Filling matches the domain: an entry for google.com also works on mail.google.com.',
  'pv.f.username': 'Username',
  'pv.f.password': 'Password',
  'pv.f.passwordKeep': 'Leave empty to keep the current one',
  'pv.f.totp': 'One-time code (2FA)',
  'pv.f.totpKeep': 'Leave empty to keep the current one',
  'pv.f.totpHint': 'Paste the secret key from the QR code, or the full otpauth:// URI.',
  'pv.f.category': 'Category',
  'pv.f.noCategory': 'No category',
  'pv.f.notes': 'Notes',
  'pv.vaultSettings': 'Vault settings',
  'pv.autoLock': 'Auto-lock',
  'pv.autoLockNever': 'Never',
  'pv.saved': 'Saved.',
  'pv.deleteVault': 'Delete this vault',
  'pv.deleteVaultWarning':
    'Permanently deletes all its entries. Enter the master password to confirm.',
  'pv.transfer': 'Transfer',
  'pv.import': 'Import (CSV / JSON)',
  'pv.imported':
    '{n} entries imported, {merged} merged, {overwritten} overwritten, {skipped} duplicate row(s) skipped',
  'pv.importFailed': 'Import failed: unreadable file, or no password column.',
  'pv.export': 'Export',
  'pv.exportIntro':
    'Enter the master password, then pick an encrypted backup or a clear-text export to migrate elsewhere.',
  'pv.exportWarning':
    'These files are NOT encrypted: every password is in clear text. Use them only to migrate to another manager, and delete them right after.',
  'pv.exportPlain': 'Clear-text export (migration)',
  'pv.exportArchive': 'Encrypted backup (recommended)',
  'pv.exportArchiveHint':
    '.orbitvault file encrypted with AES-256-GCM (key derived with scrypt). It keeps the whole vault — categories, extra URLs, history — and restores into Orbit.',
  'pv.exportArchiveAction': 'Save encrypted backup',
  'pv.archivePassphrase': 'Archive passphrase',
  'pv.archivePassphraseOptional': 'Archive passphrase (empty = master password)',
  'pv.archiveSaved': 'Encrypted backup created ({n} entries).',
  'pv.restoreArchive': 'Restore an encrypted archive',
  'pv.restoreArchiveHint':
    'Enter the archive passphrase, then pick the .orbitvault file. Entries already present are not duplicated.',
  'pv.chooseArchive': 'Choose file…',
  'pv.exported': '{n} entries exported',
  'pv.kpImport.action': 'Pull in the KeePassXC database',
  'pv.kpImport.running': 'Pulling from KeePassXC…',
  'pv.kpImport.scanning': 'Reading the entry list…',
  'pv.kpImport.progress': '{done}/{total} sites queried',
  'pv.kpImport.doneTitle': 'Import complete',
  'pv.kpImport.summary':
    '{scanned} entries in the database — {n} added, {merged} merged, {overwritten} overwritten.',
  'pv.kpImport.withoutUrl':
    '{n} entries without a URL could not be fetched (KeePassXC only returns passwords per site):',
  'pv.kpImport.failed': '{n} sites returned nothing (access denied or database locked).',
  'pv.kpImport.denied':
    'KeePassXC refuses to list its entries. Tick “Allow limited access to all entries in connected databases” under Settings → Browser Integration → Advanced, then try again.',
  'pv.kpImport.notAssociated':
    'Orbit is not associated with a KeePassXC database yet. Do that in Settings → KeePassXC.',
  'pv.kpImport.dbLocked':
    'KeePassXC returned no entries: its database is locked (or empty). Unlock it, then try again.',
  'pv.audit': 'Health check',
  'pv.auditDesc':
    'Estimated strength and reuse checks stay local. The optional breach lookup is separate and only runs when requested.',
  'pv.auditClean': 'Nothing to report across {n} entries.',
  'pv.auditRunning': 'Checking…',
  'pv.auditFailed': 'The health check could not complete. Make sure the vault is still unlocked.',
  'pv.audit.total': 'Entries',
  'pv.audit.moderate': 'Moderate',
  'pv.audit.strong': 'Strong',
  'pv.audit.reused': 'Passwords reused across sites',
  'pv.audit.weak': 'Weak passwords',
  'pv.audit.old': 'Unchanged for over a year',
  'pv.audit.empty': 'Entries with no password',
  'pv.audit.breached': 'Passwords found in known breaches',
  'pv.breachPrivacy':
    'Optional check via Have I Been Pwned. Orbit sends only the first 5 characters of each unique password’s locally computed SHA-1 hash. The service can still see your IP address and request time; results are not saved.',
  'pv.breachCheck': 'Check for breaches (online)',
  'pv.breachChecking': 'Checking…',
  'pv.breachUnavailable': 'The breach-check service is unavailable. No breach result was saved.',
  'pv.breachPartial': '{checked} password(s) checked; {failed} could not be checked because the service was unavailable.',
  'pv.breachNoPasswords': 'There are no passwords to check.',
  'pv.breachClean': 'None of the {n} checked password(s) were found in the queried corpus.',
  'pv.breachCount': 'seen {n} times',
  'pv.generatorHint':
    'To replace a password, Orbit can already suggest a strong one on sign-up and password-change forms in your apps.',
  'pv.footerNote':
    'Auto-locks after {minutes} min of inactivity, and whenever Orbit sleeps or locks.',
  'pv.remember.label': 'Remember this password on this device',
  'pv.remember.warning':
    'It will be held by the system keychain, never in clear text on disk — but anyone who opens a session under your account will then be able to open this vault without knowing it.',
  'pv.remember.unlock': 'Unlock without typing',
  'pv.remember.forget': 'Forget the remembered password',
  'pv.remember.orType': 'or type it',
  'pv.remember.failed':
    'Vault unlocked, but remembering failed: the system keychain is not available here.',
  'pv.remember.gone':
    'The remembered password no longer works (system keychain unavailable, or master password changed). Please type it.',
  // Automatic encrypted vault backup
  'vb.title': 'Automatic encrypted backup',
  'vb.desc':
    'Regularly writes an .orbitvault archive of your vaults into a folder of your choice. A vault with no backup cannot be recovered: no server holds your passwords.',
  'vb.loading': 'Reading the configuration…',
  'vb.enable': 'Enable automatic backup',
  'vb.enableDesc': 'Requires a folder and a passphrase below.',
  'vb.folder': 'Backup folder',
  'vb.folderNone': 'No folder chosen',
  'vb.choose': 'Choose…',
  'vb.open': 'Open',
  'vb.folderHint':
    'Archives are encrypted, so a synced folder (cloud, NAS) or a USB stick are fine. Prefer a different medium from Orbit’s — a backup on the same disk does not protect against that disk failing.',
  'vb.passphrase': 'Archive passphrase',
  'vb.passphrasePlaceholder': '8 characters minimum',
  'vb.passphraseSave': 'Save',
  'vb.passphraseSet': 'Passphrase in place (held by the system keychain).',
  'vb.passphraseForget': 'Forget it',
  'vb.passphraseWarning':
    'Write it down elsewhere: without it the archives are permanently unreadable — by you too. Orbit cannot remind you of it; it is handed to the system keychain and never written in clear text.',
  'vb.every': 'Frequency',
  'vb.everyHours': 'Every {n} hours',
  'vb.everyDays': 'Every {n} day(s)',
  'vb.keep': 'Archives kept',
  'vb.keepHint': 'Older ones are deleted beyond this count, per vault.',
  'vb.lastRun': 'Last backup',
  'vb.nextRun': 'Next',
  'vb.never': 'never',
  'vb.runNow': 'Back up now',
  'vb.refresh': 'Refresh',
  'vb.ranOk': '{n} vault(s) backed up, {entries} entries.',
  'vb.lockedSkipped':
    'Not backed up because locked: {names}. Orbit does not hold their key — unlock them to include them.',
  'vb.failed': 'Failed for: {names}',
  'vb.err.noKeychain':
    'The system keychain is not available on this machine. Orbit refuses to write the passphrase in clear text next to the archives it protects: automatic backup stays unavailable, but the manual encrypted export works.',
  'vb.err.dirRequired': 'Choose a backup folder first.',
  'vb.err.passphraseRequired': 'Save a passphrase first.',
  'vb.err.dirUnwritable': 'Cannot write into that folder. Check that it exists and is accessible.',
  'vb.err.allLocked':
    'No unlocked vault: there was nothing to back up. Unlock one and try again.',
  'vb.err.generic': 'The backup did not complete.',
  'pv.err.badPassword': 'Wrong password.',
  'pv.err.badPassphrase': 'Wrong passphrase, or damaged file.',
  'pv.err.weakPassphrase': 'The archive passphrase must be at least 8 characters.',
  'pv.err.notAnArchive': 'This file is not an encrypted Orbit archive.',
  'pv.err.archiveTooNew':
    'This archive was created by a newer version of Orbit. Update Orbit first.',
  'pv.err.locked': 'The vault locked itself in the meantime. Unlock it and try again.',
  'pv.err.weakMaster': 'The master password must be at least 8 characters.',
  'pv.err.mismatch': 'The two entries do not match.',
  'pv.err.nameRequired': 'Give the vault a name.',
  'vs.title': 'Read aloud',
  'vs.desc':
    'Used by “Read page aloud” and “Read aloud” in the right-click menu. Everything happens on your machine: no text is sent to a third-party service.',
  'vs.system': 'System voice',
  'vs.systemFound': 'Available through {engine}. Instant, nothing to download — but the voice stays synthetic.',
  'vs.systemMissing': 'No system voice detected.',
  'vs.piper': 'Piper — natural offline voices',
  'vs.piperDesc':
    'Local neural synthesis, far easier on the ear. Chrome’s voices are a Google cloud service, unavailable outside Chrome.',
  'vs.piperNotInstalled':
    'The engine (~26 MB) and at least one voice need downloading. Nothing is installed or started until you ask.',
  'vs.installEngine': 'Install the engine (~26 MB)',
  'vs.mmsDesc':
    'Offline Malagasy neural synthesis. Meta VITS model (MMS-TTS), ~250 MB. Ideal for Malagasy text.',
  'vs.mmsNotInstalled':
    'The model (~250 MB) needs to be downloaded once. Nothing is installed or started until you ask.',
  'vs.installMms': 'Install Malagasy model (~250 MB)',
  'vs.mmsReady': 'Malagasy model ready.',
  'vs.uninstallMms': 'Uninstall Malagasy model',
  'vs.installing': 'Installing…',
  'vs.voices': 'Voices',
  'vs.download': 'Download',
  'vs.use': 'Use',
  'vs.removeVoice': 'Remove this voice',
  'vs.uninstall': 'Uninstall Piper and all its voices',
  'vs.preview': 'Try it',
  'vs.stop': 'Stop',
  'vs.failed': 'Could not complete.',
  'vs.note':
    'Volume follows Orbit’s own (Settings → Notifications). A Piper voice takes disk space but costs nothing while it is not speaking.',
};
