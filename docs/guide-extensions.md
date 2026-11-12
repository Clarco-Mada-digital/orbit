# Créer une extension pour Orbit

Orbit charge de vraies extensions de navigateur. Si vous savez écrire une
extension Chrome, vous savez écrire une extension Orbit — à quelques
différences près, qui tiennent au moteur (Electron) et au fait qu'Orbit affiche
des **webviews** et non des onglets. Ce document dit ce qui marche, ce qui ne
marche pas, et comment publier.

---

## 1. Ce qu'est une extension Orbit

Une archive ZIP contenant un `manifest.json` **à la racine**, plus ses fichiers.

```
mon-extension.zip
├── manifest.json        ← à la racine, pas dans un sous-dossier
├── content.js
├── options.html         (facultatif)
├── options.js           (facultatif)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

Le piège le plus fréquent : zipper **le dossier** au lieu de son contenu.
Orbit refuse alors l'archive avec « Le ZIP ne contient pas de manifest.json ».

Rien n'est chargé avant installation : une extension présente au catalogue est
un fichier inerte jusqu'à ce que l'utilisateur clique sur « Installer ».

---

## 2. Manifeste

### Exemple minimal qui fonctionne

```json
{
  "manifest_version": 3,
  "name": "Mon Extension",
  "version": "1.0.0",
  "description": "Ce qu'elle fait, en une phrase qui tient dans une carte.",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "permissions": ["storage"],
  "host_permissions": []
}
```

### Champs lus par Orbit

| Champ | Usage dans Orbit |
| :--- | :--- |
| `name`, `version` | **Obligatoires.** Le nom identifie l'extension pour la mise à jour (le suivi se fait par nom, pas par identifiant : Electron dérive l'identifiant du dossier d'extraction, il change à chaque réinstallation). `version` décide si le magasin propose « Mettre à jour ». |
| `description` | Affichée dans le magasin et sur la page des extensions. |
| `icons` | La vraie icône de l'extension est affichée dans la liste et dans la barre. Sans elle, un pictogramme générique. |
| `options_ui.page` / `options_page` | Fait apparaître le bouton de réglages de l'extension dans Orbit. |
| `permissions`, `optional_permissions` | Servent aussi à produire les avertissements ci-dessous. |
| `orbit.nativeApp` | **Propre à Orbit.** Voir §5. |
| `orbit.minOrbitVersion` | Version minimale d'Orbit attendue (indicatif). |

### Versionner correctement

La version compte : le magasin compare celle du catalogue à celle installée.
Publier un correctif **sans incrémenter la version** laisse tout le monde sur
l'ancienne — le magasin considère la version installée comme à jour. La
publication vérifie que les archives suivent les sources
(`npm run export:extensions -- --check`), mais personne ne peut deviner à votre
place qu'il fallait passer en `1.0.1`.

---

## 3. Ce qui marche, ce qui ne marche pas

Orbit s'appuie sur le support natif d'Electron (`session.loadExtension`), qui
ne couvre pas tout Chrome.

### Fiable

- **Scripts de contenu** (`content_scripts`) — le cœur de ce qui est utile ici :
  agir sur les pages affichées dans Orbit.
- **`chrome.storage.local`** — pour les réglages de l'extension. Deux points à
  connaître : ce stockage est **par profil** (partition), et il est rangé sous
  l'ID de l'extension — pour une extension non packagée, cet ID dérive du
  **chemin** du dossier. C'est pourquoi Orbit installe chaque archive dans un
  dossier stable (`userData/extensions/zip-<nom>`) : une mise à jour garde le
  même chemin, donc le même ID, donc les réglages déjà saisis. Si vous
  distribuez vous-même votre extension, ne comptez pas sur un dossier
  horodaté pour la réinstaller.
- **Page d'options** (`options_ui`), ouverte par Orbit.
- **Manifest V2 comme V3** pour tout ce qui est script de contenu.
- CSS injecté, raccourcis clavier gérés par votre propre code dans le script
  de contenu.

### À éviter

| Fonctionnalité | Pourquoi |
| :--- | :--- |
| `background.service_worker` (MV3) | La tâche de fond peut ne pas tourner. Orbit affiche un avertissement sur la carte de l'extension. Si votre logique en dépend, mettez-la dans le script de contenu. |
| `declarativeNetRequest` | Non pris en charge par Electron. Pour du blocage, Orbit a ses propres boucliers intégrés. |
| `nativeMessaging` | Aucune connexion à une application locale. Orbit l'avertit explicitement. |
| API d'onglets (`chrome.tabs`) | Orbit n'a pas d'onglets de navigateur mais des webviews : ne construisez rien dessus. |
| Chrome Web Store | Les extensions installées depuis le Web Store fonctionnent mal dans Orbit (sandboxing, API limitées). Publiez une archive. |

Ces avertissements ne sont pas décoratifs : ils apparaissent dans
**Réglages → Extensions**, sous le nom de l'extension, pour que l'utilisateur
sache pourquoi « elle ne fait rien ».

---

## 4. Écrire la logique pour qu'elle soit testable

Convention du projet, utile au-delà : la logique délicate ne vit pas dans le
script de contenu mais dans un `lib.js` chargé avant lui, qui s'expose sur
`globalThis`.

```json
"content_scripts": [
  { "matches": ["<all_urls>"], "js": ["lib.js", "content.js"] }
]
```

```js
// lib.js — aucune dépendance au DOM : testable par `node --test`
(function (root) {
  function expandSnippet(text, dictionary) { /* … */ }
  root.MonExtension = { expandSnippet };
})(typeof globalThis !== 'undefined' ? globalThis : self);
```

`content.js` ne garde alors que le branchement aux évènements. Les tests du
dépôt tournent **sans `node_modules`** : n'introduisez pas de dépendance dans
ce qui est testé.

---

## 5. Extensions qui activent une app intégrée

Cas particulier d'Orbit : une extension peut ne contenir **aucun code** et
servir uniquement d'interrupteur pour une fonctionnalité déjà présente dans
l'application. C'est ce que fait « Téléphone Orbit » : son archive ne contient
qu'un manifeste et une icône.

```json
{
  "manifest_version": 2,
  "name": "Téléphone Orbit",
  "version": "1.4.0",
  "description": "Pilotage du téléphone Android (adb + scrcpy).",
  "icons": { "128": "icon128.png" },
  "orbit": { "nativeApp": "phone", "minOrbitVersion": "1.14.0" }
}
```

Tant qu'aucune extension active ne déclare `orbit.nativeApp: "phone"`, l'app
Téléphone n'existe pas dans l'interface. C'est le mécanisme qui permet de
livrer une capacité lourde ou de niche sans l'imposer à tout le monde — mais il
suppose que le code correspondant soit **déjà dans Orbit** : vous ne pouvez pas
créer une nouvelle app native depuis une extension tierce.

---

## 6. Essayer son extension

1. **Dans Orbit** : Réglages → Extensions → *Installer depuis un ZIP*, puis
   sélectionnez votre archive. Réinstaller la même archive remplace la version
   précédente (Orbit décharge l'ancienne, repérée par son nom, dans toutes les
   sessions).
2. Les scripts de contenu ne s'injectent **qu'à la navigation suivante** :
   Orbit recharge les apps ouvertes après une installation. Si vous doutez,
   rechargez l'app concernée.
3. Pour itérer sans repackager, placez les sources dans
   `electron/extensions/<nom>/` et utilisez *Installer depuis un dossier*.

---

## 7. Publier

Les archives **ne sont pas embarquées dans Orbit** : elles sont publiées à côté
et téléchargées à l'installation. Pour une extension destinée au catalogue
officiel :

```bash
# 1. Sources dans electron/extensions/<nom>/ (le nom du dossier devient
#    le nom de l'archive — il ne doit plus changer ensuite : c'est l'URL
#    de téléchargement).
npm run export:extensions -- <nom>

# 2. Vérifier que les archives publiées suivent bien les sources
npm run export:extensions -- --check

# 3. Pousser sur master : le workflow Pages reconstruit le catalogue
#    (taille + empreinte SHA-256) et publie extensions-dist/ sous /extensions/.
```

Orbit lit alors `catalog.json` en HTTPS et télécharge l'archive à
l'installation, après avoir vérifié **sa taille et son empreinte SHA-256**.
Une archive dont l'empreinte ne correspond pas est refusée, pas installée.

Pour une extension distribuée hors catalogue, il n'y a rien à faire de
particulier : donnez le ZIP, l'utilisateur passe par *Installer depuis un ZIP*.

### Entrée du catalogue

Chaque entrée est générée, jamais écrite à la main :

```json
{
  "file": "mon-extension.zip",
  "name": "Mon Extension",
  "version": "1.0.0",
  "description": "…",
  "nativeApp": null,
  "size": 14715,
  "sha256": "3b1c…"
}
```

Une entrée sans `sha256` valide, dont la taille dépasse 32 Mo, dont le nom de
fichier contient un séparateur de chemin, ou dont la version n'est pas
numérique est **écartée** par Orbit — l'extension n'apparaîtrait simplement
pas dans le magasin. Deux archives portant le même `name` sont refusées à la
génération du catalogue.

---

## 8. Checklist avant publication

- [ ] `manifest.json` à la racine du ZIP
- [ ] `name` et `version` présents, version incrémentée depuis la précédente
- [ ] Icônes 16/48/128 fournies
- [ ] Aucune dépendance à un service worker, `declarativeNetRequest`,
      `nativeMessaging` ou `chrome.tabs`
- [ ] `host_permissions` réduit au nécessaire (`[]` si possible)
- [ ] Aucune donnée envoyée à un service distant sans que ce soit annoncé dans
      la description
- [ ] Logique testable isolée dans un `lib.js`, sans dépendance
- [ ] Testée par *Installer depuis un ZIP* dans une vraie page
- [ ] `npm run export:extensions -- --check` passe
