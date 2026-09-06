# Orbit 🛰

**Hub applicatif tout-en-un** pour Windows, macOS et Linux — regroupez toutes vos
apps web (Gmail, Slack, Notion, ChatGPT…) dans une seule fenêtre, avec profils,
sessions isolées et multi-comptes.

![Orbit](docs/orbit-welcome.png)

> D'autres captures (interface principale, écran partagé…) sont les bienvenues :
> déposez vos PNG dans `docs/` et référencez-les ici.

## ⬇️ Téléchargement

Récupérez la dernière version sur la page des **[Releases](https://github.com/Clarco-Mada-digital/orbit/releases/latest)** :

| Plateforme | Fichier |
|-----------|---------|
| 🪟 **Windows** | `Orbit-Setup-<version>.exe` (installateur) ou `Orbit-<version>.exe` (portable) |
| 🐧 **Linux** | `Orbit-<version>.AppImage` (portable, mise à jour auto) ou `orbit_<version>_amd64.deb` |
| 🍎 **macOS** | `Orbit-<version>.dmg` |

> L'app n'est pas signée : Windows (SmartScreen) et macOS (Gatekeeper) afficheront
> un avertissement « éditeur inconnu ». Choisissez « Exécuter quand même » /
> clic droit → Ouvrir.

## ✨ Fonctionnalités

- 🎯 **Profils multiples** — séparez pro et perso (Travail 💼, Personnel 🏠…)
- 🔒 **Sessions isolées** — chaque app a son coffre à cookies ; profil « partagé » possible (SSO)
- 👥 **Conteneurs multi-comptes** — plusieurs comptes d'un même service (2 Gmail…)
- 🖥️ **Écran partagé & espaces de travail** — 2 à 4 apps côte à côte, dispositions enregistrées
- 🪟 **Fenêtre détachée** — sortez une app dans sa propre fenêtre (2ᵉ écran)
- ⚡ **Palette de commandes** (`Alt/⌘ + K`) — apps, actions, mais aussi **calculatrice**
  (`4*4`, `20% de 150`, `sqrt(2)`), **conversions** (`10 km en mi`, `100 usd en eur`,
  `255 in hex`, `#6366f1`, `today + 30 jours`) — Entrée copie le résultat
- 🧩 **En-tête configurable** — choisissez les modules affichés et leur zone
  (gauche / centre / droite) : horloge, météo, batterie, moniteur système,
  minuteur de concentration (Pomodoro), profil actif…
- 🪟 **Fenêtres secondaires habillées** — les pop-ups (connexion Google, liens
  externes) s'ouvrent aux couleurs d'Orbit, coins arrondis et en-tête épuré
- 🔎 **Recherche dans la page** (`Ctrl/Cmd + F`)
- 🔎 **Zoom par app**, **veille** des apps inactives, **favoris**
- 🔐 **Verrouillage** (global + par profil) et **verrouillage auto** après inactivité
- 💾 **Sauvegarde/restauration chiffrée** de la configuration
- 🎬 **Téléchargement vidéo/audio** (yt-dlp) depuis n'importe quel site
- 🛡️ **Bloqueur de pub** intégré et **remplissage KeePassXC**
- 🔄 **Mises à jour automatiques** (AppImage / Windows)
- 🎨 **Thèmes** clair/sombre/auto, polices et couleur d'accent

## 🚀 Développement

```bash
git clone https://github.com/Clarco-Mada-digital/orbit.git
cd orbit
npm install
npm run electron:dev
```

### Build local

```bash
npm run electron:build   # binaires dans dist-electron/ (plateforme courante)
```

## 📦 Publier une version

Les builds multi-plateformes sont automatisés par **GitHub Actions** : il suffit de
pousser un tag de version.

```bash
npm version minor -m "chore(release): v%s"   # bump + commit + tag
git push origin master --follow-tags          # déclenche le CI
```

Le workflow compile sur Linux, Windows et macOS puis publie automatiquement la
release avec tous les artefacts et des notes de version générées depuis les
commits.

## 🏗️ Architecture

- **Frontend** : React 18 + Vite + TailwindCSS + Zustand (persisté)
- **Desktop** : Electron 43, `<webview>` embarquées (partitions par profil/app)
- **Mises à jour** : electron-updater (feed GitHub Releases)
- **Icons** : Lucide React

### 🧩 Extensions (Fake Data Filler et autres)

Orbit intègre un bouton **🎲 « Remplir avec des données de test »** sur les champs de
formulaire non de connexion. Il détecte le type du champ (email, nom, téléphone, ville,
date, etc.) et le remplit avec des données réalistes depuis des listes locales, sans
dépendance externe — comme les extensions **Fake Filler** (Chrome) ou **Fake Data
Filler** (Firefox).

#### Architecture des extensions

```
extensions-dist/            ← ZIPs distribuables (SUIVI EN GIT, partagés avec utilisateurs)
  └── fake-data-filler-orbit.zip   (24 Ko, Manifest V3)
  └── color-picker.zip             (28 Ko) — pipette de couleur (bouton 🎨, Alt+C)
  └── page-to-markdown.zip         (21 Ko) — page → Markdown (clic droit, Alt+M)
  └── text-snippets.zip            (14 Ko) — abréviations extensibles (;email → texte complet)
  └── sticky-notes.zip             (14 Ko) — notes par site (bouton 📝, Alt+N)
  └── qr-code-generator.zip        (17 Ko) — QR codes locaux (bouton ⊞, Alt+Q, clic droit)

userData/extensions/         ← Extensions installées par l'utilisateur (Electron, jamais en git)

# Les sources des extensions (electron/extensions/) NE SONT PAS dans git :
# uniquement les développeurs qui modifient les extensions ont les sources
# localement. Pour créer/modifier une extension :
#   1. Créer electron/extensions/<mon-extension>/ localement
#   2. Lancer npm run export:extensions
#   3. Le ZIP est créé dans extensions-dist/ et suivi en git
```

#### Fake Data Filler — intégré nativement

- Le bouton 🎲 apparaît automatiquement sur les champs de formulaire
- Raccourci **Alt+F** pour remplir le champ focalisé
- Personnalisation dans **Réglages → Extensions** → section Fake Data Filler
- Toggle **Activer/Désactiver** pour masquer le bouton 🎲
- Export en ZIP pour partage : **Réglages → Extensions → Exporter en ZIP**

#### Installation manuelle d'une extension depuis ZIP

1. Récupérer le ZIP depuis `dist/extensions/` (ex: `fake-data-filler-orbit.zip`)
2. Dans Orbit : **Réglages → Extensions → Extensions installables → Installer depuis ZIP**
3. Sélectionner le fichier ZIP
4. L'extension est extraite et chargée automatiquement

#### Distribution des extensions

- Les ZIPs distribuables sont dans `extensions-dist/` (suivis en git)
- Pour créer/actualiser tous les ZIPs : `npm run export:extensions`
- Pour créer un ZIP spécifique : `npm run export:extensions -- <nom-dossier>`
- Les utilisateurs qui téléchargent une release n'ont **pas** d'extensions pré-installées
- S'ils veulent une extension, ils téléchargent le ZIP depuis le repo et l'installent manuellement

#### Ajouter une nouvelle extension

1. Créer un dossier dans `electron/extensions/` (ex: `electron/extensions/mon-extension/`)
2. Ajouter un `manifest.json` + les fichiers de l'extension (content.js, icônes...)
3. Générer le ZIP : `npm run export:extensions`
4. Le ZIP est créé dans `extensions-dist/mon-extension.zip`

Point technique : les extensions Chrome installées **par le Chrome Web Store ne
fonctionnent pas bien dans Orbit** (contenu des webviews, sandboxing, API limitées).
C'est pourquoi Fake Data Filler est fourni en tant qu'extension **locale** : le
bouton 🎲 est déjà intégré nativement dans Orbit (via `credentials-preload.cjs`),
et l'extension exportable est un portage autonome pour les utilisateurs avancés.

## 🧪 Tests

```bash
npm test   # lance tous les tests unitaires (passgen, raccourcis, sessions, layout…)
```

## 📄 Licence

MIT © 2026

---

Fait avec ❤️ pour rassembler vos apps web au même endroit.
