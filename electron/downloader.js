import { app, net } from 'electron';
import { spawn } from 'child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_TOOL_BYTES = 50 * 1024 * 1024;
const TOOL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

function binName() {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function binPath() {
  return path.join(app.getPath('userData'), 'bin', binName());
}

function assetName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
  if (process.arch === 'x64') return 'yt-dlp_linux';
  throw new Error(`yt-dlp n’est pas disponible pour ${process.platform}/${process.arch}`);
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

async function ensureYtDlp() {
  const destination = binPath();
  let current = false;
  try {
    const stat = fs.statSync(destination);
    current = stat.isFile() && Date.now() - stat.mtimeMs < TOOL_REFRESH_MS;
  } catch {
    current = false;
  }
  if (current) return destination;

  const release = JSON.parse(await readText(
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
  ));
  if (!release?.tag_name || !Array.isArray(release.assets)) {
    throw new Error('Version yt-dlp indisponible');
  }
  const name = assetName();
  const binaryAsset = release.assets.find((asset) => asset.name === name);
  const sumsAsset = release.assets.find((asset) => asset.name === 'SHA2-256SUMS');
  if (!binaryAsset?.browser_download_url || !sumsAsset?.browser_download_url) {
    throw new Error(`Binaire yt-dlp introuvable pour ${process.platform}/${process.arch}`);
  }
  if (!Number.isSafeInteger(binaryAsset.size) || binaryAsset.size <= 0 || binaryAsset.size > MAX_TOOL_BYTES) {
    throw new Error('Taille du binaire yt-dlp non valide');
  }

  const sums = await readText(sumsAsset.browser_download_url);
  const checksum = sums
    .split(/\r?\n/)
    .map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line))
    .find((match) => match?.[2] === name)?.[1];
  if (!checksum) throw new Error('Empreinte SHA-256 yt-dlp absente');

  const response = await net.fetch(binaryAsset.browser_download_url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) throw new Error(`Téléchargement yt-dlp impossible (HTTP ${response.status})`);
  const chunks = [];
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_TOOL_BYTES || bytes > binaryAsset.size) {
        throw new Error('Binaire yt-dlp trop volumineux');
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      hash.update(chunk);
    }
  } catch (error) {
    response.body.cancel().catch(() => {});
    throw error;
  }
  if (bytes !== binaryAsset.size || hash.digest('hex') !== checksum) {
    throw new Error('Vérification SHA-256 de yt-dlp échouée');
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
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
}, onEvent) {
  ensureYtDlp()
    .then((bin) => {
      const state = { filename: 'Analyse…', savePath: '', speedBytesPerSecond: 0, etaSeconds: 0 };
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
        const success = code === 0 && Boolean(state.savePath);
        onEvent({
          id,
          filename: state.savePath ? path.basename(state.savePath) : state.filename,
          savePath: state.savePath,
          state: success ? 'completed' : signal === 'SIGTERM' ? 'cancelled' : 'interrupted',
          receivedBytes: success ? undefined : 0,
          totalBytes: success ? undefined : 0,
          error: success ? undefined : `yt-dlp a terminé sans fichier (code ${code ?? signal ?? 'inconnu'})`,
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
