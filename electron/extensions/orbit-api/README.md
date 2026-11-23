# Orbit API

Extension **optionnelle** d'Orbit (`orbit.nativeApp: "api"`) qui active le
client API intégré. Les requêtes partent du processus principal d'Orbit : pas
de règle CORS, aucun en-tête interdit — comme Postman ou REST Client.

## Deux façons de travailler

**Formulaire** (façon Postman) : méthode, URL, paramètres, en-têtes, corps
(JSON, texte, XML, formulaire, multipart avec fichiers, GraphQL, fichier
binaire), authentification (Bearer, Basic, clé d'API). Les requêtes se rangent
dans des **collections** (dossiers compris) et s'exportent en `.http`.

**Fichiers `.http` / `.rest`** (format de l'extension REST Client de VS Code) :

```http
@baseUrl = https://api.exemple.com

### Connexion
# @name login
POST {{baseUrl}}/login
Content-Type: application/json

{ "user": "moi", "password": "{{motdepasse}}" }

### Profil — réutilise le jeton de la réponse précédente
GET {{baseUrl}}/me
Authorization: Bearer {{login.response.body.$.token}}
```

Un ▶ dans la marge envoie chaque requête ; Ctrl+Entrée envoie celle sous le
curseur.

## Variables

- `{{nom}}` : environnement actif (Local, Recette, Production…), variables de
  la collection ou `@nom = …` du fichier.
- Système : `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`,
  `{{$datetime iso8601}}`, `{{$datetime rfc1123}}`, `{{$randomInt 1 100}}`.
- Réponses nommées : `{{login.response.body.$.data.id}}`,
  `{{login.response.headers.Location}}`.

## Import

cURL (« Copier en cURL » des outils de développement — on peut aussi le coller
directement dans la barre d'URL), fichiers `.http`, OpenAPI 3 / Swagger 2 en
JSON, collections Postman v2.x.

## Réponse

Statut, durée (premier octet / téléchargement), taille, corps formaté (JSON),
aperçu HTML et images, en-têtes, commande cURL équivalente, enregistrement du
corps dans un fichier. Historique des 100 dernières requêtes.
