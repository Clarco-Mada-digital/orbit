// Raccourcis clavier d'Orbit — centralisés.
//
// Pour ne JAMAIS entrer en conflit avec les apps web embarquées (Gmail,
// Notion, Slack… qui utilisent Ctrl+K, Ctrl+Tab…), Orbit utilise :
//   - Windows / Linux : la touche **Alt** (les apps web l'utilisent rarement)
//   - macOS : **⌘** (Option sert à taper les caractères accentués)
//
// Les raccourcis sont interceptés GLOBALEMENT (même quand le focus est dans
// une app) par le main process (before-input-event) → jamais mangés par les
// apps, et les apps gardent leurs propres raccourcis Ctrl.

export function isMac() {
  return (
    typeof window !== 'undefined' &&
    window.electronAPI?.platform === 'darwin'
  );
}

const ASSISTANT_CHAT_SHORTCUT_KEYS = ['a', 'j', 'u', 'y'];

export function normalizeAssistantChatShortcutKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  return ASSISTANT_CHAT_SHORTCUT_KEYS.includes(normalized) ? normalized : null;
}

// Cœur commun : une combinaison normalisée { key, ctrl, alt, meta, shift } →
// nom d'action, ou null. Le DOM (keydown) et le main process
// (before-input-event) n'en diffèrent que par la forme de l'événement : une
// seule table évite que les deux listes divergent.
//
// Choix des touches :
//   • lettres plutôt que symboles — « \ », « / » ou « [ » demandent AltGr ou
//     Maj sur un clavier AZERTY ;
//   • jamais ⌘X, ⌘Z, ⌘C, ⌘V, ⌘A sur macOS (couper, annuler, copier…) ;
//   • l'écran partagé vit sur la couche ⇧, plus sûre côté apps web.
export function matchCombo({ key, code, ctrl, alt, meta, shift }, mac, assistantChatShortcutKey = 'a') {
  const k = String(key || '').toLowerCase();
  // Rechercher dans la page : Ctrl+F (Win/Linux) ou ⌘F (mac) — remplace la
  // recherche de l'app embarquée par celle d'Orbit.
  if ((mac ? meta && !ctrl : ctrl && !alt) && !shift && k === 'f') return 'find';
  // Recharger la page de l'app active : Ctrl+R / ⌘R et F5 — comme dans un
  // navigateur. Avec Maj (⇧R / ⇧F5) → rechargement FORT, cache ignoré.
  const modReload = mac ? meta && !ctrl : ctrl && !alt;
  if (modReload && k === 'r') return shift ? 'reload-hard' : 'reload';
  if (k === 'f5' && !alt) return shift || ctrl || meta ? 'reload-hard' : 'reload';
  // Aide : la liste des raccourcis, sans modificateur.
  if (k === 'f1' && !alt && !ctrl && !meta && !shift) return 'help';

  const mod = mac ? meta : alt;
  // Modificateur parasite (Ctrl, ou l'autre) → pas un raccourci Orbit
  if (!mod || ctrl || (mac ? alt : meta)) return null;
  const chatKey = normalizeAssistantChatShortcutKey(assistantChatShortcutKey);
  if (shift && chatKey && k === chatKey) return 'assistant-chat';

  if (shift) {
    switch (k) {
      case 's': return 'screenshot';
      case 'e': return 'proofread-editor';
      case 'i': return 'assistant-editor';
      case 'o': return 'store';
      case 'p': return 'profiles';
      case 'm': return 'mark-all-read';
      case 'h': return 'toggle-bars';
      // Libres d'usage ailleurs : ⇧D (palette de Mouse Scroll), ⇧F (Fake
      // Data) et ⇧J / ⇧U / ⇧Y (touches possibles de l'assistant) ne sont
      // jamais pris ici — voir test/mouse-scroll.test.js.
      case 't': return 'downloads';
      case 'v': return 'vault';
      case 'n': return 'detach';
      // Écran partagé
      case 'x': return 'split-toggle';
      case 'c': return 'split-direction';
      case 'g': return 'split-focus';
      // Profil suivant / précédent : même geste que pour les apps, avec ⇧.
      case 'pagedown': return 'next-profile';
      case 'pageup': return 'prev-profile';
      default: break;
    }
  }

  switch (k) {
    case 'k': return 'search';
    case ',': return 'settings';
    // Modifier l'URL de la page courante — surtout utile sur une page VOLANTE.
    case 'l': return 'edit-url';
    case 't': return 'new-page';
    case 'w': return 'close-page';
    case 's': return shift ? null : 'toggle-sleep';
    case 'b': return 'toggle-sidebar';
    case 'pagedown': return 'next-app';
    case 'pageup': return 'prev-app';
    case '+':
    case '=': return 'zoom-in';
    case '-': return 'zoom-out';
    case '0': return 'zoom-reset';
    default: break;
  }
  if (/^[1-9]$/.test(k)) return `app-${k}`;
  // Clavier AZERTY : la rangée du haut donne « & é " ' ( … » sans Maj. La
  // position physique de la touche (`code`) désigne alors le chiffre.
  const digit = /^Digit([1-9])$/.exec(String(code || ''));
  if (digit) return `app-${digit[1]}`;
  return null;
}

// La combinaison est-elle un raccourci d'Orbit ? (événement keydown du DOM)
export function matchShortcut(e, assistantChatShortcutKey = 'a') {
  if (!e) return null;
  return matchCombo(
    { key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey },
    isMac(),
    assistantChatShortcutKey,
  );
}

// Même logique pour l'objet `input` du main process (before-input-event)
export function matchShortcutInput(input, assistantChatShortcutKey = 'a') {
  if (!input || input.type !== 'keyDown') return null;
  const mac = typeof process !== 'undefined' && process.platform === 'darwin';
  return matchCombo(
    { key: input.key, code: input.code, ctrl: input.control, alt: input.alt, meta: input.meta, shift: input.shift },
    mac,
    assistantChatShortcutKey,
  );
}

// Groupes d'affichage, dans l'ordre où ils apparaissent.
export const SHORTCUT_GROUPS = ['general', 'apps', 'pages', 'split', 'view', 'tools'];

// Liste d'affichage (panneau « help », Réglages → Raccourcis) — adaptée à la
// plateforme. Chaque entrée porte son `group` (voir SHORTCUT_GROUPS).
// Accepte une fonction de traduction `t` (i18n) ; sans elle, retombe sur le FR.
export function shortcutKeys(t, assistantOptions = {}) {
  const d = (key, fr) => (typeof t === 'function' ? t(key) : fr);
  const mac = isMac();
  const M = mac ? '⌘' : 'Alt';
  const g = (group, keys, desc) => ({ group, keys, desc });
  const shortcuts = [
    // Général
    g('general', [M, 'K'], d('sc.search', 'Rechercher partout (ce panneau)')),
    g('general', ['F1'], d('sc.help', 'Afficher cette liste de raccourcis')),
    g('general', [M, ','], d('sc.settings', 'Paramètres')),
    g('general', [M, '⇧', 'O'], d('sc.store', "Boutique d'applications")),
    g('general', [M, '⇧', 'P'], d('sc.profiles', 'Gérer les profils')),
    g('general', [M, '⇧', 'M'], d('sc.markAll', 'Tout marquer comme lu')),
    g('general', [d('sc.escKey', 'Échap')], d('sc.escape', 'Fermer / annuler')),
    // Apps et profils
    g('apps', [M, 'Page ↓'], d('sc.nextApp', "Passer à l'app suivante")),
    g('apps', [M, 'Page ↑'], d('sc.prevApp', "Passer à l'app précédente")),
    g('apps', [M, '1…9'], d('sc.gotoApp', 'Aller directement à l’app n° 1 à 9')),
    g('apps', [M, '⇧', 'Page ↓'], d('sc.nextProfile', 'Passer au profil suivant')),
    g('apps', [M, '⇧', 'Page ↑'], d('sc.prevProfile', 'Passer au profil précédent')),
    g('apps', [M, 'S'], d('sc.sleep', "Mettre en veille / réveiller l'app active")),
    g('apps', [M, '⇧', 'N'], d('sc.detach', 'Détacher l’app active dans sa propre fenêtre')),
    // Pages
    g('pages', [M, 'T'], d('sc.newPage', 'Ouvrir une adresse dans une page volante')),
    g('pages', [M, 'L'], d('sc.editUrl', 'Modifier l’adresse de la page active')),
    g('pages', [M, 'W'], d('sc.closePage', 'Fermer l’aperçu de lien ou la page volante active')),
    g('pages', [mac ? '⌘' : 'Ctrl', 'R'], d('sc.reload', "Recharger la page de l'app active (⇧ : ignorer le cache)")),
    g('pages', [mac ? '⌘' : 'Ctrl', 'F'], d('sc.find', 'Rechercher dans la page')),
    // Écran partagé
    g('split', [M, '⇧', 'X'], d('sc.splitToggle', 'Écran partagé : partager avec l’app précédente / quitter')),
    g('split', [M, '⇧', 'C'], d('sc.splitDirection', 'Écran partagé : côte à côte ↔ haut / bas')),
    g('split', [M, '⇧', 'G'], d('sc.splitFocus', 'Écran partagé : passer au panneau suivant')),
    // Affichage
    g('view', [M, '+'], d('sc.zoomIn', 'Zoom avant (app active)')),
    g('view', [M, '−'], d('sc.zoomOut', 'Zoom arrière (app active)')),
    g('view', [M, '0'], d('sc.zoomReset', 'Réinitialiser le zoom')),
    g('view', [M, 'B'], d('sc.sidebar', 'Réduire / agrandir la barre latérale')),
    g('view', [M, '⇧', 'H'], d('sc.bars', 'Afficher / masquer les barres cachées (mode épuré)')),
    g('view', ['F11'], d('sc.fullscreen', 'Plein écran')),
    // Outils
    g('tools', [M, '⇧', 'S'], d('sc.screenshot', 'Capturer l’écran de l’app active')),
    g('tools', [M, '⇧', 'E'], d('sc.proofreadEditor', 'Relire le texte du champ actif (sans IA)')),
    g('tools', [M, '⇧', 'I'], d('sc.assistantEditor', 'Relire le texte du champ actif avec l’IA')),
    g('tools', [M, '⇧', 'T'], d('sc.downloads', 'Téléchargements')),
    g('tools', [M, '⇧', 'V'], d('sc.vault', 'Coffre-fort de mots de passe')),
  ];
  if (assistantOptions.assistantChatEnabled !== false && assistantOptions.assistantChatShortcutEnabled !== false) {
    const key = (normalizeAssistantChatShortcutKey(assistantOptions.assistantChatShortcutKey) || 'a').toUpperCase();
    const at = shortcuts.findIndex((s) => s.group === 'tools') + 1;
    shortcuts.splice(at, 0, g('tools', [M, '⇧', key], d('sc.assistantChat', 'Ouvrir la discussion avec l’assistant IA Orbit')));
  }
  return shortcuts;
}

// Minuscules, sans accents : « ecran » trouve « Écran partagé ».
const fold = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// Filtre la liste pour la recherche des réglages. Chaque mot doit apparaître
// dans la description, le nom du groupe ou les touches : « split alt » ou
// « zoom » ou « ⇧ x » fonctionnent. `groupLabel(id)` donne le nom affiché
// d'un groupe (pour que « partagé » trouve tout le groupe).
export function filterShortcuts(list, query, groupLabel = (id) => id) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((s) => {
    const hay = fold(`${s.desc} ${groupLabel(s.group)} ${s.keys.join(' ')}`);
    // « shift » / « maj » trouvent ⇧ ; « cmd » trouve ⌘.
    const keysAlias = s.keys.includes('⇧') ? ' shift maj' : '';
    const cmdAlias = s.keys.includes('⌘') ? ' cmd command' : '';
    return words.every((w) => (hay + keysAlias + cmdAlias).includes(w));
  });
}
