import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  discoverCompatibleAssistantModels,
  isValidDiscoveredAssistantModel,
} from '../electron/assistant-catalog.js';

const revision = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function candidate(id, siblings = ['config.json', 'tokenizer.json', 'onnx/model_q4.onnx']) {
  return {
    id: `onnx-community/${id}`,
    sha: revision,
    siblings: siblings.map((rfilename) => ({
      rfilename,
      size: rfilename === 'onnx/model_q4.onnx' ? 100_000_000 : 1000,
      ...(rfilename === 'onnx/model_q4.onnx' ? { lfs: { oid: digest } } : {}),
    })),
  };
}

test('model discovery only returns pinned, hash-verifiable compatible ONNX models', async () => {
  let requestUrl;
  const fetchMock = async (url) => {
    const request = new URL(url);
    if (request.pathname.includes('/tree/')) {
      const name = decodeURIComponent(request.pathname.split('/')[3]);
      return {
        ok: true,
        json: async () => [{
          type: 'file',
          path: 'onnx/model_q4.onnx',
          size: 100_000_000,
          lfs: { oid: digest },
          name,
        }],
      };
    }
    requestUrl = request;
    return {
      ok: true,
      json: async () => [
        candidate('Good-Model-ONNX'),
        candidate('Known-Model'),
        candidate('Missing-Tokenizer', ['config.json', 'onnx/model_q4.onnx']),
        candidate('Wrong-Quantization', ['config.json', 'tokenizer.json', 'onnx/model_fp16.onnx']),
        candidate('External-Data', [
          'config.json',
          'tokenizer.json',
          'onnx/model_q4.onnx',
          'onnx/model_q4.onnx_data',
        ]),
        candidate('Tiny-Random-Model'),
      ],
    };
  };

  const models = await discoverCompatibleAssistantModels(fetchMock, ['onnx-community/Known-Model']);
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'onnx-community/Good-Model-ONNX');
  assert.equal(models[0].revision, revision);
  assert.equal(models[0].weight, 'onnx/model_q4.onnx');
  assert.equal(models[0].sha256, digest);
  assert.equal(isValidDiscoveredAssistantModel(models[0]), true);
  assert.equal(requestUrl.hostname, 'huggingface.co');
  assert.equal(requestUrl.searchParams.get('pipeline_tag'), 'text-generation');
  assert.equal(requestUrl.searchParams.getAll('expand[]').includes('sha'), true);
});

test('model discovery reports network and malformed response errors', async () => {
  await assert.rejects(
    discoverCompatibleAssistantModels(async () => ({ ok: false, status: 503 })),
    /HTTP 503/
  );
  await assert.rejects(
    discoverCompatibleAssistantModels(async () => ({ ok: true, json: async () => ({}) })),
    /invalid format/
  );
});
