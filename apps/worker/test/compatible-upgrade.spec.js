import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const PASSWORD = 'upgrade-fixture-password';
const ADMIN = 'patch-admin@example.com';
const MEMBER = 'patch-member@example.com';
const runtime = { ...env, SETUP_SECRET: undefined, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) }, SETUP_STATUS_RATE_LIMITER: { limit: async () => ({ success: true }) }, EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const context = () => { const values = new Map(); return { env: runtime, get: key => values.get(key), set: (key, value) => values.set(key, value) }; };
async function api(path, { method = 'GET', cookie, body, origin = 'http://localhost' } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('http://localhost/api' + path, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: origin, 'Content-Type': 'application/json', 'Accept-Language': 'en' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), runtime, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
async function login(email = ADMIN) {
  const response = await api('/login', { method: 'POST', body: { email, password: PASSWORD } });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function expectLoginBlocked() {
  const response = await api('/login', { method: 'POST', body: { email: ADMIN, password: PASSWORD } });
  expect([500, 503]).toContain(response.status);
  expect(response.headers.get('set-cookie')).toBeNull();
}
async function pending323() {
  await env.db.batch([env.db.prepare('DROP TABLE admin_confirmation'), env.db.prepare('DELETE FROM schema_migrations WHERE version = 323')]);
}
async function tableRows(table) { return (await env.db.prepare('SELECT * FROM ' + table).all()).results; }
async function status() { const response = await api('/setup/status'); expect(response.status).toBe(200); return (await response.json()).data; }
let accountId;
beforeAll(async () => {
  await dbInit.migrate(context());
  await markInstalled(env, ['example.com'], []);
  for (const [email, admin] of [[ADMIN, 1], [MEMBER, 0]]) {
    const material = await cryptoUtils.hashPassword(PASSWORD);
    const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS userId').bind(email, material.hash, material.salt, admin).first();
    const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS accountId').bind(email, user.userId).first();
    if (admin) {
      accountId = account.accountId;
      await env.db.prepare("INSERT INTO email(account_id,user_id,subject,type,text) VALUES (?,?,'preserved patch email',0,'Existing mail remains readable')").bind(accountId,user.userId).run();
    }
  }
  await env.db.prepare("UPDATE setting SET title = 'Existing mailbox'").run();
  await env.kv.delete(KvConst.SETTING);
});

describe.sequential('compatible installed database patches', () => {
  it('keeps 322 login/mail/brand available and lets only the administrator upgrade without a setup secret', async () => {
    const existingSession = await login();
    await pending323();
    try {
      const schemaBefore = await tableRows('schema_migrations');
      expect(await status()).toMatchObject({ setupRequired: false, upgradeRequired: true, upgradeBlocking: false, upgradeSupported: true });
      expect(await tableRows('schema_migrations')).toEqual(schemaBefore);
      expect(await dbInit.hasTable(context(), 'admin_confirmation')).toBe(false);
      expect((await (await api('/setting/websiteConfig')).json()).data.title).toBe('Existing mailbox');
      expect((await api('/my/loginUserInfo', { cookie: existingSession })).status).toBe(200);
      expect((await api('/login', { method:'POST', body:{ email: ADMIN, password:'incorrect-password' } })).status).toBe(401);
      const admin = await login(); const member = await login(MEMBER);
      const proofKey = KvConst.RECENT_AUTH + await cryptoUtils.hashSecret(admin.slice(admin.indexOf('=') + 1));
      expect(await env.kv.get(proofKey)).toBeNull();
      const mail = await api('/email/list?type=0&accountId=' + accountId, { cookie: admin });
      expect(mail.status).toBe(200); expect(await mail.text()).toContain('preserved patch email');
      expect((await api('/email/list?type=0&accountId=' + accountId, { cookie: member })).status).toBe(404);
      expect((await api('/setting/query', { cookie: admin })).status).toBe(200);
      const policy = await api('/setting/confirmation', { cookie: admin });
      expect(policy.status).toBe(503); expect(await policy.text()).toContain('upgrade the database');
      expect((await api('/setting/set', { method: 'PUT', cookie: admin, body: { googleOauthEnabled: 0 } })).status).toBe(503);
      expect((await api('/my/genCliToken', { method: 'POST', cookie: member, body: {} })).status).toBe(503);
      expect((await api('/admin/upgrade', { method: 'POST' })).status).toBe(401);
      expect((await api('/admin/upgrade', { method: 'POST', cookie: member })).status).toBe(403);
      expect((await api('/admin/upgrade', { method: 'POST', cookie: admin, origin: 'https://evil.example' })).status).toBe(403);
      expect(await dbInit.hasTable(context(), 'admin_confirmation')).toBe(false);
      const before = {};
      for (const table of ['user', 'account', 'email', 'contact', 'attachments', 'setting', 'runtime_config', 'managed_domain']) before[table] = await tableRows(table);
      expect((await api('/admin/upgrade', { method:'POST', cookie:admin })).status).toBe(200);
      expect(await status()).toMatchObject({ setupRequired:false, upgradeRequired:false, upgradeBlocking:false });
      for (const table of Object.keys(before)) expect(await tableRows(table)).toEqual(before[table]);
      expect((await (await api('/setting/confirmation', { cookie:admin })).json()).data).toMatchObject({ enabled:false, windowMinutes:1440 });
      expect((await api('/my/loginUserInfo', { cookie: admin })).status).toBe(200);
      await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, window_minutes = 60, revision = 4').run();
      expect((await api('/admin/upgrade', { method:'POST', cookie:admin })).status).toBe(200);
      expect((await (await api('/setting/confirmation', { cookie:admin })).json()).data).toMatchObject({ enabled:true, windowMinutes:60, revision:4 });
      expect((await api('/setting/set', { method:'PUT', cookie:admin, body:{googleOauthEnabled:0} })).status).toBe(428);
    } finally { await dbInit.migrate(context()); }
  });
  it('blocks an incompatible core schema even when the 323 patch is also absent', async () => {
    await pending323();
    await env.db.prepare('DROP TABLE send_request').run();
    try { expect(await status()).toMatchObject({ setupRequired:false, upgradeRequired:true, upgradeBlocking:true }); await expectLoginBlocked(); }
    finally { await dbInit.migrate(context()); }
  });
  it('does not treat an applied marker with a missing policy table as a compatible pending patch', async () => {
    await env.db.prepare('DROP TABLE admin_confirmation').run();
    try { expect(await status()).toMatchObject({ upgradeRequired:true, upgradeBlocking:true }); await expectLoginBlocked(); }
    finally { await dbInit.migrate(context()); }
  });
  it('does not treat a malformed policy row as a disabled policy or a compatible pending patch', async () => {
    const admin = await login();
    await env.db.prepare('DELETE FROM admin_confirmation').run();
    try {
      expect(await status()).toMatchObject({ upgradeRequired:true, upgradeBlocking:true });
      await expectLoginBlocked();
      expect((await api('/setting/set', { method:'PUT', cookie:admin, body:{googleOauthEnabled:0} })).status).toBe(503);
    } finally { await dbInit.migrate(context()); }
  });
});
