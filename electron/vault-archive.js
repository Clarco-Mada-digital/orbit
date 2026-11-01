// ---------------------------------------------------------------------------
// Archive chiffrée d'un trousseau (export / import « sauvegarde »)
//
// L'export CSV/JSON existe pour MIGRER vers un autre gestionnaire : il est en
// clair, c'est inhérent au format. Ce module couvre l'autre besoin, le plus
// courant : SAUVEGARDER son trousseau (clé USB, disque externe, cloud) sans
// poser ses mots de passe en clair sur le support.
//
// Le fichier est un enveloppe JSON :
//   • en-tête en CLAIR : format, version, paramètres scrypt, date, nombre
//     d'entrées. Assez pour qu'un import sache quoi faire d'un fichier, et
//     pour qu'on puisse encore l'ouvrir dans dix ans. Aucun secret dedans.
//   • contenu en AES-256-GCM, clé dérivée par scrypt de la PHRASE DE PASSE
//     choisie à l'export. L'en-tête est lié au chiffré par l'AAD : on ne peut
//     pas recoller l'en-tête d'une archive sur le contenu d'une autre.
//
// Le module n'utilise QUE des modules natifs de Node : il est testable sans
// Electron ni dépendance installée.
// ---------------------------------------------------------------------------
import crypto from 'crypto';

export const ARCHIVE_FORMAT = 'orbit-vault-archive';
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_EXTENSION = 'orbitvault';

// Mêmes paramètres que le coffre lui-même (~33 Mo, ~100 ms) : une archive
// volée coûte aussi cher à attaquer que le trousseau d'origine.
const KDF = { algo: 'scrypt', N: 32768, r: 8, p: 1, len: 32 };
const MAXMEM = 96 * 1024 * 1024;

export const MIN_PASSPHRASE_LENGTH = 8;

function deriveKey(passphrase, kdf) {
  return crypto.scryptSync(
    Buffer.from(String(passphrase), 'utf8'),
    Buffer.from(kdf.salt, 'hex'),
    kdf.len || KDF.len,
    { N: kdf.N || KDF.N, r: kdf.r || KDF.r, p: kdf.p || KDF.p, maxmem: MAXMEM }
  );
}

const aad = (header) => Buffer.from(`${header.format}|${header.v}`, 'utf8');

// `payload` : { entries: [...], categories: [...] } — la forme interne du
// trousseau, historique des mots de passe compris. Une archive restitue donc
// le trousseau tel quel, pas une version appauvrie comme le CSV.
export function sealArchive({ passphrase, payload, meta = {} } = {}) {
  if (String(passphrase || '').length < MIN_PASSPHRASE_LENGTH) {
    throw Object.assign(new Error('passphrase trop courte'), { code: 'weak-passphrase' });
  }
  const header = {
    format: ARCHIVE_FORMAT,
    v: ARCHIVE_VERSION,
    cipher: 'aes-256-gcm',
    kdf: { ...KDF, salt: crypto.randomBytes(16).toString('hex') },
    exportedAt: meta.exportedAt || Date.now(),
    vaultName: meta.vaultName || '',
    entryCount: Array.isArray(payload?.entries) ? payload.entries.length : 0,
  };
  const key = deriveKey(passphrase, header.kdf);
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(header));
    const data = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
      cipher.final(),
    ]);
    return {
      ...header,
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

// Reconnaît une archive avant de demander la phrase de passe : une erreur
// « ce fichier n'est pas une archive Orbit » vaut mieux qu'un « mauvais mot de
// passe » trompeur.
export function isArchive(envelope) {
  return Boolean(
    envelope &&
      envelope.format === ARCHIVE_FORMAT &&
      envelope.iv &&
      envelope.tag &&
      typeof envelope.data === 'string'
  );
}

export function openArchive({ passphrase, envelope } = {}) {
  if (!isArchive(envelope)) {
    throw Object.assign(new Error('archive non reconnue'), { code: 'not-an-archive' });
  }
  if (Number(envelope.v) > ARCHIVE_VERSION) {
    // Une version future peut avoir changé le chiffrement : mieux vaut le dire
    // que de déchiffrer de travers.
    throw Object.assign(new Error('archive trop récente'), { code: 'unsupported-version' });
  }
  if (!envelope.kdf?.salt) {
    throw Object.assign(new Error('archive incomplète'), { code: 'not-an-archive' });
  }
  const key = deriveKey(passphrase, envelope.kdf);
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'hex')
    );
    decipher.setAAD(aad(envelope));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    const payload = JSON.parse(plain.toString('utf8'));
    return {
      entries: Array.isArray(payload?.entries) ? payload.entries : [],
      categories: Array.isArray(payload?.categories) ? payload.categories : [],
    };
  } catch (err) {
    if (err.code === 'not-an-archive' || err.code === 'unsupported-version') throw err;
    // Échec d'authentification GCM : mauvaise phrase de passe, ou fichier
    // abîmé. On ne distingue pas les deux (ça ne renseignerait qu'un
    // attaquant), exactement comme au déverrouillage d'un trousseau.
    throw Object.assign(new Error('phrase de passe incorrecte'), { code: 'bad-passphrase' });
  } finally {
    key.fill(0);
  }
}
