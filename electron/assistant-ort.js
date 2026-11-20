// ---------------------------------------------------------------------------
// Runtime WASM d'ONNX pour l'assistant local.
//
// POURQUOI CE FICHIER EXISTE : en version empaquetée, l'interface est chargée
// en `file://`. Or le moteur d'inférence doit récupérer deux fichiers
// (`ort-wasm-*.wasm` et son usine `ort-wasm-*.mjs`) : Chromium refuse `fetch()`
// sur une URL `file:` et refuse aussi d'importer un module depuis ce schéma.
// Résultat observé : « no available backend found. ERR: [wasm] [object Event] »
// — le taux d'échec d'un chargement qui n'a jamais eu le droit de commencer.
//
// On les sert donc par le petit serveur HTTP de boucle locale qui sert déjà les
// poids du modèle (voir assistant.js). En développement, la page vient de Vite
// en `http://` : les URL fournies par le bundler marchent déjà, et ce module
// n'est pas sollicité.
//
// Les noms sont hachés par Vite (`ort-wasm-simd-threaded.asyncify-CxOG5pUO.wasm`) :
// on ne les devine pas, on les découvre dans le dossier produit.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const CONTENT_TYPES = {
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// Le dossier produit par `vite build`, à côté de `electron/`.
export function ortAssetDirectory(appDirectory) {
  return path.join(appDirectory, '..', 'dist', 'assets');
}

// Cherche les deux fichiers du runtime. Renvoie leurs noms, jamais un chemin :
// le nom est ensuite cherché dans une liste blanche par le serveur HTTP, ce qui
// interdit toute remontée de répertoire.
export function findOrtAssets(directory) {
  let files;
  try {
    files = fs.readdirSync(directory);
  } catch {
    return null;
  }
  const wasm = files.find((name) => /^ort-wasm[^/\\]*\.wasm$/.test(name));
  const mjs = files.find((name) => /^ort-wasm[^/\\]*\.mjs$/.test(name));
  if (!wasm || !mjs) return null;
  return { wasm, mjs };
}

export function ortAssetType(name) {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

// Un nom demandé est-il l'un des deux fichiers du runtime ?
export function isOrtAsset(name, assets) {
  return Boolean(assets) && (name === assets.wasm || name === assets.mjs);
}

// Réponse HTTP pour `/ort/<nom>` : le nom doit figurer parmi les deux fichiers
// découverts, et le type MIME doit être exact — un wasm annoncé en
// `application/octet-stream` fait échouer `WebAssembly.instantiateStreaming`.
export function serveOrtAsset(name, directory, request, response, headers = {}) {
  const assets = findOrtAssets(directory);
  if (!isOrtAsset(name, assets)) {
    response.writeHead(404, headers).end();
    return;
  }
  const filePath = path.join(directory, name);
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      response.writeHead(404, headers).end();
      return;
    }
    const type = ortAssetType(name);
    if (request.method === 'HEAD') {
      response
        .writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': stat.size })
        .end();
      return;
    }
    response.writeHead(200, {
      ...headers,
      'Content-Type': type,
      'Content-Length': stat.size,
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (error) => {
      if (!['EPIPE', 'ECONNRESET'].includes(error.code)) {
        console.error('[orbit] lecture du runtime ONNX échouée:', error);
      }
      response.destroy(error);
    });
    stream.pipe(response);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[orbit] accès au runtime ONNX échoué:', error);
    }
    if (!response.headersSent) response.writeHead(404, headers).end();
    else response.destroy(error);
  }
}
