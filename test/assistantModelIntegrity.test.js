import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assistantModelIntegrityMatches,
  hasValidAssistantModelIntegrityMetadata,
} from '../electron/assistant-model-integrity.js';

const model = { size: 128, sha256: 'a'.repeat(64) };

test('assistant model metadata requires a positive size and SHA-256 digest', () => {
  assert.equal(hasValidAssistantModelIntegrityMetadata(model), true);
  assert.equal(hasValidAssistantModelIntegrityMetadata({ size: 128, sha256: '0'.repeat(64) }), false);
  assert.equal(hasValidAssistantModelIntegrityMetadata({ size: 128, sha256: '' }), false);
  assert.equal(hasValidAssistantModelIntegrityMetadata({ size: 0, sha256: 'a'.repeat(64) }), false);
});

test('assistant model downloads are accepted only when size and digest match', () => {
  assert.equal(assistantModelIntegrityMatches(model, 128, model.sha256), true);
  assert.equal(assistantModelIntegrityMatches(model, 127, model.sha256), false);
  assert.equal(assistantModelIntegrityMatches(model, 128, 'b'.repeat(64)), false);
  assert.equal(assistantModelIntegrityMatches({ size: 128, sha256: '0'.repeat(64) }, 128, '0'.repeat(64)), false);
});
