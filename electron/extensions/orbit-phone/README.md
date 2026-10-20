# Téléphone Orbit

Extension **optionnelle** d'Orbit. Elle n'embarque pas de code d'interface
dans les pages web : elle déclare au manifeste `orbit.nativeApp: "phone"`, et
Orbit active alors son pont natif (adb/scrcpy). Il n'y a donc **pas de
`content.js`** : rien n'est injecté dans les sites, tout se passe côté
application de bureau.

Sans elle :

- aucun bouton Téléphone dans la barre d'Orbit ;
- aucune app dans la barre latérale (elle n'y a jamais sa place) ;
- aucune commande adb/scrcpy acceptée ;
- le pont natif n'est pas chargé en mémoire et l'interface Téléphone n'est
  jamais téléchargée par le renderer.

## Installation

1. Dans Orbit : **Extensions → Extensions Orbit**, puis **Installer** en face de
   « Téléphone Orbit » (l'archive est livrée avec Orbit, mais reste inerte tant
   qu'elle n'est pas installée). Sinon : **Installer un ZIP** et choisissez
   `orbit-phone.zip` (dossier `extensions-dist/` du dépôt).
2. Un bouton **Téléphone** apparaît dans la barre du haut (avant la cloche),
   avec le nombre de notifications du mobile.
3. Branchez le téléphone en USB avec le **débogage USB** activé, ou utilisez la
   connexion sans fil (Android 11+).
4. Depuis le panneau, installez le moteur scrcpy embarqué — Orbit le télécharge
   dans ses propres données, sans toucher au système.

## Fonctionnement

- **Bouton de barre** → panneau Téléphone (Échap ou croix pour fermer). Rien
  n'est monté tant que le panneau n'est pas ouvert.
- **Accueil** : recherche d'applications (nom, paquet, initiales) et de liens,
  favoris, récents.
- **Ouverture d'une app** : Orbit crée un **écran virtuel Android** à l'aspect
  de la zone d'Orbit (`scrcpy --new-display --start-app`, scrcpy 3.0+ /
  Android 11+). L'application recompose son interface à cette taille et remplit
  la vue ; souris (clic, glisser), molette et clavier (texte, flèches, Tab,
  Page↑/↓…) agissent sur cet écran via `adb shell input -d`.
  Si l'appareil refuse l'écran virtuel, l'app s'ouvre sur l'écran principal du
  téléphone et le panneau affiche cet écran.
- **Fermer l'app** détruit son écran virtuel (le processus scrcpy s'arrête) et
  revient à la grille.
- **Notifications** : Orbit sonde le téléphone toutes les 12 s (liste des clés
  seule), affiche les notifications dans sa propre cloche (section Téléphone)
  et peut alerter le bureau. Actions : ouvrir l'app concernée sur le téléphone,
  écarter (sommeil 24 h côté Android — seule action permise par ADB), voir le
  volet sur le mobile.
- **Réglages** : moteur scrcpy, résolution de capture, intervalle, icônes,
  alertes de bureau, connexion USB/sans fil.

## Désinstallation

**Extensions → Téléphone Orbit → poubelle** : le bouton disparaît de la barre,
le panneau se ferme et l'écran virtuel est arrêté. Les réglages de l'app
(dernier appareil, favoris) restent dans les données d'Orbit et sont retrouvés
si l'extension est réinstallée.

## Prérequis

- Orbit **1.14** ou plus récent.
- Aucun `adb` ni `scrcpy` système n'est nécessaire : l'app installe les siens.
- Écran virtuel : Android 11+ et appareil déverrouillé.
