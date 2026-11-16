# Créer un thème pour Orbit

Un thème Orbit est **un seul fichier JSON**. Pas de CSS à écrire, pas de classe
à connaître, rien à compiler : des couleurs, et une dizaine de réglages de
forme. Si vous savez choisir dix couleurs, vous savez faire un thème.

Ce document décrit le format, chaque réglage, et les pièges — notamment celui de
la lisibilité, qui est le seul vrai piège du métier.

---

## 1. Le plus court chemin

N'écrivez pas un thème depuis la page blanche. **Exportez-en un, modifiez-le,
réimportez-le.**

1. Réglages → Apparence → **Exporter le thème courant**
2. Ouvrez le fichier dans un éditeur de texte
3. Changez les couleurs qui vous intéressent
4. Réglages → Apparence → **Importer un thème**

L'identifiant du fichier exporté est déjà suffixé (`tech-copie`), vous pouvez
donc le réimporter sans conflit avec le thème d'origine. Réimporter un thème
qui porte le même identifiant le **remplace** : corrigez, réimportez, regardez,
autant de fois que nécessaire.

---

## 2. Les deux axes : thème et ambiance

Orbit sépare deux choses que la plupart des applications confondent.

| Axe | Ce qu'il porte | Valeurs |
| --- | --- | --- |
| **Thème** (`skin`) | L'identité : couleurs et formes | `orbit`, `tech`, `paper`, `amber`, `noel`, `aurore`, ou le vôtre |
| **Ambiance** (`mode`) | Clair ou sombre | `dark`, `light`, `auto` |

Les thèmes livrés, pour situer les caractères : **Orbit** (l'apparence
d'origine), **Tech** (angles vifs, halo, police à chasse fixe, et derrière
l'interface un réseau de points reliés qui dérive et se resserre autour du
curseur), **Papier**
(plat et reposant), **Nuit chaude** (ambre et brun), **Noël** (vert sapin,
or et neige, avec un accent rouge baie de houx en clair ; la neige tombe sur
toute la fenêtre et deux guirlandes courent en haut et en bas, coupées avec
les animations de l'application) et **Aurore** (ciel d'espace : nuit polaire,
étoiles qui scintillent et tournent avec la voûte céleste, étoiles filantes,
planètes qui flottent et voiles vert menthe et violet ; accent vert d'aurore
en sombre et violet profond en clair).

Conséquence pour vous : **un thème décrit normalement DEUX palettes**, une par
ambiance. La silhouette (les angles, le halo, la police) ne change pas entre
les deux — c'est l'identité du thème. Seules les couleurs bougent.

Vous pouvez n'en décrire qu'une seule. Orbit l'utilisera alors pour les deux,
et vous préviendra à l'import : le mode « auto » n'aura aucun effet sur votre
thème.

---

## 3. Fichier minimal qui fonctionne

```json
{
  "orbitTheme": 1,
  "id": "nord",
  "name": "Nord",
  "dark": {
    "bgPrimary": "46 52 64",
    "bgSecondary": "59 66 82",
    "bgElevated": "67 76 94",
    "bgHover": "76 86 106",
    "textPrimary": "236 239 244",
    "textSecondary": "216 222 233",
    "textMuted": "180 190 208",
    "border": "67 76 94",
    "borderLight": "76 86 106",
    "accent": "136 192 208"
  }
}
```

C'est tout. Les formes sont héritées du thème Orbit, et le thème apparaît
aussitôt dans le sélecteur.

### Les trois champs d'en-tête

| Champ | Obligatoire | Règle |
| --- | --- | --- |
| `orbitTheme` | oui | La version du format. Vaut **1** aujourd'hui. |
| `id` | oui | 2 à 32 caractères : minuscules, chiffres, tirets. Sert de clé interne — ne reprenez pas l'identifiant d'un thème livré (`orbit`, `tech`, `paper`, `amber`). |
| `name` | oui | Le nom affiché dans les réglages. 48 caractères au maximum. |

---

## 4. Les couleurs

Dix couleurs par ambiance, **toutes obligatoires**. Deux écritures acceptées :

- un triplet RGB : `"46 52 64"` (chaque composante de 0 à 255) ;
- de l'hexadécimal : `"#2e3440"`.

Les deux sont équivalentes. L'hexadécimal est plus pratique quand vous copiez
depuis un outil de design ; le triplet est ce qu'Orbit utilise en interne.

| Clé | Où ça se voit |
| --- | --- |
| `bgPrimary` | Le fond général de la fenêtre |
| `bgSecondary` | Les panneaux : barre latérale, champs de saisie |
| `bgElevated` | Les surfaces posées par-dessus : cartes, menus, boîtes de dialogue |
| `bgHover` | Le fond d'un élément survolé ou actif |
| `textPrimary` | Le texte courant |
| `textSecondary` | Le texte secondaire : sous-titres, libellés |
| `textMuted` | Les mentions discrètes : légendes, aides, compteurs |
| `border` | Les liserés et séparateurs |
| `borderLight` | Les liserés un peu plus marqués |
| `accent` | **La couleur signature du thème** : boutons, sélection, icônes actives |

### L'accent n'est qu'une proposition

Si l'utilisateur a choisi une couleur d'accent dans les réglages, **son choix
gagne** sur la vôtre. C'est volontaire : la couleur d'accent est un réglage
d'accessibilité et de goût autant qu'un choix de design. Votre `accent` est la
valeur par défaut de votre thème, pas une contrainte.

---

## 5. Les formes : `traits`

C'est ici que votre thème cesse d'être « le thème sombre avec une autre
teinte ». Tout est **facultatif, clé par clé** : ce que vous n'écrivez pas est
hérité du thème Orbit.

```json
"traits": {
  "radiusCard": "2px",
  "radiusControl": "1px",
  "radiusPill": "2px",
  "borderWidth": "1px",
  "shadowCard": "none",
  "glow": 1,
  "font": "JetBrains Mono",
  "tracking": "0.04em",
  "uppercase": true,
  "texture": "grid"
}
```

| Clé | Type attendu | Effet |
| --- | --- | --- |
| `radiusCard` | longueur CSS | Arrondi des cartes et panneaux. `"0"` donne des angles vifs. |
| `radiusControl` | longueur CSS | Arrondi des boutons et des champs. |
| `radiusPill` | longueur CSS | Arrondi des pastilles et compteurs. `"9999px"` = complètement rond. |
| `borderWidth` | longueur CSS | Épaisseur des liserés. |
| `shadowCard` | ombre CSS, ou `"none"` | Ombre portée des surfaces. `"none"` donne une interface parfaitement plate. |
| `glow` | nombre de 0 à 1 | Halo d'accent autour des boutons. `0` = aucun, `1` = franc. |
| `font` | nom de police | Police de l'interface. Un nom simple, sans guillemets. |
| `tracking` | valeur en `em` | Interlettrage. `"0.04em"` aère un rendu technique. |
| `uppercase` | `true` / `false` | Met les titres de section en capitales. |
| `texture` | `none`, `grid` ou `glow` | Fond de l'application : rien, une grille technique, ou une lueur d'ambiance. |

Les longueurs acceptées sont `0`, ou un nombre suivi de `px`, `rem`, `em`
ou `%`. `"12"` tout seul est refusé — l'unité est obligatoire, sinon la valeur
ne veut rien dire en CSS.

### Trois recettes de silhouette

**Instrument technique** — angles vifs, halo, police à chasse fixe :
```json
"traits": { "radiusCard": "2px", "radiusControl": "1px", "shadowCard": "none",
            "glow": 1, "font": "JetBrains Mono", "tracking": "0.04em",
            "uppercase": true, "texture": "grid" }
```

**Papier calme** — tout plat, arrondi généreux, aucun effet :
```json
"traits": { "radiusCard": "1rem", "radiusControl": "0.625rem",
            "shadowCard": "none", "glow": 0, "texture": "none" }
```

**Relief doux** — ombres franches, lueur discrète :
```json
"traits": { "radiusCard": "0.875rem", "glow": 0.35,
            "shadowCard": "0 8px 20px -6px rgb(0 0 0 / 0.45)", "texture": "glow" }
```

---

## 6. La lisibilité : le seul vrai piège

Un thème se dessine à l'œil, et l'œil se trompe. Un cyan néon sur noir profond
paraît éclatant pendant qu'on le règle ; le gris des légendes, lui, est devenu
illisible sans qu'on le remarque. On s'en aperçoit après deux heures de
travail, sous forme de fatigue.

Orbit **mesure** donc le contraste de votre thème à l'import, et vous signale
chaque paire problématique avec son rapport :

```
Lisibilité (dark) : textMuted sur bgPrimary donne 2.4:1,
en dessous du minimum conseillé de 3:1
```

**Ce n'est qu'un avertissement.** Votre thème est importé quand même : c'est
votre interface, et vous avez peut-être une bonne raison. Les thèmes livrés
avec Orbit, eux, n'ont pas ce droit — un test refuse la livraison d'une palette
en dessous des seuils.

### Les seuils

| Paire | Minimum | Pourquoi |
| --- | --- | --- |
| `textPrimary` sur les trois fonds | 4,5:1 | Le seuil WCAG AA pour du texte courant. |
| `textSecondary` sur `bgPrimary` et `bgElevated` | 4,5:1 | C'est du texte qu'on lit vraiment, pas de la décoration. |
| `textMuted` sur `bgPrimary` et `bgElevated` | 3:1 | Mentions discrètes. Exiger 4,5 obligerait à un gris si sombre qu'il ne se distinguerait plus du texte normal — on perdrait la hiérarchie qu'il sert à créer. |
| `accent` sur `bgPrimary` et `bgElevated` | 3:1 | L'accent porte des icônes et des bordures, pas des paragraphes. |

### Deux conseils qui évitent l'essentiel des problèmes

1. **Écartez vos fonds les uns des autres.** `bgPrimary`, `bgSecondary` et
   `bgElevated` doivent se distinguer, sinon les cartes et menus se fondent
   dans la page. Deux ou trois pas de luminosité suffisent.
2. **Ne dérivez pas `textMuted` de `textSecondary` en baissant l'opacité.**
   Choisissez-le explicitement, contre votre fond, et vérifiez le rapport.

---

## 7. Partager son thème

Un thème est un fichier : envoyez-le, publiez-le dans un dépôt, joignez-le à un
message. Celui qui le reçoit fait Réglages → Apparence → **Importer un thème**.

Rien n'est exécuté à l'import : un thème ne contient que des valeurs, jamais de
code. Orbit refuse d'ailleurs toute valeur qui pourrait s'échapper vers du CSS
arbitraire — un `font` ou un `shadowCard` contenant `;` ou `{}` est rejeté.

---

## 8. Mémo du format

```json
{
  "orbitTheme": 1,
  "id": "mon-theme",
  "name": "Mon thème",
  "traits": {
    "radiusCard": "0.75rem", "radiusControl": "0.5rem", "radiusPill": "9999px",
    "borderWidth": "1px", "shadowCard": "none", "glow": 0,
    "font": "Inter", "tracking": "0em", "uppercase": false, "texture": "none"
  },
  "dark":  { "bgPrimary": "…", "bgSecondary": "…", "bgElevated": "…", "bgHover": "…",
             "textPrimary": "…", "textSecondary": "…", "textMuted": "…",
             "border": "…", "borderLight": "…", "accent": "…" },
  "light": { "bgPrimary": "…", "bgSecondary": "…", "bgElevated": "…", "bgHover": "…",
             "textPrimary": "…", "textSecondary": "…", "textMuted": "…",
             "border": "…", "borderLight": "…", "accent": "…" }
}
```

Obligatoire : `orbitTheme`, `id`, `name`, et au moins une des deux ambiances
avec ses dix couleurs. Tout le reste est facultatif.
