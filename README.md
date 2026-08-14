# Orbit 🛰

**Alternative moderne à Station** - Hub applicatif tout-en-un pour Windows, macOS et Linux.

![Orbit Screenshot](https://via.placeholder.com/1200x600/0a0a0f/6366f1?text=Orbit+-+Modern+App+Hub)

## ✨ Fonctionnalités

- 🎯 **Profils multiples** - Séparez vie pro et perso (Travail 💼, Personnel 🏠, etc.)
- 🚀 **80+ applications** intégrées - Gmail, Slack, Notion, GitHub, ChatGPT et plus
- ⚡ **Quick Switcher** - Recherche ultra-rapide avec `Cmd/Ctrl + K`
- 🎨 **Thèmes & personnalisation** - Clair, sombre ou auto avec couleurs d'accent
- 📱 **Interface fluide** - Sidebar rétractable, animations modernes
- 🔒 **Sessions isolées** - Chaque app a son propre espace (cookies, storage)
- 🌐 **Contournement X-Frame-Options** - Gmail, Slack et sites bloqués fonctionnent !
- 💾 **Sauvegarde automatique** - Vos apps et profils persistent entre sessions

## 🚀 Installation

### Prérequis
- Node.js 18+ et npm
- Git

### Développement

```bash
# Cloner le repo
git clone https://github.com/votre-username/orbit.git
cd orbit

# Installer les dépendances
npm install

# Lancer en mode développement
npm run electron:dev
```

### Build production

```bash
# Build pour votre plateforme
npm run electron:build

# Les binaires seront dans dist-electron/
```

## 🎮 Utilisation

### Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Cmd/Ctrl + K` | Quick Switcher |
| `Cmd/Ctrl + ,` | Paramètres |
| `Escape` | Fermer overlay |
| `Cmd/Ctrl + L` | Focus URL bar |
| `Cmd/Ctrl + R` | Recharger app active |

### Ajouter une application

1. Cliquez sur **+ Ajouter** dans la sidebar
2. Choisissez parmi 80+ apps pré-configurées
3. Ou ajoutez une app personnalisée (nom, URL, icône)

### Gérer les profils

1. Ouvrez les paramètres (`Cmd/Ctrl + ,`)
2. Allez dans **Profils**
3. Créez, éditez ou supprimez des profils

## 🏗️ Architecture

- **Frontend** : React 18 + Vite + TailwindCSS
- **Desktop** : Electron + `<webview>` embarquées (partitions par profil pour isoler les sessions)
- **State** : Zustand (persist dans localStorage)
- **Animations** : Framer Motion
- **Icons** : Lucide React

## 📦 Stack technique

```json
{
  "electron": "^33.3.1",
  "react": "^18.3.1",
  "vite": "^6.0.7",
  "tailwindcss": "^3.4.17",
  "zustand": "^5.0.2",
  "framer-motion": "^11.15.0"
}
```

## 🤝 Contribution

Les contributions sont les bienvenues !

1. Fork le projet
2. Créez une branche (`git checkout -b feature/AmazingFeature`)
3. Commit (`git commit -m 'Add AmazingFeature'`)
4. Push (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request

## 📄 Licence

MIT © 2026

## 🙏 Inspirations

- [Station](https://github.com/getstation/desktop-app) - L'original (abandonné)
- [Franz](https://meetfranz.com/) - Multi-messenger
- [Wavebox](https://wavebox.io/) - Browser pour apps web

---

Fait avec ❤️ pour remplacer Station
