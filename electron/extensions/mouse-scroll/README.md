# Souris & Défilement

Extension **optionnelle** d'Orbit, dans l'esprit de *Mos* sur macOS : elle rend
la molette agréable dans les pages web, et ajoute deux outils du même geste —
le défilement automatique et les aides à la présentation.

Rien n'est actif tant qu'elle n'est pas installée, et rien ne quitte la
machine : aucune requête réseau, aucune permission d'hôte, seul
`chrome.storage.local` sert à retenir les réglages.

## Installation

1. Dans Orbit : **Extensions → Extensions Orbit → Installer** en face de
   « Souris & Défilement ». Sinon **Installer un ZIP** et choisir
   `mouse-scroll.zip` (dossier `extensions-dist/`).
2. Rien d'autre à faire : les pages déjà ouvertes prennent le réglage après un
   rechargement.
3. **Extensions → Souris & Défilement → ⚙️** pour tout régler.

## Ce que ça fait

### Défilement lissé
La page **glisse** vers sa position au lieu de sauter d'un cran. Réglables :
souplesse, pixels par cran, vitesse, sens inversé, <kbd>Maj</kbd> + molette
pour l'axe horizontal, et un modificateur de défilement rapide
(<kbd>Alt</kbd> par défaut, ×3).

Deux précautions qui comptent à l'usage :

- **le pavé tactile est laissé tranquille** par défaut : il envoie déjà un
  défilement continu, le lisser une seconde fois le rendrait pâteux. La
  distinction se fait sur la forme des événements (un cran de molette est franc
  et isolé, un pavé tactile envoie des rafales de petites valeurs) ;
- **les applications qui pilotent la molette elles-mêmes** ne sont jamais
  touchées : cartes, Figma, Miro, Excalidraw, éditeurs de code (Monaco,
  CodeMirror, Ace), canevas, vidéos. <kbd>Ctrl</kbd> + molette reste le zoom du
  navigateur.

### Défilement automatique
**Clic du milieu maintenu**, puis on éloigne la souris : la page défile seule,
d'autant plus vite que le curseur s'éloigne. Un clic du milieu **sans
mouvement** garde son comportement habituel (collage X11, nouvel onglet) — le
défilement ne s'engage qu'après un vrai déplacement.

### Palette de présentation — <kbd>Alt+Maj+D</kbd>

Un seul raccourci ouvre une **palette visible**, et tout s'y choisit :

| Dans la palette | |
| --- | --- |
| 🔴 Pointeur laser | point lumineux avec traîne, aucune trace laissée |
| ✏️ Stylo · 🖍️ Surligneur | dessiner / surligner directement sur la page |
| ↗ Flèche · ▭ Rectangle · ◯ Ellipse | désigner une zone |
| **6 couleurs · 4 épaisseurs** | le réglage qu'on vient chercher, en un clic |
| 💡 Spot lumineux · ◎ Halo de clic · ✛ Curseur | aides visuelles pour filmer |
| 🖱️ | couper / rétablir le lissage **sur ce site** |
| ↶ Annuler · 🧽 Effacer · ✕ Fermer | |

La palette se déplace par sa poignée `⠿` et retient sa position. Les tracés ne
sont pas enregistrés : ils disparaissent à la fermeture.

Avec un outil de dessin actif, la couche capte les clics — la page ne les reçoit
plus, c'est le prix pour pouvoir tracer par-dessus. Un bandeau le dit,
<kbd>Échap</kbd> rend la main à la page, un second <kbd>Échap</kbd> ferme la
palette.

#### Pourquoi un seul raccourci

Orbit intercepte les combinaisons <kbd>Alt</kbd> dans le processus principal
(`before-input-event`) **avant** que la page ne les voie. Un raccourci
d'extension posé sur l'un des siens n'est pas « en conflit » : il est
simplement **mort**, sans message. Orbit se réserve en Alt+Maj :
`A B E H I K L M O P S PageUp PageDown` — dont quatre (`K`, `L`, `B`, `S`) parce
que ces branches ne vérifient même pas <kbd>Maj</kbd>. S'y ajoutent `F`
(extension Fake Data) et `J`/`U`/`Y` (touches alternatives de l'assistant).
D'où <kbd>Alt+Maj+D</kbd>, et le reste dans la palette, où on le **voit**.

`test/mouse-scroll.test.js` confronte ce choix au vrai `matchShortcutInput`
d'Orbit et aux sources des autres extensions : si Orbit se réserve une
combinaison de plus, le test tombe.

## Sites particuliers

Une règle par site peut couper le lissage, inverser le sens ou changer la
vitesse. Le motif **le plus précis gagne** : `mail.google.com` l'emporte sur
`*.google.com`, quel que soit l'ordre d'ajout. Le bouton 🖱️ de la palette
ajoute ou retire la règle du site courant sans ouvrir les options.

## Désinstallation

**Extensions → Souris & Défilement → poubelle** : la molette retrouve
immédiatement son comportement natif. Les réglages restent dans le stockage de
l'extension et sont retrouvés en cas de réinstallation.

## Notes techniques

- `lib.js` ne contient que de la logique pure (molette ou pavé tactile,
  conversion d'un cran en pixels, approche de la position cible, résolution des
  règles de site). Il est chargé avant `content.js` **et** vérifié par
  `node --test` (`test/mouse-scroll.test.js`), sans navigateur.
- Le script de contenu neutralise `scroll-behavior: smooth` de la page le temps
  de son animation, puis remet l'état d'origine : deux animations concurrentes
  donnent un défilement saccadé.
- Injecté dans tous les cadres pour que la molette fonctionne dans les iframes ;
  les aides à la présentation, elles, ne s'affichent que dans le cadre
  principal (une seule couche par page).
