// ---------------------------------------------------------------------------
// Lecture du flux audio de Piper
//
// Piper écrit du PCM brut (16 bits signé, mono, petit-boutiste) au fil de la
// synthèse : phrase par phrase, pas à la fin. On le rejoue ici avec Web Audio
// plutôt que via un lecteur externe (aplay, afplay, PowerShell), pour trois
// raisons : un seul chemin de code sur les trois systèmes, le volume réglé dans
// Orbit est respecté, et l'arrêt est immédiat.
//
// Chaque morceau reçu est planifié À LA SUITE du précédent sur l'horloge de
// l'AudioContext. Les lire « quand ils arrivent » produirait des trous audibles
// à chaque hoquet du processus ou de l'IPC.
//
// Rien n'est créé tant qu'aucune lecture ne démarre : l'AudioContext naît au
// premier morceau et se ferme à la fin.
// ---------------------------------------------------------------------------
let ctx = null;
let gain = null;
let nextAt = 0;
let sampleRate = 22050;
let sources = new Set();
let volume = 1;

function ensureContext() {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor({ sampleRate });
  gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);
  nextAt = 0;
  return ctx;
}

export function setVolume(value) {
  volume = Math.min(1, Math.max(0, Number(value) || 0));
  if (gain) gain.gain.value = volume;
}

export function start({ sampleRate: rate } = {}) {
  stop();
  sampleRate = Number(rate) || 22050;
  ensureContext();
}

export function pushChunk(chunk) {
  const audio = ensureContext();
  if (!audio || !chunk) return;
  // Le morceau arrive en Uint8Array (structured clone d'un Buffer Node).
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  // Un morceau peut se terminer au milieu d'un échantillon : on ignore l'octet
  // orphelin plutôt que de décaler tout le reste d'un demi-échantillon, ce qui
  // transformerait la voix en bruit blanc.
  const samples = Math.floor(bytes.byteLength / 2);
  if (samples === 0) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);

  const buffer = audio.createBuffer(1, samples, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples; i += 1) {
    channel[i] = view.getInt16(i * 2, true) / 32768;
  }

  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  // Petit coussin au démarrage : le temps que les morceaux suivants arrivent.
  const now = audio.currentTime;
  if (nextAt < now) nextAt = now + 0.08;
  source.start(nextAt);
  nextAt += buffer.duration;

  sources.add(source);
  source.onended = () => sources.delete(source);
}

export function stop() {
  for (const source of sources) {
    try {
      source.stop();
    } catch {
      /* déjà terminée */
    }
  }
  sources = new Set();
  nextAt = 0;
  if (ctx && ctx.state !== 'closed') {
    const closing = ctx;
    ctx = null;
    gain = null;
    closing.close().catch(() => {});
  }
}

// Branche le lecteur sur les événements du processus principal. Renvoie la
// fonction de désabonnement.
export function attachTtsPlayer() {
  return window.electronAPI?.tts?.onAudio?.({
    start,
    chunk: pushChunk,
    end: () => {
      // On ne coupe pas : les morceaux déjà planifiés doivent finir de se jouer.
      // Le contexte se fermera au prochain `start` ou `stop`.
    },
  });
}
