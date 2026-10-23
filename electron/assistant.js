import { app, net } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { assistantModelCorsHeaders } from './assistant-cors.js';

const MODEL_FILES = [
  'added_tokens.json',
  'chat_template.jinja',
  'config.json',
  'generation_config.json',
  'merges.txt',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
];

export const ASSISTANT_MODELS = {
  'smollm2-360m': {
    id: 'onnx-community/SmolLM2-360M-Instruct-ONNX',
    revision: 'fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9',
    weight: 'onnx/model_q4.onnx',
    size: 386495938,
    sha256: '77b81bc8d2cb60c23a3399acba67dfa241d073764a4d1bdcce479747fb794aa6',
    label: 'SmolLM2 360M',
    files: [
      'config.json',
      'generation_config.json',
      'merges.txt',
      'special_tokens_map.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'vocab.json',
    ],
    minRamGb: 4,
    recommendedRamGb: 5.5,
    minFreeRamGb: 1.5,
    requiresWebGPU: false,
  },
  'qwen3-0.6b': {
    id: 'onnx-community/Qwen3-0.6B-ONNX',
    revision: '558750086ed49d78cb701ed6fa85af33fd16453f',
    weight: 'onnx/model_q4.onnx',
    size: 919096585,
    sha256: 'd43d836fc5e240df9013733ccd214972c5d21bd9ec47e574e4f1e359cf90aed0',
    label: 'Qwen3 0.6B',
    minRamGb: 6,
    recommendedRamGb: 7.2,
    minFreeRamGb: 3,
    requiresWebGPU: false,
  },
  'qwen3-1.7b': {
    id: 'onnx-community/Qwen3-1.7B-ONNX',
    revision: 'e1da89f753284b95bd0971c64524f52edc5eb6e3',
    weight: 'onnx/model_q4f16.onnx',
    size: 1426069098,
    sha256: 'fb85b44defdf43ace50c7a4937127e889b9f8a0483eb87a6c4151a815c5da3b5',
    label: 'Qwen3 1.7B',
    minRamGb: 24,
    recommendedRamGb: 32,
    minFreeRamGb: 12,
    requiresWebGPU: true,
  },
};

let root;
let installPromise = null;
let progressReporter = () => {};
let modelServer;
let modelServerStart;

export function setAssistantProgressReporter(reporter) {
  if (typeof reporter !== 'function') throw new TypeError('Progress reporter must be a function');
  progressReporter = reporter;
}

function modelRoot() {
  if (!root) root = path.join(app.getPath('userData'), 'orbit-assistant');
  return root;
}

function modelPath(modelKey) {
  const model = ASSISTANT_MODELS[modelKey];
  if (!model) throw new RangeError(`Unknown Orbit assistant model: ${modelKey}`);
  return path.join(modelRoot(), model.id);
}

function markerPath(modelKey) {
  return path.join(modelPath(modelKey), 'orbit-model.json');
}

export function getAssistantState() {
  const cpus = os.cpus();
  return {
    success: true,
    models: Object.fromEntries(
      Object.entries(ASSISTANT_MODELS).map(([key, model]) => {
        let installed = false;
        try {
          const marker = JSON.parse(fs.readFileSync(markerPath(key), 'utf8'));
          const weights = path.join(modelPath(key), model.weight);
          installed =
            marker.revision === model.revision &&
            fs.statSync(weights).size === model.size;
        } catch {
          installed = false;
        }
        return [key, {
          id: model.id,
          label: model.label,
          size: model.size,
          installed,
          minRamGb: model.minRamGb,
          recommendedRamGb: model.recommendedRamGb,
          minFreeRamGb: model.minFreeRamGb,
          requiresWebGPU: model.requiresWebGPU,
        }];
      })
    ),
    hardware: {
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpuCores: cpus.length,
      cpuModel: cpus[0]?.model || '',
      platform: process.platform,
      arch: process.arch,
    },
    downloading: Boolean(installPromise),
  };
}

function serveModelFile(request, response) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
    ...assistantModelCorsHeaders(request.headers.origin),
  };
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers).end();
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, headers).end();
    return;
  }

  let segments;
  try {
    segments = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      .split('/')
      .filter(Boolean);
  } catch {
    response.writeHead(400, headers).end();
    return;
  }
  const [modelKey, ...requested] = segments;
  const model = ASSISTANT_MODELS[modelKey];
  if (!model) {
    response.writeHead(404, headers).end();
    return;
  }
  const modelPrefix = model.id.split('/');
  if (modelPrefix.some((part, index) => requested[index] !== part)) {
    response.writeHead(404, headers).end();
    return;
  }
  const file = requested.slice(modelPrefix.length).join('/');
  if (![...(model.files || MODEL_FILES), model.weight].includes(file) || !getAssistantState().models[modelKey].installed) {
    response.writeHead(404, headers).end();
    return;
  }

  const directory = modelPath(modelKey);
  const filePath = path.resolve(directory, file);
  if (!filePath.startsWith(`${directory}${path.sep}`)) {
    response.writeHead(404, headers).end();
    return;
  }
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      response.writeHead(404, headers).end();
      return;
    }

    if (request.method === 'HEAD') {
      response.writeHead(200, { ...headers, 'Content-Length': stat.size }).end();
      return;
    }

    const range = request.headers.range;
    let start = 0;
    let end = stat.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
      } else {
        const suffixLength = Number(match[2]);
        start = Math.max(0, stat.size - suffixLength);
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        start >= stat.size
      ) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }).end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      response.writeHead(206, {
        ...headers,
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      });
    } else {
      response.writeHead(200, { ...headers, 'Content-Length': stat.size });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (error) => {
      if (!['EPIPE', 'ECONNRESET'].includes(error.code)) {
        console.error('[orbit] lecture du fichier de modèle local échouée:', error);
      }
      response.destroy(error);
    });
    stream.pipe(response);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[orbit] accès au fichier de modèle local échoué:', error);
    }
    if (!response.headersSent) response.writeHead(404, headers).end();
    else response.destroy(error);
  }
}

async function ensureModelServer() {
  if (modelServer?.listening) {
    const address = modelServer.address();
    return `http://127.0.0.1:${address.port}/`;
  }
  if (!modelServerStart) {
    modelServerStart = new Promise((resolve, reject) => {
      const server = createServer(serveModelFile);
      modelServer = server;
      server.once('error', (error) => {
        modelServer = null;
        modelServerStart = null;
        reject(error);
      });
      server.listen(0, '127.0.0.1', () => {
        server.unref();
        const address = server.address();
        resolve(`http://127.0.0.1:${address.port}/`);
      });
    });
  }
  return modelServerStart;
}

export async function getAssistantModelBaseUrl(modelKey) {
  if (!ASSISTANT_MODELS[modelKey]) return { success: false, error: 'unknown-model' };
  if (!getAssistantState().models[modelKey].installed) {
    return { success: false, error: 'model-not-installed' };
  }
  try {
    const baseUrl = await ensureModelServer();
    return { success: true, url: `${baseUrl}${encodeURIComponent(modelKey)}/` };
  } catch (error) {
    console.error('[orbit] serveur local du modèle assistant indisponible:', error);
    return { success: false, error: 'model-server-unavailable' };
  }
}

function reportProgress(modelKey, phase, file, fileIndex, fileCount, received, total) {
  progressReporter({ modelKey, phase, file, fileIndex, fileCount, received, total });
}

async function downloadFile(modelKey, model, file, fileIndex, fileCount) {
  const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}?download=true`;
  const destination = path.join(modelPath(modelKey), file);
  const temporary = `${destination}.part`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const response = await net.fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} — ${file}`);
  const contentLength = Number(response.headers.get('content-length')) || 0;
  if (file === model.weight && contentLength && contentLength !== model.size) {
    throw new Error(`Unexpected model size for ${model.label}`);
  }

  const output = fs.createWriteStream(temporary);
  const hash = file === model.weight ? crypto.createHash('sha256') : null;
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      hash?.update(chunk);
      if (!output.write(chunk)) await new Promise((resolve, reject) => {
        output.once('drain', resolve);
        output.once('error', reject);
      });
      reportProgress(modelKey, 'download', file, fileIndex, fileCount, received, contentLength);
    }
    await new Promise((resolve, reject) => {
      output.once('error', reject);
      output.end(resolve);
    });

    if (file === model.weight && (received !== model.size || hash.digest('hex') !== model.sha256)) {
      throw new Error(`Model integrity check failed for ${model.label}`);
    }
    fs.renameSync(temporary, destination);
  } catch (error) {
    response.body?.cancel().catch(() => {});
    output.destroy();
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

export async function installAssistantModel(modelKey) {
  if (installPromise) return { success: false, error: 'busy' };
  const model = ASSISTANT_MODELS[modelKey];
  if (!model) return { success: false, error: 'unknown-model' };
  if (getAssistantState().models[modelKey].installed) return { success: true, alreadyInstalled: true };

  installPromise = (async () => {
    try {
      const files = [...(model.files || MODEL_FILES), model.weight];
      for (let index = 0; index < files.length; index += 1) {
        await downloadFile(modelKey, model, files[index], index + 1, files.length);
      }
      if (modelKey === 'qwen3-0.6b') {
        try {
          fs.unlinkSync(path.join(modelPath(modelKey), 'onnx/model_q4f16.onnx'));
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.error('[orbit] nettoyage de l’ancien fichier de modèle échoué:', error);
          }
        }
      }
      fs.writeFileSync(
        markerPath(modelKey),
        JSON.stringify({ modelKey, revision: model.revision, installedAt: new Date().toISOString() })
      );
      return { success: true };
    } catch (error) {
      console.error('[orbit] téléchargement du modèle local échoué:', error);
      return { success: false, error: String(error.message || error) };
    } finally {
      installPromise = null;
    }
  })();

  return installPromise;
}

export async function removeAssistantModel(modelKey) {
  const model = ASSISTANT_MODELS[modelKey];
  if (!model) return { success: false, error: 'unknown-model' };
  if (installPromise) return { success: false, error: 'busy' };

  const destination = modelPath(modelKey);
  const parent = modelRoot();
  if (path.dirname(destination) !== path.join(parent, path.dirname(model.id))) {
    return { success: false, error: 'unsafe-path' };
  }
  try {
    if (fs.existsSync(destination)) {
      const stat = fs.lstatSync(destination);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { success: false, error: 'unsafe-path' };
      fs.rmSync(destination, { recursive: true });
    }
    return { success: true };
  } catch (error) {
    console.error('[orbit] suppression du modèle local échouée:', error);
    return { success: false, error: String(error.message || error) };
  }
}
