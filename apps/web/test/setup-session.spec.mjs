import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSetupSession, getSetupSession, hasSetupSession, setSetupSession } from '../src/utils/setup-session.js';

test('setup authorization stays in process memory and can be cleared', () => {
  clearSetupSession();
  assert.equal(hasSetupSession(), false);
  setSetupSession('session-only', '2026-09-14T00:00:00.000Z');
  assert.deepEqual(getSetupSession(), { setupSession: 'session-only', expiresAt: '2026-09-14T00:00:00.000Z' });
  assert.equal(hasSetupSession(), true);
  clearSetupSession();
  assert.deepEqual(getSetupSession(), { setupSession: null, expiresAt: null });
  assert.equal(hasSetupSession(), false);
});
