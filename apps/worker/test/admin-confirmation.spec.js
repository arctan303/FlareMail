import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const PASSWORD = 'confirmation-test-password';
const ADMIN = 'confirmation-admin@example.com';
const MEMBER = 'confirmation-member@example.com';
const runtime = { ...env, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const context = () => { const values = new Map(); return { env, get: key => values.get(key), set: (key, value) => values.set(key, value) }; };
async function api(path, { method = 'GET', cookie, body, origin = 'http://localhost' } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('http://localhost/api' + path, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
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
async function key(cookie) { return KvConst.RECENT_AUTH + await cryptoUtils.hashSecret(cookie.slice(cookie.indexOf('=') + 1)); }
async function clear(cookie) { await env.kv.delete(await key(cookie)); }
async function state(cookie) { return (await (await api('/setting/confirmation/status', { cookie })).json()).data; }
async function policy(cookie, body) { return api('/setting/confirmation', { method: 'PUT', cookie, body }); }
async function reauth(cookie, password = PASSWORD) { return api('/my/reauth/password', { method: 'POST', cookie, body: { password } }); }
async function sensitive(cookie) {
  const current = (await (await api('/setting/runtime', { cookie })).json()).data;
  return api('/setting/runtime', { method: 'PUT', cookie, body: { revision: current.revision, allowedOrigins: [] } });
}
beforeAll(async () => {
  await dbInit.migrate(context());
  await markInstalled(env, ['example.com'], []);
  for (const [email, admin] of [[ADMIN, 1], [MEMBER, 0]]) {
    const material = await cryptoUtils.hashPassword(PASSWORD);
    const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS userId').bind(email, material.hash, material.salt, admin).first();
    await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind(email, user.userId).run();
  }
});
beforeEach(async () => {
  await env.db.prepare('UPDATE admin_confirmation SET enabled = 0, window_minutes = 1440, revision = 0 WHERE id = 1').run();
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('unified settings confirmation policy', () => {
  it('defaults off, permits sensitive saves without a proof and never exposes the proof publicly', async () => {
    const cookie = await login(); await clear(cookie);
    expect(await state(cookie)).toMatchObject({ enabled: false, windowMinutes: 1440, valid: false });
    expect((await sensitive(cookie)).status).toBe(200);
    const publicConfig = await (await api('/setting/websiteConfig')).text();
    expect(publicConfig).not.toContain('authenticatedAt');
    expect(publicConfig).not.toContain('windowMinutes');
    expect(await dbInit.v3_23Applied(context())).toBe(true);
  });
  it('keeps authentication, administrator permissions and same-origin requirements when off', async () => {
    const body = { enabled: true, windowMinutes: 1440, revision: 0 };
    expect((await policy(null, body)).status).toBe(401);
    const member = await login(MEMBER);
    expect((await policy(member, body)).status).toBe(403);
    expect((await api('/setting/confirmation/status', { cookie: member })).status).toBe(403);
    const admin = await login();
    for (const origin of [null, 'https://other.example']) {
      expect((await api('/setting/confirmation', { method: 'PUT', cookie: admin, body, origin })).status).toBe(403);
    }
    expect((await api('/setting/runtime', { method: 'PUT', cookie: member, body: { revision: 0, allowedOrigins: [] } })).status).toBe(403);
  });
  it('requires a real password after enabling and keeps a one-day proof beyond ten minutes', async () => {
    const cookie = await login();
    expect((await policy(cookie, { enabled: true, windowMinutes: 1440, revision: 0 })).status).toBe(200);
    expect((await sensitive(cookie)).status).toBe(428);
    expect((await reauth(cookie, 'incorrect-password')).status).toBe(403);
    expect((await sensitive(cookie)).status).toBe(428);
    expect((await reauth(cookie)).status).toBe(200);
    const granted = await state(cookie);
    expect(granted.valid).toBe(true);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60000);
    expect((await sensitive(cookie)).status).toBe(200);
    expect((await state(cookie)).expiresAt).toBe(granted.expiresAt);
    vi.spyOn(Date, 'now').mockReturnValue(granted.expiresAt);
    expect((await sensitive(cookie)).status).toBe(428);
    expect((await state(cookie)).valid).toBe(false);
  });
  it('does not share proofs between sessions or revive them across policy revisions', async () => {
    const first = await login(); const second = await login();
    await policy(first, { enabled: true, windowMinutes: 60, revision: 0 });
    await reauth(first);
    expect((await sensitive(first)).status).toBe(200);
    expect((await sensitive(second)).status).toBe(428);
    expect((await policy(second, { enabled: false, windowMinutes: 60, revision: 1 })).status).toBe(428);
    expect((await policy(first, { enabled: false, windowMinutes: 60, revision: 1 })).status).toBe(200);
    expect(await state(first)).toMatchObject({ enabled: false, windowMinutes: 60, valid: false });
    expect((await sensitive(second)).status).toBe(200);
    await policy(second, { enabled: true, windowMinutes: 60, revision: 2 });
    expect((await sensitive(first)).status).toBe(428);
  });
  it('rejects invalid durations and stale saves without overwriting the stored policy', async () => {
    const cookie = await login();
    for (const windowMinutes of [0, -1, 0.5, 10081, '1440', null]) {
      expect((await policy(cookie, { enabled: false, windowMinutes, revision: 0 })).status).toBe(400);
    }
    expect((await policy(cookie, { enabled: false, windowMinutes: 10080, revision: 0 })).status).toBe(200);
    expect((await policy(cookie, { enabled: true, windowMinutes: 1, revision: 0 })).status).toBe(409);
    expect(await state(cookie)).toMatchObject({ enabled: false, windowMinutes: 10080, revision: 1 });
  });
  it('does not require confirmation for public brand changes even with protection enabled', async () => {
    const cookie = await login();
    await policy(cookie, { enabled: true, windowMinutes: 1440, revision: 0 });
    expect((await api('/setting/set', { method: 'PUT', cookie, body: { title: 'Confirmation test brand' } })).status).toBe(200);
    expect((await api('/setting/set', { method: 'PUT', cookie, body: { googleOauthEnabled: 0 } })).status).toBe(428);
  });
  it('keeps secret disclosure independently password protected while settings confirmation is off', async () => {
    const cookie = await login();
    await env.db.prepare("UPDATE runtime_config SET oauth_issuer = 'https://mail.example.com', oauth_secret = 'confirmation-private-secret' WHERE id = 1").run();
    for (const body of [{}, { password: 'incorrect' }]) {
      expect((await api('/setting/runtime/oauth-secret', { method: 'POST', cookie, body })).status).toBe(403);
    }
    const correct = await api('/setting/runtime/oauth-secret', { method: 'POST', cookie, body: { password: PASSWORD } });
    expect((await correct.json()).data.secret).toBe('confirmation-private-secret');
  });
  it('removes shared proofs on logout and rejects further writes', async () => {
    const cookie = await login(); expect(await env.kv.get(await key(cookie))).not.toBeNull();
    expect((await api('/logout', { method: 'DELETE', cookie })).status).toBe(200);
    expect(await env.kv.get(await key(cookie))).toBeNull();
    expect((await policy(cookie, { enabled: false, windowMinutes: 1440, revision: 0 })).status).toBe(401);
  });
  it('upgrades a 322 database without changing accounts/settings and preserves policy on repeated migration', async () => {
    const before = {};
    for (const table of ['user', 'account', 'setting', 'runtime_config']) before[table] = (await env.db.prepare('SELECT * FROM ' + table).all()).results;
    await env.db.batch([env.db.prepare('DROP TABLE admin_confirmation'), env.db.prepare('DELETE FROM schema_migrations WHERE version = 323')]);
    expect(await dbInit.v3_23Applied(context())).toBe(false);
    await dbInit.migrate(context());
    expect(await dbInit.v3_23Applied(context())).toBe(true);
    for (const table of Object.keys(before)) expect((await env.db.prepare('SELECT * FROM ' + table).all()).results).toEqual(before[table]);
    await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, window_minutes = 2880, revision = 7 WHERE id = 1').run();
    await dbInit.migrate(context());
    expect(await env.db.prepare('SELECT * FROM admin_confirmation').first()).toEqual({ id: 1, enabled: 1, window_minutes: 2880, revision: 7 });
  });

  it('lets members generate and rotate only their own CLI token while off, without bypassing sessions or origins', async () => {
    const member = await login(MEMBER); await clear(member);
    const admin = await env.db.prepare('SELECT user_id, cli_token FROM user WHERE email = ?').bind(ADMIN).first();
    const request = { method: 'POST', cookie: member, body: { userId: admin.user_id } };
    const first = await api('/my/genCliToken', request);
    expect(first.status).toBe(200);
    const second = await api('/my/genCliToken', request);
    expect(second.status).toBe(200);
    expect((await first.json()).data.token).not.toBe((await second.json()).data.token);
    expect((await env.db.prepare('SELECT cli_token FROM user WHERE email = ?').bind(ADMIN).first()).cli_token).toBe(admin.cli_token);
    const statusResponse = await api('/my/reauth/status', { cookie: member });
    expect(statusResponse.headers.get('cache-control')).toBe('no-store');
    expect((await statusResponse.json()).data).toMatchObject({ enabled: false, valid: false, windowMinutes: 1440 });
    expect((await api('/my/genCliToken', { method: 'POST' })).status).toBe(401);
    expect((await api('/my/genCliToken', { ...request, origin: 'https://evil.example' })).status).toBe(403);
    expect((await api('/my/resetPassword', { method: 'PUT', cookie: member, origin: 'https://evil.example', body: { password: 'another-password' } })).status).toBe(403);
    expect((await api('/my/resetPassword', { method: 'PUT', body: { password: 'another-password' } })).status).toBe(401);
  });
  it('shares one confirmation across administrator and personal operations beyond ten minutes', async () => {
    const cookie = await login();
    await policy(cookie, { enabled: true, windowMinutes: 1440, revision: 0 });
    expect((await api('/my/genCliToken', { method: 'POST', cookie })).status).toBe(428);
    await reauth(cookie);
    const shared = await state(cookie);
    const personal = (await (await api('/my/reauth/status', { cookie })).json()).data;
    expect(personal).toEqual(shared);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60000);
    expect((await sensitive(cookie)).status).toBe(200);
    expect((await api('/my/genCliToken', { method: 'POST', cookie })).status).toBe(200);
    expect((await (await api('/my/reauth/status', { cookie })).json()).data.expiresAt).toBe(shared.expiresAt);
    vi.spyOn(Date, 'now').mockReturnValue(shared.expiresAt);
    expect((await api('/my/genCliToken', { method: 'POST', cookie })).status).toBe(428);
  });
  it('applies the same policy to members while keeping user proofs and policy permissions separate', async () => {
    const admin = await login(); const member = await login(MEMBER);
    await policy(admin, { enabled: true, windowMinutes: 1440, revision: 0 });
    await reauth(admin);
    expect((await api('/my/genCliToken', { method: 'POST', cookie: member })).status).toBe(428);
    await reauth(member);
    expect((await api('/my/genCliToken', { method: 'POST', cookie: member })).status).toBe(200);
    expect((await policy(member, { enabled: false, windowMinutes: 1440, revision: 1 })).status).toBe(403);
    expect((await api('/setting/runtime', { method: 'PUT', cookie: member, body: { revision: 0, allowedOrigins: [] } })).status).toBe(403);
    await policy(admin, { enabled: true, windowMinutes: 60, revision: 1 });
    expect((await api('/my/genCliToken', { method: 'POST', cookie: member })).status).toBe(428);
    const status = (await (await api('/my/reauth/status', { cookie: member })).json()).data;
    expect(status).toMatchObject({ enabled: true, windowMinutes: 60, valid: false });
  });
  it('rejects both kinds of legacy proof instead of widening their scope', async () => {
    const cookie = await login();
    await policy(cookie, { enabled: true, windowMinutes: 1440, revision: 0 });
    const hash = await cryptoUtils.hashSecret(cookie.slice(cookie.indexOf('=') + 1));
    const userId = (await env.db.prepare('SELECT user_id FROM user WHERE email = ?').bind(ADMIN).first()).user_id;
    const authenticatedAt = Date.now();
    await env.kv.put(KvConst.RECENT_AUTH + hash, JSON.stringify({ version: 1, method: 'password', userId, authenticatedAt, expiresAt: authenticatedAt + 600000 }));
    await env.kv.put(KvConst.ADMIN_CONFIRMATION + hash, JSON.stringify({ version: 1, userId, revision: 1, authenticatedAt, expiresAt: authenticatedAt + 86400000 }));
    expect((await sensitive(cookie)).status).toBe(428);
    expect((await api('/my/genCliToken', { method: 'POST', cookie })).status).toBe(428);
    await reauth(cookie);
    expect((await sensitive(cookie)).status).toBe(200);
    expect((await api('/my/genCliToken', { method: 'POST', cookie })).status).toBe(200);
    await api('/logout', { method: 'DELETE', cookie });
    expect(await env.kv.get(KvConst.ADMIN_CONFIRMATION + hash)).toBeNull();
  });
  it('caps the shared proof at the existing login session expiry', async () => {
    const cookie = await login();
    const hash = await cryptoUtils.hashSecret(cookie.slice(cookie.indexOf('=') + 1));
    const session = await env.kv.get(KvConst.SESSION + hash, { type: 'json' });
    session.createdAt = Date.now() - (7 * 24 - 2) * 3600000;
    await env.kv.put(KvConst.SESSION + hash, JSON.stringify(session));
    await reauth(cookie);
    expect((await state(cookie)).expiresAt).toBe(session.createdAt + 7 * 86400000);
  });
  it('allows a member password change while off and invalidates all of that user’s sessions', async () => {
    const email = 'confirmation-password-off@example.com';
    const material = await cryptoUtils.hashPassword(PASSWORD);
    const user = await env.db.prepare('INSERT INTO user(email,password,salt) VALUES (?,?,?) RETURNING user_id AS userId').bind(email, material.hash, material.salt).first();
    await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind(email, user.userId).run();
    const first = await login(email); const second = await login(email); await clear(first);
    expect((await api('/my/resetPassword', { method: 'PUT', cookie: first, body: { password: 'new-unified-password' } })).status).toBe(200);
    for (const cookie of [first, second]) {
      expect((await api('/my/loginUserInfo', { cookie })).status).toBe(401);
      expect(await env.kv.get(await key(cookie))).toBeNull();
    }
    const row = await env.db.prepare('SELECT password,salt FROM user WHERE user_id = ?').bind(user.userId).first();
    expect(await cryptoUtils.verifyPassword('new-unified-password', row.salt, row.password)).toBe(true);
  });
});
