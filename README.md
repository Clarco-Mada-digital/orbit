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

## 📄 Licence

MIT © 2026

---

Fait avec ❤️ pour rassembler vos apps web au même endroit.
