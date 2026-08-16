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

// La combinaison est-elle un raccourci d'Orbit ? (événement keydown du DOM)
export function matchShortcut(e) {
  const mac = isMac();
  // Rechercher dans la page : Ctrl+F (Win/Linux) ou ⌘F (mac) — remplace la
  // recherche de l'app embarquée par celle d'Orbit.
  if (
    (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.altKey) &&
    !e.shiftKey &&
    (e.key || '').toLowerCase() === 'f'
  ) {
    return 'find';
  }
  const mod = mac ? e.metaKey : e.altKey;
  // Modificateur parasite (Ctrl, ou l'autre) → pas un raccourci Orbit
  if (!mod || e.ctrlKey || (mac ? e.altKey : e.metaKey)) return null;
  const k = (e.key || '').toLowerCase();
  const shift = !!e.shiftKey;
  if (k === 'k') return 'search';
  if (k === ',') return 'settings';
  if (shift && k === 'o') return 'store';
  if (shift && k === 'p') return 'profiles';
  if (shift && k === 'm') return 'mark-all-read';
  if (k === 's') return 'toggle-sleep';
  if (k === 'b') return 'toggle-sidebar';
  if (k === 'pagedown') return 'next-app';
  if (k === 'pageup') return 'prev-app';
  if (/^[1-9]$/.test(k)) return `app-${k}`;
  if (k === '+' || k === '=') return 'zoom-in';
  if (k === '-') return 'zoom-out';
  if (k === '0') return 'zoom-reset';
  return null;
}

// Même logique pour l'objet `input` du main process (before-input-event)
export function matchShortcutInput(input) {
  if (!input || input.type !== 'keyDown') return null;
  const mac = typeof process !== 'undefined' && process.platform === 'darwin';
  // Rechercher dans la page : Ctrl+F (Win/Linux) ou ⌘F (mac)
  if (
    (mac ? input.meta && !input.control : input.control && !input.alt) &&
    !input.shift &&
    String(input.key || '').toLowerCase() === 'f'
  ) {
    return 'find';
  }
  const mod = mac ? input.meta : input.alt;
  if (!mod || input.control || (mac ? input.alt : input.meta)) return null;
  const k = String(input.key || '').toLowerCase();
  const shift = !!input.shift;
  if (k === 'k') return 'search';
  if (k === ',') return 'settings';
  if (shift && k === 'o') return 'store';
  if (shift && k === 'p') return 'profiles';
  if (shift && k === 'm') return 'mark-all-read';
  if (k === 's') return 'toggle-sleep';
  if (k === 'b') return 'toggle-sidebar';
  if (k === 'pagedown') return 'next-app';
  if (k === 'pageup') return 'prev-app';
  if (/^[1-9]$/.test(k)) return `app-${k}`;
  if (k === '+' || k === '=') return 'zoom-in';
  if (k === '-') return 'zoom-out';
  if (k === '0') return 'zoom-reset';
  return null;
}

// Liste d'affichage (panneau « help ») — adaptée à la plateforme.
// Accepte une fonction de traduction `t` (i18n) ; sans elle, retombe sur le FR.
export function shortcutKeys(t) {
  const d = (key, fr) => (typeof t === 'function' ? t(key) : fr);
  const mac = isMac();
  const M = mac ? '⌘' : 'Alt';
  return [
    { keys: [M, 'K'], desc: d('sc.search', 'Rechercher partout (ce panneau)') },
    { keys: [M, ','], desc: d('sc.settings', 'Paramètres') },
    { keys: [M, '⇧', 'O'], desc: d('sc.store', "Boutique d'applications") },
    { keys: [M, '⇧', 'P'], desc: d('sc.profiles', 'Gérer les profils') },
    { keys: [M, 'S'], desc: d('sc.sleep', "Mettre en veille / réveiller l'app active") },
    { keys: [M, 'B'], desc: d('sc.sidebar', 'Réduire / agrandir la barre latérale') },
    { keys: [M, '⇧', 'M'], desc: d('sc.markAll', 'Tout marquer comme lu') },
    { keys: mac ? [M, '`'] : [M, 'Page ↓'], desc: d('sc.nextApp', "Passer à l'app suivante") },
    { keys: mac ? [M, '⇧', '`'] : [M, 'Page ↑'], desc: d('sc.prevApp', "Passer à l'app précédente") },
    { keys: [M, '1…9'], desc: d('sc.gotoApp', 'Aller directement à l’app n° 1 à 9') },
    { keys: [M, '+'], desc: d('sc.zoomIn', 'Zoom avant (app active)') },
    { keys: [M, '−'], desc: d('sc.zoomOut', 'Zoom arrière (app active)') },
    { keys: [M, '0'], desc: d('sc.zoomReset', 'Réinitialiser le zoom') },
    { keys: [d('sc.escKey', 'Échap')], desc: d('sc.escape', 'Fermer / annuler') },
  ];
}
