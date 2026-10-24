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
- **Accueil personnalisable** : horloge, batterie, notifications, favoris,
  applications récentes et contrôles rapides peuvent être affichés ou masqués.
  Quatre dégradés et quatre photos sont proposés ; une image locale (PNG, JPEG,
  WebP ou GIF, jusqu'à 4 Mo) ou une URL d'image peut aussi servir de fond.
  « Tout effacer » écarte les notifications du téléphone (mise en sommeil
  Android de 24 h, comme l'action individuelle). Les contrôles rapides ajustent
  le volume, pilotent le Wi-Fi et le Bluetooth via ADB et ouvrent les réglages
  Android du réseau, du son ou de l'appareil. Certains constructeurs peuvent
  restreindre les commandes radio ; Orbit affiche alors l'erreur et laisse les
  réglages Android accessibles.
  Les cartes de cet accueil sont des widgets Orbit : les widgets Android
  publiés par des applications installées ne sont pas hébergés ici, car cela
  nécessite un hôte de widgets Android natif.
- Les raccourcis **Écran**, **Miroir**, **Retour**, **Accueil**, **Récents** et
  **Volume** restent accessibles directement sur le bureau, sans ouvrir le
  tiroir d'applications. Les favoris et les apps récentes y sont affichés en
  cartes compactes et défilantes.
- **Applications** : recherche par nom, paquet ou initiales, ouverture de liens,
  favoris et récents.
- **Ouverture d'une app** : chaque app ouvre sa **propre fenêtre de bureau** par
  un processus scrcpy (`--new-display --start-app`, scrcpy 3.0+ / Android 11+).
  scrcpy transporte directement la vidéo et le clavier ; Orbit ne simule plus
  la fenêtre avec des captures d'écran répétées. Le mode Paysage fournit par
  défaut un écran virtuel large, et scrcpy 4+ peut suivre le redimensionnement
  de la fenêtre tout en conservant une densité lisible.
- **Miroir** : le bouton Fenêtre miroir reste une session séparée qui affiche
  l'écran physique du téléphone. Ouvrir une application ne remplace pas et ne
  détourne pas le miroir.
- **Fermer l'app** ferme sa fenêtre scrcpy. Fermer l'espace Téléphone dans Orbit
  laisse ouvertes les fenêtres d'applications déjà lancées.
- **Notifications** : Orbit sonde le téléphone toutes les 12 s (liste des clés
  seule), affiche les notifications dans sa propre cloche (section Téléphone)
  et peut alerter le bureau. Actions : ouvrir l'app concernée sur le téléphone,
  écarter (sommeil 24 h côté Android — seule action permise par ADB), voir le
  volet sur le mobile.
- **Réglages** : moteur scrcpy, résolution et fréquence de l'aperçu, taille des
  icônes, orientation et densité des fenêtres d'applications, adaptation au
  redimensionnement, widgets et ambiance de l'accueil, alertes de bureau,
  connexion USB/sans fil.

## Désinstallation

**Extensions → Téléphone Orbit → poubelle** : le bouton disparaît de la barre,
le panneau se ferme et l'écran virtuel est arrêté. Les réglages de l'app
(dernier appareil, favoris) restent dans les données d'Orbit et sont retrouvés
si l'extension est réinstallée.

## Prérequis

- Orbit **1.14** ou plus récent.
- Aucun `adb` ni `scrcpy` système n'est nécessaire : l'app installe les siens.
- Écran virtuel : Android 11+ et appareil déverrouillé.
