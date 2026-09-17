import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSettingPatch, needsSettingConfirmation } from '../src/utils/setting-patch.js';
import { createRecentAuthCoordinator } from '../src/utils/recent-auth.js';

test('brand and core saves never carry untouched credentials or other sections', () => {
  const baseline = { receive: 0, googleClientId: 'old-client', blackFrom: 'old' };
  const form = { receive: 1, googleClientId: 'new-client', blackFrom: 'new' };
  const core = buildSettingPatch('core', form, baseline, { googleClientSecret: 'new-secret' });
  assert.deepEqual(core, { receive: 1 }); assert.equal(needsSettingConfirmation(core), false);
  const brand = buildSettingPatch('brand', form, baseline, { brand: { title: 'New' }, brandBaseline: { title: 'Old' } });
  assert.deepEqual(brand, { title: 'New' }); assert.equal(needsSettingConfirmation(brand), false);
  assert.deepEqual(buildSettingPatch('auth', baseline, baseline), {});
});
test('only credential changes require a settings confirmation', () => {
  const patch = buildSettingPatch('auth', { googleClientId: 'new' }, { googleClientId: 'old' });
  assert.deepEqual(patch, { googleClientId: 'new' }); assert.equal(needsSettingConfirmation(patch), true);
  const mail = buildSettingPatch('mail', { blackFrom: 'blocked' }, { blackFrom: '' });
  assert.equal(needsSettingConfirmation(mail), false);
  const token = buildSettingPatch('mail', {}, {}, { resendTokens: { 'example.com': 'token' } });
  assert.equal(needsSettingConfirmation(token), true);
});
test('disabled policy skips password prompts; enabled policy passes its configured duration', async () => {
  let prompts = 0; let actions = 0;
  const disabled = createRecentAuthCoordinator({ getStatus: async () => ({ enabled: false, valid: false }), requestAuthentication: async () => { prompts++; return false; } });
  await disabled.run('save', () => { actions++; });
  assert.equal(prompts, 0); assert.equal(actions, 1);
  const enabled = createRecentAuthCoordinator({ getStatus: async () => ({ enabled: true, valid: false, windowMinutes: 1440 }), requestAuthentication: async (_, status) => { assert.equal(status.windowMinutes, 1440); return true; } });
  await enabled.run('save', () => { actions++; }); assert.equal(actions, 2);
});

test('personal and administrator pages share a server confirmation and re-read policy changes', async () => {
  let state = { enabled: true, valid: false, windowMinutes: 1440 }; let prompts = 0;
  const options = { getStatus: async () => state, requestAuthentication: async (_, policy) => {
    prompts++; assert.equal(policy.windowMinutes, 1440); state = { ...state, valid: true }; return true;
  } };
  const admin = createRecentAuthCoordinator(options); const personal = createRecentAuthCoordinator(options);
  assert.equal((await admin.run('管理员设置', () => 'admin saved')).value, 'admin saved');
  assert.equal((await personal.run('个人设置', () => 'personal saved')).value, 'personal saved');
  assert.equal(prompts, 1);
  state = { enabled: false, valid: false, windowMinutes: 60 };
  assert.equal((await personal.run('个人设置', () => 'saved while off')).value, 'saved while off');
  assert.equal(prompts, 1);
});
