// ---------------------------------------------------------------------------
// Ouverture d'une base KeePass (.kdbx) — déchiffrement
//
// Lit le fichier directement, sans que KeePassXC tourne ni qu'Orbit lui soit
// associé. C'est la voie complète : toutes les entrées, y compris celles sans
// URL, que le protocole navigateur ne peut pas rendre.
//
// Deux points techniques :
//   • KDBX 4 (le format par défaut de KeePassXC depuis la 2.6) dérive sa clé
//     avec Argon2, que Node n'implémente pas. kdbxweb demande donc qu'on lui
//     fournisse une implémentation — ici hash-wasm, en WebAssembly, sans
//     binaire natif à compiler pour chaque plateforme.
//   • Le mot de passe maître de la base n'est utilisé QUE pour l'ouverture, et
//     n'est jamais conservé : il arrive de l'interface, sert à dériver la clé,
//     puis disparaît avec la fonction. La base, elle, n'est jamais réécrite —
//     on l'ouvre en lecture seule.
// ---------------------------------------------------------------------------
import fs from 'fs';
import kdbxweb from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';
import { collectRows, categoriesFrom } from './kdbx-entries.js';

// kdbxweb délègue Argon2 : sans ce branchement, toute base KDBX 4 échoue avec
// « argon2 not implemented ». Les types suivent la spécification KDBX
// (0 = Argon2d, 2 = Argon2id).
let argon2Ready = false;

function installArgon2() {
  if (argon2Ready) return;
  kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
    const common = {
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      iterations,
      parallelism,
      hashLength: length,
      // hash-wasm attend des kibioctets, comme la spécification KDBX.
      memorySize: memory,
      outputType: 'binary',
    };
    const digest = type === 2 ? await argon2id(common) : await argon2d(common);
    return new Uint8Array(digest);
  });
  argon2Ready = true;
}

// Codes d'erreur de kdbxweb traduits en codes stables pour l'interface : une
// base refusée doit dire POURQUOI (mot de passe faux, fichier clé manquant,
// fichier corrompu), pas afficher un message anglais d'une bibliothèque.
function mapError(err) {
  const code = err?.code || '';
  if (code === kdbxweb.Consts.ErrorCodes.InvalidKey) return 'bad-password';
  if (code === kdbxweb.Consts.ErrorCodes.BadSignature) return 'not-a-kdbx';
  if (code === kdbxweb.Consts.ErrorCodes.Unsupported) return 'unsupported-kdbx';
  if (code === kdbxweb.Consts.ErrorCodes.FileCorrupt) return 'corrupt-kdbx';
  return 'kdbx-failed';
}

// Ouvre la base et rend des lignes d'import prêtes pour le coffre.
// `keyFilePath` est facultatif : certaines bases exigent un fichier clé en
// plus du mot de passe, et sans lui l'ouverture échoue avec « mot de passe
// incorrect », ce qui serait trompeur.
export async function readDatabase({ path, password, keyFilePath } = {}) {
  if (!path) return { success: false, error: 'no-file' };
  installArgon2();

  let data;
  let keyFile;
  try {
    data = fs.readFileSync(path);
    if (keyFilePath) keyFile = new Uint8Array(fs.readFileSync(keyFilePath));
  } catch {
    return { success: false, error: 'unreadable' };
  }

  // kdbxweb veut un ArrayBuffer exact : un Buffer Node partage souvent un
  // pool plus grand, et `buffer.buffer` embarquerait les octets voisins.
  const bytes = new Uint8Array(data).slice().buffer;

  let db;
  try {
    const credentials = new kdbxweb.Credentials(
      kdbxweb.ProtectedValue.fromString(String(password ?? '')),
      keyFile || null
    );
    db = await kdbxweb.Kdbx.load(bytes, credentials);
  } catch (err) {
    return { success: false, error: mapError(err) };
  }

  const recycleBinUuid = db.meta?.recycleBinEnabled ? db.meta?.recycleBinUuid : null;
  const { rows, skipped } = collectRows(db.getDefaultGroup(), { recycleBinUuid });
  return {
    success: true,
    rows,
    categories: categoriesFrom(rows),
    total: rows.length,
    skipped,
    name: db.meta?.name || '',
  };
}
