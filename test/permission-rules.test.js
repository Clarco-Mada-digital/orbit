import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  permissionCheckAllowed,
  permissionRequestDecision,
} from '../electron/permission-rules.js';

test('sensitive permissions prompt only for readable origins in ask mode', () => {
  assert.equal(permissionRequestDecision('media', 'ask', 'https://example.com', null), 'ask');
  assert.equal(permissionRequestDecision('media', 'ask', null, null), 'deny');
  assert.equal(permissionRequestDecision('media', 'deny', 'https://example.com', null), 'deny');
  assert.equal(permissionRequestDecision('media', 'allow', 'https://example.com', null), 'allow');
});

test('remembered site decisions override the global permissions mode', () => {
  assert.equal(permissionRequestDecision('media', 'deny', 'https://example.com', 'allow'), 'allow');
  assert.equal(permissionRequestDecision('media', 'allow', 'https://example.com', 'deny'), 'deny');
});

test('permissions outside the allow-list remain denied regardless of global mode', () => {
  assert.equal(permissionRequestDecision('usb', 'allow', 'https://example.com', null), 'deny');
  assert.equal(permissionCheckAllowed('usb', 'allow', null), false);
});

test('permission checks reflect remembered and global askable decisions', () => {
  assert.equal(permissionCheckAllowed('media', 'ask', null), false);
  assert.equal(permissionCheckAllowed('media', 'allow', null), false);
  assert.equal(permissionCheckAllowed('media', 'allow', null, 'https://example.com'), true);
  assert.equal(permissionCheckAllowed('media', 'deny', 'allow', 'https://example.com'), true);
  assert.equal(permissionCheckAllowed('media', 'allow', 'deny', 'https://example.com'), false);
  assert.equal(permissionCheckAllowed('media', 'allow', null, null), false);
  assert.equal(permissionCheckAllowed('fullscreen', 'ask', null), true);
});
