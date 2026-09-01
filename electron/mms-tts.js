// ---------------------------------------------------------------------------
// MMS-TTS Malagasy — synthèse vocale neuronale hors-ligne
//
// Utilise le modèle VITS quantisé de Meta (facebook/mms-tts-mlg) converti
// en ONNX par willwade/mms-tts-multilingual-models-onnx. Le modèle fait
// ~114 Mo et tourne en local sans connexion Internet une fois téléchargé.
//
// Architecture : VITS (Variational Inference with Adversarial Learning)
//   Entrées  : x (tokens), x_length, noise_scale, length_scale, noise_scale_w
//   Sortie   : y (waveform PCM float32)
// ---------------------------------------------------------------------------
import { app, net } from 'electron';
import fs from 'fs';
import path from 'path';
import ort from 'onnxruntime-node';

const MODEL_BASE = 'https://huggingface.co/willwade/mms-tts-multilingual-models-onnx/resolve/main/mlg';
const SAMPLE_RATE = 16000;

let root = null;
let current = null; // processus en cours (pour isSpeaking / stop)
let session = null; // ONNX Runtime session
let tokens = null; // Map<character, id>

function dirs() {
  if (!root) root = path.join(app.getPath('userData'), 'mms-tts');
  return {
    root,
    model: path.join(root, 'model.onnx'),
    tokens: path.join(root, 'tokens.txt'),
  };
}

export function isInstalled() {
  const d = dirs();
  return fs.existsSync(d.model) && fs.existsSync(d.tokens);
}

export function getState() {
  return {
    installed: isInstalled(),
    modelId: 'mms-tts-mlg',
    sampleRate: SAMPLE_RATE,
  };
}

// ---------------------------------------------------------------------------
// Téléchargement
// ---------------------------------------------------------------------------
async function download(url, dest, onProgress) {
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let received = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!out.write(Buffer.from(value))) {
        await new Promise((r) => out.once('drain', r));
      }
      onProgress?.({ received, total });
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  fs.renameSync(tmp, dest);
  return dest;
}

async function ensureInstalled(onProgress) {
  if (isInstalled()) return;
  const d = dirs();
  fs.mkdirSync(d.root, { recursive: true });

  onProgress?.({ phase: 'download', received: 0, total: 0 });
  let p = 0;
  await download(`${MODEL_BASE}/model.onnx`, d.model, (prog) => {
    p = prog.received;
    onProgress?.({ phase: 'download', received: prog.received, total: prog.total });
  });
  await download(`${MODEL_BASE}/tokens.txt`, d.tokens);
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
function loadTokens() {
  if (tokens) return tokens;
  const d = dirs();
  const lines = fs.readFileSync(d.tokens, 'utf8').split('\n');
  tokens = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "character index" (e.g. "a 0", "À 24")
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace === -1) continue;
    const char = trimmed.slice(0, lastSpace);
    const id = parseInt(trimmed.slice(lastSpace + 1), 10);
    if (!isNaN(id)) {
      tokens.set(char, id);
    }
  }
  return tokens;
}

function tokenize(text) {
  const vocab = loadTokens();
  const ids = [];
  for (const ch of text) {
    const id = vocab.get(ch) ?? vocab.get(ch.toLowerCase()) ?? vocab.get(ch.toUpperCase());
    if (id !== undefined) {
      ids.push(id);
    }
    // Les caractères inconnus sont ignorés (pas d'insertion de token inconnu)
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Inférence ONNX
// ---------------------------------------------------------------------------
async function loadSession() {
  if (session) return session;
  const d = dirs();
  session = await ort.InferenceSession.create(d.model);
  return session;
}

// Synthèse : retourne un Buffer PCM 16 bits signé.
export async function synthesize(text, { onProgress } = {}) {
  const content = String(text || '').trim().slice(0, 40000);
  if (!content) return null;

  await ensureInstalled(onProgress);
  onProgress?.({ phase: 'load', received: 0, total: 0 });

  const sess = await loadSession();

  // Tokeniser
  const ids = tokenize(content);
  if (ids.length === 0) return null;

  // Créer les tenseurs ONNX
  const inputIds = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const inputLength = new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]);
  const noiseScale = new ort.Tensor('float32', new Float32Array([0.667]), [1]);
  const lengthScale = new ort.Tensor('float32', new Float32Array([1.0]), [1]);
  const noiseScaleW = new ort.Tensor('float32', new Float32Array([0.8]), [1]);

  onProgress?.({ phase: 'synth', received: 0, total: 0 });

  // Inférence
  const results = await sess.run({
    x: inputIds,
    x_length: inputLength,
    noise_scale: noiseScale,
    length_scale: lengthScale,
    noise_scale_w: noiseScaleW,
  });

  // La sortie est un tenseur float32 de forme [1, 1, L]
  const outputTensor = results[Object.keys(results)[0]];
  const float32 = outputTensor.data;

  // Convertir Float32 [-1, 1] → PCM 16 bits signé LE
  const pcm = Buffer.alloc(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }

  return { pcm, sampleRate: SAMPLE_RATE };
}

// ---------------------------------------------------------------------------
// API compatible Piper
// ---------------------------------------------------------------------------

export function stop() {
  if (current) {
    try { current.kill?.('SIGTERM'); } catch { /* ignore */ }
    current = null;
  }
}

export function isSpeaking() {
  return Boolean(current);
}

// `onAudio(chunk)` reçoit du PCM 16 bits signé, mono, petit-boutiste.
// `onStart({ sampleRate })` est appelé au début.
// `onEnd()` est appelé à la fin.
export async function speak(text, { onStart, onAudio, onEnd, onProgress } = {}) {
  stop();
  current = { kill: () => {} }; // marqueur fantôme pour isSpeaking()

  try {
    const result = await synthesize(text, { onProgress });
    if (!result || !current) {
      onEnd?.();
      return { success: false, error: 'synth-failed' };
    }

    onStart?.({ sampleRate: result.sampleRate });

    // Envoyer le PCM en blocs pour simuler le streaming
    const CHUNK = 32000; // ~1 seconde à 16 kHz
    for (let offset = 0; offset < result.pcm.length; offset += CHUNK) {
      if (!current) break;
      const chunk = result.pcm.subarray(offset, offset + CHUNK);
      onAudio?.(chunk);
    }

    onEnd?.();
    return { success: true };
  } catch (err) {
    console.error('[orbit] mms-tts erreur:', err.message);
    onEnd?.();
    return { success: false, error: err.message };
  } finally {
    current = null;
  }
}

// ---------------------------------------------------------------------------

export function uninstall() {
  stop();
  session = null;
  tokens = null;
  try {
    fs.rmSync(dirs().root, { recursive: true, force: true });
  } catch {
    return { success: false };
  }
  return { success: true };
}
