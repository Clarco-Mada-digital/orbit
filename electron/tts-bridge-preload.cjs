// ---------------------------------------------------------------------------
// Voix d'Orbit pour la synthèse vocale des sites (window.speechSynthesis).
//
// Dans Electron, la synthèse vocale du navigateur ne dit souvent RIEN (sous
// Linux, Chromium n'y branche aucun moteur), alors qu'Orbit a sa propre
// lecture vocale, réglée par l'utilisateur (moteur système, Piper, MMS). Ce
// preload remplace `speechSynthesis` dans les pages par un pont vers cette
// lecture : un site qui « parle » utilise la voix choisie dans Réglages →
// Lecture vocale.
//
// Deux mondes :
//   • le MONDE PRINCIPAL (la page) reçoit une implémentation compatible de
//     speechSynthesis (speak, cancel, getVoices, événements start/end sur
//     l'énoncé) ; elle n'a accès à rien d'autre qu'à des événements DOM ;
//   • le MONDE ISOLÉ (ce fichier) relaie vers Orbit. Comme Chrome, il n'accepte
//     de parler qu'après une interaction de l'utilisateur avec la page : un
//     site ne peut pas se mettre à parler tout seul à l'ouverture.
//
// Messages page → preload : CustomEvent 'orbit:tts-out' (détail en JSON).
// Messages preload → page : CustomEvent 'orbit:tts-in' (détail en JSON).
// Les détails passent en CHAÎNES : un objet ne traverse pas proprement la
// frontière entre les deux mondes.
// ---------------------------------------------------------------------------
const { ipcRenderer, webFrame } = require('electron');

const MAX_TEXT = 4000;

// Page principale seulement : les iframes (publicités, widgets) sont souvent
// des dizaines par page, et chacune paierait un aller-retour synchrone pour
// une fonction qu'elles n'utilisent presque jamais.
let info = null;
if (window.top === window.self) {
  try {
    info = ipcRenderer.sendSync('tts:pageInfo');
  } catch {
    info = null;
  }
}

if (info && info.enabled) {
  const voice = {
    name: String(info.name || 'Orbit').slice(0, 120),
    lang: String(info.lang || 'fr-FR').slice(0, 20),
  };

  // --- Monde isolé : relais vers Orbit -------------------------------------
  document.addEventListener('orbit:tts-out', (event) => {
    let msg;
    try {
      msg = JSON.parse(String(event.detail || ''));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const id = Number(msg.id) || 0;
    if (msg.op === 'cancel') {
      ipcRenderer.send('tts:page', { op: 'cancel' });
      return;
    }
    if (msg.op !== 'speak') return;
    const text = String(msg.text || '').slice(0, MAX_TEXT);
    // Même règle que Chrome : pas de voix sans interaction avec la page.
    const activated = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
    if (!activated || !text.trim()) {
      document.dispatchEvent(
        new CustomEvent('orbit:tts-in', { detail: JSON.stringify({ id, type: 'error', error: activated ? 'text-too-short' : 'not-allowed' }) })
      );
      return;
    }
    ipcRenderer.send('tts:page', { op: 'speak', id, text, rate: Number(msg.rate) || 1 });
  });

  ipcRenderer.on('orbit:tts-page', (_event, msg) => {
    if (!msg || typeof msg !== 'object') return;
    const payload = { id: Number(msg.id) || 0, type: String(msg.type || '') };
    document.dispatchEvent(new CustomEvent('orbit:tts-in', { detail: JSON.stringify(payload) }));
  });

  // --- Monde principal : speechSynthesis compatible ------------------------
  const pageScript = `(() => {
    const VOICE = ${JSON.stringify(voice)};
    const NativeUtterance = window.SpeechSynthesisUtterance;
    if (!NativeUtterance || window.__orbitSpeech) return;
    Object.defineProperty(window, '__orbitSpeech', { value: true });

    // Une voix « Orbit » : celle choisie dans les réglages. Les sites la
    // trouvent dans getVoices() et peuvent la sélectionner.
    const orbitVoice = Object.freeze({
      voiceURI: 'orbit-voice',
      name: VOICE.name,
      lang: VOICE.lang,
      localService: true,
      default: true,
    });

    // utterance.voice n'accepte normalement qu'une vraie SpeechSynthesisVoice :
    // sans ce relais, « u.voice = voix » lèverait une erreur et casserait la page.
    const voices = new WeakMap();
    try {
      Object.defineProperty(NativeUtterance.prototype, 'voice', {
        configurable: true,
        get() { return voices.get(this) || null; },
        set(v) { voices.set(this, v || null); },
      });
    } catch {}

    const ids = new WeakMap();
    const byId = new Map();
    let seq = 0;
    let queue = [];
    let current = null;

    const fire = (utterance, type, extra) => {
      let ev;
      try {
        ev = type === 'error'
          ? new SpeechSynthesisErrorEvent('error', { utterance, error: (extra && extra.error) || 'synthesis-failed' })
          : new SpeechSynthesisEvent(type, { utterance, charIndex: 0, elapsedTime: 0 });
      } catch {
        ev = new Event(type);
      }
      try { utterance.dispatchEvent(ev); } catch {}
    };

    const send = (msg) => document.dispatchEvent(new CustomEvent('orbit:tts-out', { detail: JSON.stringify(msg) }));

    const next = () => {
      if (current || synth.paused) return;
      const utterance = queue.shift();
      if (!utterance) return;
      current = utterance;
      const id = ++seq;
      ids.set(utterance, id);
      byId.set(id, utterance);
      send({ op: 'speak', id, text: String(utterance.text || ''), rate: Number(utterance.rate) || 1 });
    };

    document.addEventListener('orbit:tts-in', (event) => {
      let msg;
      try { msg = JSON.parse(String(event.detail || '')); } catch { return; }
      const utterance = byId.get(msg.id);
      if (!utterance) return;
      if (msg.type === 'start') { fire(utterance, 'start'); return; }
      byId.delete(msg.id);
      if (current === utterance) current = null;
      fire(utterance, msg.type === 'error' ? 'error' : 'end', msg);
      next();
    });

    class OrbitSpeechSynthesis extends EventTarget {
      constructor() { super(); this.onvoiceschanged = null; this._paused = false; }
      get speaking() { return Boolean(current); }
      get pending() { return queue.length > 0; }
      get paused() { return this._paused; }
      getVoices() { return [orbitVoice]; }
      speak(utterance) {
        if (!(utterance instanceof NativeUtterance)) throw new TypeError("Failed to execute 'speak' on 'SpeechSynthesis'");
        queue.push(utterance);
        next();
      }
      cancel() {
        const dropped = queue;
        queue = [];
        if (current) send({ op: 'cancel' });
        for (const u of dropped) fire(u, 'error', { error: 'canceled' });
      }
      // Pas de pause dans les moteurs d'Orbit : on suspend la file, et la
      // phrase en cours est arrêtée (elle reprendra au début).
      pause() {
        this._paused = true;
        if (current) {
          const u = current;
          byId.delete(ids.get(u));
          current = null;
          queue.unshift(u);
          send({ op: 'cancel' });
        }
      }
      resume() { this._paused = false; next(); }
    }
    const synth = new OrbitSpeechSynthesis();
    synth.addEventListener('voiceschanged', (e) => { try { synth.onvoiceschanged && synth.onvoiceschanged.call(synth, e); } catch {} });
    try {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
    } catch {}
    // Les sites attendent souvent « voiceschanged » avant de choisir une voix.
    setTimeout(() => synth.dispatchEvent(new Event('voiceschanged')), 0);
  })();`;

  try {
    webFrame.executeJavaScript(pageScript);
  } catch {
    /* page sans monde principal accessible : la synthèse native reste */
  }
}
