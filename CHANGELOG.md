# Notes de version

Ce fichier est la source unique des notes de version : il alimente l'onglet
« À propos » dans l'application **et** le texte de la release GitHub. Une
version sans section ici ne peut pas être publiée (`npm run release` refuse).

Format : une section `## [X.Y.Z] — AAAA-MM-JJ` par version, puis des
sous-sections `### Ajouté` / `### Modifié` / `### Corrigé` / `### Sécurité`.
La plus récente en premier.

## [1.12.0] — 2026-09-29

### Ajouté
- **Synchronisation entre machines** (Réglages → Sauvegarde) : profils, apps,
  conteneurs, espaces de travail, automatisations et réglages restent
  identiques sur tous vos postes. Orbit n'héberge rien — il dépose un fichier
  **chiffré** dans un dossier que vous choisissez (Drive, Nextcloud, Dropbox,
  partage réseau…), et c'est ce service qui le convoie. La fusion se fait
  entité par entité : ajouter une app sur le portable pendant qu'on en renomme
  une sur le fixe ne perd aucune des deux modifications.
- **Pages volantes** : tapez une adresse dans `Alt/⌘ + K` et elle s'ouvre
  *dans* Orbit, dans une section dédiée en bas de la barre latérale. Éphémères
  (elles disparaissent à la fermeture), avec leur propre session jetable — et
  promouvables en vraie application d'un clic droit.
- **Recherche transverse** dans `Alt/⌘ + K` : retrouvez « cette page vue hier »
  sans vous rappeler dans quelle app. La palette cherche désormais dans le
  titre des pages ouvertes et dans votre historique de navigation, puis rouvre
  la page dans son application d'origine. L'historique reste **local** : il
  n'entre jamais dans la synchronisation, et les pages de connexion n'y sont
  pas consignées.
- **Automatisations** (Réglages → Automatisations) : des règles « quand ceci,
  fais cela ». Router un lien vers une app précise (`github.com` → votre app
  GitHub), l'ouvrir en page volante, dans le navigateur, ou le bloquer. Et
  basculer de profil à heure fixe, certains jours seulement.

### Corrigé
- **Fenêtres secondaires non redimensionnables** : les pop-ups (connexion
  Google, liens externes) restaient figées à leur taille d'ouverture. Sans
  cadre système, elles ne recevaient aucune bordure de redimensionnement —
  elles ont désormais leurs propres poignées sur les quatre bords et les quatre
  coins, et le double-clic sur l'en-tête les agrandit.
- **Restauration d'une sauvegarde invalide** : le message d'erreur affichait un
  texte technique au lieu de « Fichier de sauvegarde invalide ».
- **Calendrier de l'en-tête** : les info-bulles des flèches de mois
  affichaient leur clé de traduction brute.
- **Interface en anglais** : trois libellés de la barre latérale (Boutique,
  Profils, Réglages) restaient en français.

### Sécurité
- La **phrase secrète de synchronisation** est confiée au trousseau de votre
  système d'exploitation (comme la clé KeePassXC), jamais écrite en clair sur
  le disque.
- Une **page volante n'écrit jamais dans les cookies d'une app connectée** :
  elle garde sa propre session jetable, purgée à sa fermeture, même dans un
  profil configuré en session partagée.

### Interne
- Suite de tests portée de 24 à **177 tests**, toujours sans aucune dépendance
  à installer. ESLint (avec les règles React Hooks) ajouté au projet et branché
  sur l'intégration continue.

## [1.11.1] — 2026-09-15

### Ajouté
- **Écran partagé — redimensionnement en grille** (3-4 apps) : glissez les
  séparateurs entre les panneaux pour ajuster leurs tailles (en plus du mode
  2 apps déjà ajustable).

### Corrigé
- **Écran partagé — le redimensionnement « collait »** : en glissant le
  séparateur, dès que le curseur passait sur une app le drag restait actif (la
  taille suivait la souris même après avoir lâché). Un voile de capture pendant
  le glissement corrige le problème.

## [1.11.0] — 2026-09-15

### Ajouté
- **Écran partagé — dispositions personnalisables** (façon Snap Windows 11) :
  choix de la forme via des vignettes dans le menu Écran partagé — maître à
  gauche / droite / haut / bas, colonnes, lignes, grille 2×2.
- **Placement libre des apps** : une grille de zones cliquables reflète la
  disposition ; on clique deux zones pour échanger les apps (gauche/droite
  **et** haut/bas).
- Les apps de portée **« tous les profils »** peuvent désormais être mises en
  écran partagé avec les apps du profil ouvert.
- Premiers **tests unitaires** (partition de session, disposition de barre,
  raccourcis, génération de mots de passe) et **analyse Argus** en intégration
  continue.

### Modifié
- À 3 apps, la disposition remplit tout l'espace (maître + 2) — fini la
  cellule vide avec « + ». Le déplacement des panneaux se choisit dans le menu.

### Corrigé
- **Calendrier** de la barre : en anglais, les en-têtes de jours étaient
  décalés (dimanche en premier) alors que la grille commence le lundi → la date
  du jour tombait sous le mauvais jour. En-têtes alignés en lundi-premier.

## [1.9.0] — 2026-09-06

### Ajouté
- Extension **Fake Data Filler** intégrée à Orbit : bouton 🎲 sur les champs
  de formulaire (sauf connexion), raccourci **Alt+F**, valeurs personnalisables
  dans **Réglages → Extensions**, export en ZIP pour partage.
- Installation d'extensions depuis un **ZIP** ou un dossier dépaqueté
  (Réglages → Extensions) — les ZIP distributables sont partagés dans le dépôt
  (color picker, page → Markdown, text snippets, notes, QR code…).
- Le menu contextuel s'enrichit des actions proposées par les extensions
  installées (extraction de couleur, page → Markdown, etc.).
- Barre : les extensions **épinglables** en icônes directes ; les autres se
  replient derrière une pastille unique (liste dépliable au clic).

### Modifié
- Les réglages « Données de test » quittent « Général » pour rejoindre
  l'extension Fake Data Filler (Réglages → Extensions).
- Texte de remplissage des champs plus réaliste (phrases complètes au lieu de
  « Lorem »).

### Corrigé
- **Text Snippets** : les abréviations créées dans la page d'options ne se
  déclenchaient jamais — les options s'ouvrent désormais dans la partition de
  l'app active, partageant le même stockage (chrome.storage) que les content
  scripts.
- Le générateur natif de mot de passe ne se superposait plus au panneau de
  l'extension Fake Data Filler.
- Les items d'extension du menu contextuel sont nettoyés quand le menu se
  ferme sans action, et un clic dans une app embarquée referme les menus de
  la barre.

## [1.7.4] — 2026-08-25

### Corrigé
- Erreurs d'affichage d'alert dans orbite.
- Mise à jour du gestion des micros et confirmation, alerte etc.. et appel par les applicaiton de messagerie.

## [1.7.3] — 2026-08-27

### Corrigé
- KeePassXC ne proposait plus aucun identifiant. Les pages de connexion
  donnent elles-mêmes le focus au champ au chargement ; ce focus arrive avant
  toute interaction, la protection anti-récolte le refuse — et `focusin` ne se
  redéclenche jamais sur un champ déjà focalisé, donc le clic ne relançait
  rien. La recherche est maintenant rejouée sur le clic.
- La page d'une app « tous les profils » ne s'affichait que dans son profil
  d'origine : elle apparaissait dans la barre latérale mais restait invisible
  ailleurs.

### Ajouté
- Choix de la source des identifiants : KeePassXC, trousseaux intégrés, les
  deux ou aucun. Le filtrage est appliqué dans le processus principal.
- Notes de version consultables dans l'application (onglet « À propos »).

### Modifié
- La recherche de mise à jour rejoint l'onglet « À propos », auprès du numéro
  de version, au lieu d'être répétée dans « Général ».
- L'interrupteur « activer KeePassXC » disparaît au profit du choix de source :
  il ne décidait que la moitié de la question.

## [1.7.2] — 2026-08-26

### Ajouté
- Coffre-fort de mots de passe intégré : trousseaux chiffrés AES-256-GCM, clé
  dérivée par scrypt, mot de passe maître jamais stocké. Catégories, TOTP,
  audit local, import/export, verrouillage automatique.
- Proposition d'enregistrement après une connexion et générateur de mot de
  passe à l'inscription, dans la page.
- Mode épuré : en-tête, barre latérale et barre du bas masquables, révélés au
  bord de l'écran, zone par zone.
- Menu contextuel dessiné par Orbit : rangée d'icônes de navigation, sections,
  navigation au clavier. Menu natif en repli.
- Lecture vocale des pages via le moteur du système, et voix neuronales hors
  ligne avec Piper (installation à la demande).
- Portée d'une app : ce profil seulement, ou tous les profils.
- Bloqueur de pub réglable app par app.
- Raccourci de changement de profil.

### Modifié
- Les favoris deviennent des « épinglés » : plus de doublon dans la liste.

### Corrigé
- Les téléchargements en cours ne sont plus interrompus quand l'application
  passe en arrière-plan, et quitter avec un téléchargement actif demande
  confirmation.
- Les modales et menus se ferment au clic à l'extérieur, y compris quand ce
  clic a lieu dans une page embarquée.
- Le panneau des téléchargements ne se fermait plus à chaque ligne supprimée.

### Sécurité
- Fuses Electron activées au packaging (`runAsNode`, inspection, `NODE_OPTIONS`,
  chargement depuis l'asar uniquement, intégrité de l'asar, chiffrement des
  cookies).
- Les pages embarquées ne peuvent plus atteindre les commandes du coffre.
- `shell.openExternal` valide le schéma des URL venues d'une page embarquée.
- Remplissage automatique refusé dans un champ invisible et avant toute
  interaction réelle de l'utilisateur.

## [1.7.1] — 2026-08-25

### Corrigé
- Erreurs de notifications.
- Mise à jour du catalogue d'applications.

## [1.7.0] — 2026-08-25

### Ajouté
- Capture d'écran d'une page d'application.

### Corrigé
- Détection audio dans les pages web.
- Affichage du bouton sur le bord de l'application.
- Son de notification.

---

Les versions antérieures à 1.7.0 n'ont pas de notes rédigées : leur historique
se lit dans les commits (`git log v1.6.0`).
