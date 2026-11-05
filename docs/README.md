# Documentation Orbit

Orbit est une application de bureau Electron qui rassemble des applications web,
des profils et des outils de productivité dans un espace configurable.

## Consulter la documentation

- [Guide utilisateur complet](./guide-utilisateur.md)
- [Guide développeur et architecture](./guide-developpeur.md)
- [Guide utilisateur en PDF](./guide-utilisateur.pdf)
- [Page de présentation](./index.html)

## Publication GitHub Pages

Le site public est servi à partir du dossier `docs/` par le workflow
`.github/workflows/pages.yml`. À chaque push sur `master` qui modifie un fichier
de `docs/`, GitHub Actions publie son contenu automatiquement. Le workflow peut
aussi être lancé manuellement depuis l’onglet **Actions**.

Dans **Settings → Pages → Build and deployment**, sélectionner **GitHub Actions**
comme source. L’URL du site est
[clarco-mada-digital.github.io/orbit](https://clarco-mada-digital.github.io/orbit/).

La page est autonome et n'utilise aucun framework ni ressource hébergée ailleurs.
La section de téléchargement récupère les fichiers de la dernière release avec
l’API publique GitHub ; les liens directs vers les releases restent disponibles
si l’API ne répond pas.

## Démarche : faire évoluer la documentation avec l'application

Une documentation ne se périme pas d'un coup, mais fonctionnalité par
fonctionnalité, en silence — parce qu'on a livré sans écrire la ligne qui va
avec. D'où cette démarche, volontairement courte.

### 1. Une seule source

`guide-utilisateur.md` est la **seule** source. `guide-utilisateur.html` et
`guide-utilisateur.pdf` en sont **dérivés** : ne les éditez jamais à la main,
la prochaine génération écraserait la modification. (Avant, les trois vivaient
leur vie séparément : trois vérités différentes selon le fichier ouvert.)

### 2. Une commande

```bash
npm run docs        # Markdown → HTML → PDF
npm run docs:html   # HTML seul, quand aucun Chromium n'est disponible
```

Le PDF passe par un Chrome/Chromium en mode « headless », détecté
automatiquement (`CHROME_BIN=/chemin/vers/chrome npm run docs` pour l'imposer).
S'il n'y en a pas, le HTML est quand même produit et le script le dit.

### 3. Un garde-fou automatique

`test/docs.test.js` confronte le guide aux **listes qui vivent dans le code** :
outils d'annotation (`ANNOTATION_TOOLS`), raccourcis du studio (`STUDIO_KEYS`),
widgets de l'accueil du Téléphone, types de données sensibles, extensions du
catalogue. Ajouter un outil sans le documenter fait **échouer `npm test`**, en
nommant ce qui manque.

Il vérifie aussi que le HTML n'est pas en retard sur le Markdown : si la source
a changé depuis la dernière génération, le site publié et le PDF montrent encore
l'ancienne version.

Ces tests ne jugent pas la prose — aucun test ne le peut. Ils garantissent
seulement que **rien ne manque à l'appel**.

### 4. Le réflexe, à chaque fonctionnalité livrée

1. Écrire la section dans `guide-utilisateur.md` (à quoi ça sert, comment y
   accéder — bouton **et** raccourci, ce que ça donne).
2. Si la fonctionnalité apparaît dans une liste du code, ajouter son terme de
   reconnaissance dans `test/docs.test.js`.
3. `npm run docs`, puis committer les trois fichiers ensemble.
4. Ajouter l'entrée correspondante au `CHANGELOG.md`.

## Régénérer le PDF à la main (hors `npm run docs`)

Le PDF est produit à partir de `guide-utilisateur.html` avec Google Chrome ou
Chromium en mode headless. Depuis la racine du dépôt :

```bash
google-chrome --headless --disable-gpu --no-sandbox \
  --no-pdf-header-footer \
  --print-to-pdf=docs/guide-utilisateur.pdf \
  file:///chemin/absolu/vers/le/depot/docs/guide-utilisateur.html
```

Le guide Markdown et le guide HTML sont les sources à maintenir. Le PDF est leur
version prête à télécharger ou à imprimer.

## Équipe et attribution

**Développeur : Clarco RAHERINANDRASANA.**

Orbit est distribué sous licence MIT. Les marques, logos et services tiers
mentionnés dans la documentation restent la propriété de leurs détenteurs
respectifs.
