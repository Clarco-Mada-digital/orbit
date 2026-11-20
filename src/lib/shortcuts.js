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

// Liste d'affichage (panneau « help ») — adaptée à la plateforme.
// Accepte une fonction de traduction `t` (i18n) ; sans elle, retombe sur le FR.
export function shortcutKeys(t, assistantOptions = {}) {
  const d = (key, fr) => (typeof t === 'function' ? t(key) : fr);
  const mac = isMac();
  const M = mac ? '⌘' : 'Alt';
  const shortcuts = [
    { keys: [M, '⇧', 'E'], desc: d('sc.proofreadEditor', 'Relire le texte du champ actif (sans IA)') },
    { keys: [M, '⇧', 'I'], desc: d('sc.assistantEditor', 'Relire le texte du champ actif avec l’IA') },
    { keys: [M, 'K'], desc: d('sc.search', 'Rechercher partout (ce panneau)') },
    {
      keys: [mac ? '⌘' : 'Ctrl', 'R'],
      desc: d('sc.reload', "Recharger la page de l'app active (⇧ : ignorer le cache)"),
    },
    { keys: [M, ','], desc: d('sc.settings', 'Paramètres') },
    { keys: [M, '⇧', 'O'], desc: d('sc.store', "Boutique d'applications") },
    { keys: [M, '⇧', 'P'], desc: d('sc.profiles', 'Gérer les profils') },
    { keys: [M, 'S'], desc: d('sc.sleep', "Mettre en veille / réveiller l'app active") },
    { keys: [M, 'B'], desc: d('sc.sidebar', 'Réduire / agrandir la barre latérale') },
    { keys: [M, '⇧', 'M'], desc: d('sc.markAll', 'Tout marquer comme lu') },
    {
      keys: [M, '⇧', 'H'],
      desc: d('sc.bars', 'Afficher / masquer les barres cachées (mode épuré)'),
    },
    { keys: mac ? [M, '`'] : [M, 'Page ↓'], desc: d('sc.nextApp', "Passer à l'app suivante") },
    { keys: mac ? [M, '⇧', '`'] : [M, 'Page ↑'], desc: d('sc.prevApp', "Passer à l'app précédente") },
    {
      keys: [M, '⇧', 'Page ↓'],
      desc: d('sc.nextProfile', 'Passer au profil suivant'),
    },
    {
      keys: [M, '⇧', 'Page ↑'],
      desc: d('sc.prevProfile', 'Passer au profil précédent'),
    },
    { keys: [M, '1…9'], desc: d('sc.gotoApp', 'Aller directement à l’app n° 1 à 9') },
    { keys: [M, '+'], desc: d('sc.zoomIn', 'Zoom avant (app active)') },
    { keys: [M, '−'], desc: d('sc.zoomOut', 'Zoom arrière (app active)') },
    { keys: [M, '0'], desc: d('sc.zoomReset', 'Réinitialiser le zoom') },
    { keys: [M, 'T'], desc: d('sc.newPage', 'Ouvrir une adresse dans une page volante') },
    { keys: [M, 'W'], desc: d('sc.closePage', 'Fermer l’aperçu de lien ou la page volante active') },
    { keys: [M, '⇧', 'X'], desc: d('sc.splitToggle', 'Écran partagé : partager avec l’app précédente / quitter') },
    { keys: [M, '⇧', 'C'], desc: d('sc.splitDirection', 'Écran partagé : côte à côte ↔ haut / bas') },
    { keys: [M, '⇧', 'G'], desc: d('sc.splitFocus', 'Écran partagé : passer au panneau suivant') },
    { keys: [M, '⇧', 'N'], desc: d('sc.detach', 'Détacher l’app active dans sa propre fenêtre') },
    { keys: [M, '⇧', 'T'], desc: d('sc.downloads', 'Téléchargements') },
    { keys: [M, '⇧', 'V'], desc: d('sc.vault', 'Coffre-fort de mots de passe') },
    { keys: ['F1'], desc: d('sc.help', 'Afficher cette liste de raccourcis') },
    { keys: [d('sc.escKey', 'Échap')], desc: d('sc.escape', 'Fermer / annuler') },
  ];
  if (assistantOptions.assistantChatEnabled !== false && assistantOptions.assistantChatShortcutEnabled !== false) {
    const key = (normalizeAssistantChatShortcutKey(assistantOptions.assistantChatShortcutKey) || 'a').toUpperCase();
    shortcuts.splice(2, 0, {
      keys: [M, '⇧', key],
      desc: d('sc.assistantChat', 'Ouvrir la discussion avec l’assistant IA Orbit'),
    });
  }
  shortcuts.splice(2, 0, {
    keys: [M, '⇧', 'S'],
    desc: d('sc.screenshot', 'Capturer l’écran de l’app active'),
  });
  return shortcuts;
}
