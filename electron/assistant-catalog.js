import crypto from 'node:crypto';

const MAX_MODELS = 30;
const MAX_WEIGHT_SIZE = 3 * 1024 ** 3;
const MIN_WEIGHT_SIZE = 16 * 1024 ** 2;
const ALLOWED_FILES = new Set([
  'added_tokens.json',
  'chat_template.jinja',
  'config.json',
  'generation_config.json',
  'merges.txt',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
]);
const WEIGHT_FILE = 'onnx/model_q4.onnx';
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const REVISION_PATTERN = /^[a-f0-9]{40}$/i;
const REPOSITORY_PATTERN = /^onnx-community\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function isValidCandidate(candidate) {
  if (
    !candidate ||
    !REPOSITORY_PATTERN.test(candidate.id) ||
    !REVISION_PATTERN.test(candidate.sha) ||
    !Array.isArray(candidate.siblings)
  ) {
    return false;
  }
  const files = new Set(candidate.siblings.map((file) => file.rfilename));
  return files.has(WEIGHT_FILE)
    && !files.has(`${WEIGHT_FILE}_data`)
    && files.has('config.json')
    && files.has('tokenizer.json')
    && !/(?:tiny|random)/i.test(candidate.id);
}

function modelKeyFor(id) {
  // SHA-1 sert ici d'IDENTIFIANT COURT et stable pour un identifiant de modèle
  // public, pas de preuve : rien n'est authentifié avec, et une collision
  // donnerait au pire deux modèles au même emplacement de cache. Passer à
  // SHA-256 changerait toutes les clés et ferait retélécharger les poids déjà
  // présents, pour aucun gain réel.
  // argus-ignore SEC-WEAK-HASH
  return `hf-${crypto.createHash('sha1').update(id).digest('hex').slice(0, 12)}`;
}

function buildModel(candidate, weight) {
  if (
    !Number.isSafeInteger(weight?.size) ||
    weight.size < MIN_WEIGHT_SIZE ||
    weight.size > MAX_WEIGHT_SIZE ||
    !SHA256_PATTERN.test(weight.lfs?.oid || '')
  ) return null;

  const availableFiles = candidate.siblings
    .map((file) => file.rfilename)
    .filter((name) => ALLOWED_FILES.has(name));
  if (!availableFiles.includes('config.json') || !availableFiles.includes('tokenizer.json')) return null;

  const name = candidate.id.split('/')[1].replace(/-ONNX$/i, '').replace(/[-_]+/g, ' ');
  const sizeGb = weight.size / (1024 ** 3);
  return {
    key: modelKeyFor(candidate.id),
    id: candidate.id,
    revision: candidate.sha,
    weight: WEIGHT_FILE,
    size: weight.size,
    sha256: weight.lfs.oid.toLowerCase(),
    label: name,
    files: availableFiles,
    minRamGb: Math.max(0.5, Math.ceil(sizeGb * 1.5 * 10) / 10),
    recommendedRamGb: Math.max(1, Math.ceil(sizeGb * 2.2 * 10) / 10),
    minFreeRamGb: Math.max(0.3, Math.ceil(sizeGb * 1.3 * 10) / 10),
    requiresWebGPU: false,
  };
}

export function isValidDiscoveredAssistantModel(model) {
  if (!model || typeof model.id !== 'string' || typeof model.revision !== 'string') return false;
  return Boolean(
    model &&
    model.key === modelKeyFor(model.id) &&
    REPOSITORY_PATTERN.test(model.id) &&
    REVISION_PATTERN.test(model.revision) &&
    model.weight === WEIGHT_FILE &&
    Number.isSafeInteger(model.size) &&
    model.size >= MIN_WEIGHT_SIZE &&
    model.size <= MAX_WEIGHT_SIZE &&
    SHA256_PATTERN.test(model.sha256 || '') &&
    Array.isArray(model.files) &&
    model.files.includes('config.json') &&
    model.files.includes('tokenizer.json') &&
    model.files.every((file) => ALLOWED_FILES.has(file)) &&
    typeof model.label === 'string' &&
    model.label.length > 0
  );
}

export async function discoverCompatibleAssistantModels(fetchImpl = globalThis.fetch, excludedIds = []) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');

  const endpoint = new URL('https://huggingface.co/api/models');
  endpoint.searchParams.set('author', 'onnx-community');
  endpoint.searchParams.set('pipeline_tag', 'text-generation');
  endpoint.searchParams.set('sort', 'downloads');
  endpoint.searchParams.set('direction', '-1');
  endpoint.searchParams.set('limit', String(MAX_MODELS * 2));
  endpoint.searchParams.append('expand[]', 'siblings');
  endpoint.searchParams.append('expand[]', 'sha');

  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Model catalog request failed (HTTP ${response.status})`);
  const candidates = await response.json();
  if (!Array.isArray(candidates)) throw new Error('Model catalog response has an invalid format');

  const excluded = new Set(excludedIds);
  const compatible = candidates
    .filter((candidate) => !excluded.has(candidate.id) && isValidCandidate(candidate))
    .slice(0, MAX_MODELS);

  const results = [];
  let nextCandidate = 0;
  const workers = Array.from({ length: Math.min(4, compatible.length) }, async () => {
    while (nextCandidate < compatible.length) {
      const candidate = compatible[nextCandidate];
      nextCandidate += 1;
      const treeUrl = `https://huggingface.co/api/models/${candidate.id}/tree/${candidate.sha}/onnx?recursive=false&expand=true`;
      const treeResponse = await fetchImpl(treeUrl, { signal: AbortSignal.timeout(15000) });
      if (treeResponse.status === 404) continue;
      if (!treeResponse.ok) {
        throw new Error(`Model metadata request failed (HTTP ${treeResponse.status})`);
      }
      const files = await treeResponse.json();
      if (!Array.isArray(files)) throw new Error('Model file metadata has an invalid format');
      const weight = files.find((file) => file.path === WEIGHT_FILE && file.type === 'file');
      const model = buildModel(candidate, weight);
      if (model) results.push(model);
    }
  });
  await Promise.all(workers);
  return results;
}
