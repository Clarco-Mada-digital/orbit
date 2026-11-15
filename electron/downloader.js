import { app, net } from 'electron';
import { execFileSync, spawn } from 'child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CHECKSUMS_URL,
  MAX_TOOL_BYTES,
  assetNameFor,
  chooseTool,
  parseChecksums,
  releaseAssetUrl,
  verifyDownload,
} from '../src/lib/mediaTool.js';
import { selectCookiesForUrl, toNetscapeCookieFile } from '../src/lib/mediaCookies.js';

// ---------------------------------------------------------------------------
// Téléchargement vidéo/audio par yt-dlp.
//
// La RÈGLE de l'approvisionnement vit dans src/lib/mediaTool.js (pure, donc
// testée) ; ce fichier ne fait que l'exécuter. Ce qui a changé par rapport à
// la version qui « marchait une fois sur trois » :
//
//   • on part avec le binaire présent sur le disque, même périmé, et la mise
//     à jour se fait en arrière-plan — plus de 41 Mo à attendre avant que la
//     vidéo ne commence, et plus d'échec quand GitHub ne répond pas ;
//   • plus d'appel à api.github.com (60 requêtes/heure sans authentification,
//     c'était une cause d'échec intermittent) : l'URL de release directe ;
//   • ffmpeg est localisé et transmis, sans quoi yt-dlp ne peut pas réunir la
//     piste vidéo et la piste audio que YouTube sert séparément ;
//   • les cookies de la session Orbit sont transmis pour le DOMAINE VISÉ
//     seulement, ce qui débloque Facebook et les vidéos réservées.
// ---------------------------------------------------------------------------

function binName() {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function binPath() {
  return path.join(app.getPath('userData'), 'bin', binName());
}

async function readText(url, limit = 256 * 1024) {
  const response = await net.fetch(url, {
    headers: { Accept: 'application/json, text/plain' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > limit) throw new Error('Réponse distante trop volumineuse');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new Error('Réponse distante trop volumineuse');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// --- Localisation des outils ----------------------------------------------

// Premier chemin exécutable trouvé pour `tool` dans le PATH. Sert de repli
// pour yt-dlp et d'emplacement pour ffmpeg.
function findInPath(tool) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(probe, [tool], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500,
      encoding: 'utf8',
    });
    const first = String(out || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

let ffmpegCache; // undefined = pas encore cherché, null = absent

// Emplacement de ffmpeg, cherché une seule fois par session.
//
// Sans ffmpeg, yt-dlp ne sait pas assembler les pistes séparées de YouTube :
// il retombe sur un format déjà mixé, donc une qualité très inférieure, ou
// échoue. `--ffmpeg-location` lui épargne de le chercher lui-même dans un
// PATH qui, dans une application empaquetée, n'est pas celui du terminal.
export function ffmpegLocation() {
  if (ffmpegCache !== undefined) return ffmpegCache;
  ffmpegCache = findInPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return ffmpegCache;
}

export function hasFfmpeg() {
  return Boolean(ffmpegLocation());
}

// --- Approvisionnement de yt-dlp ------------------------------------------

let refreshing = null; // une seule mise à jour à la fois (41 Mo)

function cachedTool() {
  const destination = binPath();
  try {
    const stat = fs.statSync(destination);
    if (!stat.isFile() || stat.size === 0) return null;
    return { path: destination, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

// Télécharge la dernière version et la met en place. Vérifiée en SHA-256
// AVANT d'être rendue exécutable : on n'exécute pas ce qu'on n'a pas reconnu.
async function downloadTool() {
  const name = assetNameFor(process.platform, process.arch);
  if (!name) {
    throw new Error(`yt-dlp n’est pas publié pour ${process.platform}/${process.arch}`);
  }
  const expectedSum = parseChecksums(await readText(CHECKSUMS_URL), name);
  if (!expectedSum) throw new Error('Empreinte SHA-256 de yt-dlp introuvable');

  const response = await net.fetch(releaseAssetUrl(name), {
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement de yt-dlp impossible (HTTP ${response.status})`);
  }
  const declared = Number(response.headers.get('content-length'));
  const expectedSize = Number.isSafeInteger(declared) && declared > 0 ? declared : null;

  const chunks = [];
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_TOOL_BYTES) throw new Error('Binaire yt-dlp trop volumineux');
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      hash.update(chunk);
    }
  } catch (error) {
    response.body.cancel().catch(() => {});
    throw error;
  }

  const check = verifyDownload({
    expectedSize,
    receivedSize: bytes,
    expectedSum,
    actualSum: hash.digest('hex'),
  });
  if (!check.ok) throw new Error(`Binaire yt-dlp refusé (${check.reason})`);

  const destination = binPath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // Nom temporaire propre au processus : deux fenêtres Orbit ne doivent pas
  // écrire dans le même fichier intermédiaire.
  const temporary = `${destination}.${process.pid}.part`;
  try {
    fs.writeFileSync(temporary, Buffer.concat(chunks), { mode: 0o755 });
    if (process.platform !== 'win32') fs.chmodSync(temporary, 0o755);
    fs.renameSync(temporary, destination);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch (cleanupError) {
      console.error('[orbit] nettoyage du binaire yt-dlp incomplet échoué:', cleanupError);
    }
    throw error;
  }
  return destination;
}

// Une seule mise à jour en vol, quel que soit le nombre d'appels.
function refreshTool() {
  if (!refreshing) {
    refreshing = downloadTool()
      .catch((error) => {
        // Un échec de mise à jour n'est PAS un échec de téléchargement : on le
        // note et on continue avec ce qu'on a. C'est tout le correctif.
        console.warn('[orbit] mise à jour de yt-dlp impossible:', error.message);
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

// Chemin du yt-dlp à lancer MAINTENANT. Ne lève que s'il n'y a vraiment rien.
export async function resolveTool() {
  const decision = chooseTool({
    cached: cachedTool(),
    system: findInPath(binName()),
  });

  if (decision.refresh) {
    if (decision.blocking) {
      // On attend la mise à jour, mais son échec ne nous arrête pas : on
      // retombe sur `decision.use` juste en dessous s'il existe.
      const updated = await refreshTool();
      if (updated) return updated;
    } else {
      // Mise à jour lancée sans être attendue : elle servira la prochaine
      // fois. Le `catch` est dans refreshTool, rien ne remonte ici.
      refreshTool();
    }
  }
  if (decision.use) return decision.use;

  throw new Error(
    'yt-dlp est introuvable et n’a pas pu être téléchargé (connexion ?). ' +
      'Réessayez, ou installez yt-dlp sur le système.'
  );
}

// --- Cookies de session ---------------------------------------------------

// Écrit les cookies du DOMAINE VISÉ dans un fichier temporaire lisible par
// son seul propriétaire. Rend { file, cleanup } ; file vaut null quand il n'y
// a rien à transmettre (on saute alors --cookies, qu'un fichier vide ferait
// échouer).
function writeCookieFile(cookies, url) {
  const text = toNetscapeCookieFile(selectCookiesForUrl(cookies, url));
  if (!text) return { file: null, cleanup: () => {} };
  let file = null;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-dl-'));
    file = path.join(dir, 'cookies.txt');
    // 0600 : un cookie de session vaut le mot de passe, il ne traîne pas en
    // lecture pour tout le monde sur une machine partagée.
    fs.writeFileSync(file, text, { mode: 0o600 });
    return {
      file,
      cleanup: () => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (error) {
          console.error('[orbit] suppression du fichier de cookies échouée:', error);
        }
      },
    };
  } catch (error) {
    console.warn('[orbit] cookies non transmis à yt-dlp:', error.message);
    return { file: null, cleanup: () => {} };
  }
}

// --- Titre et téléchargement ---------------------------------------------

// Titre de la vidéo, demandé AVANT d'ouvrir la boîte "Enregistrer sous" :
// c'est ce titre qui sert de nom de fichier proposé. Sans lui, le dialogue
// proposait « video.mp4 », un nom qui ne dit plus rien de la vidéo une fois le
// téléchargement terminé. Un échec (site injoignable, outil absent) n'est pas
// une erreur : on retombe simplement sur le nom générique.
export async function fetchMediaTitle(url, { cookies = null } = {}) {
  let bin;
  try {
    bin = await resolveTool();
  } catch {
    return '';
  }
  const jar = cookies ? writeCookieFile(cookies, url) : { file: null, cleanup: () => {} };
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      jar.cleanup();
      resolve(String(value || '').trim());
    };
    const args = ['--no-playlist', '--no-warnings', '--skip-download', '--print', '%(title).180s'];
    if (jar.file) args.push('--cookies', jar.file);
    args.push('--', url);
    const proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* déjà terminé */
      }
      finish('');
    }, 20_000);
    timer.unref?.();
    proc.stdout?.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > 4096) output = output.slice(0, 4096);
    });
    proc.once('error', () => finish(''));
    proc.once('close', (code) => finish(code === 0 ? output.split(/\r?\n/).filter(Boolean).pop() : ''));
  });
}

function parseProgress(text, id, onEvent, state) {
  const progress = /ORBIT_PROGRESS:(\d+)\|(\d+)\|([^|]*)\|([^|]*)/g;
  for (const match of text.matchAll(progress)) {
    const receivedBytes = Number(match[1]) || 0;
    const totalBytes = Number(match[2]) || 0;
    state.speedBytesPerSecond = Number(match[3]) || 0;
    state.etaSeconds = Number(match[4]) || 0;
    onEvent({
      id,
      filename: state.filename,
      state: 'progressing',
      receivedBytes,
      totalBytes,
      speedBytesPerSecond: state.speedBytesPerSecond,
      etaSeconds: state.etaSeconds,
    });
  }
  const pathMatch = text.match(/ORBIT_PATH:(.+)/);
  if (pathMatch) state.savePath = pathMatch[1].trim();
  const nameMatch = text.match(/ORBIT_NAME:(.+)/);
  if (nameMatch) state.filename = path.basename(nameMatch[1].trim());
  const speedMatch = text.match(/ORBIT_SPEED:(\d+)/);
  if (speedMatch) state.speedBytesPerSecond = Number(speedMatch[1]) || 0;
  const etaMatch = text.match(/ORBIT_ETA:(\d+)/);
  if (etaMatch) state.etaSeconds = Number(etaMatch[1]) || 0;
  // Dernière plainte de yt-dlp, gardée pour le message d'échec : « code 1 »
  // n'apprend rien, « Video unavailable » ou « Sign in to confirm your age »
  // dit exactement quoi faire.
  const errorMatch = text.match(/^\s*ERROR:\s*(.+)$/m);
  if (errorMatch) state.lastError = errorMatch[1].trim().slice(0, 300);
}

export function downloadMedia({
  id,
  url,
  mode,
  outputTemplate,
  format,
  extractAudio = false,
  audioFormat = 'm4a',
  mergeOutputFormat = 'mp4',
  cookies = null,
}, onEvent) {
  resolveTool()
    .then((bin) => {
      const state = {
        filename: 'Analyse…',
        savePath: '',
        speedBytesPerSecond: 0,
        etaSeconds: 0,
        lastError: '',
      };
      const jar = cookies ? writeCookieFile(cookies, url) : { file: null, cleanup: () => {} };
      const args = [
        '--newline',
        '--no-playlist',
        '--no-mtime',
        '--retries', '10',
        '--fragment-retries', '10',
        '--extractor-retries', '5',
        '--socket-timeout', '30',
        '--progress-template',
        'download:ORBIT_PROGRESS:%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
        '--print', 'after_move:ORBIT_PATH:%(filepath)s',
        '--print', 'before_dl:ORBIT_NAME:%(title).200s.%(ext)s',
        '-f', format,
        '-o', outputTemplate,
      ];
      const ffmpeg = ffmpegLocation();
      if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
      if (jar.file) args.push('--cookies', jar.file);
      if (mode === 'video' && mergeOutputFormat) args.push('--merge-output-format', mergeOutputFormat);
      if (extractAudio) args.push('--extract-audio', '--audio-format', audioFormat);
      args.push('--', url);

      const proc = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      onEvent({ id, filename: state.filename, state: 'progressing', receivedBytes: 0, totalBytes: 0, proc });
      let output = '';
      let settled = false;
      const parse = (chunk) => {
        output += chunk.toString('utf8');
        const lines = output.split(/\r?\n/);
        output = lines.pop() || '';
        for (const line of lines) parseProgress(line, id, onEvent, state);
      };
      proc.stdout.on('data', parse);
      proc.stderr.on('data', parse);
      proc.once('error', (error) => {
        if (settled) return;
        settled = true;
        jar.cleanup();
        onEvent({
          id,
          filename: state.filename,
          state: 'interrupted',
          error: String(error.message || error),
        });
      });
      proc.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        if (output) parseProgress(output, id, onEvent, state);
        jar.cleanup();
        const success = code === 0 && Boolean(state.savePath);
        // Message utile en cas d'échec : la plainte de yt-dlp d'abord, le code
        // de sortie seulement s'il n'a rien dit.
        const why = state.lastError
          ? state.lastError
          : !ffmpeg && mode === 'video'
            ? 'ffmpeg est absent : les pistes vidéo et audio n’ont pas pu être réunies.'
            : `yt-dlp a terminé sans fichier (code ${code ?? signal ?? 'inconnu'})`;
        onEvent({
          id,
          filename: state.savePath ? path.basename(state.savePath) : state.filename,
          savePath: state.savePath,
          state: success ? 'completed' : signal === 'SIGTERM' ? 'cancelled' : 'interrupted',
          receivedBytes: success ? undefined : 0,
          totalBytes: success ? undefined : 0,
          error: success ? undefined : why,
        });
      });
    })
    .catch((error) => {
      onEvent({
        id,
        filename: 'yt-dlp indisponible',
        state: 'interrupted',
        error: String(error.message || error),
      });
    });
}
