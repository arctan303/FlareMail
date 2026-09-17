import test from 'node:test';
import assert from 'node:assert/strict';
import { runAfterSetupGate, SETUP_GATE_READY, SETUP_GATE_SETUP, SETUP_GATE_UPGRADE } from '../src/utils/setup-gate.js';

const status = (overrides = {}) => ({ setupRequired: false, upgradeRequired: false, upgradeSupported: true, ...overrides });

test('setup and upgrade states block the ready branch without automatic setup', async () => {
  for (const [value, expected] of [[status({setupRequired: true}), SETUP_GATE_SETUP], [status({upgradeRequired: true}), SETUP_GATE_UPGRADE]]) {
    let readyCalls = 0;
    let automaticCalls = 0;
    const result = await runAfterSetupGate({
      getStatus: async () => value,
      readyAction: async () => { readyCalls += 1 },
    });
    assert.equal(result.state, expected);
    assert.equal(result.ready, false);
    assert.equal(result.automaticAttempted, false);
    assert.equal(readyCalls, 0);
    assert.equal(automaticCalls, 0);
  }
});

test('ready status enters ready branch without automatic setup', async () => {
  let readyCalls = 0;
  const result = await runAfterSetupGate({
    getStatus: async () => status(),
    readyAction: async () => { readyCalls += 1; return 'loaded' },
  });
  assert.equal(result.state, SETUP_GATE_READY);
  assert.equal(result.value, 'loaded');
  assert.equal(result.automaticAttempted, false);
  assert.equal(readyCalls, 1);
});

test('status errors and malformed responses propagate instead of entering ready', async () => {
  const statusError = new Error('status unavailable');
  await assert.rejects(runAfterSetupGate({ getStatus: async () => { throw statusError }, readyAction: async () => {} }), statusError);
  await assert.rejects(runAfterSetupGate({ getStatus: async () => ({}), readyAction: async () => {} }), /valid gate fields/);
});

test('ready action errors propagate', async () => {
  const error = new Error('ready failed');
  await assert.rejects(runAfterSetupGate({ getStatus: async () => status(), readyAction: async () => { throw error } }), error);
});

test('compatible pending patches load the normal application without running a migration', async () => {
  let loaded = 0;
  const value = status({ upgradeRequired: true, upgradeBlocking: false });
  const result = await runAfterSetupGate({ getStatus: async () => value, readyAction: async (received) => { assert.equal(received, value); loaded++; return 'normal login and mailbox'; } });
  assert.equal(result.state, SETUP_GATE_READY);
  assert.equal(result.status.upgradeRequired, true);
  assert.equal(result.automaticAttempted, false);
  assert.equal(loaded, 1);
});

test('only explicitly supported compatible patches can pass, and new setup always takes precedence', async () => {
  for (const upgradeBlocking of [true, undefined, null, 'false', 0]) {
    const result = await runAfterSetupGate({ getStatus: async () => status({ upgradeRequired:true, upgradeBlocking }), readyAction: async () => assert.fail('blocked schema entered ready') });
    assert.equal(result.state, SETUP_GATE_UPGRADE);
  }
  for (const upgradeSupported of [false, undefined]) {
    const result = await runAfterSetupGate({ getStatus: async () => status({ upgradeRequired:true, upgradeBlocking:false, upgradeSupported }), readyAction: async () => assert.fail('unsupported schema entered ready') });
    assert.equal(result.state, SETUP_GATE_UPGRADE);
  }
  const fresh = await runAfterSetupGate({ getStatus: async () => status({ setupRequired:true, upgradeBlocking:false }), readyAction: async () => assert.fail('new install entered ready') });
  assert.equal(fresh.state, SETUP_GATE_SETUP);
});
