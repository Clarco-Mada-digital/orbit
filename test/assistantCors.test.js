import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantModelCorsHeaders } from '../electron/assistant-cors.js';

test('model server CORS allows only Orbit file and local development origins', () => {
  assert.deepEqual(assistantModelCorsHeaders('null'), {
    'Access-Control-Allow-Origin': 'null',
    Vary: 'Origin',
  });
  assert.deepEqual(assistantModelCorsHeaders('http://localhost:5173'), {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    Vary: 'Origin',
  });
  assert.deepEqual(assistantModelCorsHeaders('http://127.0.0.1:5173'), {
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
    Vary: 'Origin',
  });
  assert.deepEqual(assistantModelCorsHeaders('https://untrusted.example'), {});
  assert.deepEqual(assistantModelCorsHeaders('*'), {});
  assert.deepEqual(assistantModelCorsHeaders(undefined), {});
});
