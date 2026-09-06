# Notes de version

Ce fichier est la source unique des notes de version : il alimente l'onglet
« À propos » dans l'application **et** le texte de la release GitHub. Une
version sans section ici ne peut pas être publiée (`npm run release` refuse).

Format : une section `## [X.Y.Z] — AAAA-MM-JJ` par version, puis des
sous-sections `### Ajouté` / `### Modifié` / `### Corrigé` / `### Sécurité`.
La plus récente en premier.

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
