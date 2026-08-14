import { getWebview } from './webviewRegistry';

// Contrôles média partagés (mini-barre de la Topbar + mini-lecteur flottant).
// Tout passe par le <webview> de l'app : execution de JS pour lecture/pause et
// Picture-in-Picture, touches média pour piste précédente/suivante.

const CODE_TOGGLE = `(()=>{try{const m=[...document.querySelectorAll('video,audio')].find(x=>x.readyState>0)||document.querySelector('video,audio');if(m){m.paused?m.play():m.pause();}}catch(e){}})()`;
const CODE_PIP = `(()=>{try{const v=document.querySelector('video');if(!v)return;if(document.pictureInPictureElement){document.exitPictureInPicture().catch(()=>{});}else if(v.requestPictureInPicture){v.requestPictureInPicture().catch(()=>{});}}catch(e){}})()`;

// Exécute du JS dans la page de l'app (protégé contre l'exception synchrone
// levée quand le webview n'est pas encore attaché / prêt).
function exec(appId, code) {
  const wv = getWebview(appId);
  if (wv && typeof wv.executeJavaScript === 'function') {
    try {
      const p = wv.executeJavaScript(code, true);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* webview pas prêt / détaché */
    }
  }
}

// Envoie une touche média à la page (interceptée par YouTube, Spotify…).
function key(appId, keyCode) {
  const wv = getWebview(appId);
  if (wv && typeof wv.sendInputEvent === 'function') {
    try {
      wv.sendInputEvent({ type: 'keyDown', keyCode });
      wv.sendInputEvent({ type: 'keyUp', keyCode });
    } catch {
      /* ignore */
    }
  }
}

export const mediaToggle = (appId) => exec(appId, CODE_TOGGLE);
export const mediaPip = (appId) => exec(appId, CODE_PIP);
export const mediaPrev = (appId) => key(appId, 'MediaPreviousTrack');
export const mediaNext = (appId) => key(appId, 'MediaNextTrack');

// Positionne la lecture à `fraction` (0→1) de la durée du média.
export const mediaSeek = (appId, fraction) => {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  exec(
    appId,
    `(()=>{try{const m=document.querySelector('video,audio');if(m&&isFinite(m.duration))m.currentTime=${f}*m.duration;}catch(e){}})()`
  );
};

// Choisit le média « en avant » : en priorité celui qui JOUE (et l'app active
// si elle joue), sinon le premier ayant un média. Renvoie [appId, info] | null.
export function pickNowPlaying(media, activeApp) {
  const entries = Object.entries(media || {}).filter(([, m]) => m && m.hasMedia);
  if (entries.length === 0) return null;
  const playing = entries.filter(([, m]) => m.playing);
  return (
    playing.find(([id]) => id === activeApp) ||
    playing[0] ||
    entries.find(([id]) => id === activeApp) ||
    entries[0]
  );
}
