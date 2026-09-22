import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import { markInstalled } from './installed-instance';

const PASSWORD = 'schema-fixture-password';
const ADMIN = 'schema-admin@example.com';
const MEMBER = 'schema-member@example.com';
const runtime = {
  ...env,
  SETUP_SECRET: undefined,
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SETUP_STATUS_RATE_LIMITER: { limit: async () => ({ success: true }) },
  EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const context = () => {
  const values = new Map();
  return { env: runtime, get: key => values.get(key), set: (key, value) => values.set(key, value) };
};

async function api(path, { method = 'GET', cookie, body, origin = 'http://localhost' } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('http://localhost/api' + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: origin,
      'Content-Type': 'application/json',
      'Accept-Language': 'en',
    },
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

beforeAll(async () => {
  await dbInit.migrate(context());
  await markInstalled(env, ['example.com'], []);
  for (const [email, admin] of [[ADMIN, 1], [MEMBER, 0]]) {
    const material = await cryptoUtils.hashPassword(PASSWORD);
    const user = await env.db.prepare(
      'INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS userId'
    ).bind(email, material.hash, material.salt, admin).first();
    await env.db.prepare(
      'INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS accountId'
    ).bind(email, user.userId).first();
  }
});

describe.sequential('admin database schema inspection API', () => {
  it('rejects anonymous and regular member requests with 401/403', async () => {
    const anonRes = await api('/admin/schema');
    expect(anonRes.status).toBe(401);

    const memberCookie = await login(MEMBER);
    const memberRes = await api('/admin/schema', { cookie: memberCookie });
    expect(memberRes.status).toBe(403);
  });

  it('rejects cross-origin requests even with administrator session', async () => {
    const adminCookie = await login(ADMIN);
    const crossRes = await api('/admin/schema', { cookie: adminCookie, origin: 'https://evil.attacker.com' });
    expect(crossRes.status).toBe(403);
  });

  it('returns current and latest schema versions and history for administrator', async () => {
    const adminCookie = await login(ADMIN);
    const res = await api('/admin/schema', { cookie: adminCookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.data).toMatchObject({
      currentVersion: { id: 325, label: 'v3.25' },
      latestVersion: { id: 325, label: 'v3.25' },
      upgradeRequired: false,
      upgradeBlocking: false,
      upgradeSupported: true,
      pendingPatches: [],
    });
    expect(Array.isArray(body.data.history)).toBe(true);
    expect(body.data.history.length).toBeGreaterThanOrEqual(14);
    const topPatch = body.data.history[0];
    expect(topPatch.version).toBe(325);
    expect(topPatch.label).toBe('v3.25');
    expect(topPatch.descKey).toBe('schemaPatch325');
    expect(topPatch.appliedTime).toBeTruthy();
  });

  it('reports pending patch when database is behind, and updates after upgrade', async () => {
    const adminCookie = await login(ADMIN);
    const account = await env.db.prepare('SELECT account_id AS accountId, user_id AS userId FROM account WHERE email = ?').bind(ADMIN).first();
    const existing = await env.db.prepare("INSERT INTO email(account_id,user_id,subject,text) VALUES (?,?,?,?) RETURNING email_id AS emailId")
      .bind(account.accountId, account.userId, 'preserved 324 mail', 'unchanged body').first();
    const settingBefore = await env.db.prepare('SELECT * FROM setting').first();
    // Simulate a healthy 324 database: the additive Reply-To column and its marker do not exist yet.
    await env.db.batch([
      env.db.prepare('ALTER TABLE email DROP COLUMN reply_to'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 325'),
    ]);

    const behindRes = await api('/admin/schema', { cookie: adminCookie });
    expect(behindRes.status).toBe(200);
    const behindData = (await behindRes.json()).data;
    expect(behindData.currentVersion).toMatchObject({ id: 324, label: 'v3.24' });
    expect(behindData.latestVersion).toMatchObject({ id: 325, label: 'v3.25' });
    expect(behindData.upgradeRequired).toBe(true);
    expect(behindData.upgradeBlocking).toBe(false);
    expect(behindData.pendingPatches).toEqual([
      expect.objectContaining({ version: 325, label: 'v3.25', descKey: 'schemaPatch325' }),
    ]);
    expect((await login(ADMIN))).toBeTruthy();

    // Admin runs upgrade
    const upgradeRes = await api('/admin/upgrade', { method: 'POST', cookie: adminCookie });
    expect(upgradeRes.status).toBe(200);

    // After upgrade, re-check schema status
    const afterRes = await api('/admin/schema', { cookie: adminCookie });
    expect(afterRes.status).toBe(200);
    const afterData = (await afterRes.json()).data;
    expect(afterData.currentVersion).toMatchObject({ id: 325, label: 'v3.25' });
    expect(afterData.latestVersion).toMatchObject({ id: 325, label: 'v3.25' });
    expect(afterData.upgradeRequired).toBe(false);
    expect(afterData.pendingPatches).toEqual([]);
    const replyToColumn = (await env.db.prepare("PRAGMA table_info('email')").all()).results.find(column => column.name === 'reply_to');
    expect(replyToColumn).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "'[]'" });
    expect(await env.db.prepare('SELECT subject, text, reply_to AS replyTo FROM email WHERE email_id = ?').bind(existing.emailId).first())
      .toMatchObject({ subject: 'preserved 324 mail', text: 'unchanged body', replyTo: '[]' });
    expect(await env.db.prepare('SELECT * FROM setting').first()).toEqual(settingBefore);

    expect((await api('/admin/upgrade', { method: 'POST', cookie: adminCookie })).status).toBe(200);
    expect(await env.db.prepare('SELECT reply_to AS replyTo FROM email WHERE email_id = ?').bind(existing.emailId).first())
      .toEqual({ replyTo: '[]' });
  });

  it('keeps a 323 database usable and upgrades both additive patches to current', async () => {
    const adminCookie = await login(ADMIN);
    await env.db.batch([
      env.db.prepare('ALTER TABLE email DROP COLUMN reply_to'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 325'),
      env.db.prepare('DROP TABLE mail_provider_config'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 324'),
    ]);

    const behind = await api('/admin/schema', { cookie: adminCookie });
    expect(behind.status).toBe(200);
    const behindData = (await behind.json()).data;
    expect(behindData.currentVersion).toMatchObject({ id: 323, label: 'v3.23' });
    expect(behindData.latestVersion).toMatchObject({ id: 325, label: 'v3.25' });
    expect(behindData).toMatchObject({ upgradeRequired: true, upgradeBlocking: false, upgradeSupported: true });
    expect(behindData.pendingPatches).toEqual([
      expect.objectContaining({ version: 324, descKey: 'schemaPatch324' }),
      expect.objectContaining({ version: 325, descKey: 'schemaPatch325' }),
    ]);
    expect(await login(ADMIN)).toBeTruthy();

    expect((await api('/admin/upgrade', { method: 'POST', cookie: adminCookie })).status).toBe(200);
    const upgraded = (await (await api('/admin/schema', { cookie: adminCookie })).json()).data;
    expect(upgraded).toMatchObject({
      currentVersion: { id: 325, label: 'v3.25' },
      latestVersion: { id: 325, label: 'v3.25' },
      upgradeRequired: false,
      upgradeBlocking: false,
    });
    expect(upgraded.pendingPatches).toEqual([]);
    expect(await dbInit.v3_24Applied(context())).toBe(true);
    expect(await dbInit.v3_25Applied(context())).toBe(true);
  });

  it('blocks a forged 325 marker when the Reply-To column is missing', async () => {
    await env.db.prepare('ALTER TABLE email DROP COLUMN reply_to').run();
    try {
      const status = await api('/setup/status');
      expect(status.status).toBe(200);
      expect((await status.json()).data).toMatchObject({
        upgradeRequired: true,
        upgradeBlocking: true,
        upgradeSupported: true,
      });
      await expect(dbInit.v3_25DB(context())).rejects.toThrow('requires manual recovery');
      expect(dbInit.requiresManualRecovery(new Error('Reply-To migration requires manual recovery.'))).toBe(true);
    } finally {
      await env.db.prepare('DELETE FROM schema_migrations WHERE version = 325').run();
      await dbInit.v3_25DB(context());
    }
  });
});
