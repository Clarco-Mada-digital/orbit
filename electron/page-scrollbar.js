// ---------------------------------------------------------------------------
// Barres de défilement des pages embarquées
//
// Sans style, Chromium dessine la barre du système : large et grise sous
// Windows et sur certains bureaux Linux, sans rapport avec le thème d'Orbit.
// On pose donc une barre fine, arrondie, dans la couleur d'accent du thème.
//
// Le point essentiel : la feuille est injectée en origine « user »
// (insertCSS … cssOrigin: 'user'). Dans la cascade, une règle de l'AUTEUR de
// la page l'emporte toujours sur une règle « user » de même importance. Un site
// qui stylise déjà ses barres garde donc les siennes :
//   • `scrollbar-color` / `scrollbar-width` (standard) : Chromium ignore alors
//     tous les pseudo-éléments ::-webkit-scrollbar de l'élément, les nôtres
//     compris ;
//   • ::-webkit-scrollbar* : ses propriétés passent devant les nôtres.
// Nous ne posons volontairement AUCUNE propriété standard (scrollbar-color) :
// elle désactiverait les ::-webkit-scrollbar du site là où il n'utilise que
// ceux-là.
//
// Même rendu sur Windows, Linux et macOS : c'est Chromium qui dessine.
// ---------------------------------------------------------------------------

import { webContents } from 'electron';

const RGB_TRIPLET = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/;

const state = {
  enabled: true,
  // Indigo d'Orbit tant que l'interface n'a pas transmis son thème.
  accent: '99 102 241',
};

// webContents → clé de la feuille injectée (pour la retirer au changement de thème)
const injected = new Map();

export function buildCss(accent) {
  const rgb = RGB_TRIPLET.test(accent || '') ? accent.trim().split(/\s+/).join(', ') : '99, 102, 241';
  // Bordure transparente + background-clip : la zone de saisie fait 10 px
  // (facile à attraper), le pouce dessiné n'en montre que 6.
  return `
::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb {
  background-color: rgba(${rgb}, 0.38);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
  min-height: 32px;
  min-width: 32px;
}
::-webkit-scrollbar-thumb:hover { background-color: rgba(${rgb}, 0.62); border-width: 1.5px; }
::-webkit-scrollbar-thumb:active { background-color: rgba(${rgb}, 0.8); }
::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
`;
}

async function apply(contents) {
  if (!contents || contents.isDestroyed()) return;
  const previous = injected.get(contents);
  injected.delete(contents);
  if (previous) {
    await contents.removeInsertedCSS(previous).catch(() => {});
  }
  if (!state.enabled || contents.isDestroyed()) return;
  try {
    const key = await contents.insertCSS(buildCss(state.accent), { cssOrigin: 'user' });
    if (!contents.isDestroyed()) injected.set(contents, key);
  } catch {
    /* page en cours de fermeture ou de navigation : le prochain dom-ready s'en charge */
  }
}

// À appeler pour chaque <webview> créé. Une feuille insérée ne survit pas à
// une navigation : on la repose à chaque document (dom-ready).
export function attach(contents) {
  const onReady = () => {
    // Nouveau document : l'ancienne clé ne désigne plus rien.
    injected.delete(contents);
    apply(contents);
  };
  contents.on('dom-ready', onReady);
  contents.once('destroyed', () => injected.delete(contents));
}

// Réglage venant de l'interface : { enabled, accent: "r g b" }.
export function configure({ enabled, accent } = {}) {
  const nextEnabled = enabled !== false;
  const nextAccent = RGB_TRIPLET.test(accent || '') ? accent.trim() : state.accent;
  if (nextEnabled === state.enabled && nextAccent === state.accent) return;
  state.enabled = nextEnabled;
  state.accent = nextAccent;
  for (const contents of [...injected.keys()]) apply(contents);
  // Pages sans feuille (réglage réactivé) : on les reprend toutes.
  if (state.enabled) {
    for (const contents of webContentsList()) {
      if (!injected.has(contents)) apply(contents);
    }
  }
}

function webContentsList() {
  try {
    return webContents.getAllWebContents().filter((c) => !c.isDestroyed() && c.getType() === 'webview');
  } catch {
    return [];
  }
}
