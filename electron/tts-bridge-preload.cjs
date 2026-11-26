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

// Page principale : réponse SYNCHRONE, le pont est réglé avant le moindre
// script du site.
//
// Iframes : elles aussi peuvent parler — des applications entières vivent
// dans un cadre (ex. les apps partagées de Meta AI, servies depuis un autre
// domaine). Mais une page en compte parfois des dizaines (publicités,
// widgets) : pas d'aller-retour synchrone pour chacune. Le pont s'y pose donc
// tout de suite avec une voix provisoire, puis la vraie voix arrive de façon
// asynchrone ('voiceschanged', comme dans Chrome). Si la voix d'Orbit est
// désactivée pour les sites, la synthèse d'origine est rendue.
const isTop = window.top === window.self;
let info = null;
if (isTop) {
  try {
    info = ipcRenderer.sendSync('tts:pageInfo');
  } catch {
    info = null;
  }
} else {
  info = { enabled: true, name: 'Orbit', lang: navigator.language || 'fr-FR' };
}

// Une langue complète (« fr-FR » plutôt que « fr ») : beaucoup de sites
// filtrent les voix sur la région.
const REGIONS = { fr: 'FR', en: 'US', mg: 'MG', es: 'ES', de: 'DE', it: 'IT', pt: 'PT' };
function fullLang(raw) {
  const lang = String(raw || 'fr-FR').slice(0, 20);
  if (/^[a-z]{2,3}$/i.test(lang)) {
    const base = lang.toLowerCase();
    return `${base}-${REGIONS[base] || base.toUpperCase()}`;
  }
  return lang;
}
const voiceOf = (i) => ({ name: String(i.name || 'Orbit').slice(0, 120), lang: fullLang(i.lang) });

if (info && info.enabled) {
  const voice = voiceOf(info);

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
    ipcRenderer.send('tts:page', { op: 'speak', id, text, rate: Number(msg.rate) || 1, lang: String(msg.lang || '').slice(0, 20) });
  });

  if (!isTop) {
    ipcRenderer
      .invoke('tts:pageInfoAsync')
      .then((real) => {
        const payload = real && real.enabled ? { type: 'voice', voice: voiceOf(real) } : { type: 'disable' };
        document.dispatchEvent(new CustomEvent('orbit:tts-in', { detail: JSON.stringify({ id: 0, ...payload }) }));
      })
      .catch(() => {
        document.dispatchEvent(new CustomEvent('orbit:tts-in', { detail: JSON.stringify({ id: 0, type: 'disable' }) }));
      });
  }

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
    // De quoi rendre la synthèse d'origine si Orbit ne doit pas parler ici.
    const nativeSynth = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
    const nativeVoice = Object.getOwnPropertyDescriptor(NativeUtterance.prototype, 'voice');

    // Une voix « Orbit » : celle choisie dans les réglages. Les sites la
    // trouvent dans getVoices() et peuvent la sélectionner.
    const makeVoice = (v) => Object.freeze({
      voiceURI: 'orbit-voice',
      name: v.name,
      lang: v.lang,
      localService: true,
      default: true,
    });
    let orbitVoice = makeVoice(VOICE);

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
      // La langue demandée par le site (utterance.lang, ou celle de la voix
      // choisie) : Orbit prend une voix installée qui la parle, s'il en a une.
      const v = voices.get(utterance);
      const lang = String(utterance.lang || (v && v.lang) || document.documentElement.lang || '');
      send({ op: 'speak', id, text: String(utterance.text || ''), rate: Number(utterance.rate) || 1, lang });
    };

    document.addEventListener('orbit:tts-in', (event) => {
      let msg;
      try { msg = JSON.parse(String(event.detail || '')); } catch { return; }
      // Réponse différée (iframe) : la vraie voix, ou « pas de pont ici ».
      if (msg.type === 'voice' && msg.voice) {
        orbitVoice = makeVoice(msg.voice);
        synth.dispatchEvent(new Event('voiceschanged'));
        return;
      }
      if (msg.type === 'disable') {
        try {
          if (nativeSynth) Object.defineProperty(window, 'speechSynthesis', nativeSynth);
          else delete window.speechSynthesis;
          if (nativeVoice) Object.defineProperty(NativeUtterance.prototype, 'voice', nativeVoice);
        } catch {}
        return;
      }
      const utterance = byId.get(msg.id);
      if (!utterance) return;
      if (msg.type === 'start') { fire(utterance, 'start'); return; }
      byId.delete(msg.id);
      if (current === utterance) current = null;
      fire(utterance, msg.type === 'error' ? 'error' : 'end', msg);
      next();
    });

    class OrbitSpeechSynthesis extends EventTarget {
      constructor() { super(); this._onvc = null; this._paused = false; }
      // Comme Chrome, les voix « arrivent » APRÈS que le site s'est abonné :
      // poser le gestionnaire programme un 'voiceschanged'. Sans ça, l'événement
      // envoyé au chargement partait avant le script du site, qui attendait
      // alors une liste de voix qui ne venait jamais.
      get onvoiceschanged() { return this._onvc; }
      set onvoiceschanged(fn) {
        this._onvc = typeof fn === 'function' ? fn : null;
        if (this._onvc) setTimeout(() => this.dispatchEvent(new Event('voiceschanged')), 0);
      }
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
    // Les sites attendent souvent « voiceschanged » avant de choisir une voix :
    // on le signale aussi une fois la page analysée (abonnés par addEventListener).
    const announce = () => setTimeout(() => synth.dispatchEvent(new Event('voiceschanged')), 0);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce, { once: true });
    else announce();
  })();`;

  try {
    webFrame.executeJavaScript(pageScript);
  } catch {
    /* page sans monde principal accessible : la synthèse native reste */
  }
}
