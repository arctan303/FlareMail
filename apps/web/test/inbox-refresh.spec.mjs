import test from 'node:test';
import assert from 'node:assert/strict';
import { createInboxCheck, createInboxRefresh } from '../src/utils/inbox-refresh.js';

function harness(check, onError) {
  const timers = new Map(); let id = 0;
  const refresh = createInboxRefresh({ check, onError, interval: () => 30000,
    setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  return { refresh, timers, fire() {
    const [key, timer] = timers.entries().next().value;
    timers.delete(key); return timer.fn();
  } };
}

test('inbox refresh checks on entry and every 30 seconds; hidden/unmounted views stop scheduling', async () => {
  let checks = 0;
  const h = harness(async () => { checks++; });
  h.refresh.resume();
  assert.equal([...h.timers.values()][0].delay, 0);
  await h.fire();
  assert.equal(checks, 1);
  assert.equal([...h.timers.values()][0].delay, 30000);
  h.refresh.pause(); assert.equal(h.timers.size, 0);
  h.refresh.resume(); await h.fire(); assert.equal(checks, 2);
  h.refresh.dispose(); h.refresh.resume(); assert.equal(h.timers.size, 0);
});

test('re-entry during a request coalesces into one fresh check without concurrent requests', async () => {
  let release; let calls = 0;
  const h = harness(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  h.refresh.resume(); const running = h.fire();
  h.refresh.pause(); h.refresh.resume(); h.refresh.resume();
  assert.equal(calls, 1); assert.equal(h.timers.size, 0);
  release(); await running;
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].delay, 0);
  h.refresh.dispose();
});

test('transient failures keep polling; authentication failures can pause it without changing settings', async () => {
  let stop = false;
  const h = harness(async () => { throw new Error('offline'); }, () => { if (stop) h.refresh.pause(); });
  h.refresh.resume(); await h.fire(); assert.equal(h.timers.size, 1);
  stop = true; await h.fire(); assert.equal(h.timers.size, 0);
});

test('disposing during a request never schedules another timer', async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  h.refresh.resume(); const running = h.fire(); h.refresh.dispose();
  release(); await running; assert.equal(h.timers.size, 0);
});

test('only new mail in the still-active mailbox triggers an update; stale scope responses are ignored', async () => {
  let active = true, key = 'all', rows = [], refreshes = 0, calls = [], release;
  const check = createInboxCheck({
    isActive: () => active, isReady: () => true,
    getContext: () => ({ key, accountId: 2, allReceive: 1 }),
    getMarker: () => ({ emailId: 90, reqAccountId: 2, allReceive: 1 }),
    fetchLatest: (...args) => { calls.push(args); return new Promise(resolve => { release = () => resolve(rows); }); },
    refresh: () => { refreshes++; },
  });
  let pending = check(); release(); await pending;
  assert.equal(refreshes, 0); assert.deepEqual(calls[0], [90, 2, 1]);
  rows = [{ emailId: 91 }]; pending = check(); release(); await pending; assert.equal(refreshes, 1);
  pending = check(); key = 'unread'; release(); await pending; assert.equal(refreshes, 1);
  pending = check(); active = false; release(); await pending; assert.equal(refreshes, 1);
  await check(); assert.equal(calls.length, 4);
});
