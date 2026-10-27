# Orbit — guide utilisateur

**Un espace de travail pour vos applications web**<br />
Développé par **Clarco RAHERINANDRASANA**<br />
Documentation française · édition 2026

> Les libellés, extensions et raccourcis peuvent évoluer selon la version. Les
> raccourcis affichés dans **Réglages → Raccourcis** font foi pour votre
> installation.

## 1. Découvrir Orbit

Orbit est une application de bureau pour Windows, macOS et Linux. Elle ouvre vos
services web dans des vues intégrées et les organise dans une barre latérale.
Chaque profil peut regrouper ses propres applications, connexions, apparence et
espace de travail.

### Ce qu’Orbit rassemble

- Applications web et liens personnels dans un espace configurable.
- Profils et sessions isolées, avec partage de connexion facultatif au sein d’un
  profil (SSO).
- Conteneurs pour utiliser plusieurs comptes d’un même service.
- Écran partagé, espaces de travail, fenêtres détachées et dossiers d’apps.
- Recherche, assistant IA, correcteur, coffre-fort et gestionnaire de
  téléchargements.
- Extensions optionnelles, dont Text Snippets, Fake Data Filler et Web Clipper.
- Orbit Phone en extension optionnelle pour piloter un appareil Android
  compatible.

Orbit ne remplace pas les services web que vous ajoutez : leur disponibilité, les
connexions et leurs règles de confidentialité restent celles de leurs éditeurs.

## 2. Installer et lancer Orbit

Téléchargez la version publiée depuis la
[page des releases GitHub](https://github.com/Clarco-Mada-digital/orbit/releases/latest).
Choisissez le format correspondant au système :

| Système | Formats publiés |
|---|---|
| Windows | Installateur `.exe` ou version portable `.exe` |
| Linux | `.AppImage` ou paquet Debian `.deb` |
| macOS | Image disque `.dmg` ou archive `.zip` |

L’application n’est pas signée pour toutes les plateformes. Windows
SmartScreen ou macOS Gatekeeper peuvent afficher un avertissement d’éditeur non
identifié. Vérifiez que le téléchargement vient bien de la release du dépôt
officiel avant de décider de poursuivre.

Au premier démarrage, l’écran de bienvenue permet d’ajouter une première app ou
de commencer avec un espace vide. Installez vos applications via la boutique
intégrée ou ajoutez une URL web.

## 3. Organiser son espace

### Applications

- Utilisez **+** ou la boutique pour ajouter une app.
- Ajoutez une URL personnelle si le service n’est pas dans le catalogue.
- Réorganisez la liste par glisser-déposer ; créez des dossiers pour regrouper
  les apps.
- Le clic droit sur une app donne accès aux actions telles que favori, veille,
  fenêtre détachée, déplacement de profil ou gestion de session.

### Profils et sessions

Créez des profils séparés, par exemple Travail et Personnel. Par défaut, les
sessions sont cloisonnées pour réduire les mélanges de comptes. L’option de
partage de connexion d’un profil rapproche le comportement d’un navigateur :
les apps du profil peuvent partager la session d’un même service. Les conteneurs
servent à garder plusieurs comptes séparés lorsque c’est nécessaire.

Avant de changer le mode de partage, lisez l’avertissement affiché dans Orbit :
les apps peuvent être rechargées et certaines sessions nécessiter une nouvelle
connexion.

### Espaces, fenêtres et apparence

- Placez plusieurs apps côte à côte dans l’écran partagé et enregistrez une
  disposition dans un espace de travail.
- Détachez une app dans une fenêtre séparée lorsque vous souhaitez la déplacer
  sur un autre écran.
- Personnalisez le thème, la couleur d’accent, les polices et les modules
  affichés dans les barres.
- Chaque profil peut avoir ses réglages d’accueil et de fond distincts.

## 4. Recherche et raccourcis utiles

Sur Windows et Linux, les raccourcis Orbit utilisent généralement **Alt**. Sur
macOS, le modificateur équivalent est généralement **⌘**. Les apps web conservent
leurs raccourcis propres.

| Raccourci | Action |
|---|---|
| `Alt/⌘ + K` | Recherche et palette de commandes |
| `Alt/⌘ + ,` | Réglages |
| `Alt/⌘ + Maj + O` | Boutique d’applications |
| `Alt/⌘ + Maj + P` | Gestion des profils |
| `Alt/⌘ + L` | Modifier l’URL de la page active |
| `Alt/⌘ + Page ↓ / Page ↑` | App suivante / précédente |
| `Alt/⌘ + Maj + Page ↓ / Page ↑` | Profil suivant / précédent |
| `Ctrl + F` ou `⌘ + F` | Rechercher dans la page |
| `Ctrl + R` ou `⌘ + R` | Recharger l’app active |
| `Alt/⌘ + Maj + E` | Relire le champ actif hors ligne |
| `Alt/⌘ + Maj + I` | Ouvrir la relecture IA du texte actif |
| `Alt/⌘ + Maj + A` | Ouvrir la discussion IA |

Les raccourcis IA peuvent être configurés. La liste à jour et les réglages
personnalisés se trouvent dans Orbit.

## 5. Assistant IA et relecture

Orbit propose un assistant de discussion, des outils de résumé et de rédaction,
ainsi qu’une relecture. Le mode local facultatif télécharge un modèle sur
l’appareil ; il peut demander de l’espace disque, de la mémoire et un matériel
compatible.

Des fournisseurs distants peuvent aussi être configurés. La connexion à ces
services et le traitement des textes dépendent du fournisseur. Lisez la
confirmation présentée par Orbit avant d’envoyer du contenu. Les clés API
configurées sont protégées par le stockage sécurisé du système lorsqu’il est
disponible.

Le correcteur rapide fonctionne localement. Un moteur grammatical LanguageTool
local peut être installé en option ; il nécessite Java 17 ou plus récent et un
téléchargement initial conséquent. Les règles rapides restent disponibles si le
moteur complet n’est pas installé.

## 6. Coffre-fort de mots de passe

Le coffre-fort intégré stocke les identifiants dans des trousseaux protégés par
un mot de passe maître. Déverrouillez uniquement lorsque vous souhaitez
consulter ou utiliser les entrées. Les fonctions de santé du coffre peuvent
signaler les mots de passe faibles ou réutilisés et, si vous l’activez, vérifier
les mots de passe compromis à travers un service externe.

Lors de cette vérification facultative, Orbit calcule localement une empreinte
SHA-1 et n’envoie que les cinq premiers caractères au service Have I Been
Pwned ; le service voit néanmoins l’adresse IP et l’heure de la requête.
Consultez les explications affichées dans les réglages de santé avant de
l’activer.

Les trousseaux peuvent être exportés et importés. Vérifiez le contenu d’une
archive importée et conservez les exports dans un emplacement protégé.

## 7. Téléchargements et extensions

### Gestionnaire de téléchargements

La page **Téléchargements** rassemble les fichiers, l’historique, les
téléchargements de médias pris en charge et les réglages de destination. Vous
pouvez choisir un dossier permanent ou demander un emplacement à chaque
téléchargement. Les liens magnet sont transmis au client torrent associé par le
système ; Orbit n’est pas lui-même un client torrent.

La disponibilité du téléchargement de vidéos/audio dépend des outils et des
conditions du site source. Respectez les droits d’auteur, les conditions
d’utilisation et les lois applicables.

### Installer une extension Orbit

Ouvrez **Réglages → Extensions**. Les extensions distribuées séparément peuvent
être installées depuis leur archive ZIP. Une extension n’est activée qu’après
installation et activation. Les extensions du Chrome Web Store ne sont pas
toutes compatibles avec Electron.

- **Text Snippets** : remplace les abréviations configurées (par défaut, par
  exemple `;email`) par leur texte complet dans les champs compatibles. La
  conversion se produit au fil de la saisie.
- **Fake Data Filler** : 🎲 ou `Alt+F` remplit le champ focalisé ; `Alt+Maj+F`
  remplit les champs visibles du formulaire actif. Les champs de connexion sont
  ignorés. Les valeurs sont générées localement ; les champs personnalisés se
  règlent dans Extensions.
- **Web Clipper** : conserve localement une sélection ou le contenu principal
  d’une page, puis permet de rechercher et d’exporter les captures en Markdown.
- **Orbit Phone** : extension optionnelle pour afficher les contrôles de bureau
  et notifications d’un Android compatible. Les widgets disponibles sur son
  accueil sont des widgets Orbit ; les widgets Android natifs ne sont pas
  hébergés dans cette interface.

## 8. Confidentialité et sécurité

- Les profils et applications utilisent des sessions web isolées selon la
  configuration ; le SSO est facultatif.
- Le stockage des cookies dans les versions empaquetées utilise le mécanisme de
  chiffrement d’Electron et le trousseau du système lorsqu’il est disponible.
- Les données de l’assistant local et de la relecture rapide restent sur
  l’appareil. Les fonctions connectées envoient les données nécessaires au
  fournisseur choisi.
- Fake Data et Text Snippets n’ont pas besoin de services externes pour
  fonctionner.
- Les services web intégrés continuent de recevoir les données que vous saisissez
  directement sur leurs pages.

Protégez votre compte système, votre mot de passe maître et vos fichiers de
sauvegarde. Le chiffrement local ne remplace pas une sauvegarde sécurisée.

## 9. Dépannage

**Une app reste blanche ou ne se connecte pas**

Vérifiez votre connexion, rechargez la page, puis vérifiez que le service n’est
pas en panne. Si une app a perdu sa session, reconnectez-vous. En dernier
recours, utilisez les commandes de gestion de données de cette app en sachant
qu’une suppression de cookies vous déconnectera.

**Une extension ne réagit pas**

Vérifiez qu’elle est installée et activée dans **Réglages → Extensions**. Après
une modification d’extension, rechargez l’app web. Pour Text Snippets, vérifiez
le déclencheur et l’abréviation dans ses options. Certaines pages, champs
protégés et contenus fournis par des extensions tierces peuvent limiter
l’injection.

**L’assistant local ne démarre pas**

Vérifiez le modèle installé, la mémoire disponible et la compatibilité GPU
indiquée dans les réglages. Le fournisseur en ligne reste une option séparée.

**LanguageTool ne démarre pas**

Vérifiez que Java 17 ou plus récent est installé. Orbit indique la commande
adaptée aux distributions prises en charge ; les règles rapides restent
utilisables sans Java.

**Où trouver les diagnostics et l’aide ?**

Consultez **Réglages → Diagnostic** puis ouvrez une
[discussion GitHub](https://github.com/Clarco-Mada-digital/orbit/issues) en
fournissant le système, la version d’Orbit et les étapes reproductibles. Ne
joignez pas de mots de passe, cookies ou données privées.

## 10. Liens utiles

- [Télécharger Orbit](https://github.com/Clarco-Mada-digital/orbit/releases/latest)
- [Code source](https://github.com/Clarco-Mada-digital/orbit)
- [Guide PDF](./guide-utilisateur.pdf)
- [Guide développeur](./guide-developpeur.md)
- [Page de présentation](./index.html)

---

**Orbit** · Développé par **Clarco RAHERINANDRASANA** · Licence MIT.
