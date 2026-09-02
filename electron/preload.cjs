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
  installWebStoreExtension: (idOrUrl) => ipcRenderer.invoke('extensions:installWebStore', { idOrUrl }),
  openExtensionOptions: (payload) => ipcRenderer.invoke('extensions:openOptions', payload),
  getExtensionInfo: (payload) => ipcRenderer.invoke('extensions:getInfo', payload),
  pickExtensionFolder: () => ipcRenderer.invoke('extensions:pickFolder'),
  pickExtensionCrx: () => ipcRenderer.invoke('extensions:pickCrx'),
  installExtension: (payload) => ipcRenderer.invoke('extensions:install', payload),
  uninstallExtension: (payload) => ipcRenderer.invoke('extensions:uninstall', payload),
  // KeePassXC (auto-remplissage des identifiants)
  keepassStatus: () => ipcRenderer.invoke('keepass:status'),
  keepassAssociate: () => ipcRenderer.invoke('keepass:associate'),
  keepassSetEnabled: (enabled) => ipcRenderer.invoke('keepass:setEnabled', enabled),
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
  openDownloadsFolder: () => ipcRenderer.invoke('downloads:openFolder'),
  // Téléchargement vidéo/audio (yt-dlp) — mode: 'video' | 'audio'
  downloadMedia: (url, mode) => ipcRenderer.invoke('media:download', { url, mode }),
  // Ouvrir une app dans une fenêtre détachée (même session)
  openDetached: (payload) => ipcRenderer.invoke('app:openDetached', payload),
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
    onShow: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('orbit:context-menu', listener);
      return () => ipcRenderer.removeListener('orbit:context-menu', listener);
    },
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
  platform: process.platform,
});
