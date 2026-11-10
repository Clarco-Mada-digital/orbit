# Notes de version

Ce fichier est la source unique des notes de version : il alimente l'onglet
« À propos » dans l'application **et** le texte de la release GitHub. Une
version sans section ici ne peut pas être publiée (`npm run release` refuse).

Format : une section `## [X.Y.Z] — AAAA-MM-JJ` par version, puis des
sous-sections `### Ajouté` / `### Modifié` / `### Corrigé` / `### Sécurité`.
La plus récente en premier.

## [1.20.0] — 2026-11-10

### Ajouté
- **Fake data : les images de test.** Un champ d’avatar ou d’URL de photo reçoit
  l’adresse d’un portrait de stock (Random User Generator) ou d’une photo
  aléatoire (Lorem Picsum). Un champ de fichier qui attend une image reçoit un
  vrai fichier PNG **dessiné localement** dans un `<canvas>` et injecté via
  `DataTransfer` : aperçus et contrôles de type le voient comme un fichier
  choisi à la main, sans aucune requête réseau. Les champs de fichier qui
  n’acceptent pas d’image (`.pdf`, documents) sont ignorés.
- **Fake data : identité et paiement de test.** Le détecteur reconnaît en plus le
  sexe, la date de naissance, l’âge, l’IBAN français (clé modulo 97 valide), le
  numéro de carte (valide au sens de Luhn, préfixe de test 4242), la date
  d’expiration future et le cryptogramme. Les listes déroulantes, cases à cocher,
  boutons radio, plages, couleurs, dates et heures sont remplies comme avant,
  désormais aussi depuis l’extension ZIP.
- **Réglages → Extensions : nouveaux champs personnalisés** (photo de profil,
  pays, région, fonction) et option **« Photos et images de test »** pour couper
  les adresses d’images externes et n’utiliser que le dessin local.
- **Extension Fake Data Filler 1.7.0** (ZIP) alignée sur le chemin natif :
  remplissage du formulaire actif (`Alt+Maj+F`), listes déroulantes, images et
  nouveaux types.

### Corrigé
- **Fenêtre détachée : zoom, rechargement et clic droit.** Cette fenêtre n'avait
  ni barre d'outils ni raccourcis : une page trop petite ou bloquée n'offrait
  aucune issue. Elle reçoit maintenant le même preload que les pages
  embarquées (donc `Ctrl + molette`), `Ctrl +` / `Ctrl -` / `Ctrl 0` pour le
  zoom, `Ctrl + R` / `F5` pour recharger, `Alt + ←/→` pour l'historique, et un
  clic droit avec copier/coller, précédent/suivant, recharger et zoom. Le zoom
  part de la valeur de l'app et y est mémorisé.
- **Pages volantes : le vrai nom et la vraie icône du site.** Un lien libre
  s'appelait jusqu'ici par son domaine et retombait sur un globe ou l'icône
  d'un service tiers. La barre latérale affiche désormais le titre de la page
  (comme un onglet de navigateur) dès que le moteur le connaît, et l'icône est
  le favicon réellement déclaré par le site. En cause : l'écouteur de favicon
  était branché sur `favicon-updated`, un événement qui n'existe pas dans
  Electron — le bon nom est `page-favicon-updated`. Une page privée en profite
  aussi ; sa pastille de lunettes la distingue toujours.

## [1.19.1] — 2026-11-08

### Ajouté
- **Les extensions ne sont plus embarquées : elles se téléchargent.** Orbit lit
  un catalogue publié en ligne et récupère l'archive au moment où vous
  installez. Une application qui portera peut-être cent extensions ne grossit
  plus de toutes celles que personne n'installe, et une extension corrigée
  n'attend plus la prochaine version d'Orbit pour arriver. Hors ligne, le
  magasin affiche la dernière liste connue, datée ; un champ de recherche
  apparaît dès que le catalogue s'allonge, et le poids de chaque archive est
  annoncé avant le téléchargement.
- **Une page pour les extensions** sur le site : la liste se construit depuis
  le même catalogue que l'application, et chaque archive s'y télécharge
  directement — pour l'installer ensuite depuis son ordinateur.
- **Un guide pour écrire son extension** (`docs/guide-extensions.md`) : format
  attendu, ce que le moteur sait faire et ce qu'il ne sait pas, essais et
  publication.
- **Téléphone : un vrai bureau, à composer soi-même.** La barre d'état sert de
  poignée à un volet qui descend avec les notifications et les contrôles, comme
  sur le téléphone. Entre les deux, des cartes que l'on ajoute, déplace,
  redimensionne et retire ; en bas, un dock. Le bureau est **sobre par défaut**
  — l'heure et les favoris — et « tout afficher » le remplit d'un clic.
- **Téléphone : cinq cartes qui montrent le téléphone lui-même.** L'écran
  vivant (un aperçu rafraîchi, qui ouvre le miroir), l'agenda, la lecture en
  cours avec ses commandes, le stockage, et la tuile d'application — n'importe
  quelle application avec son compteur et sa dernière notification. Les widgets
  Android d'autres applications ne sont pas hébergeables (Android ne les expose
  qu'à un lanceur installé sur le téléphone) : ces cartes lisent les mêmes
  données directement sur l'appareil.
- **Téléphone : sonnerie, Ne pas déranger, Wi-Fi et Bluetooth** dans le volet et
  dans l'accès rapide flottant, avec l'état réel lu sur l'appareil.
- **Téléphone : envoyer un dossier entier**, son arborescence recréée dans les
  téléchargements. L'envoi de plusieurs fichiers à la fois existait déjà mais ne
  se devinait pas — le libellé le dit maintenant.
- **Miroir : images par seconde et débit vidéo réglables.** Ils étaient
  appliqués sans être réglables nulle part ; ce sont les deux boutons que l'on
  cherche sur une liaison sans fil.

### Modifié
- **Accès rapide au téléphone : la pastille flottante porte sa propre
  identité.** Elle affichait l'icône de la première application épinglée, donc
  elle annonçait une application alors qu'un clic ouvre un panneau. Ce panneau
  réunit désormais les applications épinglées *et* les raccourcis du téléphone.
- **Téléphone : une barre de moins.** L'en-tête répétait ce que la barre d'état
  du bureau affiche déjà, et son engrenage doublait l'onglet Réglages.
- **Le bouton Téléphone de la barre du haut ne se réimpose plus.** Il était
  réinséré à chaque démarrage : l'enlever ne servait à rien. C'est un module
  comme un autre, que l'on place soi-même.
- **Réglages du Téléphone : le ménage.** Quatre réglages qui ne pilotaient rien
  ont disparu ; trois autres, à moitié branchés, fonctionnent enfin — le tri du
  tiroir est mémorisé, « largeur minimale d'une tuile » agit vraiment, et
  « taille des icônes » vaut aussi pour le bureau.
- **Les listes d'applications remplissent la largeur.** Favoris, récentes et
  tiroir s'étalaient sur un nombre fixe de colonnes ou défilaient
  horizontalement : ils s'adaptent maintenant à la fenêtre.

### Corrigé
- **Un appel entrant pouvait s'annoncer « null ».** Le champ `tickerText` d'une
  notification Android vaut littéralement « null » quand il est vide, et ce mot
  passait pour le nom de l'appelant dès que le titre était générique.
- **Souris & Défilement 1.1.1** : correctif d'accessibilité de la page d'options
  qui n'avait jamais été publié, l'archive étant restée en retard sur ses
  sources. La publication refuse désormais cet écart.
- Un test de coffre-fort échouait au hasard une fois sur cinquante : il
  cherchait un identifiant de trois lettres dans une archive chiffrée, où une
  telle suite apparaît par pur hasard.

### Sécurité
- **Les archives d'extensions sont vérifiées avant installation.** L'adresse de
  téléchargement ne peut pas quitter le dossier du catalogue, la taille reçue
  est bornée pendant la réception, et l'empreinte SHA-256 doit correspondre à
  celle que le catalogue annonce — sans quoi l'archive est refusée, pas
  installée. Le catalogue lui-même n'est lu qu'en HTTPS, et chacune de ses
  entrées est validée avant d'être proposée.

## [1.19.0] — 2026-11-06

### Ajouté
- **Studio : la disposition « Présentation » donne enfin la priorité à ce qui
  porte l'information.** La capture garde toute la hauteur et presque toute la
  largeur ; la caméra devient une vignette posée à mi-hauteur sur le côté
  choisi — dans un coin, elle ne se distinguait plus de « écran + pastille ».
  Son **cadrage** se règle d'une touche (`O`) : *chevauché*, où elle mord sur
  la capture comme une incrustation de plateau, ou *espacé*, même vignette mais
  séparée. Sa **hauteur de pose** (haut / milieu / bas) se change avec `C` ou
  les flèches, pour la dégager de ce qu'on veut justement montrer.
- **Studio : les changements ne coupent plus l'image.** Changer de disposition,
  de cadrage ou de fond fait *glisser* la composition vers sa nouvelle place en
  une fraction de seconde, avec un fondu sur le fond. Un réglage qu'on fait
  glisser (taille de la pastille, marge) reste lui immédiat : l'animer donnerait
  un curseur que l'image suit avec un temps de retard.
- **Studio : chaque raccourci dit ce qu'il vient de changer**, sous l'aperçu —
  et dit aussi quand le réglage ne se voit pas encore (le cadrage sans caméra,
  le coin hors « écran + pastille »). Un raccourci sans effet visible était
  indiscernable d'un raccourci cassé.
- **Studio : les raccourcis marchent depuis l'application que vous filmez.**
  On filme son écran pour montrer autre chose : pendant la prise, le focus est
  ailleurs et les touches ne recevaient plus rien. Le temps de l'enregistrement
  seulement, Orbit pose les mêmes actions en raccourcis système
  (`Alt+Maj+D`, `F`, `C`, `Z`, `X`, `O`, `P`, `K`), et les libère à la fin.
  Seuls ceux réellement obtenus sont annoncés : un gestionnaire de fenêtres
  s'en réserve parfois un.
- **Studio : anneau de voix** (`V`) — un liseré respire autour de la caméra au
  rythme du micro, donc on voit qui parle. Mesuré en valeur efficace et non en
  crête, avec un seuil : sinon il clignoterait au rythme des consonnes ou
  vibrerait sur le bruit de fond.
- **Studio : coup de zoom** (`X`) — l'image se rapproche du curseur quelques
  secondes puis revient toute seule. C'est le geste qu'on fait au moment de
  montrer quelque chose, là où un zoom permanent finit par donner le mal de mer.
- **Studio : carton de titre** — quelques secondes de titre sur le fond, puis la
  composition se découvre dessous pendant qu'il s'efface.
- **Studio : la pause se voit dans la vidéo.** L'image se fige avec un bandeau
  qui reste un instant enregistré avant la coupure : à la relecture, la coupure
  se lit comme voulue au lieu d'un saut dont on se demande si on a manqué
  quelque chose.
- **Studio : cadrages mémorisés** — la mise en scène du moment s'enregistre sous
  un nom (jusqu'à cinq) et se rappelle d'un clic ou d'un `Alt`+chiffre. La
  définition et la cadence n'en font pas partie : ce sont des réglages propres à
  la machine, et les imposer donnerait une vidéo saccadée sans qu'on comprenne
  pourquoi.
- **Téléphone : la pastille des applications épinglées se replie en languette.**
  Poussée contre le bord gauche ou droit, il ne reste qu'un onglet discret ; un
  clic la rouvre, un glissement la ramène où vous voulez. Un point rouge y
  signale les notifications en attente. La pastille elle-même a maigri.
- **Veille des vulnérabilités** : un workflow hebdomadaire interroge OSV.dev et
  ouvre une alerte uniquement s'il y a quelque chose à dire. C'est le seul cas
  qu'une intégration continue classique ne voit jamais — devenir vulnérable
  sans qu'aucun commit ne soit poussé.

### Sécurité
- **`@xmldom/xmldom` passe de 0.7.13 à 0.8.15**, version abandonnée et visée par
  quinze CVE (injection via le DocType, entités externes). Elle était tirée par
  **kdbxweb**, c'est-à-dire par le parseur du XML des fichiers KDBX — donc d'une
  entrée qui vient de l'extérieur. La version corrigée est imposée en attendant
  que kdbxweb la suive.
- Trois autres avis publiés depuis la dernière version sont également couverts :
  `joi` → 18.3.1, `minimatch` → 11.0.1, `follow-redirects` → 1.16.2. Aucun
  n'était visible jusqu'ici : faute de synchronisation avec OSV.dev, l'analyse
  d'intégration continue comparait les dépendances à une liste de dix-sept
  paquets. Elle était verte sans avoir presque rien vérifié — le symptôme est
  exactement l'inverse d'une alerte.

### Modifié
- **Démarrage plus rapide** : la visionneuse de documents, le studio, le
  coffre-fort et la relecture hors ligne ne sont plus chargés au lancement mais
  à leur première ouverture. KaTeX (~280 Ko), que la visionneuse embarque pour
  les formules, sortait ainsi du paquet principal : **1145 Ko → 734 Ko**.
- **L'analyse de qualité ne tourne plus à chaque push**, mais aux versions et à
  la demande. Elle mesure une dette, qui bouge lentement ; en faire échouer un
  push plusieurs fois par jour pour les mêmes constats apprend à ne plus lire
  les notifications — y compris le jour où il y a vraiment quelque chose. Les
  tests, eux, restent à chaque push.

### Corrigé
- **Le bouton d'opacité d'une capture épinglée ne faisait rien sous Linux.**
  `BrowserWindow.setOpacity` n'existe que sous Windows et macOS et échoue en
  silence ailleurs. L'opacité est désormais appliquée dans la fenêtre, en CSS :
  même rendu partout, et la barre d'outils reste lisible à 30 %.
- **Accessibilité** : les champs de la page d'options de l'extension Souris &
  Défilement n'avaient pas d'étiquette associée — un intitulé posé à côté se
  voit, mais ne se lit pas à voix haute.

## [1.18.0] — 2026-11-05

### Ajouté
- **Annotation des captures avant enregistrement** : l'aperçu devient un
  éditeur — flèche, rectangle, ellipse, dessin libre, surligneur, texte,
  **étapes numérotées** (la pastille suivante se numérote toute seule, même
  après une annulation), **recadrage**, **masquage par pixellisation** (un flou
  se devine sur du texte, des blocs non), plus luminosité, contraste et
  saturation. Tout est dessiné DANS l'image : « Enregistrer » et « Copier »
  rendent exactement ce qui est affiché, et une capture non retouchée part
  telle quelle, sans ré-encodage. Le recadrage ne déplace pas les annotations :
  il change la fenêtre regardée, et « Tout l'écran » revient en arrière.
- **Masquage assisté des données sensibles** : adresses e-mail, IBAN, numéros
  de carte et de téléphone sont repérés **dans la page**, avant la capture —
  seul moment où le texte est encore du texte, avec ses coordonnées. Un bouton
  les masque d'un coup ; chaque masque reste une forme annulable. Les numéros
  de carte sont validés par la clé de Luhn et les IBAN par le modulo 97, pour
  ne pas masquer une référence de commande. L'échelle page → image est
  **mesurée**, jamais déduite du zoom et de la densité d'écran : un masque mal
  placé serait pire que pas de masque.
- **Épingler une capture** : la capture (annotée ou non) passe dans une petite
  fenêtre flottante toujours visible, déplaçable, redimensionnable et
  translucide au besoin (quatre niveaux) — pour la garder sous les yeux pendant
  qu'on travaille. Plusieurs épinglages se décalent en cascade. `Ctrl+C`
  copie, `Ctrl+S` enregistre, `Échap` ferme.
- **Qui appelle, dans le toast d'appel entrant** : le titre des notifications
  Android est souvent générique (« Appel entrant »). Orbit lit désormais les
  autres champs de la notification (dont les numéros portés par
  `android.people`), interroge la radio au besoin, puis **cherche le nom dans
  les contacts du téléphone**. Le toast affiche l'appelant, son numéro,
  l'application qui sonne et depuis combien de temps ça sonne ; à défaut, il
  dit franchement qu'aucune identité n'a été transmise.
- **Appels récents du téléphone** (widget d'accueil du Téléphone) : le journal
  d'appels du mobile, appels manqués en évidence, avec durée et horodatage.
  **Rappeler** lance l'appel depuis le téléphone, **Préparer** ouvre son clavier
  avec le numéro prêt (à confirmer sur l'appareil) — un appel ne part jamais par
  surprise. Les numéros inconnus du journal sont rapprochés des contacts, et un
  numéro masqué est signalé comme tel au lieu d'offrir un bouton mort.
- **Annoter l'écran** (studio : bouton « Annoter l'écran » ou touche `A`) :
  une couche de dessin plein écran, au-dessus de tout — stylo, surligneur,
  flèche, rectangle, ellipse, pointeur laser, six couleurs, trois épaisseurs,
  annuler, tout effacer. C'est une **vraie fenêtre**, donc l'enregistrement et
  les captures la reprennent telles quelles, sans que le studio ait à la
  composer, et elle fonctionne par-dessus n'importe quelle application. En mode
  pointeur, la couche est traversante : les clics vont aux applications et les
  tracés restent affichés. `Échap` rend la main, un second `Échap` ferme.
- **Envoyer un fichier au téléphone** : bouton dans les contrôles rapides de
  l'accueil du Téléphone. Le sélecteur est ouvert par le processus principal —
  aucun chemin ne vient de l'interface — et les fichiers arrivent dans les
  téléchargements du mobile. Le nom distant est assaini (ni séparateur, ni
  remontée de dossier, ni caractère de contrôle) ; les dossiers sont refusés.
- **Extension « Souris & Défilement »** (optionnelle, dans Extensions → 
  Extensions Orbit) : défilement lissé réglable (souplesse, pixels par cran,
  vitesse, sens, `Maj`+molette horizontal, défilement rapide), défilement
  automatique au clic du milieu, et une **palette de présentation**
  (`Alt+Maj+D`) — pointeur laser, stylo, surligneur, flèche, rectangle,
  ellipse, couleurs, épaisseurs, spot lumineux, halo de clic, curseur mis en
  évidence. Le pavé tactile est laissé tranquille (il défile déjà en continu)
  et les applications qui pilotent la molette elles-mêmes (cartes, Figma,
  éditeurs de code) ne sont jamais touchées.
- **Studio d'enregistrement** (`Alt+K` → « Studio », ou `Alt+Maj+S` → `4`) :
  filme un écran ou une fenêtre, avec ou sans caméra, et le met en scène —
  fond uni ou dégradé, marge, coins arrondis, ombre portée. Tout est composé
  sur un canvas, et c'est ce canvas qui est enregistré : l'aperçu EST la vidéo.
  - **Dispositions** : écran + pastille, caméra seule, côte à côte,
    présentation (caméra ronde qui chevauche le bord de la capture). La
    présentation existe aussi **sans caméra** : la capture est alors réduite et
    centrée, à la manière d'une diapositive.
  - **Caméra** : cercle ou arrondi, quatre coins, côté gauche/droite, taille,
    effet miroir.
  - **Mouvement** : halo qui met le curseur en valeur, zoom qui suit le
    pointeur en douceur.
  - **Raccourcis** pendant la prise. Accès DIRECT : `1`–`5` vont à une
    disposition, `Maj`+`1`–`8` à un fond, et les flèches placent la caméra un
    axe à la fois (`↑`/`↓` haut ou bas, `←`/`→` gauche ou droite). Les lettres
    font défiler quand on cherche encore : `F` fond, `D` disposition, `C` coin,
    `Z` zoom, `H` halo, `M` miroir. Et `P` pause, `S` arrêt, `R` réduire.
  - **« Écran seul »** garde la caméra branchée sans l'afficher : on explique
    en plein écran, puis on se réaffiche d'une touche, sans rechoisir le
    périphérique.
  - **Fenêtre réduite** : le studio se replie en une barre (chronomètre, pause,
    arrêt) — c'est ce qui permet de filmer Orbit lui-même.
  - **Définition et cadence réglables** (720p/1080p, 15/24/30 img/s) avec la
    cadence RÉELLEMENT tenue affichée pendant l'enregistrement : l'encodage se
    fait par le processeur, et une vidéo saccadée se découvre sinon à la
    relecture.
  - Sortie WebM dans « Vidéos/Orbit », conversion MP4 facultative si ffmpeg est
    présent.

### Modifié
- **Un espace de travail peut être réenregistré** sur la disposition actuelle
  (icône disquette, au survol de sa ligne) : l'ajuster n'oblige plus à le
  supprimer puis à le recréer sous le même nom.
- **La documentation se construit, elle ne se recopie plus.**
  `docs/guide-utilisateur.md` est la seule source ; `npm run docs` en dérive le
  HTML et le PDF (`scripts/build-docs.js`). Auparavant les trois fichiers
  vivaient leur vie séparément, et leur contenu divergeait. `test/docs.test.js`
  confronte en plus le guide aux listes qui vivent dans le code (outils
  d'annotation, raccourcis du studio, widgets du Téléphone, données sensibles,
  extensions du catalogue) : livrer une fonctionnalité sans la documenter fait
  désormais échouer `npm test`. La démarche est décrite dans `docs/README.md`.
- Le menu de capture (`Alt+Maj+S`) propose une quatrième voie, « Enregistrer
  une vidéo » : la question posée est la même, et on ne sait pas toujours
  d'avance si une image suffira.
- Orbit ne laisse plus Chromium endormir sa fenêtre quand elle passe en
  arrière-plan. C'est sans effet visible à l'usage, mais indispensable au
  studio : on filme son écran POUR montrer autre chose, donc Orbit passe
  derrière — et la vidéo tombait alors à deux ou trois images par seconde.

### Corrigé
- **Fermer une capture épinglée ouvrait une boîte « A JavaScript error occurred
  in the main process ».** Le gestionnaire `closed` lisait
  `win.webContents.id` alors que la fenêtre était déjà détruite
  (« Object has been destroyed »). L'identifiant est désormais retenu à la
  création.
- **Une extension Orbit livrée en version plus récente ne pouvait pas être mise
  à jour.** Le catalogue comparait les seuls NOMS et grisait le bouton dès
  qu'une extension du même nom était installée : l'ancienne version continuait
  de tourner — avec ses anciens raccourcis — sans qu'aucun écran ne le dise.
  Le catalogue compare maintenant les versions (numériquement : `1.10.0` est
  bien postérieur à `1.9.3`) et propose **« Mettre à jour »**, en affichant la
  version installée. Il ne propose jamais de revenir en arrière si la copie
  installée est plus récente que l'archive livrée.

## [1.17.3] — 2026-11-03

### Ajouté
- **Appels et applications épinglées dans Orbit Phone** : un toast global
  propose de décrocher ou refuser les appels entrants ; jusqu'à huit
  applications Android peuvent être épinglées dans une barre flottante.
- **Aperçu des captures d'écran** : choisir de sauvegarder, copier ou annuler
  après la capture, avec un délai réglable pour préparer l'écran.
- **Catalogue des modèles IA locaux** : actualiser les modèles disponibles et
  suivre leur téléchargement depuis les réglages.

### Modifié
- La correction orthographique tient compte de la langue détectée dans le texte,
  au lieu d'imposer la langue de l'interface.
- Les contrôles et erreurs de l'assistant IA sont rapprochés de la conversation.

## [1.17.2] — 2026-11-01

### Ajouté
- **Ouverture directe d'une base KeePass (.kdbx)** — Transférer → « Ouvrir une
  base KeePass ». C'est la voie COMPLÈTE : elle n'exige ni que KeePassXC
  tourne, ni association, et reprend **toutes** les entrées, y compris celles
  sans adresse de site, que le protocole navigateur ne peut pas rendre. Les
  groupes de la base deviennent des catégories ; la corbeille et les entrées
  vides sont écartées. Le fichier est lu en LECTURE SEULE et son mot de passe
  n'est ni conservé ni journalisé. KDBX 4 (Argon2) pris en charge.

### Corrigé
- **Le rapatriement KeePassXC répondait « Action incorrecte ».** L'action
  `get-database-entries` n'existe que depuis KeePassXC 2.8 ; sur 2.7.x — la
  version la plus répandue — la base ne peut pas être énumérée. Orbit interroge
  désormais, dans ce cas, les adresses de ses propres apps (ce que `get-logins`
  sait faire sur toutes les versions) et l'écran annonce clairement que
  l'import est partiel, en indiquant les deux moyens de tout rapatrier :
  KeePassXC 2.8+, ou l'ouverture directe du fichier .kdbx ci-dessus.

## [1.17.1] — 2026-11-01

### Corrigé
- **Le menu « Transférer » du coffre ne faisait rien.** Son détecteur de clic
  extérieur s'exécutait en phase capture : il refermait le menu avant que le
  clic n'atteigne l'entrée choisie. « Rapatrier la base KeePassXC », comme les
  trois autres actions, restait donc sans effet.
- **Ce menu s'ouvrait vers la gauche** et passait sous la colonne des sections
  des réglages, où ses entrées devenaient illisibles.
- **Réglages tronqués à droite** : la colonne de contenu gardait
  `min-width: auto`, donc elle refusait de rétrécir sous la largeur de son
  contenu. Une seule URL longue dans une entrée du coffre élargissait toute la
  colonne, et le panneau rognait le reste — barre d'outils et textes coupés.

## [1.17.0] — 2026-11-01

### Ajouté
- **Rapatriement KeePassXC** : un bouton recopie les identifiants de la base
  KeePassXC ouverte dans un trousseau Orbit, sans doublon (rapprochement par
  domaine et nom d'utilisateur, avec choix fusionner / écraser). Nécessite
  l'option « Allow limited access to all entries in connected databases » dans
  KeePassXC. Les entrées sans URL, que le protocole ne permet pas de récupérer,
  sont listées à la fin du rapatriement.
- **Sauvegarde chiffrée du coffre** : export `.orbitvault` en AES-256-GCM, clé
  dérivée par scrypt d'une phrase de passe dédiée, et restauration depuis
  l'application. L'archive conserve tout le trousseau (catégories, URLs
  secondaires, favoris, historique des mots de passe), contrairement au CSV.
- **Mots de passe dans la palette** : `Alt+K` cherche aussi dans les trousseaux
  déverrouillés et copie un mot de passe — ou un code TOTP — sans ouvrir les
  réglages. Le secret ne passe pas par l'interface : le processus principal
  écrit dans le presse-papiers et le vide après 30 s.
- **Vidage de l'historique** : oubli d'une page depuis `Alt+K` (bouton ou
  `Maj+Suppr`), commandes « oublier la dernière heure » et « vider tout
  l'historique », et une section Réglages → Confidentialité qui affiche ce qui
  est mémorisé, permet d'arrêter l'enregistrement et de vider par période.
- **Rendu markdown enrichi** (visionneuse de documents) : formules
  mathématiques TeX (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) mises en forme par
  KaTeX, lecteurs audio et vidéo (chargés seulement au clic), notes de bas de
  page numérotées avec aller-retour, titres soulignés, alertes GitHub
  (`> [!NOTE]`), échappements `\*` et adresses web reconnues sans crochets.
- **Sauvegarde automatique chiffrée du coffre** : archive `.orbitvault` écrite
  à intervalle régulier dans un dossier au choix, avec rotation des N dernières.
  La phrase de passe est confiée au trousseau du système ; sans trousseau
  disponible, Orbit refuse d'activer la fonction plutôt que d'écrire la phrase
  en clair. Seuls les trousseaux déverrouillés sont archivés, et l'écran le dit.
- **Déverrouillage sans saisie** (facultatif, par trousseau) : le mot de passe
  maître peut être confié au trousseau du système de la machine. L'écran
  explique ce que ça implique. La mémorisation est oubliée automatiquement si le
  mot de passe maître change ou si le trousseau est supprimé.
- **Code 2FA dans les pages** : après un remplissage, un bouton ⏱ remplit le
  champ de code du site — ou le copie par le processus principal si le champ
  n'existe pas encore, auquel cas le code n'entre jamais dans la page. Orbit
  revérifie que l'entrée demandée appartient bien au domaine affiché.
- **Réglages → Général → Recherche** : chaque source de la palette `Alt+K`
  (pages visitées, pages ouvertes, identifiants, code 2FA) s'active ou se coupe
  séparément.

### Corrigé
- **Alignement des colonnes de tableau** dans la visionneuse de documents :
  `|---:|` était analysé mais jamais appliqué, une colonne de nombres restait
  collée à gauche.

### Modifié
- L'écran d'export distingue la sauvegarde chiffrée (recommandée) de l'export
  CSV / JSON en clair, désormais présenté comme un outil de migration.
- **`npm test` passe au vert sans `node_modules`** : `shields-rules` n'a plus
  besoin de `tldts` (son module testé ne dépend de rien), et les trois fichiers
  qui exercent une vraie bibliothèque (react-markdown, zustand) sont ignorés
  avec une raison lisible au lieu d'échouer. La construction d'une page volante
  sort du magasin vers `src/lib/flyPages.js`, désormais testée sans dépendance.
- **Dictionnaire i18n découpé par domaine** (`src/lib/i18n/`) : le fichier
  unique dépassait 3 900 lignes. L'API ne change pas, et le test vérifie en
  plus qu'aucune clé n'est définie dans deux modules — un doublon y serait
  silencieux.
- Le choix des sources d'identifiants porte aussi le bouton de code 2FA des
  pages, pour que la décision reste au même endroit.
- Les notes de bas de page des réponses de l'assistant sont mises en valeur au
  lieu de se confondre avec le dernier paragraphe.

## [1.16.2] — 2026-10-27

### Ajouté
- **Santé du coffre-fort** : évaluation des mots de passe faibles ou réutilisés,
  statistiques de robustesse et vérification facultative des mots de passe
  compromis avec le protocole k-anonymity de Have I Been Pwned.
- **Import de trousseaux** : choisissez de fusionner ou remplacer un trousseau
  existant portant le même nom.
- **Formulaires et snippets** : `Alt+Maj+F` remplit les champs visibles du
  formulaire actif ; Text Snippets développe immédiatement les abréviations,
  y compris dans les modales.
- **Documentation publique** : guides utilisateur et développeur, guide PDF et
  page de présentation Orbit publiable avec GitHub Pages.

### Corrigé
- Les extensions et raccourcis de page sont maintenant disponibles dans les
  fenêtres détachées et leurs fenêtres de connexion.
- Le chargement des extensions dans une session détachée attend leur
  synchronisation avec les réglages du profil.

## [1.16.1] — 2026-10-25

### Ajouté
- **Gestionnaire de téléchargements** : page dédiée aux téléchargements,
  historique, choix du dossier, liens torrent magnet et options de médias.
- **Web Clipper** : capture locale d'une sélection ou d'une page, recherche
  dans la bibliothèque et export Markdown d'une capture ou de toute la collection.
- **Correcteur hors ligne** : détection du système et du runtime Java pour
  guider l'installation de LanguageTool sur Linux, macOS et Windows.

### Corrigé
- Le choix du dossier de destination ne déclenche plus de demande de dossier
  en double et les téléchargements sont finalisés dans le dossier sélectionné.
- Le serveur de modèles locaux limite maintenant le CORS aux origines Orbit
  autorisées ; les liens magnet sont validés avant d'ouvrir le client torrent.
- Les tests imbriqués d'agents sont maintenant exécutés de manière fiable sous
  Node 22, utilisé par la CI.
- Les releases mettent à jour le manifeste npm et le lockfile ensemble. Le
  workflow de release ne se déclenche que sur un tag de version.

## [1.16.0] — 2026-10-24

### Ajouté
- **Discussions IA enrichies** : réponses et messages affichent le Markdown
  (titres, listes, tableaux, code et liens) ainsi que les formules LaTeX,
  intégrées ou sur plusieurs lignes.
- **Espace de travail IA** : discussions et agents sont accessibles depuis une
  barre latérale repliable. Les agents sont classés par catégorie, leurs
  commandes `/` sont propres à l'agent actif, et les réponses comme les
  conversations peuvent être copiées, supprimées ou exportées en Markdown,
  seules ou en groupe.
- **Accueil Orbit Phone** : « Tout effacer » écarte les notifications du
  téléphone ; le fond peut être choisi parmi des dégradés ou photos, une image
  locale ou une URL. Les widgets Orbit de l'accueil restent personnalisables.
- **Personnalisation de l'espace de travail** : dossiers et liens partagés entre
  profils complètent la réorganisation des applications dans la barre latérale.

### Corrigé
- Les téléchargements de modèles locaux utilisent désormais des révisions
  immuables, une taille attendue et une empreinte SHA-256 vérifiée. Les choix
  SmolLM2 135M et Qwen2.5 0.5B correspondent à leurs vrais fichiers publiés ;
  le modèle Llama 1B incomplet n'est plus proposé.
- Les règles de permissions demandent une décision explicite pour les accès
  sensibles et refusent par défaut quand aucune interface de confirmation n'est
  disponible.

### Sécurité
- Mise à jour d'Electron et des dépendances vulnérables ; l'audit npm ne relève
  plus de vulnérabilité connue.
- Le rendu Markdown de l'assistant n'exécute pas le HTML fourni et neutralise
  les liens non sûrs ; les images distantes ne sont pas chargées.

## [1.15.0] — 2026-10-22

### Ajouté
- **Orbit Phone — bureau repensé** : favoris et applications récentes en
  cartes compactes, avec une disposition qui utilise toute la largeur disponible.
  Les commandes Écran, Miroir, Retour, Accueil, Récents et Volume sont accessibles
  directement depuis l'accueil, sans ouvrir le tiroir d'applications.
- **Contrôles Android** : bascule du Wi-Fi et du Bluetooth, commandes de volume
  et raccourcis vers les réglages Android du réseau, du son et de l'appareil.
  Les contrôles rapides peuvent être masqués dans les réglages du bureau Phone.

### Corrigé
- **Réorganisation des applications** : le glisser-déposer dans l'espace entre
  deux applications les place maintenant près de la cible visée, au lieu de les
  envoyer en fin de liste. Un repère indique l'insertion avant ou après la cible.
- **Suggestions du correcteur** : les corrections orthographiques utilisent le
  menu natif pour que Chromium conserve le champ actif et remplace effectivement
  le mot sélectionné.
- **Choix du dossier de téléchargement** : les erreurs d'ouverture du sélecteur
  sont désormais signalées dans les réglages, et le dialogue démarre dans un
  dossier valide.

### Modifié
- Les commandes rapides de Phone sont regroupées avec les raccourcis d'écran
  dans une barre compacte ; les actions par icône affichent leur libellé au
  survol et les sections Favoris/Récents s'étendent lorsqu'elles sont seules.

## [1.14.0] — 2026-10-13

### Ajouté
- **Ouvrir des liens avec Orbit** : Orbit se propose dans la liste « Ouvrir avec »
  du système pour les liens web (`http` / `https`) et les fichiers `.html` /
  `.htm` / `.xhtml`. Rien ne change tant qu'on n'active pas cette option dans
  Réglages : on ne prend **jamais** le gestionnaire par défaut. Une fois activé,
  un lien ou un fichier reçu depuis l'extérieur s'ouvre dans une **page volante**
  (session isolée, jetable).
- **Page d'accueil personnalisable** : quand aucune app n'est ouverte dans un
  profil, on affiche maintenant une page d'accueil au lieu d'un écran noir.
  Fond configurable (presets dégradés, image, flou/assombrissement),
  raccourci Alt+K affiché sur la page, et quelques widgets légers.

### Corrigé
- **Impossible de se connecter depuis une app en localhost** : les cookies d'un
  site local (`localhost`, `127.0.0.1`) étaient supprimés lors de la navigation.
  La cause était la règle des Boucliers qui classait ces requêtes comme tierces
  : la règle replie désormais sur l'hôte quand l'origine n'a pas de domaine
  enregistrable — sans toucher aux tiers (un vrai site tiers reste bloqué).

### Modifié
- Le choix des liens reçus (cli, second-instance, `open-url`, `open-file` macOS)
  est centralisé dans `electron/open-links.js` : règles strictes (http/https
  uniquement, et uniquement les pages `.html`), gère les arguments cités,
  ignore les options CLI et le serveur de dev.
- **Release** : ajout des déclarations d'association dans `package.json` (`linux`
  `mimeTypes`, `mac` `fileAssociations` + `protocols`) et d'un module
  `electron/default-app.js` pour la proposition réversible sur Linux.

### Interne
- `electron/open-links.js` et `electron/default-app.js` couverts par des tests
  unitaires (dépôt intégrité, types MIME, refus hors-Linux, non-écrasement
  d'un fichier étranger).
- Suite de tests portée à **294 tests**.

## [1.13.0] — 2026-10-09

### Ajouté
- **Mémoire et CPU de chaque app** : survoler une ligne de la barre latérale
  (une application installée comme une page volante) affiche sa mémoire
  résidente et son CPU, **ainsi que le classement des cinq plus gourmandes**
  avec leur total — de quoi repérer d'un coup d'œil l'app qui mange la machine,
  sans les survoler une par une. Le relevé est **local** et ne tourne que
  pendant le survol (toutes les 2 s). Une app en veille, non chargée, ou dont le
  processus de rendu n'est pas encore né, affiche un état explicite (« en
  veille », « non chargée », « relevé en cours ») plutôt qu'un chiffre faux.

### Corrigé
- **Page blanche sur une adresse IP littérale** : avec « passer en HTTPS »
  activé, Orbit réécrivait `http://192.168.1.50:8080` en `https://…`. Un serveur
  joignable en `IP:port` (NAS, box, backend auto-hébergé, dev local) ne parle
  presque jamais TLS — le handshake échouait et la page restait **blanche**,
  alors qu'un navigateur classique l'affiche sans broncher. Les adresses IP
  (IPv4 comme IPv6) sont désormais traitées comme les hôtes locaux : jamais
  « upgradées ».
- **Correcteur orthographique : la suggestion ne remplaçait rien** : cliquer un
  mot proposé dans le menu contextuel laissait le mot fautif souligné — « rien
  ne change ». Le menu est une surcouche HTML dans la fenêtre d'Orbit : il
  prenait le focus de la fenêtre, alors que Chromium remplace le mot de la frame
  **focalisée**, c'est-à-dire celle de l'app. Le remplacement visait donc une
  frame qui n'était plus la bonne. Le menu ne vole plus le focus, et le
  remplacement attend qu'il soit effectivement acquis avant d'agir.

### Interne
- Le relevé de mémoire passe par `app.getAppMetrics()` :
  `webContents.getProcessMemoryInfo()` n'existe pas dans le build Electron
  épinglé, et l'appel échouait silencieusement.
- Suite de tests portée à **234 tests** (dont l'exclusion des IP littérales de
  la réécriture HTTPS).

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
