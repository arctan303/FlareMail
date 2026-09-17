import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSetupFailure } from '../src/utils/setup-recovery.js';

test('a lost setup response checks status and treats completed setup as installed', () => {
  assert.equal(resolveSetupFailure(undefined, { setupRequired: false }), 'installed');
  assert.equal(resolveSetupFailure('ERR_NETWORK', { setupRequired: false }), 'installed');
});

test('expired or rotated setup sessions return to credential entry', () => {
  for (const code of [401, 403, 409, 410]) assert.equal(resolveSetupFailure(code, { setupRequired: true }), 'credentials');
});

test('an unresolved network failure remains retryable', () => {
  assert.equal(resolveSetupFailure('ERR_NETWORK', { setupRequired: true }), 'retry');
  assert.equal(resolveSetupFailure('ERR_NETWORK', null), 'retry');
});
