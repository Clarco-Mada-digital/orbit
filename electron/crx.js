import fs from 'fs';
import path from 'path';
import extract from 'extract-zip';

// Dézippe un .crx (v2 ou v3) dans destDir et renvoie le dossier dépaqueté.
// Electron ne charge QUE des extensions non empaquetées, donc on extrait nous-mêmes
// le contenu du .crx (qui est un ZIP avec un en-tête propre au format CRX).
export async function unpackCrx(crxPath, destDir) {
  const buf = fs.readFileSync(crxPath);
  if (buf.length < 16 || buf.toString('utf8', 0, 4) !== 'Cr24') {
    throw new Error('Fichier .crx invalide (en-tête Cr24 manquant)');
  }
  const version = buf.readUInt32LE(4);
  let zipStart;
  if (version === 2) {
    const pubkeyLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    zipStart = 16 + pubkeyLen + sigLen;
  } else if (version === 3) {
    const headerLen = buf.readUInt32LE(8);
    zipStart = 12 + headerLen;
  } else {
    throw new Error(`Version .crx non supportée (${version})`);
  }
  if (zipStart >= buf.length) throw new Error('Fichier .crx corrompu');

  fs.mkdirSync(destDir, { recursive: true });
  const tmpZip = path.join(path.dirname(destDir), `.orbit-crx-${Date.now()}.zip`);
  fs.writeFileSync(tmpZip, buf.subarray(zipStart));
  try {
    await extract(tmpZip, { dir: destDir });
  } finally {
    try {
      fs.unlinkSync(tmpZip);
    } catch {
      /* ignore */
    }
  }
  return destDir;
}
