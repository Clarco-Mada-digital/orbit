// ---------------------------------------------------------------------------
// Une recette du catalogue → l'objet d'application à installer.
//
// Partagé par le catalogue (AppStore) et l'écran d'accueil : installer une
// app doit donner EXACTEMENT le même résultat d'où qu'on le fasse (icône
// embarquée, URL « maison », numérotation des comptes multiples).
// ---------------------------------------------------------------------------
import { faviconServiceUrl } from './appIcons';
import { bundledRecipeIcon } from '../components/AppIcon';

// `count` : nombre d'instances déjà installées de cette recette. Le 2e compte
// est numéroté pour se distinguer dans la barre latérale.
export function appFromRecipe(recipe, profileId, count = 0) {
  return {
    profileId,
    recipeId: recipe.id,
    name: count === 0 ? recipe.name : `${recipe.name} (${count + 1})`,
    url: recipe.url,
    // URL « maison » = URL de la recette : au redémarrage, on n'atterrit
    // jamais sur une page de connexion persistée.
    homeUrl: recipe.url,
    icon: recipe.icon,
    color: recipe.color,
    // Icône embarquée (AppIcon la trouve via recipeId) ; le favicon ne sert
    // que de repli pour les rares recettes sans icône embarquée.
    favicon: bundledRecipeIcon(recipe.id) ? '' : recipe.brandIcon || faviconServiceUrl(recipe.url),
    unread: 0,
    sleeping: false,
  };
}
