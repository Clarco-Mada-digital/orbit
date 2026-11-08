# Orbit — guide développeur

Ce guide présente l’organisation du dépôt, les commandes de développement, les
extensions et la publication. Il complète le [guide utilisateur](./guide-utilisateur.md)
et le [README du projet](../README.md).

## 1. Prérequis et lancement

- Node.js compatible avec la version de CI (Node 22).
- npm.
- Un environnement graphique compatible avec Electron pour exécuter l’app.
- Git pour récupérer le dépôt.

```bash
git clone https://github.com/Clarco-Mada-digital/orbit.git
cd orbit
npm ci
npm run electron:dev
```

Le script `electron:dev` démarre Vite puis Electron. `npm run dev` seul ne lance
que l’interface web et ne remplace pas l’exécution intégrée à Electron.

## 2. Architecture

Orbit combine un processus principal Electron, une interface React et des pages
web intégrées dans des `<webview>`.

| Zone | Responsabilité | Repères |
|---|---|---|
| Processus principal | Fenêtres, sessions, téléchargements, permissions, IPC, mises à jour | `electron/main.js` |
| Préload de l’interface | API restreinte exposée au renderer | `electron/preload.cjs` |
| Préload des pages | Identifiants, fake data et comportements isolés des webviews | `electron/credentials-preload.cjs` |
| Interface | Écrans React, navigation et vues principales | `src/App.jsx`, `src/components/` |
| État | Préférences, profils, apps et persistance | `src/stores/` |
| Extensions | Sources d’extensions installables | `electron/extensions/` |
| Archives distribuées | ZIP et catalogue publiés (hors application) | `extensions-dist/` |
| Tests | Tests Node intégrés | `test/` |

Les partitions Electron représentent les frontières de sessions. Toute nouvelle
fonction IPC doit être validée à ses deux extrémités, minimiser les données
transmises et réutiliser les contrôles d’accès existants.

## 3. Commandes courantes

```bash
npm run electron:dev       # interface Vite + Electron
npm run dev:fresh          # idem, mais sur un profil de données VIERGE
npm run build              # build du renderer
npm test                   # suite de tests Node
npm run lint               # ESLint avec le plafond défini par le projet
npm run electron:build     # icônes + renderer + packages de la plateforme
npm run export:extensions  # régénère les ZIP des extensions locales
npm run export:fake-data   # régénère le ZIP Fake Data Filler
```

### Lancer sur un profil VIERGE

```bash
npm run dev:fresh
```

Démarre Vite puis Electron sur `--user-data-dir=.dev-profile` : un dossier de
données neuf, séparé de votre Orbit installé. Pas de cache, pas de cookies,
pas de réglages, pas de trousseau — l'application se comporte comme à sa
première installation. Supprimez `.dev-profile/` pour repartir de zéro.

Deux conséquences utiles :

- votre Orbit habituel n'est pas touché, et le **verrou d'instance unique** ne
  s'y oppose pas : les deux peuvent tourner en même temps, puisque le verrou
  porte sur le dossier de données ;
- pour piloter l'application de l'extérieur (tests manuels, captures), ajoutez
  `--remote-debugging-port=9222` et parlez-lui en DevTools Protocol.

```bash
npm run dev                       # dans un terminal : le serveur Vite
./node_modules/electron/dist/electron . \
  --user-data-dir=/tmp/orbit-essai \
  --remote-debugging-port=9222    # dans un autre : l'application
```

`npm run electron:dev` reste le lancement normal, sur vos vraies données.

La compilation finale dépend de la plateforme et des outils de packaging
disponibles. La CI release exécute des builds Linux, Windows et macOS séparés.

## 4. Modifier ou créer une extension

1. Créer ou modifier un dossier source sous `electron/extensions/<extension>/`.
2. Mettre à jour `manifest.json` et les ressources utiles.
3. Vérifier la syntaxe, les permissions et le comportement dans une page réelle.
4. Générer l’archive :

   ```bash
   npm run export:extensions -- nom-du-dossier
   ```

5. Vérifier le ZIP et `extensions-dist/catalog.json` (taille et empreinte
   SHA-256 de chaque archive).
6. Le format attendu, les limites du moteur et la publication sont détaillés
   dans [guide-extensions.md](guide-extensions.md) — c'est le document à
   donner à quelqu'un d'extérieur qui veut écrire une extension.
7. Pousser sur `master` : le workflow Pages reconstruit le catalogue et publie
   `extensions-dist/` sous `/extensions/`. C'est de là qu'Orbit télécharge les
   extensions — aucune republication de l'application n'est nécessaire.

Fake Data Filler possède aussi un chemin natif dans
`electron/credentials-preload.cjs`. Les comportements accessibles dans Orbit
doivent rester cohérents entre ce chemin et l’extension ZIP, qui est distribuée
séparément. Ni les sources d’extensions ni les ZIP ne sont inclus dans
l’archive application : le magasin lit le catalogue publié en HTTPS et
télécharge l’archive au moment de l’installation, après contrôle de sa taille
et de son empreinte (`electron/extension-store.js`,
`src/lib/extensionCatalog.js`). `ORBIT_EXTENSIONS_URL` permet de viser un autre
catalogue (recette, miroir interne).

Pour le Texte Snippets, les options sont dans `options.html` / `options.js`.
Le content script doit supporter les champs dynamiques et les contextes de
modale sans interférer avec les formulaires de connexion. Conserver les tests
associés dans `test/textSnippets.test.js`.

## 5. Internationalisation et interface

Les chaînes vivent dans `src/lib/i18n/`, un module par domaine
(`assistant`, `settings`, `vault`, `palette`, `topbar`, `apps`). Chacun exporte
`fr` et `en` ; `src/lib/i18n.dict.js` les assemble et reste le seul point
d’entrée du reste de l’application.

Lorsqu’une clé est ajoutée :

- la mettre dans le module de son domaine, et dans **les deux** langues ;
- ne pas la définir dans deux modules : l’assemblage par étalement d’objets
  ferait gagner le dernier en silence (le test le refuse) ;
- conserver la même liste de variables `{name}` dans les deux langues ;
- utiliser les clés via `useT()` ou le mécanisme de traduction existant ;
- lancer le test de parité des dictionnaires (`node --test test/i18n.test.js`),
  qui vérifie la parité globale, celle de chaque module, l’absence de doublon
  et que toute clé appelée dans le code existe.

L’interface utilise React, Tailwind CSS et Lucide. Préserver les patterns
existants, l’accessibilité clavier et les variantes compactes utilisées dans
Orbit.

## 6. Tests, lint et build

Avant de proposer une modification :

```bash
npm test
npm run lint
npm run build
```

Pour une correction ciblée, lancer d’abord les tests de son domaine. Ajouter des
tests de régression lorsqu’un comportement avait échoué. Les avertissements
ESLint sont plafonnés par la configuration du dépôt ; ne pas en ajouter sans
raison.

**`npm test` tourne sans `node_modules`** : c’est volontaire, on doit pouvoir
vérifier une modification sans rien installer. La logique à tester vit donc
dans des modules purs (`src/lib/*.js`, `electron/*-rules.js`,
`electron/*-import.js`) plutôt que dans un composant ou un magasin.

Trois fichiers de tests font exception, parce qu’ils exercent une vraie
bibliothèque et que la simuler ne prouverait rien : `assistantMarkdown`
(react-markdown + KaTeX), `fly-pages` et `assistantHistoryStore` (zustand). Ils
sont **ignorés avec une raison lisible** quand le paquet manque, via
`test/helpers/optional-dep.js`, et s’exécutent normalement en CI. Ne pas les
transformer en tests sur des imitations : préférer extraire la logique dans un
module pur, comme `src/lib/flyPages.js`.

## 7. Versions et releases

`CHANGELOG.md` est la source des notes de version affichées dans l’application
et jointes aux releases. Le script `npm run release <version>` vérifie l’état du
dépôt, la version et les notes, construit le renderer, puis crée et pousse le tag
de release. Il faut donc **un dépôt propre** et des modifications déjà
commitées avant d’utiliser cette commande.

Le workflow `.github/workflows/release.yml` est déclenché par un tag `v*`. Il
construit les packages Linux, Windows et macOS puis publie les assets sur GitHub
Releases. Ne poussez pas un tag avant d’avoir vérifié les notes et les résultats
de CI.

## 8. Publier la page statique

Le site public est `docs/index.html`. Il est autonome, responsive et ne nécessite
pas de compilation. Le workflow `.github/workflows/pages.yml` publie tout le
dossier `docs/` sur chaque push à `master` qui le modifie. Dans **Settings →
Pages → Build and deployment**, choisir **GitHub Actions** comme source.

La page utilise l’API publique GitHub pour afficher les assets de la dernière
release. Elle possède un lien de secours direct vers la page des releases.
Vérifier cette section après chaque modification des noms de fichiers du
workflow `electron-builder`. L’adresse publique est
<https://clarco-mada-digital.github.io/orbit/>.

Le guide utilisateur HTML est la source du PDF (`docs/guide-utilisateur.pdf`).
Pour régénérer le fichier, suivre les instructions dans
[`docs/README.md`](./README.md). Vérifier que les liens, images et sauts de page
du document restent lisibles avant de remplacer le PDF distribué.

## 9. Sécurité et confidentialité

- Ne jamais exposer `ipcRenderer` directement au renderer ou aux pages web.
- Valider les paramètres IPC côté processus principal et borner les tailles de
  données.
- Garder les permissions webviews et extensions au minimum nécessaire.
- Ne pas journaliser de mots de passe, cookies, clés API ou contenu de formulaires.
- Les données destinées à un fournisseur IA distant doivent avoir un parcours de
  consentement explicite ; ne pas transformer une fonction locale en envoi
  distant silencieux.
- Ne pas activer automatiquement une extension simplement parce qu’elle est
  fournie dans le dépôt.

Les fuses et leurs compromis sont décrits dans
[`electron-fuses.md`](./electron-fuses.md).

## 10. Références du dépôt

- [README](../README.md)
- [Changelog](../CHANGELOG.md)
- [Guide utilisateur](./guide-utilisateur.md)
- [Documentation du site et PDF](./README.md)
- [Fuses Electron](./electron-fuses.md)
- [Issues et demandes](https://github.com/Clarco-Mada-digital/orbit/issues)
