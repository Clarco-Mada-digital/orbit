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
  const mod = mac ? e.metaKey : e.altKey;
  // Modificateur parasite (Ctrl, ou l'autre) → pas un raccourci Orbit
  if (!mod || e.ctrlKey || (mac ? e.altKey : e.metaKey)) return null;
  const k = (e.key || '').toLowerCase();
  const shift = !!e.shiftKey;
  if (k === 'k') return 'search';
  if (k === ',') return 'settings';
  if (shift && k === 'o') return 'store';
  if (shift && k === 'p') return 'profiles';
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
  const mod = mac ? input.meta : input.alt;
  if (!mod || input.control || (mac ? input.alt : input.meta)) return null;
  const k = String(input.key || '').toLowerCase();
  const shift = !!input.shift;
  if (k === 'k') return 'search';
  if (k === ',') return 'settings';
  if (shift && k === 'o') return 'store';
  if (shift && k === 'p') return 'profiles';
  if (k === 'pagedown') return 'next-app';
  if (k === 'pageup') return 'prev-app';
  if (/^[1-9]$/.test(k)) return `app-${k}`;
  if (k === '+' || k === '=') return 'zoom-in';
  if (k === '-') return 'zoom-out';
  if (k === '0') return 'zoom-reset';
  return null;
}

// Liste d'affichage (panneau « help ») — adaptée à la plateforme
export function shortcutKeys() {
  const mac = isMac();
  const M = mac ? '⌘' : 'Alt';
  return [
    { keys: [M, 'K'], desc: 'Rechercher partout (ce panneau)' },
    { keys: [M, ','], desc: 'Paramètres' },
    { keys: [M, '⇧', 'O'], desc: "Boutique d'applications" },
    { keys: [M, '⇧', 'P'], desc: 'Gérer les profils' },
    { keys: mac ? [M, '`'] : [M, 'Page ↓'], desc: "Passer à l'app suivante" },
    { keys: mac ? [M, '⇧', '`'] : [M, 'Page ↑'], desc: "Passer à l'app précédente" },
    { keys: [M, '1…9'], desc: 'Aller directement à l’app n° 1 à 9' },
    { keys: [M, '+'], desc: 'Zoom avant (app active)' },
    { keys: [M, '−'], desc: 'Zoom arrière (app active)' },
    { keys: [M, '0'], desc: 'Réinitialiser le zoom' },
    { keys: ['Échap'], desc: 'Fermer / annuler' },
  ];
}
