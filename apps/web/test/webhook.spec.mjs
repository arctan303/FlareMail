import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaygroundApi } from '../src/playground/api.js';

test('webhook preview reads neutral empty settings and refuses all external delivery mutations', async () => {
  const api = createPlaygroundApi('en');
  const config = await api.handle('GET', '/my/webhooks/1');
  assert.equal(config.enabled, false); assert.equal(config.mode, null); assert.equal(config.hasSecret, false);
  assert.deepEqual(await api.handle('GET', '/my/webhooks/1/deliveries'), { list: [], nextBefore: null });
  for (const [method, suffix] of [['PUT', ''], ['DELETE', ''], ['POST', '/test'], ['POST', '/secret'], ['POST', '/deliveries/example/retry']]) {
    await assert.rejects(api.handle(method, `/my/webhooks/1${suffix}`, { ...config, url: 'https://example.com', mode: 'all' }), failure => failure.code === 400);
  }
  await assert.rejects(api.handle('GET', '/my/webhooks/99999'), failure => failure.code === 404);
});
