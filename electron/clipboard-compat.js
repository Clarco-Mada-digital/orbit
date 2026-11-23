// ---------------------------------------------------------------------------
// Presse-papiers du processus principal, compatible Electron 44+.
//
// Electron 44 a réécrit `clipboard` sur l'API Clipboard du W3C :
//   • `writeImage`, `readImage`, `writeHTML`… n'existent plus ;
//   • `readText()` / `writeText()` renvoient des PROMESSES.
// Le second point est piégeux : `clipboard.readText() === valeur` compare une
// promesse à une chaîne, donc vaut toujours `false` — sans erreur. Le coffre
// ne vidait alors plus jamais un mot de passe copié.
//
// Ce module est le seul endroit qui parle au presse-papiers côté principal :
// tout le reste passe par ces fonctions asynchrones.
// ---------------------------------------------------------------------------
import { clipboard, ClipboardItem } from 'electron';

export async function copyText(text) {
  try {
    await clipboard.writeText(String(text ?? ''));
    return true;
  } catch (err) {
    console.error('[orbit] copie de texte impossible :', err.message);
    return false;
  }
}

export async function readText() {
  try {
    return String((await clipboard.readText()) ?? '');
  } catch {
    return '';
  }
}

export async function clear() {
  try {
    await clipboard.clear();
  } catch {
    /* presse-papiers indisponible : rien à effacer */
  }
}

// `image` : une NativeImage (capturePage, createFromDataURL…).
export async function copyImage(image) {
  try {
    if (!image || image.isEmpty()) return false;
    // Electron < 44 : l'ancienne API reste la plus directe.
    if (typeof clipboard.writeImage === 'function') {
      clipboard.writeImage(image);
      return true;
    }
    const blob = new Blob([image.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (err) {
    console.error('[orbit] copie d’image impossible :', err.message);
    return false;
  }
}
