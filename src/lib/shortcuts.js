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
  // Recharger la page de l'app active : Ctrl+R / ⌘R et F5 — comme dans un
  // navigateur. Sans ça, Ctrl+R était simplement avalé par l'app embarquée
  // (aucun raccourci Orbit ne le gérait) et « rien ne se rechargeait ».
  // Avec Maj (⇧R / ⇧F5) → rechargement FORT, cache ignoré.
  {
    const modReload = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.altKey;
    const k0 = (e.key || '').toLowerCase();
    if (modReload && k0 === 'r') return e.shiftKey ? 'reload-hard' : 'reload';
    if (k0 === 'f5' && !e.altKey) {
      return e.shiftKey || e.ctrlKey || e.metaKey ? 'reload-hard' : 'reload';
    }
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
  if (shift && k === 'h') return 'toggle-bars';
  // Profil suivant / précédent : même geste que pour les apps, avec ⇧.
  // Doit être testé AVANT la version sans ⇧, sinon Alt+⇧+Page↓ serait avalé
  // par « app suivante ».
  if (shift && k === 'pagedown') return 'next-profile';
  if (shift && k === 'pageup') return 'prev-profile';
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
  // Recharger : Ctrl+R / ⌘R et F5 (Maj → rechargement fort). Intercepté ICI
  // pour fonctionner même quand le focus est DANS l'app embarquée.
  {
    const modReload = mac ? input.meta && !input.control : input.control && !input.alt;
    const k0 = String(input.key || '').toLowerCase();
    if (modReload && k0 === 'r') return input.shift ? 'reload-hard' : 'reload';
    if (k0 === 'f5' && !input.alt) {
      return input.shift || input.control || input.meta ? 'reload-hard' : 'reload';
    }
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
  if (shift && k === 'h') return 'toggle-bars';
  // Profil suivant / précédent : même geste que pour les apps, avec ⇧.
  // Doit être testé AVANT la version sans ⇧, sinon Alt+⇧+Page↓ serait avalé
  // par « app suivante ».
  if (shift && k === 'pagedown') return 'next-profile';
  if (shift && k === 'pageup') return 'prev-profile';
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
    { keys: [d('sc.escKey', 'Échap')], desc: d('sc.escape', 'Fermer / annuler') },
  ];
}
