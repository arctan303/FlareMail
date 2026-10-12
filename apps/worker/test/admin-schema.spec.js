import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import oauthService from '../src/service/oauth-service';
import sessionService from '../src/service/session-service';
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

async function removeWebhookPatch() {
  await env.db.batch([
    env.db.prepare('DROP TABLE IF EXISTS webhook_delivery'),
    env.db.prepare('DROP TABLE IF EXISTS webhook_config'),
    env.db.prepare('DELETE FROM schema_migrations WHERE version=327'),
  ]);
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
      currentVersion: { id: 327, label: 'v3.27' },
      latestVersion: { id: 327, label: 'v3.27' },
      upgradeRequired: false,
      upgradeBlocking: false,
      upgradeSupported: true,
      pendingPatches: [],
    });
    expect(Array.isArray(body.data.history)).toBe(true);
    expect(body.data.history.length).toBeGreaterThanOrEqual(14);
    const topPatch = body.data.history[0];
    expect(topPatch.version).toBe(327);
    expect(topPatch.label).toBe('v3.27');
    expect(topPatch.descKey).toBe('schemaPatch327');
    expect(topPatch.appliedTime).toBeTruthy();
  });

  it('reports pending patch when database is behind, and updates after upgrade', async () => {
    const adminCookie = await login(ADMIN);
    const account = await env.db.prepare('SELECT account_id AS accountId, user_id AS userId FROM account WHERE email = ?').bind(ADMIN).first();
    const existing = await env.db.prepare("INSERT INTO email(account_id,user_id,subject,text) VALUES (?,?,?,?) RETURNING email_id AS emailId")
      .bind(account.accountId, account.userId, 'preserved 324 mail', 'unchanged body').first();
    const settingBefore = await env.db.prepare('SELECT * FROM setting').first();
    // Simulate a healthy 324 database: the additive Reply-To column and its marker do not exist yet.
    await removeWebhookPatch();
    await env.db.batch([
      env.db.prepare('ALTER TABLE email DROP COLUMN reply_to'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 325'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 326'),
      env.db.prepare('ALTER TABLE user DROP COLUMN session_epoch'),
      env.db.prepare('ALTER TABLE user DROP COLUMN preserved_session_hash'),
      env.db.prepare('DROP TABLE session_revocation'),
    ]);

    const behindRes = await api('/admin/schema', { cookie: adminCookie });
    expect(behindRes.status).toBe(200);
    const behindData = (await behindRes.json()).data;
    expect(behindData.currentVersion).toMatchObject({ id: 324, label: 'v3.24' });
    expect(behindData.latestVersion).toMatchObject({ id: 327, label: 'v3.27' });
    expect(behindData.upgradeRequired).toBe(true);
    expect(behindData.upgradeBlocking).toBe(false);
    expect(behindData.pendingPatches).toEqual([
      expect.objectContaining({ version: 325, label: 'v3.25', descKey: 'schemaPatch325' }),
      expect.objectContaining({ version: 326, label: 'v3.26', descKey: 'schemaPatch326' }),
      expect.objectContaining({ version: 327, label: 'v3.27', descKey: 'schemaPatch327' }),
    ]);
    expect((await login(ADMIN))).toBeTruthy();

    // Admin runs upgrade
    const upgradeRes = await api('/admin/upgrade', { method: 'POST', cookie: adminCookie });
    expect(upgradeRes.status).toBe(200);

    // After upgrade, re-check schema status
    const afterRes = await api('/admin/schema', { cookie: adminCookie });
    expect(afterRes.status).toBe(200);
    const afterData = (await afterRes.json()).data;
    expect(afterData.currentVersion).toMatchObject({ id: 327, label: 'v3.27' });
    expect(afterData.latestVersion).toMatchObject({ id: 327, label: 'v3.27' });
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

  it('keeps a 323 database usable and upgrades the additive patches to current', async () => {
    const adminCookie = await login(ADMIN);
    await removeWebhookPatch();
    await env.db.batch([
      env.db.prepare('ALTER TABLE email DROP COLUMN reply_to'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 325'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 326'),
      env.db.prepare('ALTER TABLE user DROP COLUMN session_epoch'),
      env.db.prepare('ALTER TABLE user DROP COLUMN preserved_session_hash'),
      env.db.prepare('DROP TABLE session_revocation'),
      env.db.prepare('DROP TABLE mail_provider_config'),
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 324'),
    ]);

    const behind = await api('/admin/schema', { cookie: adminCookie });
    expect(behind.status).toBe(200);
    const behindData = (await behind.json()).data;
    expect(behindData.currentVersion).toMatchObject({ id: 323, label: 'v3.23' });
    expect(behindData.latestVersion).toMatchObject({ id: 327, label: 'v3.27' });
    expect(behindData).toMatchObject({ upgradeRequired: true, upgradeBlocking: false, upgradeSupported: true });
    expect(behindData.pendingPatches).toEqual([
      expect.objectContaining({ version: 324, descKey: 'schemaPatch324' }),
      expect.objectContaining({ version: 325, descKey: 'schemaPatch325' }),
      expect.objectContaining({ version: 326, descKey: 'schemaPatch326' }),
      expect.objectContaining({ version: 327, descKey: 'schemaPatch327' }),
    ]);
    expect(await login(ADMIN)).toBeTruthy();

    expect((await api('/admin/upgrade', { method: 'POST', cookie: adminCookie })).status).toBe(200);
    const upgraded = (await (await api('/admin/schema', { cookie: adminCookie })).json()).data;
    expect(upgraded).toMatchObject({
      currentVersion: { id: 327, label: 'v3.27' },
      latestVersion: { id: 327, label: 'v3.27' },
      upgradeRequired: false,
      upgradeBlocking: false,
    });
    expect(upgraded.pendingPatches).toEqual([]);
    expect(await dbInit.v3_24Applied(context())).toBe(true);
    expect(await dbInit.v3_25Applied(context())).toBe(true);
    expect(await dbInit.v3_26Applied(context())).toBe(true);
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

  it('keeps 325 password sessions and login usable, blocks Google replacement until upgrade, and preserves user data', async () => {
    const adminCookie = await login(ADMIN);
    const admin = await env.db.prepare('SELECT user_id AS userId FROM user WHERE email = ?').bind(ADMIN).first();
    await env.db.prepare('UPDATE user SET google_sub = ? WHERE user_id = ?').bind('325-google-before', admin.userId).run();
    const before = await env.db.prepare('SELECT email, password, salt, google_sub FROM user WHERE user_id = ?').bind(admin.userId).first();
    const settings = await env.db.prepare('SELECT * FROM setting').first();
    const hash = await cryptoUtils.hashSecret(adminCookie.slice(adminCookie.indexOf('=') + 1));
    await removeWebhookPatch();
    await env.db.batch([
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 326'),
      env.db.prepare('ALTER TABLE user DROP COLUMN session_epoch'),
      env.db.prepare('ALTER TABLE user DROP COLUMN preserved_session_hash'),
      env.db.prepare('DROP TABLE session_revocation'),
    ]);
    try {
      const schema = (await (await api('/admin/schema', { cookie: adminCookie })).json()).data;
      expect(schema).toMatchObject({ currentVersion: { id: 325 }, latestVersion: { id: 327 }, upgradeRequired: true, upgradeBlocking: false });
      expect(await login(ADMIN)).toBeTruthy();
      const legacyLogout = await login(ADMIN);
      expect((await api('/logout', { method: 'DELETE', cookie: legacyLogout })).status).toBe(200);
      const session = await sessionService.resolveByHash(context(), hash);
      expect(session).not.toBeNull();
      await expect(oauthService.bind(context(), admin.userId, '325-google-after', 'after@gmail.com', session)).rejects.toMatchObject({ code: 428 });
      expect((await api('/admin/upgrade', { method: 'POST', cookie: adminCookie })).status).toBe(200);
      expect(await env.db.prepare('SELECT email, password, salt, google_sub FROM user WHERE user_id = ?').bind(admin.userId).first()).toEqual(before);
      expect(await env.db.prepare('SELECT * FROM setting').first()).toEqual(settings);
      expect(await sessionService.resolveByHash(context(), hash)).not.toBeNull();
      const fields = (await env.db.prepare("PRAGMA table_info('user')").all()).results;
      expect(fields.find(field => field.name === 'session_epoch')).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' });
      expect(fields.find(field => field.name === 'preserved_session_hash')).toMatchObject({ type: 'TEXT', notnull: 1, dflt_value: "''" });
      expect(await dbInit.v3_26RevocationValid(context())).toBe(true);
      await dbInit.migrate(context());
      expect(await env.db.prepare('SELECT email, password, salt, google_sub FROM user WHERE user_id = ?').bind(admin.userId).first()).toEqual(before);
    } finally {
      await dbInit.v3_26DB(context());
      await env.db.prepare("UPDATE user SET google_sub = '' WHERE user_id = ?").bind(admin.userId).run();
    }
  });

  it('finishes an interrupted additive 326 migration without resetting existing epochs', async () => {
    await env.db.batch([
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 326'),
      env.db.prepare('ALTER TABLE user DROP COLUMN preserved_session_hash'),
      env.db.prepare('UPDATE user SET session_epoch = 7 WHERE email = ?').bind(MEMBER),
    ]);
    try {
      expect(await dbInit.v3_26UpgradePending(context())).toBe(true);
      await dbInit.v3_26DB(context());
      expect(await dbInit.v3_26Applied(context())).toBe(true);
      expect(await env.db.prepare('SELECT session_epoch, preserved_session_hash FROM user WHERE email = ?').bind(MEMBER).first())
        .toEqual({ session_epoch: 7, preserved_session_hash: '' });
    } finally {
      await dbInit.v3_26DB(context());
      await env.db.prepare('UPDATE user SET session_epoch = 0 WHERE email = ?').bind(MEMBER).run();
    }
  });

  it('blocks forged 326 markers and incompatible existing epoch columns without mutation', async () => {
    await env.db.prepare('ALTER TABLE user DROP COLUMN session_epoch').run();
    try {
      expect(await dbInit.inspectExistingSchema(context())).toMatchObject({ current: false, compatible: false });
      await expect(dbInit.v3_26DB(context())).rejects.toThrow('requires manual recovery');
      await env.db.prepare('DELETE FROM schema_migrations WHERE version = 326').run();
      await env.db.prepare("ALTER TABLE user ADD COLUMN session_epoch TEXT NOT NULL DEFAULT 'wrong'").run();
      const before = (await env.db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all()).results;
      await expect(dbInit.v3_26DB(context())).rejects.toThrow('requires manual recovery');
      expect((await env.db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all()).results).toEqual(before);
    } finally {
      await env.db.prepare('DELETE FROM schema_migrations WHERE version = 326').run();
      const fields = (await env.db.prepare("PRAGMA table_info('user')").all()).results;
      if (fields.some(field => field.name === 'session_epoch')) await env.db.prepare('ALTER TABLE user DROP COLUMN session_epoch').run();
      await dbInit.v3_26DB(context());
    }
  });

  it('restores a missing revocation index without changing persisted revocations', async () => {
    await env.db.prepare('INSERT INTO session_revocation(session_hash,user_id,expires_at) VALUES (?,?,?)')
      .bind('schema-preserved-deny', 1, Date.now() + 60000).run();
    const before = await env.db.prepare('SELECT * FROM session_revocation WHERE session_hash = ?').bind('schema-preserved-deny').first();
    await env.db.batch([
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 326'),
      env.db.prepare('DROP INDEX idx_session_revocation_expires'),
    ]);
    try {
      expect(await dbInit.v3_26UpgradePending(context())).toBe(true);
      await dbInit.v3_26DB(context());
      expect(await dbInit.v3_26Applied(context())).toBe(true);
      expect(await env.db.prepare('SELECT * FROM session_revocation WHERE session_hash = ?').bind('schema-preserved-deny').first()).toEqual(before);
    } finally { await dbInit.v3_26DB(context()); }
  });

  it('refuses incompatible revocation tables and indexes before any migration writes', async () => {
    const beforeRows = (await env.db.prepare('SELECT * FROM session_revocation').all()).results;
    await env.db.batch([
      env.db.prepare('DELETE FROM schema_migrations WHERE version = 326'),
      env.db.prepare('DROP INDEX idx_session_revocation_expires'),
      env.db.prepare('CREATE INDEX idx_session_revocation_expires ON session_revocation(user_id)'),
    ]);
    try {
      const wrongIndex = (await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results;
      await expect(dbInit.v3_26DB(context())).rejects.toThrow('requires manual recovery');
      expect((await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results).toEqual(wrongIndex);
      await env.db.batch([
        env.db.prepare('DROP INDEX idx_session_revocation_expires'),
        env.db.prepare('CREATE UNIQUE INDEX idx_session_revocation_expires ON session_revocation(expires_at)'),
      ]);
      await expect(dbInit.v3_26DB(context())).rejects.toThrow('requires manual recovery');
      await env.db.batch([
        env.db.prepare('DROP TABLE session_revocation'),
        env.db.prepare('CREATE TABLE session_revocation(session_hash TEXT NOT NULL PRIMARY KEY,user_id INTEGER NOT NULL,expires_at TEXT NOT NULL)'),
      ]);
      const wrongTable = (await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results;
      await expect(dbInit.v3_26DB(context())).rejects.toThrow('requires manual recovery');
      expect((await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results).toEqual(wrongTable);
    } finally {
      await env.db.prepare('DROP TABLE session_revocation').run();
      await dbInit.v3_26DB(context());
      for (const row of beforeRows) await env.db.prepare('INSERT INTO session_revocation(session_hash,user_id,expires_at) VALUES (?,?,?)')
        .bind(row.session_hash,row.user_id,row.expires_at).run();
    }
  });
});
