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
      currentVersion: { id: 324, label: 'v3.24' },
      latestVersion: { id: 324, label: 'v3.24' },
      upgradeRequired: false,
      upgradeBlocking: false,
      upgradeSupported: true,
      pendingPatches: [],
    });
    expect(Array.isArray(body.data.history)).toBe(true);
    expect(body.data.history.length).toBeGreaterThanOrEqual(14);
    const topPatch = body.data.history[0];
    expect(topPatch.version).toBe(324);
    expect(topPatch.label).toBe('v3.24');
    expect(topPatch.descKey).toBe('schemaPatch324');
    expect(topPatch.appliedTime).toBeTruthy();
  });

  it('reports pending patch when database is behind, and updates after upgrade', async () => {
    const adminCookie = await login(ADMIN);
    // Simulate being behind by removing patch 324 marker and table
    await env.db.batch([
      env.db.prepare('DROP TABLE IF EXISTS mail_provider_config'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 324'),
    ]);

    const behindRes = await api('/admin/schema', { cookie: adminCookie });
    expect(behindRes.status).toBe(200);
    const behindData = (await behindRes.json()).data;
    expect(behindData.currentVersion).toMatchObject({ id: 323, label: 'v3.23' });
    expect(behindData.latestVersion).toMatchObject({ id: 324, label: 'v3.24' });
    expect(behindData.upgradeRequired).toBe(true);
    expect(behindData.pendingPatches).toEqual([
      expect.objectContaining({ version: 324, label: 'v3.24', descKey: 'schemaPatch324' }),
    ]);

    // Admin runs upgrade
    const upgradeRes = await api('/admin/upgrade', { method: 'POST', cookie: adminCookie });
    expect(upgradeRes.status).toBe(200);

    // After upgrade, re-check schema status
    const afterRes = await api('/admin/schema', { cookie: adminCookie });
    expect(afterRes.status).toBe(200);
    const afterData = (await afterRes.json()).data;
    expect(afterData.currentVersion).toMatchObject({ id: 324, label: 'v3.24' });
    expect(afterData.latestVersion).toMatchObject({ id: 324, label: 'v3.24' });
    expect(afterData.upgradeRequired).toBe(false);
    expect(afterData.pendingPatches).toEqual([]);
  });
});
