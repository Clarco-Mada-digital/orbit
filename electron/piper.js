// ---------------------------------------------------------------------------
// Piper — synthèse vocale neuronale HORS LIGNE (voix naturelles)
//
// Pourquoi : les voix agréables de Chrome sont un service cloud propriétaire de
// Google, indisponible dans Chromium et donc dans Electron. Le seul moyen
// d'obtenir une voix non robotique sans envoyer le texte des pages à un tiers,
// c'est un moteur neuronal local. Piper fait ça très bien, en licence libre.
//
// COÛT ET ACTIVATION — c'est la contrainte qui a dicté la conception :
//   • ce module n'est même pas CHARGÉ tant que Piper n'est pas activé : main.js
//     l'importe dynamiquement, au premier usage réel ;
//   • rien n'est téléchargé sans une action explicite (26 Mo de moteur,
//     28 à 120 Mo par voix) ;
//   • aucun processus n'est lancé au démarrage, aucune détection, aucun réseau ;
//   • le processus piper ne vit que le temps d'une lecture.
//
// Le binaire est téléchargé depuis les publications GitHub de rhasspy/piper et
// les voix depuis HuggingFace, en HTTPS. À noter : le projet ne publie pas
// d'empreinte pour ses archives, on ne peut donc pas en vérifier la signature —
// d'où l'installation strictement volontaire, jamais automatique.
// ---------------------------------------------------------------------------
import { app, net } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import yauzl from 'yauzl';

const PIPER_TAG = '2023.11.14-2';
const RELEASE = `https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}`;
const VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

// Catalogue restreint et vérifié, plutôt que l'index complet de HuggingFace
// (plus d'un mégaoctet de JSON à télécharger pour afficher une liste).
export const VOICE_CATALOG = [
  { id: 'fr_FR-siwis-low', label: 'Siwis (français, légère)', lang: 'fr', path: 'fr/fr_FR/siwis/low/fr_FR-siwis-low', sizeMb: 28 },
  { id: 'fr_FR-siwis-medium', label: 'Siwis (français)', lang: 'fr', path: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium', sizeMb: 63 },
  { id: 'fr_FR-tom-medium', label: 'Tom (français, voix masculine)', lang: 'fr', path: 'fr/fr_FR/tom/medium/fr_FR-tom-medium', sizeMb: 63 },
  { id: 'fr_FR-upmc-medium', label: 'UPMC (français)', lang: 'fr', path: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', sizeMb: 76 },
  { id: 'en_US-amy-medium', label: 'Amy (anglais US)', lang: 'en', path: 'en/en_US/amy/medium/en_US-amy-medium', sizeMb: 63 },
  { id: 'en_US-lessac-medium', label: 'Lessac (anglais US)', lang: 'en', path: 'en/en_US/lessac/medium/en_US-lessac-medium', sizeMb: 63 },
  { id: 'en_GB-alba-medium', label: 'Alba (anglais GB)', lang: 'en', path: 'en/en_GB/alba/medium/en_GB-alba-medium', sizeMb: 63 },
];

let root = null;
let current = null; // processus piper en cours

function dirs() {
  if (!root) root = path.join(app.getPath('userData'), 'piper');
  return { root, bin: path.join(root, 'bin'), voices: path.join(root, 'voices') };
}

function binaryPath() {
  const { bin } = dirs();
  const exe = process.platform === 'win32' ? 'piper.exe' : 'piper';
  // L'archive contient un dossier « piper/ » ; on le conserve tel quel, les
  // bibliothèques et les données espeak-ng qu'il embarque doivent rester à côté.
  return path.join(bin, 'piper', exe);
}

function assetName() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'win32') return 'piper_windows_amd64.zip';
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz';
  }
  return `piper_linux_${arch}.tar.gz`;
}

export function isInstalled() {
  try {
    fs.accessSync(binaryPath(), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function voiceFiles(id) {
  const { voices } = dirs();
  return { model: path.join(voices, `${id}.onnx`), config: path.join(voices, `${id}.onnx.json`) };
}

export function installedVoices() {
  const { voices } = dirs();
  try {
    return fs
      .readdirSync(voices)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.replace(/\.onnx$/, ''))
      .filter((id) => fs.existsSync(voiceFiles(id).config));
  } catch {
    return [];
  }
}

// État pour l'interface. Ne touche qu'au système de fichiers : aucun réseau,
// aucun processus lancé.
export function getState() {
  return {
    installed: isInstalled(),
    voices: installedVoices(),
    catalog: VOICE_CATALOG,
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
  // Renommage final : un téléchargement interrompu ne laisse jamais un fichier
  // d'apparence valide (qui ferait croire la voix installée).
  fs.renameSync(tmp, dest);
  return dest;
}

async function extractZip(file, destDir) {
  const zipfile = await promisify(yauzl.open)(file, { lazyEntries: true });
  const destRoot = path.resolve(destDir);
  await new Promise((resolve, reject) => {
    zipfile.on('error', reject);
    zipfile.on('end', resolve);
    zipfile.readEntry();
    zipfile.on('entry', (entry) => {
      const target = path.resolve(destRoot, entry.fileName);
      const rel = path.relative(destRoot, target);
      // Même précaution que pour les extensions .crx : une archive téléchargée
      // n'écrit jamais hors du dossier prévu.
      if (rel.startsWith('..') || path.isAbsolute(rel)) return reject(new Error('archive suspecte'));
      if (/\/$/.test(entry.fileName)) {
        fs.mkdirSync(target, { recursive: true });
        return zipfile.readEntry();
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      zipfile.openReadStream(entry, (err, stream) => {
        if (err) return reject(err);
        const out = fs.createWriteStream(target);
        out.on('error', reject);
        out.on('finish', () => zipfile.readEntry());
        stream.pipe(out);
      });
    });
  });
}

function extractTarGz(file, destDir) {
  return new Promise((resolve, reject) => {
    // `tar` est présent sur Linux, macOS et Windows 10+.
    const proc = spawn('tar', ['-xzf', file, '-C', destDir], { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('extraction impossible (tar ' + code + ')'))
    );
  });
}

export async function install(onProgress) {
  const { bin, root: r } = dirs();
  fs.mkdirSync(bin, { recursive: true });
  const name = assetName();
  const archive = path.join(r, name);
  onProgress?.({ phase: 'download', received: 0, total: 0 });
  await download(`${RELEASE}/${name}`, archive, (p) => onProgress?.({ phase: 'download', ...p }));

  onProgress?.({ phase: 'extract' });
  if (name.endsWith('.zip')) await extractZip(archive, bin);
  else await extractTarGz(archive, bin);
  try {
    fs.unlinkSync(archive);
  } catch {
    /* peu importe */
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath(), 0o755);
    } catch {
      /* ignore */
    }
  }
  if (!isInstalled()) throw new Error("Le moteur s'est extrait mais reste introuvable");
  return { success: true };
}

export async function installVoice(id, onProgress) {
  const voice = VOICE_CATALOG.find((v) => v.id === id);
  if (!voice) throw new Error('Voix inconnue');
  const { model, config } = voiceFiles(id);
  await download(`${VOICES_BASE}/${voice.path}.onnx.json`, config);
  await download(`${VOICES_BASE}/${voice.path}.onnx`, model, (p) =>
    onProgress?.({ phase: 'voice', ...p })
  );
  return { success: true };
}

export function removeVoice(id) {
  const { model, config } = voiceFiles(id);
  for (const f of [model, config]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* déjà absent */
    }
  }
  return { success: true };
}

export function uninstall() {
  stop();
  try {
    fs.rmSync(dirs().root, { recursive: true, force: true });
  } catch {
    return { success: false };
  }
  return { success: true };
}

// Fréquence d'échantillonnage de la voix : nécessaire pour rejouer le flux PCM.
function sampleRateOf(id) {
  try {
    const cfg = JSON.parse(fs.readFileSync(voiceFiles(id).config, 'utf8'));
    return cfg?.audio?.sample_rate || 22050;
  } catch {
    return 22050;
  }
}

// ---------------------------------------------------------------------------
// Synthèse
// ---------------------------------------------------------------------------
export function stop() {
  if (current) {
    try {
      current.kill('SIGTERM');
    } catch {
      /* déjà terminé */
    }
    current = null;
  }
}

export function isSpeaking() {
  return Boolean(current);
}

// `onAudio(chunk)` reçoit du PCM 16 bits signé, mono, petit-boutiste.
// `onEnd()` est appelé à la fin (ou à l'arrêt).
export function speak(text, { voiceId, onStart, onAudio, onEnd } = {}) {
  const { model } = voiceFiles(voiceId);
  if (!isInstalled()) return { success: false, error: 'not-installed' };
  if (!fs.existsSync(model)) return { success: false, error: 'voice-missing' };

  stop();
  const proc = spawn(
    binaryPath(),
    // --output-raw : le PCM sort au fil de la synthèse, phrase par phrase. La
    // lecture démarre donc presque tout de suite au lieu d'attendre que toute
    // la page soit synthétisée.
    ['--model', model, '--output-raw'],
    { stdio: ['pipe', 'pipe', 'ignore'] }
  );
  current = proc;

  onStart?.({ sampleRate: sampleRateOf(voiceId) });
  proc.stdout.on('data', (chunk) => {
    if (current === proc) onAudio?.(chunk);
  });
  const finish = () => {
    if (current === proc) {
      current = null;
      onEnd?.();
    }
  };
  proc.on('error', finish);
  proc.on('exit', finish);
  proc.stdin.on('error', () => {});

  // Piper découpe sur les fins de ligne : on retire les retours à la ligne du
  // texte pour qu'il traite des phrases entières, pas des fragments.
  proc.stdin.end(String(text).replace(/\s*\n+\s*/g, ' ') + '\n', 'utf8');
  return { success: true };
}
