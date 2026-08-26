// ---------------------------------------------------------------------------
// Lecture à voix haute — moteur système
//
// POURQUOI PAS L'API DU NAVIGATEUR : « Lire la page » utilisait
// `speechSynthesis` dans la page invitée. C'est la bonne solution sur le
// papier… sauf que le Chromium embarqué dans Electron est compilé SANS le
// support de speech-dispatcher. Sous Linux, `speechSynthesis.getVoices()`
// renvoie donc toujours une liste VIDE, et `speak()` ne fait rien — en silence,
// puisque l'appel n'échoue pas. D'où « ça ne marche pas du tout », sans le
// moindre message. Vérifié : 0 voix, avec comme sans `--enable-speech-dispatcher`,
// alors que `spd-say` fonctionne parfaitement sur la même machine.
//
// On s'adresse donc directement au moteur vocal du système :
//   Linux   : spd-say (speech-dispatcher) puis espeak-ng / espeak en repli
//   macOS   : say (toujours présent)
//   Windows : System.Speech via PowerShell (toujours présent)
//
// Le texte est passé sur l'ENTRÉE STANDARD partout où c'est possible : un
// article de plusieurs milliers de caractères dépasserait la taille maximale
// d'une ligne de commande, et surtout rien de ce que contient la page ne doit
// se retrouver interprété comme un argument.
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'child_process';

// Une seule lecture à la fois : relancer coupe la précédente.
let current = null;
// Lecture programmée mais pas encore lancée (voir CANCEL_SETTLE_MS).
let pending = null;

// speech-dispatcher annule de façon ASYNCHRONE : `spd-say -C` rend la main
// avant que le démon n'ait réellement fait taire la voix. Enchaîner une
// nouvelle lecture immédiatement la faisait donc annuler elle aussi — le
// deuxième clic sur « Lire » restait muet. Mesuré sur speech-dispatcher : 0 ms
// échoue systématiquement, 50 ms suffisent. On prend 150 ms de marge, invisible
// à l'usage et appliqué uniquement quand une lecture était en cours.
const CANCEL_SETTLE_MS = 150;

function has(bin) {
  try {
    return spawnSync('which', [bin], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

let cachedEngine;

// Moteur disponible sur cette machine, ou null. Détecté une fois.
export function detectEngine() {
  if (cachedEngine !== undefined) return cachedEngine;
  if (process.platform === 'darwin') {
    cachedEngine = has('say') ? 'say' : null;
  } else if (process.platform === 'win32') {
    cachedEngine = 'powershell';
  } else if (has('spd-say')) {
    cachedEngine = 'spd-say';
  } else if (has('espeak-ng')) {
    cachedEngine = 'espeak-ng';
  } else if (has('espeak')) {
    cachedEngine = 'espeak';
  } else {
    cachedEngine = null;
  }
  return cachedEngine;
}

// Message d'aide quand aucun moteur n'est installé — dire QUOI installer vaut
// mieux que « indisponible ».
export function missingEngineHint() {
  if (process.platform === 'linux') {
    return "Aucune voix installée. Installez speech-dispatcher (« sudo apt install speech-dispatcher ») ou espeak-ng.";
  }
  return 'Aucune voix système disponible.';
}

export function stop() {
  const wasActive = Boolean(current || pending);
  clearTimeout(pending);
  pending = null;
  if (current) {
    try {
      current.kill('SIGTERM');
    } catch {
      /* déjà terminé */
    }
    current = null;
  }
  // spd-say délègue à un démon : tuer le client ne suffit pas à faire taire la
  // voix, il faut lui demander d'annuler ce qu'il est en train de dire.
  if (wasActive && detectEngine() === 'spd-say') {
    try {
      spawnSync('spd-say', ['-C'], { stdio: 'ignore', timeout: 2000 });
    } catch {
      /* ignore */
    }
  }
  return { success: true, wasActive };
}

// `lang` : code court ('fr', 'en'…) quand le moteur sait en tenir compte.
export function speak(text, { lang = 'fr' } = {}) {
  const content = String(text || '').trim().slice(0, 40000);
  if (!content) return { success: false, error: 'empty' };

  const engine = detectEngine();
  if (!engine) return { success: false, error: 'no-engine', hint: missingEngineHint() };

  const { wasActive } = stop();

  // Une lecture était en cours sur speech-dispatcher : on laisse l'annulation
  // se propager avant de relancer, sinon le démon annule aussi la nouvelle.
  if (engine === 'spd-say' && wasActive) {
    pending = setTimeout(() => {
      pending = null;
      launch(engine, content, lang);
    }, CANCEL_SETTLE_MS);
    return { success: true, engine };
  }

  return launch(engine, content, lang) ? { success: true, engine } : { success: false, error: 'spawn-failed' };
}

// Démarre réellement le processus. Renvoie true si le lancement a abouti.
function launch(engine, content, lang) {
  try {
    if (engine === 'say') {
      current = spawn('say', ['-f', '-'], { stdio: ['pipe', 'ignore', 'ignore'] });
      current.stdin.end(content, 'utf8');
    } else if (engine === 'powershell') {
      // Le texte transite par l'entrée standard puis est lu en UTF-8 : le
      // coller dans le script exposerait aux guillemets et retours à la ligne
      // du contenu de la page.
      const script =
        "$t = [Console]::In.ReadToEnd(); " +
        'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        '$s.Speak($t)';
      current = spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { stdio: ['pipe', 'ignore', 'ignore'] }
      );
      current.stdin.end(content, 'utf8');
    } else if (engine === 'spd-say') {
      // -e : lit l'entrée standard. -w : attend la fin (le processus reste
      // vivant, donc « Arrêter » a quelque chose à tuer).
      current = spawn('spd-say', ['-l', lang, '-e', '-w'], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      current.stdin.end(content, 'utf8');
    } else {
      // espeak-ng / espeak : « --stdin » évite la limite de longueur d'argument.
      current = spawn(engine, ['-v', lang, '--stdin'], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      current.stdin.end(content, 'utf8');
    }
  } catch {
    current = null;
    return false;
  }

  const proc = current;
  // Un tuyau fermé par la mort du processus ne doit pas faire tomber Orbit.
  proc.stdin?.on('error', () => {});
  proc.on('error', () => {
    if (current === proc) current = null;
  });
  proc.on('exit', () => {
    if (current === proc) current = null;
  });

  return true;
}

export function isSpeaking() {
  return Boolean(current || pending);
}
