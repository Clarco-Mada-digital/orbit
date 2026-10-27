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

## Régénérer le PDF

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
