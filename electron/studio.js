// ---------------------------------------------------------------------------
// Studio d'enregistrement — côté processus principal
//
// Le processus principal ne filme rien : la capture, la composition et
// l'encodage ont lieu dans le renderer (MediaRecorder sur un canvas). Il
// fournit ce que le renderer ne peut pas obtenir seul :
//   • la LISTE des écrans et fenêtres capturables (desktopCapturer) ;
//   • la POSITION DU CURSEUR, qui sert au zoom suivi — une capture d'écran ne
//     contient pas toujours le pointeur, et jamais ses coordonnées ;
//   • l'écriture du fichier final, et sa conversion facultative en MP4.
//
// Rien n'est enregistré à l'insu de l'utilisateur : toutes ces fonctions sont
// déclenchées par l'interface d'Orbit, jamais par une page.
// ---------------------------------------------------------------------------
import { app, desktopCapturer, screen, shell, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';

// Dossier des enregistrements : « Vidéos/Orbit », avec repli sur Images puis
// Téléchargements — certains systèmes minimalistes n'ont pas de dossier Vidéos.
export function recordingDir() {
  let base;
  for (const name of ['videos', 'pictures', 'downloads']) {
    try {
      base = app.getPath(name);
      if (base) break;
    } catch {
      /* dossier absent : on essaie le suivant */
    }
  }
  const dir = path.join(base || app.getPath('temp'), 'Orbit');
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return base || app.getPath('temp');
  }
}

// Sources capturables. La vignette sert à CHOISIR : sans elle, « Écran 1 » et
// « Écran 2 » ne veulent rien dire sur un poste à deux moniteurs.
//
// `display_id` permet d'associer un écran à ses coordonnées système, donc de
// savoir où se trouve le curseur à l'intérieur de la capture.
export async function listSources() {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    });
    const displays = screen.getAllDisplays();
    return {
      success: true,
      sources: sources
        // Les fenêtres sans nom sont des surfaces techniques : les proposer
        // n'aiderait personne.
        .filter((s) => s.name && s.name.trim())
        .map((s) => {
          const display = displays.find((d) => String(d.id) === String(s.display_id));
          return {
            id: s.id,
            name: s.name,
            kind: s.id.startsWith('screen:') ? 'screen' : 'window',
            thumbnail: s.thumbnail?.toDataURL?.() || null,
            // Bornes de l'écran, pour le zoom suivi du curseur.
            bounds: display ? display.bounds : null,
          };
        }),
    };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// --- Source demandée par le studio ----------------------------------------
// La capture d'écran passe par `getDisplayMedia`, donc par le gestionnaire de
// partage d'écran d'Orbit (voir setDisplayMediaRequestHandler dans main.js).
// Ce gestionnaire demande normalement à l'utilisateur QUEL écran partager —
// c'est exactement ce qu'il faut pour une app embarquée qui réclame l'écran.
//
// Mais dans le studio, l'utilisateur VIENT de choisir sa source en cliquant sa
// vignette : la lui redemander serait une question de plus pour la même
// décision. Il la dépose donc ici juste avant la capture, et le gestionnaire
// la consomme UNE SEULE FOIS.
//
// Jeton à usage unique, et volontairement à durée de vie courte : il ne doit
// pas traîner, pour qu'une page embarquée qui demanderait l'écran juste après
// ne récupère pas le choix fait pour le studio.
let pending = null;
const PENDING_TTL = 15000;

export function setPendingSource(id) {
  if (!id) return { success: false, error: 'no-source' };
  pending = { id, at: Date.now() };
  return { success: true };
}

export function clearPendingSource() {
  pending = null;
  return { success: true };
}

// Un choix de source est-il en attente ? (sans le consommer)
// Sert au gestionnaire de permissions : c'est la preuve que l'utilisateur
// vient de désigner lui-même ce qu'il veut filmer.
export function hasPendingSource() {
  return Boolean(pending) && Date.now() - pending.at <= PENDING_TTL;
}

// Rend la source Electron correspondante, ou null. Consomme le jeton.
export async function takePendingSource() {
  const token = pending;
  pending = null;
  if (!token || Date.now() - token.at > PENDING_TTL) return null;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    return sources.find((s) => s.id === token.id) || null;
  } catch {
    return null;
  }
}

// --- Bridage d'arrière-plan ------------------------------------------------
// Chromium ralentit fortement `requestAnimationFrame` et les minuteries d'une
// fenêtre qui n'est plus au premier plan. Or on enregistre son écran POUR
// montrer autre chose : Orbit passe derrière dès la première seconde, le
// canvas cesse d'être redessiné, et la vidéo se retrouve avec une poignée
// d'images au lieu de trente par seconde.
//
// On lève donc le bridage le temps de l'enregistrement, et on le rétablit
// aussitôt après — le laisser désactivé en permanence ferait tourner l'app
// à plein régime alors qu'elle est réduite.
export function setThrottling({ enabled, window } = {}) {
  try {
    window?.webContents?.setBackgroundThrottling(enabled !== false);
    return { success: true, throttling: enabled !== false };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// Position du curseur, en coordonnées système. Appelée à la cadence de
// l'animation : elle doit rester triviale, sans entrée/sortie.
export function cursorPoint() {
  try {
    return screen.getCursorScreenPoint();
  } catch {
    return null;
  }
}

// --- Écriture du fichier ---------------------------------------------------
// Le renderer envoie les octets du conteneur WebM produit par MediaRecorder.
// On écrit via un fichier temporaire puis `rename` : une vidéo de dix minutes
// interrompue à l'écriture ne doit pas laisser un fichier à moitié valide qui
// se lit mal et qu'on croit bon.
export async function saveRecording({ data, name } = {}) {
  if (!data || !data.byteLength) return { success: false, error: 'empty' };
  const dir = recordingDir();
  const safe = String(name || 'orbit.webm').replace(/[/\\]/g, '-');
  const file = uniquePath(path.join(dir, safe));
  try {
    const tmp = `${file}.part`;
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, file);
    await repairDuration(file);
    return { success: true, path: file, bytes: fs.statSync(file).size };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// MediaRecorder écrit un WebM « en direct » : son en-tête ne contient NI durée
// NI index. Les lecteurs l'ouvrent quand même, mais affichent une durée
// inconnue et refusent souvent de se déplacer dans la vidéo — on croit alors
// l'enregistrement abîmé alors qu'il est entier.
//
// Un simple remultiplexage (copie des flux, sans réencodage) réécrit ces
// métadonnées en une poignée de secondes. Facultatif : sans ffmpeg, le fichier
// reste parfaitement lisible, juste moins commode.
function repairDuration(file) {
  if (!hasFfmpeg()) return Promise.resolve(false);
  const fixed = `${file}.fixed.webm`;
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-y', '-fflags', '+genpts', '-i', file, '-c', 'copy', fixed],
      { timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err || !fs.existsSync(fixed) || fs.statSync(fixed).size === 0) {
          // Un repli SILENCIEUX est indiagnosticable : la vidéo sort sans
          // durée et personne ne sait pourquoi. On trace la cause, sans faire
          // échouer l'enregistrement pour autant.
          console.error(
            '[studio] durée non réécrite :',
            String(err?.message || stderr || 'sortie vide').slice(0, 200)
          );
          try {
            fs.unlinkSync(fixed);
          } catch {
            /* rien à nettoyer */
          }
          resolve(false);
          return;
        }
        try {
          fs.renameSync(fixed, file);
          resolve(true);
        } catch {
          resolve(false);
        }
      }
    );
  });
}

function uniquePath(target) {
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(target);
  const base = target.slice(0, -ext.length || undefined);
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

export function revealRecording({ path: target } = {}) {
  if (!target) return { success: false, error: 'no-path' };
  shell.showItemInFolder(target);
  return { success: true };
}

export async function saveRecordingAs({ path: source, window } = {}) {
  if (!source || !fs.existsSync(source)) return { success: false, error: 'no-file' };
  const res = await dialog.showSaveDialog(window || undefined, {
    title: 'Enregistrer la vidéo',
    defaultPath: path.join(app.getPath('downloads'), path.basename(source)),
    filters: [{ name: path.extname(source).slice(1).toUpperCase() || 'Vidéo', extensions: [path.extname(source).slice(1) || 'webm'] }],
  });
  if (res.canceled || !res.filePath) return { success: false, error: 'canceled' };
  try {
    fs.copyFileSync(source, res.filePath);
    return { success: true, path: res.filePath };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// --- Conversion MP4 (facultative) ------------------------------------------
// WebM se lit dans tous les navigateurs mais reste mal accepté par certains
// outils de montage et par les messageries. Quand ffmpeg est présent, on
// propose donc un MP4 — sans jamais l'imposer ni le rendre obligatoire.
let ffmpegChecked = null;

export function hasFfmpeg() {
  if (ffmpegChecked !== null) return ffmpegChecked;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 2500 });
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

export function convertToMp4({ path: source } = {}) {
  if (!source || !fs.existsSync(source)) return Promise.resolve({ success: false, error: 'no-file' });
  if (!hasFfmpeg()) return Promise.resolve({ success: false, error: 'no-ffmpeg' });
  const target = uniquePath(source.replace(/\.webm$/i, '') + '.mp4');
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      [
        '-y',
        '-i', source,
        // H.264 + AAC : le couple qui se lit partout, y compris sur un
        // téléphone et dans les suites de montage courantes.
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '21',
        // Chrominance 4:2:0 : sans ça, QuickTime et plusieurs lecteurs
        // refusent la vidéo produite depuis un canvas.
        '-pix_fmt', 'yuv420p',
        // Dimensions paires exigées par H.264.
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        target,
      ],
      { timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 },
      (err) => {
        if (err) {
          try {
            fs.unlinkSync(target);
          } catch {
            /* rien à nettoyer */
          }
          resolve({ success: false, error: 'convert-failed', detail: String(err.message || err) });
          return;
        }
        resolve({ success: true, path: target, bytes: safeSize(target) });
      }
    );
  });
}

function safeSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
