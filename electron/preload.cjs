const { contextBridge, ipcRenderer } = require('electron');

// API exposée à l'interface React (fenêtre uniquement).
// La navigation des apps passe par les <webview> côté DOM.
// NB : pas de __dirname ici — les preloads sandboxés ne l'ont pas.
// Le preload des <webview> (KeePassXC) est injecté par le main process
// dans l'événement 'will-attach-webview' (il connaît, lui, son chemin).
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  // Plein écran (F11) : bascule + suivi d'état
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  getFullscreen: () => ipcRenderer.invoke('window:getFullscreen'),
  onFullScreenChange: (callback) => {
    const listener = (_event, fullscreen) => callback(fullscreen);
    ipcRenderer.on('window:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener);
  },
  // Barre système (tray) + raccourci global d'invocation
  setCloseToTray: (enabled) => ipcRenderer.invoke('tray:setCloseToTray', enabled),
  setSummonHotkey: (accelerator) => ipcRenderer.invoke('tray:setSummonHotkey', accelerator),
  // Notifications système + badge de la fenêtre
  showNotification: (payload) => ipcRenderer.invoke('notifications:show', payload),
  setBadgeCount: (count) => ipcRenderer.invoke('notifications:setBadge', count),
  // Purge cookies/session d'un compte désinstallé (clé de session stable)
  clearAppSession: (payload) => ipcRenderer.invoke('sessions:clear', payload),
  // Purge les cookies d'un hôte précis (session zombie → boucle de redirection)
  clearHostSession: (payload) => ipcRenderer.invoke('sessions:clearHost', payload),
  // Extensions Chrome
  syncExtensions: (list) => ipcRenderer.invoke('extensions:sync', list),
  ensureExtensionsForPartition: (partition) =>
    ipcRenderer.invoke('extensions:ensureForPartition', partition),
  installWebStoreExtension: (idOrUrl) => ipcRenderer.invoke('extensions:installWebStore', { idOrUrl }),
  openExtensionOptions: (payload) => ipcRenderer.invoke('extensions:openOptions', payload),
  getExtensionInfo: (payload) => ipcRenderer.invoke('extensions:getInfo', payload),
  pickExtensionFolder: () => ipcRenderer.invoke('extensions:pickFolder'),
  pickExtensionCrx: () => ipcRenderer.invoke('extensions:pickCrx'),
  pickZipFile: () => ipcRenderer.invoke('extensions:pickZip'),
  installExtension: (payload) => ipcRenderer.invoke('extensions:install', payload),
  uninstallExtension: (payload) => ipcRenderer.invoke('extensions:uninstall', payload),
  exportFakeDataExtension: () => ipcRenderer.invoke('extensions:exportFakeData'),
  listBundledExtensions: () => ipcRenderer.invoke('extensions:listBundled'),
  // KeePassXC (auto-remplissage des identifiants)
  keepassStatus: () => ipcRenderer.invoke('keepass:status'),
  keepassAssociate: () => ipcRenderer.invoke('keepass:associate'),
  keepassSetEnabled: (enabled) => ipcRenderer.invoke('keepass:setEnabled', enabled),
  // Téléphone (adb + scrcpy) : tout passe par le processus principal.
  phone: {
    status: () => ipcRenderer.invoke('phone:status'),
    refreshDevices: () => ipcRenderer.invoke('phone:refreshDevices'),
    connect: (address) => ipcRenderer.invoke('phone:connect', { address }),
    pair: (payload) => ipcRenderer.invoke('phone:pair', payload),
    disconnect: (serial) => ipcRenderer.invoke('phone:disconnect', { serial }),
    listApps: (payload) => ipcRenderer.invoke('phone:listApps', payload),
    getIcon: (payload) => ipcRenderer.invoke('phone:getIcon', payload),
    clearCache: (serial) => ipcRenderer.invoke('phone:clearCache', { serial }),
    launch: (payload) => ipcRenderer.invoke('phone:launch', payload),
    // Paquet au premier plan (sert au bouton Retour : ne pas retomber sur
    // l'accueil du téléphone). Sans cette ligne, l'appel côté UI échouait
    // silencieusement.
    foreground: (payload) => ipcRenderer.invoke('phone:foreground', payload),
    openUrl: (payload) => ipcRenderer.invoke('phone:openUrl', payload),
    screen: (payload) => ipcRenderer.invoke('phone:screen', payload),
    tap: (payload) => ipcRenderer.invoke('phone:tap', payload),
    swipe: (payload) => ipcRenderer.invoke('phone:swipe', payload),
    key: (payload) => ipcRenderer.invoke('phone:key', payload),
    setRadio: (payload) => ipcRenderer.invoke('phone:setRadio', payload),
    openSettings: (payload) => ipcRenderer.invoke('phone:openSettings', payload),
    text: (payload) => ipcRenderer.invoke('phone:text', payload),
    startMirror: (payload) => ipcRenderer.invoke('phone:startMirror', payload),
    stopMirror: () => ipcRenderer.invoke('phone:stopMirror'),
    // Chaque app Android s'ouvre dans sa propre fenêtre scrcpy native.
    startApp: (payload) => ipcRenderer.invoke('phone:startApp', payload),
    stopApp: (payload) => ipcRenderer.invoke('phone:stopApp', payload || {}),
    appSession: () => ipcRenderer.invoke('phone:appSession'),
    engineStatus: (checkUpdate) => ipcRenderer.invoke('phone:engineStatus', { checkUpdate }),
    installEngine: () => ipcRenderer.invoke('phone:installEngine'),
    getSettings: () => ipcRenderer.invoke('phone:getSettings'),
    setSettings: (settings) => ipcRenderer.invoke('phone:setSettings', settings),
    // Notifications du mobile (panneau de notifications d'Orbit)
    notifications: () => ipcRenderer.invoke('phone:notifications'),
    dismissNotification: (payload) => ipcRenderer.invoke('phone:dismissNotification', payload),
    dismissNotifications: (payload) => ipcRenderer.invoke('phone:dismissNotifications', payload),
    expandShade: (payload) => ipcRenderer.invoke('phone:expandShade', payload),
    onNotifications: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('phone:notifications', listener);
      return () => ipcRenderer.removeListener('phone:notifications', listener);
    },
    onOpenRequest: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('phone:open-request', listener);
      return () => ipcRenderer.removeListener('phone:open-request', listener);
    },
    onEngineProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('phone:engine-progress', listener);
      return () => ipcRenderer.removeListener('phone:engine-progress', listener);
    },
    onMirrorStopped: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('phone:mirror-stopped', listener);
      return () => ipcRenderer.removeListener('phone:mirror-stopped', listener);
    },
  },
  // Source des identifiants proposés dans les pages : 'both' | 'keepass' | 'vault' | 'none'
  credentialsSetSource: (source) => ipcRenderer.invoke('credentials:setSource', source),
  // Raccourcis globaux interceptés par le main process (même dans les apps)
  onShortcut: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('orbit:shortcut', listener);
    return () => ipcRenderer.removeListener('orbit:shortcut', listener);
  },
  // Clic sur une notification système → ouvrir l'app concernée
  onActivateApp: (callback) => {
    const listener = (_event, appId) => callback(appId);
    ipcRenderer.on('orbit:activate-app', listener);
    return () => ipcRenderer.removeListener('orbit:activate-app', listener);
  },
  // Téléchargements (progression + actions)
  onDownload: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('orbit:download', listener);
    return () => ipcRenderer.removeListener('orbit:download', listener);
  },
  openDownload: (id) => ipcRenderer.invoke('downloads:open', id),
  revealDownload: (id) => ipcRenderer.invoke('downloads:reveal', id),
  cancelDownload: (id) => ipcRenderer.invoke('downloads:cancel', id),
  pauseDownload: (id) => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('downloads:resume', id),
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  removeDownload: (id) => ipcRenderer.invoke('downloads:remove', id),
  clearDownloadHistory: () => ipcRenderer.invoke('downloads:clearHistory'),
  openDownloadsFolder: () => ipcRenderer.invoke('downloads:openFolder'),
  // Réglages de téléchargement : dossier d'enregistrement et « demander à
  // chaque fois ». `pickFolder` ouvre le sélecteur de dossiers du système.
  setDownloadPrefs: (prefs) => ipcRenderer.invoke('downloads:setPrefs', prefs),
  pickDownloadFolder: () => ipcRenderer.invoke('downloads:pickFolder'),
  // Documents (visionneuse) : lire un fichier que l'utilisateur a ouvert, ou
  // récupérer un document distant via la session JETABLE d'une page volante
  // (jamais avec les cookies d'un compte connecté). Le processus principal
  // refuse tout ce qui n'entre pas dans ces deux cas.
  documents: {
    read: (payload) => ipcRenderer.invoke('documents:read', payload),
    fetch: (payload) => ipcRenderer.invoke('documents:fetch', payload),
    reveal: (payload) => ipcRenderer.invoke('documents:reveal', payload),
  },
  // JAMAIS SILENCIEUX : un document qu'Orbit ne sait pas afficher (bureautique,
  // archive…) est confié au navigateur du système, qui le téléchargera. Le
  // processus principal n'accepte que des adresses http(s).
  openOutside: (url) => ipcRenderer.invoke('document:openOutside', url),
  // Téléchargement vidéo/audio (yt-dlp) — mode: 'video' | 'audio'
  downloadMedia: (url, mode) => ipcRenderer.invoke('media:download', { url, mode }),
  startDownloadUrl: (url) => ipcRenderer.invoke('downloads:startUrl', url),
  openTorrentLink: (url) => ipcRenderer.invoke('downloads:openTorrent', url),
  // Ouvrir une app dans une fenêtre détachée (même session)
  openDetached: (payload) => ipcRenderer.invoke('app:openDetached', payload),
  // Données de test (« Fake data ») : pousse les valeurs perso vers le main
  setFakeData: (cfg) => ipcRenderer.invoke('fakedata:set', cfg),
  setFakeDataEnabled: (enabled) => ipcRenderer.invoke('fakedata:setEnabled', enabled),
  installExtensionFromZip: (fileName) => ipcRenderer.invoke('extensions:installFromZip', fileName),
  // Mise à jour automatique
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (callback) => {
    const channels = ['update:available', 'update:progress', 'update:downloaded', 'update:error'];
    const listeners = channels.map((ch) => {
      const l = (_e, payload) => callback(ch.replace('update:', ''), payload);
      ipcRenderer.on(ch, l);
      return [ch, l];
    });
    return () => listeners.forEach(([ch, l]) => ipcRenderer.removeListener(ch, l));
  },
  // Bloqueur de pub natif
  adblock: {
    setEnabled: (on) => ipcRenderer.invoke('adblock:setEnabled', on),
    getState: () => ipcRenderer.invoke('adblock:getState'),
    // Réglage par app : 'on' | 'off' | null (suit le réglage global)
    setForContents: (webContentsId, mode) =>
      ipcRenderer.invoke('adblock:setForContents', { webContentsId, mode }),
  },
  // Boucliers de sécurité et de confidentialité (Shields)
  shields: {
    getSiteSettings: (url) => ipcRenderer.invoke('shields:getSiteSettings', url),
    updateSiteSettings: (url, updates) =>
      ipcRenderer.invoke('shields:updateSiteSettings', url, updates),
    resetSiteSettings: (url) => ipcRenderer.invoke('shields:resetSiteSettings', url),
    getDefaults: () => ipcRenderer.invoke('shields:getDefaults'),
    updateDefaults: (updates) => ipcRenderer.invoke('shields:updateDefaults', updates),
    listSites: () => ipcRenderer.invoke('shields:listSites'),
    getBlockedStats: (webContentsId) =>
      ipcRenderer.invoke('shields:getBlockedStats', webContentsId),
    clearBlockedStats: (webContentsId) =>
      ipcRenderer.invoke('shields:clearBlockedStats', webContentsId),
  },

  // Lecture vocale (moteur système / Piper hors ligne)
  tts: {
    state: () => ipcRenderer.invoke('tts:state'),
    setPrefs: (engine, voiceId) => ipcRenderer.invoke('tts:setPrefs', { engine, voiceId }),
    installEngine: () => ipcRenderer.invoke('tts:installEngine'),
    installVoice: (id) => ipcRenderer.invoke('tts:installVoice', { id }),
    removeVoice: (id) => ipcRenderer.invoke('tts:removeVoice', { id }),
    uninstall: () => ipcRenderer.invoke('tts:uninstall'),
    installMms: () => ipcRenderer.invoke('tts:installMms'),
    uninstallMms: () => ipcRenderer.invoke('tts:uninstallMms'),
    preview: (text) => ipcRenderer.invoke('tts:preview', { text }),
    stop: () => ipcRenderer.invoke('tts:stop'),
    onProgress: (callback) => {
      const listener = (_e, payload) => callback(payload);
      ipcRenderer.on('orbit:tts-progress', listener);
      return () => ipcRenderer.removeListener('orbit:tts-progress', listener);
    },
    // Flux audio brut de Piper, rejoué par l'interface (voir lib/ttsPlayer.js)
    onAudio: (handlers) => {
      const onStart = (_e, p) => handlers.start?.(p);
      const onChunk = (_e, chunk) => handlers.chunk?.(chunk);
      const onEnd = () => handlers.end?.();
      ipcRenderer.on('orbit:tts-start', onStart);
      ipcRenderer.on('orbit:tts-audio', onChunk);
      ipcRenderer.on('orbit:tts-end', onEnd);
      return () => {
        ipcRenderer.removeListener('orbit:tts-start', onStart);
        ipcRenderer.removeListener('orbit:tts-audio', onChunk);
        ipcRenderer.removeListener('orbit:tts-end', onEnd);
      };
    },
  },
  // Un clic a eu lieu dans une app embarquée (pour refermer menus et panneaux)
  onGuestInteract: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('orbit:guest-interact', listener);
    return () => ipcRenderer.removeListener('orbit:guest-interact', listener);
  },
  // Menu contextuel des apps, dessiné par l'interface
  contextMenu: {
    setMode: (custom) => ipcRenderer.invoke('ctx:setMode', { custom }),
    run: (wcId, action, value) => ipcRenderer.invoke('ctx:action', { wcId, action, value }),
    onProofread: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('orbit:proofreader:open', listener);
      return () => ipcRenderer.removeListener('orbit:proofreader:open', listener);
    },
    onShow: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('orbit:context-menu', listener);
      return () => ipcRenderer.removeListener('orbit:context-menu', listener);
    },
  },
  assistant: {
    state: () => ipcRenderer.invoke('assistant:state'),
    setChatShortcut: (key) => ipcRenderer.invoke('assistant:set-chat-shortcut', key),
    installModel: (modelKey) => ipcRenderer.invoke('assistant:installModel', { modelKey }),
    removeModel: (modelKey) => ipcRenderer.invoke('assistant:removeModel', { modelKey }),
    modelBaseUrl: (modelKey) => ipcRenderer.invoke('assistant:modelBaseUrl', { modelKey }),
    getDocument: (wcId) => ipcRenderer.invoke('assistant:getDocument', { wcId }),
    copyText: (text) => ipcRenderer.invoke('assistant:copyText', text),
    onSelection: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('orbit:assistant:selection', listener);
      return () => ipcRenderer.removeListener('orbit:assistant:selection', listener);
    },
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('orbit:assistant:progress', listener);
      return () => ipcRenderer.removeListener('orbit:assistant:progress', listener);
    },
  },
  grammar: {
    state: (options) => ipcRenderer.invoke('grammar:state', options),
    install: () => ipcRenderer.invoke('grammar:install'),
    remove: () => ipcRenderer.invoke('grammar:remove'),
    check: (text, language) => ipcRenderer.invoke('grammar:check', { text, language }),
    onProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('orbit:grammar:progress', listener);
      return () => ipcRenderer.removeListener('orbit:grammar:progress', listener);
    },
  },
  aiProviders: {
    state: () => ipcRenderer.invoke('ai-provider:state'),
    configure: (providerId, config) => ipcRenderer.invoke('ai-provider:configure', { providerId, config }),
    clearKey: (providerId) => ipcRenderer.invoke('ai-provider:clear-key', { providerId }),
    listModels: (providerId, config) => ipcRenderer.invoke('ai-provider:list-models', { providerId, config }),
    testKey: (providerId, config) => ipcRenderer.invoke('ai-provider:test-key', { providerId, config }),
    testModel: (providerId, model, config) => ipcRenderer.invoke('ai-provider:test-model', { providerId, model, config }),
    complete: (request) => ipcRenderer.invoke('ai-provider:complete', request),
  },
  // Questions posées par le contenu des apps : dialogues JS
  // (alert/confirm/prompt) et demandes d'autorisation (caméra, micro…)
  webDialog: {
    onShow: (callback) => {
      const listener = (_event, info) => callback(info);
      ipcRenderer.on('orbit:web-dialog', listener);
      return () => ipcRenderer.removeListener('orbit:web-dialog', listener);
    },
    // Une demande expire ou disparaît : l'interface doit refermer sa modale.
    onClose: (callback) => {
      const listener = (_event, info) => callback(info);
      ipcRenderer.on('orbit:web-dialog-close', listener);
      return () => ipcRenderer.removeListener('orbit:web-dialog-close', listener);
    },
    // Accusé de réception : l'interface confirme qu'elle affiche bien la
    // demande (voir ACK_TIMEOUT_MS côté processus principal).
    ack: (id) => ipcRenderer.invoke('orbit-dialog:ack', { id }),
    answer: (payload) => ipcRenderer.invoke('orbit-dialog:answer', payload),
  },
  // Autorisations mémorisées par site (Paramètres → Confidentialité)
  sitePermissions: {
    list: () => ipcRenderer.invoke('permissions:list'),
    setMode: (mode) => ipcRenderer.invoke('permissions:setMode', mode),
    forget: (origin, permission) => ipcRenderer.invoke('permissions:forget', { origin, permission }),
  },
  // Coffre-fort de mots de passe intégré (trousseaux chiffrés)
  vault: {
    state: () => ipcRenderer.invoke('vault:state'),
    create: (payload) => ipcRenderer.invoke('vault:create', payload),
    unlock: (id, password) => ipcRenderer.invoke('vault:unlock', { id, password }),
    lock: (id) => ipcRenderer.invoke('vault:lock', { id }),
    update: (id, patch) => ipcRenderer.invoke('vault:update', { id, ...patch }),
    changeMaster: (id, current, next) =>
      ipcRenderer.invoke('vault:changeMaster', { id, current, next }),
    remove: (id, password) => ipcRenderer.invoke('vault:remove', { id, password }),
    entries: (id) => ipcRenderer.invoke('vault:entries', { id }),
    saveEntry: (id, entry) => ipcRenderer.invoke('vault:saveEntry', { id, entry }),
    deleteEntry: (id, entryId) => ipcRenderer.invoke('vault:deleteEntry', { id, entryId }),
    setCategories: (id, categories) => ipcRenderer.invoke('vault:setCategories', { id, categories }),
    reveal: (id, entryId, field) => ipcRenderer.invoke('vault:reveal', { id, entryId, field }),
    copy: (id, entryId, field) => ipcRenderer.invoke('vault:copy', { id, entryId, field }),
    totp: (id, entryId) => ipcRenderer.invoke('vault:totp', { id, entryId }),
    audit: (id) => ipcRenderer.invoke('vault:audit', { id }),
    auditBreaches: (id) => ipcRenderer.invoke('vault:auditBreaches', { id }),
    strength: (password) => ipcRenderer.invoke('vault:strength', { password }),
    generate: (opts) => ipcRenderer.invoke('vault:generate', opts),
    importFile: (id) => ipcRenderer.invoke('vault:import', { id }),
    exportFile: (id, password, format) =>
      ipcRenderer.invoke('vault:export', { id, password, format }),
    ignored: () => ipcRenderer.invoke('vault:ignored'),
    unignore: (domain) => ipcRenderer.invoke('vault:unignore', { domain }),
  },
  // Traduction : configuration (langue cible + moteur Google/LibreTranslate)
  setTranslateConfig: (cfg) => ipcRenderer.invoke('translate:setConfig', cfg),
  // Proxy / VPN par partition
  applyProxy: (payload) => ipcRenderer.invoke('proxy:apply', payload),
  // Portail captif (Wi-Fi public)
  checkCaptivePortal: () => ipcRenderer.invoke('captive:check'),
  openCaptivePortal: () => ipcRenderer.invoke('captive:open'),
  onCaptivePortal: (callback) => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('orbit:captive', listener);
    return () => ipcRenderer.removeListener('orbit:captive', listener);
  },
  // Sauvegarde / restauration de la configuration
  backupExport: (payload) => ipcRenderer.invoke('backup:export', payload),
  backupImport: () => ipcRenderer.invoke('backup:import'),
  backupDecrypt: (payload) => ipcRenderer.invoke('backup:decrypt', payload),
  // Restauration complète : étage les fichiers de session, puis redémarre
  // (voir electron/backup-files.js pour le pourquoi).
  backupStageRestore: (payload) => ipcRenderer.invoke('backup:stage', payload),
  backupRelaunch: () => ipcRenderer.invoke('backup:relaunch'),

  // Automatisations : le main garde une copie des règles de liens pour pouvoir
  // décider au clic (son gestionnaire de fenêtre est synchrone).
  setRules: (rules) => ipcRenderer.invoke('rules:set', rules),
  onLinkRouted: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('rules:linkRouted', handler);
    return () => ipcRenderer.removeListener('rules:linkRouted', handler);
  },

  // Liens ouverts depuis l'EXTÉRIEUR : le système nous a lancés (ou rappelés)
  // avec une URL, ou le chemin d'un fichier .html (double-clic, « Ouvrir avec »).
  // Le renderer les ouvre en page volante — un lien libre, pas une app connectée.
  onOpenLink: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('orbit:open-link', handler);
    return () => ipcRenderer.removeListener('orbit:open-link', handler);
  },
  // « J'écoute » : le main processus peut alors livrer les liens reçus pendant
  // le démarrage (fenêtre pas encore montée).
  linksReady: () => ipcRenderer.send('links:ready'),

  // « Ouvrir avec » : proposer Orbit, ou retirer la proposition.
  // On ne se désigne jamais gestionnaire par défaut.
  systemIntegration: {
    status: () => ipcRenderer.invoke('sysint:status'),
    propose: () => ipcRenderer.invoke('sysint:propose'),
    unpropose: () => ipcRenderer.invoke('sysint:unpropose'),
  },

  // Synchronisation entre machines par dossier partagé (voir main.js)
  sync: {
    identity: () => ipcRenderer.invoke('sync:identity'),
    chooseFolder: () => ipcRenderer.invoke('sync:chooseFolder'),
    savePassphrase: (p) => ipcRenderer.invoke('sync:savePassphrase', p),
    loadPassphrase: () => ipcRenderer.invoke('sync:loadPassphrase'),
    read: (payload) => ipcRenderer.invoke('sync:read', payload),
    write: (payload) => ipcRenderer.invoke('sync:write', payload),
  },
  // Touches média globales du clavier (⏯ ⏭ ⏮)
  setMediaKeysEnabled: (on) => ipcRenderer.invoke('mediakeys:setEnabled', on),
  onMediaKey: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('orbit:media-key', listener);
    return () => ipcRenderer.removeListener('orbit:media-key', listener);
  },
  // Mini-lecteur flottant (toujours au-dessus)
  miniPlayer: {
    open: () => ipcRenderer.invoke('miniplayer:open'),
    sendState: (state) => ipcRenderer.invoke('miniplayer:state', state),
    onRequestState: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('orbit:mp:request-state', listener);
      return () => ipcRenderer.removeListener('orbit:mp:request-state', listener);
    },
    onAction: (callback) => {
      const listener = (_event, action) => callback(action);
      ipcRenderer.on('orbit:mp:action', listener);
      return () => ipcRenderer.removeListener('orbit:mp:action', listener);
    },
  },
  // Verrouillage / sécurité
  security: {
    getState: () => ipcRenderer.invoke('security:getState'),
    setAppLock: (pin) => ipcRenderer.invoke('security:setAppLock', pin),
    removeAppLock: (pin) => ipcRenderer.invoke('security:removeAppLock', pin),
    unlockApp: (pin) => ipcRenderer.invoke('security:unlockApp', pin),
    lockApp: () => ipcRenderer.invoke('security:lockApp'),
    setProfileLock: (id, pin) => ipcRenderer.invoke('security:setProfileLock', { id, pin }),
    removeProfileLock: (id, pin) => ipcRenderer.invoke('security:removeProfileLock', { id, pin }),
    unlockProfile: (id, pin) => ipcRenderer.invoke('security:unlockProfile', { id, pin }),
    lockProfile: (id) => ipcRenderer.invoke('security:lockProfile', id),
    dropProfile: (id) => ipcRenderer.invoke('security:dropProfile', id),
    setAutoLock: (minutes) => ipcRenderer.invoke('security:setAutoLock', minutes),
    onRelock: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('orbit:relock', listener);
      return () => ipcRenderer.removeListener('orbit:relock', listener);
    },
  },
  // Style des fenêtres secondaires (habillage Orbit / système / navigateur)
  setPopupStyle: (payload) => ipcRenderer.invoke('popup:setStyle', payload),
  // Charge CPU / mémoire de la machine (widget « moniteur » de l'en-tête)
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  // Mémoire (et CPU) d'une app précise — bulle au survol de la barre latérale.
  // `webContentsId` vient de webviewRegistry.getWebContentsIdFor(appId).
  getAppMemory: (webContentsId) => ipcRenderer.invoke('app:memory', { webContentsId }),
  platform: process.platform,
});
