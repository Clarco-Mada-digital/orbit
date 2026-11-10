import { useEffect, useMemo, useState } from 'react';
import { getHostname } from '../lib/appIcons';
import { recipes } from '../lib/recipes';

// Icône d'une application, affichée partout (sidebar, en-tête, notifications…).
// Priorité : image téléversée par l'utilisateur → favicon sauvegardé →
// icon.horse (vraies icônes de marque) → Google s2 (repli) → emoji.
//
// Google s2 renvoie parfois un placeholder générique 16×16 au lieu d'une
// erreur (ex. web.whatsapp.com) : l'image se charge SANS erreur, donc
// onError ne suffit pas. On détecte aussi les images trop petites (< 24px)
// qui sont quasi toujours des placeholders, et on passe à la source suivante.
export default function AppIcon({ app, className = '', fallbackClassName = '' }) {
  const [srcIdx, setSrcIdx] = useState(0);

  const sources = useMemo(() => {
    const list = [];
    if (app.iconImage) list.push(app.iconImage);
    // Icône de marque officielle de la recette (ex. Google Drive ≠ Gmail) :
    // les favicons .google.com sont tous le même « G » générique.
    const recipe = app.recipeId ? recipes[app.recipeId] : null;
    if (recipe?.brandIcon && !list.includes(recipe.brandIcon)) list.push(recipe.brandIcon);
    if (app.favicon) list.push(app.favicon);
    const host = getHostname(app.url);
    if (host) {
      list.push(`https://icon.horse/icon/${host}`);
      list.push(`https://www.google.com/s2/favicons?domain=${host}&sz=64`);
    }
    return list;
  }, [app.iconImage, app.favicon, app.url]);

  // Si la liste des sources change (autre site, favicon mis à jour…),
  // on repart de la première source.
  useEffect(() => {
    setSrcIdx(0);
  }, [sources]);

  // Choix EXPLICITE d'un emoji par l'utilisateur (ajout ou édition) : il prime
  // sur tout — y compris le favicon automatique du site (icon.horse/s2) qui
  // était affiché quoi qu'il arrive, rendant le choix d'emoji inopérant.
  if (app.iconEmoji && !app.iconImage) {
    return (
      <span className={`leading-none ${fallbackClassName || ''}`}>{app.icon}</span>
    );
  }

  const current = sources[srcIdx];

  if (!current) {
    return (
      <span className={`leading-none ${fallbackClassName || ''}`}>{app.icon}</span>
    );
  }

  // Une image « placeholder » se charge sans erreur mais n'est pas la vraie
  // icône (générique 16×16). On la considère comme un échec → source suivante.
  //
  // Exception : le favicon qu'une page déclare elle-même. Beaucoup de sites
  // n'en publient qu'un 16×16, et c'est malgré tout LEUR icône — pour un lien
  // libre (page volante), mieux vaut la vraie petite icône que le dessin
  // générique d'un service tiers.
  const handleLoad = (e) => {
    const el = e.currentTarget;
    try {
      const ownFavicon = Boolean(app.ephemeral) && Boolean(app.favicon) && current === app.favicon;
      if (!ownFavicon && el.naturalWidth > 0 && el.naturalWidth < 24 && el.naturalHeight < 24) {
        setSrcIdx((i) => i + 1);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <img
      src={current}
      alt=""
      className={`object-contain ${className || ''}`}
      draggable={false}
      onLoad={handleLoad}
      onError={() => setSrcIdx((i) => i + 1)}
    />
  );
}
