# 🚀 GUIDE DE LANCEMENT — Orbit

## ✅ État actuel : tout fonctionne avec Electron

L'app se lance en **une seule commande** :

```bash
cd /home/programmeur/Bureau/newDoc/orbit-new
npm run electron:dev
```

Ce qui se passe :
1. Vite démarre le serveur React sur http://localhost:5173
2. Electron ouvre la fenêtre et charge l'interface
3. DevTools s'ouvre automatiquement (ferme-le si ça te gêne)

## 🖥️ Comment les apps s'ouvrent

Les applications (Gmail, Slack…) s'ouvrent **dans la fenêtre Orbit**, pas dans une
fenêtre séparée. Chaque app est une `<webview>` intégrée au DOM :

- Clique sur une app dans la sidebar → la page se charge dans la zone centrale
- Tu peux changer de profil (Travail / Personnel) → **cookies et sessions séparés**
- La page **suit** la sidebar : réduis/agrandis la sidebar, l'app se redimensionne
- Changer d'app → l'état de la page est **conservé** (pas de rechargement)

## 🧪 Ce qu'il faut tester après le lancement

1. **Ouvrir une app** : Gmail est déjà installé dans le profil Travail. Clique dessus → la page s'affiche dans la fenêtre
2. **Réduire/agrandir la sidebar** (chevron en haut à gauche) → la page suit le redimensionnement
3. **Paramètres** (`Cmd/Ctrl + ,`) → change la couleur d'accent, la taille de police, le thème → les changements s'appliquent **immédiatement**
4. **Boutique** → installe d'autres apps (Slack, Notion…)
5. **Profils** → passe de Travail à Personnel, les apps/sessions sont séparées
6. **Fenêtre** : boutons Réduire / Agrandir / Fermer dans la barre du haut

## 🐛 Dépannage rapide

| Problème | Solution |
|----------|----------|
| La fenêtre ne s'ouvre pas | Relance `npm run electron:dev` (parfois le timing Vite/Electron rate) |
| Les apps ne se chargent pas | Vérifie la connexion internet (les apps sont des pages web) |
| Un site ne s'affiche pas | Ouvre-le dans le navigateur avec l'icône ↗ de la barre d'URL |
| Connexion Google refusée | C'est le popup OAuth → il s'ouvre dans ton navigateur système |

## ⚙️ Lancement alternatif (deux terminaux)

Si `electron:dev` pose problème :

```bash
# Terminal 1
npm run dev

# Terminal 2 (attendre que Vite soit prêt)
npx electron .
```

---

**Tu n'as besoin QUE de `npm run electron:dev`.**
