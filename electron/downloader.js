// ---------------------------------------------------------------------------
// Téléchargement vidéo / audio via yt-dlp (YouTube, Facebook, et la plupart
// des sites). Le binaire yt-dlp (standalone, sans dépendance Python) est
// téléchargé automatiquement dans userData/bin au 1er usage.
//
// On évite volontairement ffmpeg : on prend un format « fichier unique »
// (vidéo mp4 déjà muxée, ou piste audio seule) → pas de fusion à faire.
// ---------------------------------------------------------------------------
import { app, net } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function binName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  return 'yt-dlp';
}
function binPath() {
  return path.join(app.getPath('userData'), 'bin', binName());
}
function releaseUrl() {
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
  if (process.platform === 'win32') return base + 'yt-dlp.exe';
  if (process.platform === 'darwin') return base + 'yt-dlp_macos';
  return base + 'yt-dlp_linux'; // standalone, pas besoin de Python
}

// Télécharge le binaire yt-dlp si absent. Renvoie son chemin.
async function ensureYtDlp(onStatus) {
  const p = binPath();
  if (fs.existsSync(p)) return p;
  onStatus && onStatus('Téléchargement de l’outil yt-dlp…');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const res = await net.fetch(releaseUrl(), { redirect: 'follow' });
  if (!res.ok) throw new Error('Téléchargement de yt-dlp impossible (HTTP ' + res.status + ')');
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(p, buf);
  if (process.platform !== 'win32') fs.chmodSync(p, 0o755);
  return p;
}

// mode: 'video' | 'audio'. onEvent({ id, filename, state, receivedBytes,
// totalBytes, savePath }) alimente le panneau Téléchargements existant.
export function downloadMedia({ id, url, mode }, onEvent) {
  const dir = app.getPath('downloads');
  const outTpl = path.join(dir, '%(title).200s.%(ext)s');
  const format =
    mode === 'audio'
      ? 'bestaudio[ext=m4a]/bestaudio' // piste audio seule, sans conversion
      : 'best[ext=mp4]/best'; // mp4 déjà muxé (pas de fusion ffmpeg)
  const args = [
    '-f',
    format,
    '-o',
    outTpl,
    '--no-playlist',
    '--newline',
    '--no-mtime',
    // `--` ferme la liste d'options : même si une URL commençait par « - »,
    // yt-dlp ne pourrait plus la lire comme un drapeau (--exec=… exécuterait
    // une commande). L'appelant valide déjà le schéma http(s) ; ceci est la
    // seconde barrière.
    '--',
    url,
  ];

  ensureYtDlp((msg) => onEvent({ id, filename: msg, state: 'progressing', receivedBytes: 0, totalBytes: 0 }))
    .then((bin) => {
      let savePath = '';
      let totalBytes = 0;
      const proc = spawn(bin, args);
      onEvent({ id, filename: 'Analyse…', state: 'progressing', receivedBytes: 0, totalBytes: 0, proc });

      const parse = (chunk) => {
        const text = chunk.toString('utf8');
        // Destination : nom du fichier de sortie
        const dest = text.match(/\[download\] Destination: (.+)/);
        if (dest) savePath = dest[1].trim();
        const already = text.match(/\[download\] (.+) has already been downloaded/);
        if (already) savePath = already[1].trim();
        // Progression : "[download]  45.3% of 10.00MiB at ..."
        const m = text.match(/\[download\]\s+([\d.]+)% of ~?\s*([\d.]+)(K|M|G)iB/);
        if (m) {
          const pct = parseFloat(m[1]);
          const size = parseFloat(m[2]);
          const unit = m[3];
          const mult = unit === 'G' ? 1024 ** 3 : unit === 'M' ? 1024 ** 2 : 1024;
          totalBytes = Math.round(size * mult);
          onEvent({
            id,
            filename: savePath ? path.basename(savePath) : 'Téléchargement…',
            state: 'progressing',
            receivedBytes: Math.round((pct / 100) * totalBytes),
            totalBytes,
          });
        }
      };
      proc.stdout.on('data', parse);
      proc.stderr.on('data', parse);
      proc.on('error', (err) => {
        onEvent({ id, filename: 'Erreur', state: 'interrupted', error: String(err.message || err) });
      });
      proc.on('close', (code) => {
        onEvent({
          id,
          filename: savePath ? path.basename(savePath) : 'Média',
          savePath,
          state: code === 0 ? 'completed' : 'interrupted',
          receivedBytes: totalBytes,
          totalBytes,
        });
      });
    })
    .catch((err) => {
      onEvent({ id, filename: 'yt-dlp indisponible', state: 'interrupted', error: String(err.message || err) });
    });
}
