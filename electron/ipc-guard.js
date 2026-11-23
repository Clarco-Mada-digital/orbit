// Garde IPC des pages embarquées.
//
// `ipcMain` écoute TOUS les webContents du processus, y compris les <webview>
// qui affichent des sites tiers. Leur preload (credentials-preload.cjs) est
// isolé, mais il possède `ipcRenderer` : un défaut d'isolation, ou un renderer
// compromis, donnerait alors accès aux ~180 canaux de l'interface (fichiers,
// réglages, coffre, téléchargements…). Ce garde réduit cette surface aux seuls
// canaux dont une page embarquée a réellement besoin.
//
// Règle : un émetteur de type `webview` n'atteint qu'un canal de la liste
// blanche ci-dessous. L'interface d'Orbit (fenêtres, panneaux) n'est pas
// concernée. Les handlers plus sensibles gardent en plus leur propre contrôle
// (`handleFromUi` dans main.js).

// Canaux utilisés par le preload des pages (credentials-preload.cjs) et par
// le preload du bloqueur de publicités (@ghostery/adblocker-electron).
const GUEST_PREFIXES = ['credentials:', '@ghostery/adblocker/'];
const GUEST_CHANNELS = new Set([
  'guest:zoom',
  'guest:interact',
  'keepass:dbg',
  'orbit-dialog:open',
  'orbit-dialog:poll',
  'orbit-dialog:drop',
  // Réglage d'affichage du bouton de téléchargement posé sur les vidéos,
  // demandé par media-button-preload.cjs au début de chaque page. Sans cette
  // entrée, l'invoke était refusé : le preload retombait sur son défaut, et le
  // choix « jamais sur la vidéo » restait sans effet.
  'media:buttonSurface',
  // Données de test personnalisées, lues par credentials-preload.cjs pour
  // l'extension Fake Data. Même symptôme : refusé, donc le formulaire se
  // remplissait de valeurs génériques au lieu de celles de l'utilisateur.
  'fakedata:get',
]);

// Ces deux canaux sont en LECTURE SEULE et ne portent aucun secret : l'un
// renvoie un mot-clé d'affichage, l'autre les données de test que
// l'utilisateur a lui-même saisies pour les injecter dans des pages. Les
// ajouter n'élargit pas la surface sensible — c'est tout l'objet d'une liste
// blanche nominative plutôt que d'un préfixe `media:` ou `fakedata:`, qui
// aurait aussi ouvert les canaux voisins (`media:failures`…).

export function isGuestChannel(channel) {
  const name = String(channel || '');
  return GUEST_CHANNELS.has(name) || GUEST_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function senderType(event) {
  try {
    return event?.sender?.getType?.() || '';
  } catch {
    // webContents détruit : on le traite comme une page, par prudence.
    return 'webview';
  }
}

export function isAllowedSender(event, channel) {
  return senderType(event) !== 'webview' || isGuestChannel(channel);
}

// Enveloppe `handle` et `on` d'un ipcMain. À appeler AVANT d'enregistrer le
// moindre handler. Idempotent.
export function installWebviewIpcGuard(ipc, { log = console.warn } = {}) {
  if (!ipc || ipc.__orbitGuarded) return ipc;
  const rawHandle = ipc.handle.bind(ipc);
  const rawOn = ipc.on.bind(ipc);
  const deny = (channel) => log(`[orbit] IPC refusé : « ${channel} » depuis une page embarquée`);

  ipc.handle = (channel, listener) =>
    rawHandle(channel, (event, ...args) => {
      if (!isAllowedSender(event, channel)) {
        deny(channel);
        throw new Error('forbidden');
      }
      return listener(event, ...args);
    });

  // `on` sert aussi à `sendSync` : sans `returnValue`, l'émetteur resterait
  // bloqué. On répond donc `null` avant d'ignorer le message.
  const guardedOn = (channel, listener) =>
    rawOn(channel, (event, ...args) => {
      if (!isAllowedSender(event, channel)) {
        deny(channel);
        try { event.returnValue = null; } catch { /* message asynchrone */ }
        return undefined;
      }
      return listener(event, ...args);
    });
  ipc.on = guardedOn;
  ipc.addListener = guardedOn;

  Object.defineProperty(ipc, '__orbitGuarded', { value: true });
  return ipc;
}
