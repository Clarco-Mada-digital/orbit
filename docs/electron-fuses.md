# Fuses Electron

Les « fuses » sont des interrupteurs gravés **dans le binaire Electron** au moment
de l'empaquetage. Contrairement à un réglage de l'application, ils ne peuvent pas
être contournés par quelqu'un qui lance l'exécutable autrement : c'est le seul
niveau où l'on peut fermer les portes dérobées offertes par le runtime lui-même.

La configuration vit dans `package.json` → `build.electronFuses`, appliquée par
electron-builder. Elle ne concerne que les versions **empaquetées** :
`npm run electron:dev` n'est pas affecté (et garde donc `--inspect`).

| Fuse | Valeur | Pourquoi |
|---|---|---|
| `runAsNode` | **désactivée** | `ELECTRON_RUN_AS_NODE=1 ./orbit -e "…"` transformait le binaire en interpréteur Node avec les droits de l'utilisateur. Orbit n'utilise pas `process.fork`, donc rien ne dépend de cette variable. |
| `enableNodeCliInspectArguments` | **désactivée** | `--inspect` ouvrait un débogueur sur le processus principal — donc l'accès à tout ce qu'il détient, coffre-fort compris. |
| `enableNodeOptionsEnvironmentVariable` | **désactivée** | `NODE_OPTIONS` permet d'injecter du code au démarrage. Orbit n'en a pas besoin : les requêtes réseau passent par Chromium, qui utilise le magasin de certificats du système et non `NODE_EXTRA_CA_CERTS`. |
| `onlyLoadAppFromAsar` | **activée** | Sans elle, Electron cherche `app.asar`, **puis** un dossier `app/`. Déposer un dossier `app/` à côté du binaire suffisait à faire exécuter son propre code. |
| `enableEmbeddedAsarIntegrityValidation` | **activée** | Vérifie l'empreinte de `app.asar` au chargement : le code empaqueté ne peut plus être modifié après signature. Effectif sur macOS et Windows ; sans effet sur Linux. |
| `enableCookieEncryption` | **activée** | Voir l'avertissement ci-dessous. |
| `grantFileProtocolExtraPrivileges` | **laissée activée** | Voir ci-dessous. |

## `enableCookieEncryption` — transition à sens unique

Les cookies de session sont le vrai trésor d'Orbit : quelques dizaines de comptes
connectés, en clair dans une base SQLite du dossier utilisateur. Quiconque lit ce
dossier — sauvegarde, dossier synchronisé, machine volée sans chiffrement de
disque — récupère tous les comptes. Cette fuse les chiffre avec le trousseau de
l'OS, comme le fait Chrome.

**C'est irréversible.** Une fois activée, les cookies sont chiffrés à la
réécriture ; **repasser la fuse à `false` rend le magasin de cookies illisible**
et déconnecte l'utilisateur de toutes ses apps. Ne la désactivez pas pour
« revenir en arrière » : il faudrait supprimer les fichiers `Cookies` et se
reconnecter partout.

Sous Linux, le chiffrement s'appuie sur le trousseau détecté (gnome-libsecret,
kwallet, ou un repli à clé fixe). Si le trousseau devient indisponible entre deux
lancements, les cookies chiffrés avec lui ne sont plus déchiffrables → l'utilisateur
est déconnecté. C'est le même compromis que Chrome, mais il faut le savoir avant
de diffuser une version.

## `grantFileProtocolExtraPrivileges` — pourquoi elle reste activée

La recommandation générale est de la désactiver. Ici c'est impossible en l'état :
l'interface est chargée avec `loadFile('dist/index.html')`, donc en `file://`, et
Vite produit `<script type="module">`. Le chargement de modules ES depuis `file://`
dépend précisément des privilèges accordés par cette fuse — la désactiver
empêcherait l'application de démarrer.

Pour pouvoir la fermer un jour, il faudrait servir l'interface depuis un protocole
personnalisé (`protocol.handle('app://…')`) au lieu de `file://`.

## Vérifier les fuses d'un binaire

Les états sont écrits en clair dans l'exécutable, après une sentinelle :

```sh
node -e "
const b=require('fs').readFileSync('dist-electron/linux-unpacked/orbit');
const S=Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const i=b.indexOf(S);
console.log([...b.subarray(i+S.length+2, i+S.length+2+b[i+S.length+1])].map(String.fromCharCode).join(''));
"
```

Chaque caractère vaut `0` (désactivée), `1` (activée) ou `\r` (non gérée), dans
l'ordre du tableau ci-dessus.
