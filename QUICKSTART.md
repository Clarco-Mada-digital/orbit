# 🚀 Guide de démarrage rapide - Orbit

## État actuel du projet

✅ **Architecture complète** : Electron + React + Vite + TailwindCSS  
✅ **Composants fonctionnels** : Sidebar, Topbar, QuickSwitcher, Settings, ProfileManager, AppStore  
✅ **80+ applications** pré-configurées (Gmail, Slack, Notion, ChatGPT, etc.)  
✅ **Profils multiples** avec gestion complète  
✅ **<webview> embarquées** pour contourner X-Frame-Options (les apps s'ouvrent dans la fenêtre)  
✅ **Design moderne** avec animations fluides  

---

## 🎯 Lancer l'application

### 1. Installation des dépendances (déjà fait ✓)
```bash
cd /home/programmeur/Bureau/newDoc/orbit-new
npm install  # Déjà installé (553 packages)
```

### 2. Démarrer en mode développement

```bash
npm run electron:dev
```

**Ce qui se passe :**
1. Vite démarre le serveur React sur http://localhost:5173
2. Electron lance l'application et charge l'interface
3. DevTools s'ouvrent automatiquement

**⚠️ Si le lancement échoue**, c'est probablement à cause d'un timeout. Relancez simplement.

---

## 🎨 Ce que vous verrez

### Interface principale
```
┌─────────────────────────────────────────────┐
│  [Orbit]                        [_ □ ✕]     │  ← Titlebar
├─────────┬───────────────────────────────────┤
│ 💼 Work │  ← → ⟳  [URL bar]      ⭐ 🔔      │  ← Topbar
│ 🏠 Perso│                                    │
│         │                                    │
│ Apps    │                                    │
│ 📧 Gmail│         Bienvenue dans Orbit       │
│ 💬 Slack│                                    │
│         │     🔍 Rechercher  🛍️ Boutique     │
│         │                                    │
│ [Store] │                                    │
│ [Profil]│                                    │
│ [Params]│                                    │
└─────────┴────────────────────────────────────┘
```

### Écran d'accueil
- **Centre** : Message de bienvenue + 4 cartes avec tips
- **Actions** : Boutons pour ouvrir Quick Switcher et App Store
- **Sidebar** : Profils (Work, Personnel) + liste d'apps (vide au départ)

---

## 🎮 Fonctionnalités à tester

### 1. **App Store** (Cmd/Ctrl + Shift + O)
- Cliquez sur **"Boutique"** dans la sidebar
- Recherchez une app (Gmail, Slack, Notion, ChatGPT...)
- Cliquez sur **"+ Installer"**
- L'app apparaît dans la sidebar

### 2. **Quick Switcher** (Cmd/Ctrl + K)
- Appuyez sur `Cmd+K` (Mac) ou `Ctrl+K` (Windows/Linux)
- Tapez le nom d'une app
- Sélectionnez avec `↑↓` et validez avec `Enter`
- Ou cliquez directement

### 3. **Profils** (Cmd/Ctrl + Shift + P)
- Cliquez sur **"Profils"** dans la sidebar
- Créez un nouveau profil (ex: "Projets 🎯")
- Choisissez un emoji et une couleur
- Installez des apps différentes par profil

### 4. **Paramètres** (Cmd/Ctrl + ,)
- **Apparence** : Changez la couleur d'accent
- **Raccourcis** : Consultez les raccourcis clavier
- **Profils** : Gérez vos profils

### 5. **Ouvrir une application**
- Cliquez sur une app installée (ex: Gmail)
- La page s'affiche **dans la fenêtre Orbit** (webview intégrée au DOM)
- Utilisez ← → ⟳ pour naviguer
- L'URL se met à jour dans la barre
- Réduisez/agrandissez la sidebar → la page suit automatiquement

---

## ⌨️ Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Cmd/Ctrl + K` | Quick Switcher |
| `Cmd/Ctrl + ,` | Paramètres |
| `Cmd/Ctrl + Shift + O` | App Store |
| `Cmd/Ctrl + Shift + P` | Gestion des profils |
| `Cmd/Ctrl + R` | Actualiser l'app active |
| `Cmd/Ctrl + [` | Retour |
| `Cmd/Ctrl + ]` | Avancer |
| `Escape` | Fermer les overlays |

---

## 🐛 Si quelque chose ne marche pas

### L'app ne se lance pas
```bash
# Essayez de rebuilder
npm run build
npm run electron:dev
```

### Les apps ne s'affichent pas
Vérifiez :
1. Vous avez bien lancé `npm run electron:dev` (pas `npm run dev` seul)
2. La connexion internet est active
3. L'app est installée dans le profil actif

---

## 📦 Build pour production

```bash
npm run electron:build
```

Cela créera un binaire dans `dist-electron/` :
- **Linux** : `.AppImage` + `.deb`
- **Windows** : `.exe` + portable
- **macOS** : `.dmg` + `.zip`

---

## 🎯 Prochaines améliorations suggérées

1. **Onglets multiples** par app (comme un vrai navigateur)
2. **Sessions persist** : garder les cookies entre les relances
3. **Badges de notifications** : compteur de non-lus qui fonctionne
4. **Thème clair** : implémenter le thème light
5. **Custom apps** : permettre d'ajouter des apps non listées
6. **Favoris** : page dédiée aux apps favorites
7. **Historique** : des pages visitées
8. **Recherche dans page** : Cmd+F dans le BrowserView
9. **Téléchargements** : gestionnaire de téléchargements
10. **Auto-update** : mise à jour automatique de l'app

---

## 💡 Architecture technique

```
Electron Main Process
├─ BrowserWindow (React UI)
├─ <webview>[] (Apps web, dans le DOM)
│   ├─ Gmail (partition: persist:work)
│   ├─ Slack (partition: persist:work)
│   └─ Notion (partition: persist:personal)
└─ IPC Handlers
    ├─ window:minimize
    ├─ window:maximize
    ├─ window:close
    ├─ notifications:show / setBadge
    ├─ extensions:* (Chrome)
    └─ sessions:clear

Note : chaque app a sa propre session (partition persist:profil:app) →
les comptes multiples (2 Gmail, 2 Slack…) sont isolés au niveau cookies.

React App (renderer)
├─ Zustand Store (state)
├─ Components
│   ├─ Sidebar
│   ├─ Topbar (pilote le webview actif)
│   ├─ QuickSwitcher
│   ├─ Settings
│   ├─ ProfileManager
│   ├─ AppStore
│   └─ WebView (composant <webview>)
└─ Lib
    └─ webviewRegistry (Map appId → webview)
```

---

## 🎉 Résultat final

Tu as maintenant une **alternative moderne et fonctionnelle à Station** avec :

✅ Interface complète et professionnelle  
✅ 80+ apps pré-configurées  
✅ Profils multiples  
✅ Quick Switcher ultra-rapide  
✅ Settings complets  
✅ Design moderne avec animations  
✅ Architecture Electron + React scalable  

**Prêt à tester ?** Lance `npm run electron:dev` ! 🚀
