import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAssistantModel,
  getBestAssistantModel,
} from '../src/lib/assistantRecommendations.js';

const GB = 1024 ** 3;
const models = {
  'smollm2-360m': { minRamGb: 4, recommendedRamGb: 5.5, minFreeRamGb: 1.5 },
  'qwen3-0.6b': { minRamGb: 6, recommendedRamGb: 7.2, minFreeRamGb: 3 },
  'qwen3-1.7b': {
    minRamGb: 24,
    recommendedRamGb: 32,
    minFreeRamGb: 12,
    requiresWebGPU: true,
  },
};

test('assistant model assessment rejects models requiring unavailable WebGPU', () => {
  assert.equal(assessAssistantModel(models['qwen3-1.7b'], {
    totalMemory: 32 * GB,
    freeMemory: 16 * GB,
  }, false), 'unsupported');
});

test('assistant model assessment warns when current free memory is low', () => {
  assert.equal(assessAssistantModel(models['qwen3-0.6b'], {
    totalMemory: 16 * GB,
    freeMemory: 2 * GB,
  }, true), 'caution');
});

test('assistant model assessment recommends a model only when its memory targets fit', () => {
  assert.equal(assessAssistantModel(models['qwen3-0.6b'], {
    totalMemory: 16 * GB,
    freeMemory: 8 * GB,
  }, false), 'recommended');
});

test('assistant recommendation chooses the best fitting model, then the lightest fallback', () => {
  const hardware = { totalMemory: 16 * GB, freeMemory: 8 * GB };
  assert.equal(getBestAssistantModel(models, hardware, true), 'qwen3-0.6b');
  assert.equal(getBestAssistantModel(models, hardware, false), 'qwen3-0.6b');
  assert.equal(getBestAssistantModel(models, { totalMemory: 5 * GB, freeMemory: 2 * GB }, false), 'smollm2-360m');
  assert.equal(getBestAssistantModel(models, {
    totalMemory: 32 * GB,
    freeMemory: 16 * GB,
  }, true), 'qwen3-1.7b');
});

test('assistant recommendation stays unknown until host hardware is available', () => {
  assert.equal(getBestAssistantModel(models, null, false), null);
});
