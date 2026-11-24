// ---------------------------------------------------------------------------
// Polices Google chargées À LA DEMANDE.
//
// index.html demandait SEIZE familles à fonts.googleapis.com à chaque
// lancement, alors qu'une seule est affichée. Chromium ne télécharge que les
// fichiers réellement utilisés, mais la feuille de style, elle, part toujours :
// une requête à un tiers au démarrage, et la liste complète des polices
// qu'Orbit sait proposer — y compris celles que personne n'a choisies.
//
// Ne restent en dur dans index.html que les deux polices de l'interface par
// défaut (Inter, JetBrains Mono) : elles sont nécessaires au premier pixel, et
// les attendre dynamiquement ferait clignoter tout le texte au démarrage. Les
// quatorze autres arrivent quand on les choisit.
//
// `familyUrl` est séparée pour être testable sans DOM — c'est la partie qui
// casse silencieusement (une URL mal formée ne lève rien, la police ne
// s'applique simplement pas).
// ---------------------------------------------------------------------------

// Déjà dans index.html : ne jamais les redemander.
const DEJA_CHARGEES = new Set(['Inter', 'JetBrains Mono']);

// Graisses demandées pour une police chargée à la demande. Les mêmes que la
// liste d'origine : régulier, moyen, demi-gras, gras — au-delà, on téléchargerait
// des fichiers que l'interface n'utilise jamais.
const GRAISSES = '400;500;600;700';

export function familyUrl(family) {
  const nom = String(family || '').trim();
  if (!nom) return null;
  // Une pile CSS (« Inter, sans-serif ») n'est pas un nom de famille Google :
  // on ne garde que le premier nom, sans guillemets.
  const premier = nom.split(',')[0].replace(/["']/g, '').trim();
  if (!premier || DEJA_CHARGEES.has(premier)) return null;
  // Les familles génériques ne s'hébergent pas : les demander renverrait 400.
  if (/^(sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(premier)) return null;
  const encodee = premier.replace(/\s+/g, '+');
  return `https://fonts.googleapis.com/css2?family=${encodee}:wght@${GRAISSES}&display=swap`;
}

const posees = new Set();

// Pose la feuille de style de cette famille si besoin. Idempotent : appelée à
// chaque application du thème, elle ne crée qu'un seul <link> par police.
export function ensureWebFont(family) {
  const url = familyUrl(family);
  if (!url || posees.has(url)) return false;
  if (typeof document === 'undefined') return false;
  // Un rechargement de l'interface repart d'un Set vide : on vérifie aussi le
  // DOM, sinon un <link> déjà présent serait dupliqué.
  if (document.querySelector(`link[href="${url}"]`)) {
    posees.add(url);
    return false;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
  posees.add(url);
  return true;
}
