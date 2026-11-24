// ---------------------------------------------------------------------------
// Chiffrement par le trousseau du système (safeStorage), en ASYNCHRONE.
//
// Electron 45 a déprécié `encryptString` / `decryptString` /
// `isEncryptionAvailable` (synchrones) ; Electron 46 les supprime. Tout le
// chiffrement d'Orbit (coffre-fort, verrouillage, KeePassXC, clés d'IA,
// connexions SQL, phrase de synchronisation) passe désormais par ce module.
//
// Compatibilité des données, vérifiée sur Electron 45 : l'API asynchrone
// produit le même format (préfixe « v11 ») et relit ce que l'ancienne API a
// écrit, et inversement. Aucun secret existant ne devient illisible.
//
// Piège : `decryptStringAsync` renvoie { result, shouldReEncrypt }, pas une
// chaîne. `decrypt` ci-dessous rend toujours la chaîne.
// ---------------------------------------------------------------------------
import { safeStorage } from 'electron';

const hasAsync = typeof safeStorage.encryptStringAsync === 'function';

export async function isAvailable() {
  try {
    if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
      return Boolean(await safeStorage.isAsyncEncryptionAvailable());
    }
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export async function encrypt(text) {
  const value = String(text ?? '');
  return hasAsync ? safeStorage.encryptStringAsync(value) : safeStorage.encryptString(value);
}

export async function decrypt(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!hasAsync) return safeStorage.decryptString(buf);
  const out = await safeStorage.decryptStringAsync(buf);
  return typeof out === 'string' ? out : String(out?.result ?? '');
}

// Formes base64, pour les secrets rangés dans des fichiers JSON.
export const encryptToBase64 = async (text) => (await encrypt(text)).toString('base64');
export const decryptFromBase64 = (b64) => decrypt(Buffer.from(String(b64), 'base64'));
