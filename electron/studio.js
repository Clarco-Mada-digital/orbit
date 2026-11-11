// ---------------------------------------------------------------------------
// Studio d'enregistrement — côté processus principal
//
// Le processus principal ne filme rien : la capture, la composition et
// l'encodage ont lieu dans le renderer (MediaRecorder sur un canvas). Il
// fournit ce que le renderer ne peut pas obtenir seul :
//   • la LISTE des écrans et fenêtres capturables (desktopCapturer) ;
//   • la POSITION DU CURSEUR, qui sert au zoom suivi — une capture d'écran ne
//     contient pas toujours le pointeur, et jamais ses coordonnées ;
//   • l'écriture du fichier final, et sa conversion facultative en MP4 ;
//   • les RACCOURCIS GLOBAUX pendant l'enregistrement (voir plus bas).
//
// Rien n'est enregistré à l'insu de l'utilisateur : toutes ces fonctions sont
// déclenchées par l'interface d'Orbit, jamais par une page.
// ---------------------------------------------------------------------------
import { app, desktopCapturer, screen, shell, dialog, globalShortcut } from 'electron';
import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { keepSegments } from '../src/lib/videoEdit.js';

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
    const screens = sources.filter((s) => s.id.startsWith('screen:'));
    return {
      success: true,
      sources: sources
        // Les fenêtres sans nom sont des surfaces techniques : les proposer
        // n'aiderait personne.
        .filter((s) => s.name && s.name.trim())
        .map((s) => {
          const bounds = s.id.startsWith('screen:') ? screenBounds(s, screens, displays) : null;
          return {
            id: s.id,
            name: s.name,
            kind: s.id.startsWith('screen:') ? 'screen' : 'window',
            thumbnail: s.thumbnail?.toDataURL?.() || null,
            // Bornes de l'écran, pour le zoom suivi du curseur.
            bounds,
          };
        }),
    };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}

// Bornes système d'une source « écran ». `display_id` est souvent VIDE sous
// Linux : sans repli, le studio ignorait où tombait l'écran filmé, et ne
// pouvait ni y replacer les annotations ni masquer sa propre barre — qui
// apparaissait alors dans la vidéo.
//   • identifiant connu → l'écran correspondant ;
//   • une seule source pour plusieurs moniteurs (X11 : « écran entier ») → la
//     zone qui les englobe tous ;
//   • autant de sources que de moniteurs → appariement dans l'ordre.
function screenBounds(source, screens, displays) {
  const byId = displays.find((d) => String(d.id) === String(source.display_id));
  if (byId) return byId.bounds;
  if (displays.length === 0) return null;
  if (screens.length === 1) {
    const left = Math.min(...displays.map((d) => d.bounds.x));
    const top = Math.min(...displays.map((d) => d.bounds.y));
    const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
    const bottom = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  if (screens.length === displays.length) {
    const index = screens.indexOf(source);
    const ordered = [...displays].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    return ordered[index]?.bounds || null;
  }
  return null;
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

export function setPendingSource(id, { audio = false } = {}) {
  if (!id) return { success: false, error: 'no-source' };
  pending = { id, audio: Boolean(audio), at: Date.now() };
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
// `audio` dit si l'utilisateur a demandé AUSSI le son du système : le
// gestionnaire de partage d'écran s'en sert pour demander une boucle audio.
export async function takePendingSource() {
  const token = pending;
  pending = null;
  if (!token || Date.now() - token.at > PENDING_TTL) return null;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const source = sources.find((s) => s.id === token.id) || null;
    return source ? { source, audio: token.audio } : null;
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

// Durée et présence d'une piste audio, lues une seule fois. `ffprobe` arrive
// avec ffmpeg : sans lui, on considère prudemment qu'il n'y a pas d'audio —
// mieux vaut une copie muette qu'un échec après un long ré-encodage.
function probeMedia(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_type',
        '-of', 'json',
        file,
      ],
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );
    const data = JSON.parse(String(out));
    return {
      duration: Number(data?.format?.duration) || 0,
      hasAudio: (data?.streams || []).some((stream) => stream.codec_type === 'audio'),
    };
  } catch {
    return { duration: 0, hasAudio: false };
  }
}

const ffTime = (value) => String(Math.round(Math.max(0, value) * 1000) / 1000);

// --- Édition d'une prise ----------------------------------------------------
// Recadrer le début / la fin, supprimer une ou plusieurs portions AU MILIEU, et
// retirer le son. On écrit TOUJOURS une copie à côté de l'original : une
// édition ne doit jamais détruire la prise brute.
//
// La coupe ré-encode (H.264/AAC) au lieu de copier les flux : un `-c copy` ne
// tombe que sur les images-clés et déplace la coupe de plusieurs secondes.
// Plusieurs portions gardées sont recollées par `concat`, sans réencodage
// supplémentaire.
export function editRecording({ path: source, start = 0, end = 0, mute = false, cuts = [] } = {}) {
  if (!source || !fs.existsSync(source)) {
    return Promise.resolve({ success: false, error: 'no-file' });
  }
  if (!hasFfmpeg()) return Promise.resolve({ success: false, error: 'no-ffmpeg' });

  const info = probeMedia(source);
  const from = Math.max(0, Number(start) || 0);
  const to = Number(end) > 0 ? Number(end) : info.duration;
  if (!(to > from + 0.05)) {
    return Promise.resolve({ success: false, error: 'bad-range' });
  }

  const segments = keepSegments({ start: from, end: to, cuts, duration: info.duration });
  if (segments.length === 0) {
    return Promise.resolve({ success: false, error: 'bad-range' });
  }

  const base = source.replace(/\.[^.]+$/, '');
  const target = uniquePath(`${base} — édité.mp4`);
  const withAudio = !mute && info.hasAudio;
  const kept = segments.reduce((total, segment) => total + (segment.end - segment.start), 0);

  // Un seul morceau : le chemin rapide (décalage à la lecture) suffit.
  const only = segments.length === 1 ? segments[0] : null;
  const args = ['-y'];
  if (only) {
    if (only.start > 0) args.push('-ss', ffTime(only.start));
    args.push('-i', source);
    const length = only.end - only.start;
    if (length > 0) args.push('-t', ffTime(length));
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '21',
      '-pix_fmt', 'yuv420p',
      // Dimensions paires exigées par H.264.
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    );
    if (!withAudio) args.push('-an');
    else args.push('-c:a', 'aac', '-b:a', '160k');
  } else {
    // Plusieurs morceaux : chaque portion est découpée, puis recollée.
    const chains = [];
    segments.forEach((segment, index) => {
      chains.push(
        `[0:v]trim=start=${ffTime(segment.start)}:end=${ffTime(segment.end)},` +
          `setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2[v${index}]`
      );
      if (withAudio) {
        chains.push(
          `[0:a]atrim=start=${ffTime(segment.start)}:end=${ffTime(segment.end)},` +
            `asetpts=PTS-STARTPTS[a${index}]`
        );
      }
    });
    const inputs = segments
      .map((_, index) => `[v${index}]${withAudio ? `[a${index}]` : ''}`)
      .join('');
    chains.push(
      `${inputs}concat=n=${segments.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`
    );
    args.push('-i', source, '-filter_complex', chains.join(';'), '-map', '[v]');
    if (withAudio) args.push('-map', '[a]');
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '21',
      '-pix_fmt', 'yuv420p'
    );
    if (!withAudio) args.push('-an');
    else args.push('-c:a', 'aac', '-b:a', '160k');
  }
  args.push('-movflags', '+faststart', target);

  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      args,
      { timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err || !fs.existsSync(target) || fs.statSync(target).size === 0) {
          try {
            fs.unlinkSync(target);
          } catch {
            /* rien à nettoyer */
          }
          console.error(
            '[studio] édition échouée :',
            String(err?.message || stderr || 'sortie vide').slice(0, 200)
          );
          resolve({ success: false, error: 'edit-failed' });
          return;
        }
        resolve({ success: true, path: target, bytes: safeSize(target), duration: kept });
      }
    );
  });
}

// --- Raccourcis globaux pendant l'enregistrement ---------------------------
//
// Les touches du studio (disposition, fond, coup de zoom, pause, arrêt…) ne
// répondaient que si Orbit avait le focus. Or on filme son écran pour montrer
// AUTRE CHOSE : pendant la prise, le focus est dans l'application démontrée.
// Les raccourcis étaient donc morts au moment précis où ils servent, et il
// fallait revenir sur Orbit — c'est-à-dire sortir du cadre — pour changer quoi
// que ce soit.
//
// Trois décisions, et elles se tiennent :
//
//   • `Alt+Maj+<lettre>` plutôt que la lettre seule. Un raccourci global
//     capte la touche dans TOUTE l'application filmée : enregistrer « D » ou
//     « S » rendrait impossible d'écrire ces lettres ailleurs, ce qui est
//     inacceptable. La combinaison suit celles qu'Orbit s'est déjà réservées.
//   • Enregistrés tant que le studio est ouvert (pas seulement pendant la
//     prise) : on prépare souvent le cadrage en regardant la fenêtre à filmer,
//     donc sans le focus. Libérés à la fermeture — y compris en cas de
//     fermeture brutale (voir releaseStudioKeys, appelé au démontage).
//     Un raccourci global qui survit à ce qui l'a posé est un bogue qu'on
//     découvre des heures plus tard, dans une autre application.
//   • Les touches de l'interface restent actives telles quelles quand Orbit a
//     le focus : ce sont deux chemins vers la même action, et le plus court
//     reste disponible quand on est devant.
const STUDIO_GLOBAL_KEYS = {
  'Alt+Shift+D': 'layout',
  'Alt+Shift+F': 'background',
  'Alt+Shift+X': 'zoomPulse',
  'Alt+Shift+Z': 'zoom',
  'Alt+Shift+O': 'framing',
  'Alt+Shift+C': 'corner',
  'Alt+Shift+P': 'pause',
  'Alt+Shift+K': 'stop',
};

let studioKeysOwner = null;

/**
 * Pose (ou retire) les raccourcis globaux du studio.
 *
 * Rend la liste de ce qui a RÉELLEMENT été enregistré : un gestionnaire de
 * fenêtres peut déjà s'être approprié une combinaison, et l'annoncer dans
 * l'interface alors qu'elle ne répondra pas serait pire que de ne rien
 * proposer.
 */
export function setStudioKeys({ enabled, window } = {}) {
  releaseStudioKeys();
  if (!enabled || !window || window.isDestroyed()) return { success: true, keys: [] };

  const keys = [];
  for (const [accelerator, action] of Object.entries(STUDIO_GLOBAL_KEYS)) {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (window.isDestroyed()) return;
        window.webContents.send('orbit:studio:key', action);
      });
      if (ok) keys.push({ accelerator, action });
    } catch {
      /* combinaison refusée par le système : on continue sans elle */
    }
  }
  studioKeysOwner = keys.length > 0 ? keys : null;
  return { success: true, keys };
}

export function releaseStudioKeys() {
  if (!studioKeysOwner) return;
  for (const { accelerator } of studioKeysOwner) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* déjà libérée */
    }
  }
  studioKeysOwner = null;
}
