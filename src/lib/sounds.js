// Sons de notification intégrés, synthétisés à la volée (aucun fichier binaire).
// Chaque son est rendu en WAV puis encodé en data URL — même format qu'un son
// importé par l'utilisateur, donc compatible avec le lecteur existant
// (new Audio(dataURL)). Génération paresseuse + cache.

const SR = 22050; // suffisant pour un court son de notification, data URL légère

function toWavDataURL(samples) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const ws = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  ws(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SR, true);
  view.setUint32(28, SR * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ws(36, 'data');
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

function render(dur, fn) {
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / SR) * 0.6;
  return out;
}

const decay = (t, k) => Math.exp(-k * t);
const PI2 = Math.PI * 2;

// Recettes des sons proposés (nom → fonction de rendu).
const recipes = {
  Pop: () => render(0.16, (t) => Math.sin(PI2 * (520 + 420 * t) * t) * decay(t, 26)),
  Ding: () => render(0.5, (t) => Math.sin(PI2 * 880 * t) * decay(t, 6)),
  Carillon: () =>
    render(0.6, (t) => (Math.sin(PI2 * 660 * t) + 0.6 * Math.sin(PI2 * 990 * t)) * decay(t, 5)),
  Bulle: () => render(0.1, (t) => Math.sin(PI2 * 620 * t) * decay(t, 16)),
  Cloche: () =>
    render(0.8, (t) => (Math.sin(PI2 * 1046 * t) + 0.5 * Math.sin(PI2 * 1568 * t)) * decay(t, 4)),
  Toc: () => render(0.12, (t) => Math.sin(PI2 * 200 * t) * decay(t, 30)),
};

// Noms des sons intégrés (pour l'UI).
export const builtinSoundNames = Object.keys(recipes);

const cache = {};

// Retourne la data URL WAV d'un son intégré (générée puis mise en cache).
export function getBuiltinSound(name) {
  if (!recipes[name]) return '';
  if (!cache[name]) cache[name] = toWavDataURL(recipes[name]());
  return cache[name];
}
