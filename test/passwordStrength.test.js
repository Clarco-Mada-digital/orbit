import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scorePassword } from '../electron/password-strength.js';

test('password strength rejects common passwords and predictable repetitions', () => {
  assert.equal(scorePassword('password123'), 1);
  assert.equal(scorePassword('aaaaaaaaaaaaaaaa'), 1);
  assert.equal(scorePassword('abcabcabcabc'), 1);
  assert.equal(scorePassword('qwerty-2026-password'), 1);
});

test('password strength distinguishes weak, moderate, and high-entropy values', () => {
  assert.equal(scorePassword('abc123'), 1);
  assert.equal(scorePassword('aD7mP3xQ'), 2);
  assert.equal(scorePassword('y7Kp!4mQv#9Rz2sT'), 4);
});
