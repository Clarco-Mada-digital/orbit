import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import yauzl from 'yauzl';

const fromBuffer = promisify(yauzl.fromBuffer);

// Dézippe un .crx (v2 ou v3) dans destDir et renvoie le dossier dépaqueté.
// Electron ne charge QUE des extensions non empaquetées, donc on extrait nous-mêmes
// le contenu du .crx (qui est un ZIP avec un en-tête propre au format CRX).
//
// Sécurité (le .crx vient du Chrome Web Store ou d'un fichier utilisateur, donc
// NON fiable) : on extrait avec yauzl en REFUSANT
//   • les entrées « symlink » (vecteur de la faille extract-zip GHSA-jmr9-…),
//   • les chemins qui s'échappent du dossier cible (« ../ », chemins absolus).
// C'est ce qui remplace extract-zip (non maintenu, faille sans correctif).
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
  const zipBuffer = buf.subarray(zipStart);
  const destRoot = path.resolve(destDir);

  const zipfile = await fromBuffer(zipBuffer, { lazyEntries: true });

  await new Promise((resolve, reject) => {
    zipfile.on('error', reject);
    zipfile.on('end', resolve);
    zipfile.readEntry();

    zipfile.on('entry', (entry) => {
      try {
        // Refus des chemins qui s'échappent du dossier cible
        const target = path.resolve(destRoot, entry.fileName);
        const rel = path.relative(destRoot, target);
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(`Entrée .crx suspecte (chemin) : ${entry.fileName}`);
        }

        // Refus des symlinks (mode Unix S_IFLNK dans les attributs externes)
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0xf000) === 0xa000) {
          throw new Error(`Entrée .crx suspecte (symlink) : ${entry.fileName}`);
        }

        // Dossier
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true });
          zipfile.readEntry();
          return;
        }

        // Fichier : écrire dans le dossier cible
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zipfile.openReadStream(entry, (err, stream) => {
          if (err) return reject(err);
          const out = fs.createWriteStream(target);
          out.on('error', reject);
          stream.on('error', reject);
          out.on('finish', () => zipfile.readEntry());
          stream.pipe(out);
        });
      } catch (err) {
        reject(err);
      }
    });
  });

  return destDir;
}
