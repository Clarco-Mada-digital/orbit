# Orbit Base de données

Extension **optionnelle** d'Orbit. Comme « Téléphone Orbit », elle ne contient
aucun code de page : elle déclare `orbit.nativeApp: "database"` et Orbit active
son client SQL intégré (le code vit dans `electron/database.js`, les pilotes ne
sont chargés qu'à la première connexion de leur type).

Une extension de navigateur ne peut pas ouvrir de connexion TCP vers MySQL ou
PostgreSQL : c'est pourquoi le client vit dans Orbit et non dans l'extension.

## Bases prises en charge

| Base | Pilote |
| :--- | :--- |
| SQLite | `node:sqlite` (intégré à Electron, aucun module natif) |
| MySQL / MariaDB | `mysql2` |
| PostgreSQL | `pg` |
| SQL Server | `mssql` (tedious) |

## Connexions

- **Épinglée** : retrouvée au prochain lancement. Le mot de passe est chiffré
  par le trousseau du système (`safeStorage`) ; sans trousseau, il n'est
  **jamais** écrit en clair et reste en mémoire le temps de la session.
- **Jetable** : rien n'est écrit sur le disque, la connexion et son historique
  disparaissent à la fermeture d'Orbit.
- **Lecture seule** : toute requête qui modifie est refusée (et la session
  elle-même est ouverte en lecture seule sur MySQL, PostgreSQL et SQLite).

## Fonctions

- Arbre des schémas, tables et vues, avec filtre.
- **Éditeur SQL** : Ctrl+Entrée exécute la requête sous le curseur (ou la
  sélection) ; un ▶ dans la marge exécute une requête précise ; « Tout
  exécuter » enchaîne le script et s'arrête à la première erreur. Ouverture et
  enregistrement de fichiers `.sql` (`DELIMITER` MySQL et `$$` PostgreSQL
  compris). Historique et requêtes favorites par connexion.
- **Table** : données paginées, filtre `WHERE`, tri par colonne, édition au
  double-clic, ajout et suppression de lignes (uniquement avec clé primaire,
  pour ne jamais toucher plusieurs lignes par erreur).
- **Structure** des colonnes, et **Analyse** : remplissage, valeurs distinctes,
  bornes et valeurs les plus fréquentes de chaque colonne.
- **Export** CSV, JSON ou `INSERT` SQL.

## Installation

**Extensions → Extensions Orbit → Installer** en face de « Orbit Base de
données ». Un bouton apparaît dans la barre du haut.
