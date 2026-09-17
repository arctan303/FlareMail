import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingPatch, needsSettingConfirmation } from '../src/utils/setting-patch.js';

test('sending provider save is isolated, sensitive and keeps blank saved keys', () => {
  const baseline = { mailProvider: 'resend', blackFrom: 'old', receive: 0 };
  const form = { ...baseline, mailProvider: 'cloudflare', blackFrom: 'new', receive: 1 };
  const patch = buildSettingPatch('channels', form, baseline, { resendTokens: { 'example.com': '' } });
  assert.deepEqual(patch, { mailProvider: 'cloudflare' });
  assert.equal(needsSettingConfirmation(patch), true);
  assert.deepEqual(buildSettingPatch('core', form, baseline), { receive: 1 });
  assert.deepEqual(buildSettingPatch('mail', form, baseline), { blackFrom: 'new' });
  assert.deepEqual(buildSettingPatch('channels', baseline, baseline, { resendTokens: { 'example.com': 'key' } }), { resendTokens: { 'example.com': 'key' } });
  assert.deepEqual(buildSettingPatch('channels', baseline, baseline), {});
});
