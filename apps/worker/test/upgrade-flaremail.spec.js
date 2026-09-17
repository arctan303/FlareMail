import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import { migrations } from '../src/init/migrations';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import baseline from './fixtures/schema-318.json';

const PASSWORD = 'upgrade-fixture-password-2026';
const SETUP_SECRET = 'upgrade-fixture-setup-token-2026';
const CLI_HASH = 'sha256$' + 'a'.repeat(64);
const EXISTING_ACCESS_TOKEN = 't'.repeat(43);
const ATTACHMENT_KEY = 'attachments/upgrade-fixture/kept.txt';
const BUSINESS_TABLES = ['user', 'account', 'email', 'attachments', 'contact', 'star', 'oauth_authorization_code'];
const allow = { limit: async () => ({ success: true }) };

function runtimeEnv() {
  return {
    ...env,
    FLAREMAIL_ADMIN_PASSWORD: 'changed-env-password-must-not-reset-existing-users',
    SETUP_SECRET,
    FLAREMAIL_DOMAINS: ['example.com', 'example.net'],
    LOGIN_RATE_LIMITER: allow,
    EMAIL_RATE_LIMITER: allow,
    SETUP_RATE_LIMITER: allow,
    SETUP_STATUS_RATE_LIMITER: allow,
  };
}

function context(runtime = runtimeEnv()) {
  const values = new Map();
  return { env: runtime, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

function identifier(name) {
  return '"' + name.replaceAll('"', '""') + '"';
}

async function api(path, options = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('http://localhost' + path, options), runtimeEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function post(path, body, cookie) {
  return api(path, {
    method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function login(email) {
  const response = await post('/api/login', { email, password: PASSWORD });
  expect((await response.json()).code).toBe(200);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toContain('HttpOnly');
  return cookie.split(';')[0];
}

async function businessSnapshot() {
  const rows = {};
  for (const table of BUSINESS_TABLES) {
    rows[table] = (await env.db.prepare('SELECT * FROM ' + identifier(table) + ' ORDER BY 1').all()).results;
  }
  rows.attachmentBody = await (await env.r2.get(ATTACHMENT_KEY)).text();
  rows.keptSession = await env.kv.get('upgrade:kept-session');
  rows.keptProviderToken = await env.kv.get('oauth:provider:token:' + await cryptoUtils.hashSecret(EXISTING_ACCESS_TOKEN));
  return rows;
}

async function completeSnapshot() {
	const runtimeTable = await env.db.prepare(`
		SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_config'
	`).first();
  return {
    business: await businessSnapshot(),
    structures: (await env.db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB '_*' ORDER BY name").all()).results,
		settings: (await env.db.prepare('SELECT * FROM setting').all()).results,
		runtime: runtimeTable ? (await env.db.prepare('SELECT * FROM runtime_config').all()).results : [],
    markers: (await env.db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results,
    settingCache: await env.kv.get(KvConst.SETTING),
  };
}

async function restoreFrozen318() {
  const tables = await env.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_*'").all();
  for (const { name } of tables.results) await env.db.prepare('DROP TABLE ' + identifier(name)).run();
  for (const object of baseline.schema) await env.db.prepare(object.sql).run();
  const settings = {
    ...baseline.settings,
    title: 'My existing mailbox',
    forward_email: 'forward@example.net',
    black_subject: 'keep-this-filter',
    google_client_id: 'existing-client-id',
    google_client_secret: 'fixture-only-existing-google-secret',
    resend_tokens: '{"example.com":"fixture-only-existing-send-token"}',
  };
  const columns = Object.keys(settings);
  await env.db.prepare('INSERT INTO setting (' + columns.map(identifier).join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')')
    .bind(...columns.map(key => settings[key])).run();
  for (const version of baseline.versions) {
    await env.db.prepare("INSERT INTO schema_migrations(version,applied_time) VALUES (?, '2026-09-14 00:00:00')").bind(version).run();
  }
  for (const [id, email, admin] of [[1, env.FLAREMAIL_ADMIN_EMAIL, 1], [2, 'member@example.com', 0]]) {
    const salt = 'fixture-salt-' + id;
    const password = await cryptoUtils.genHashPassword(PASSWORD, salt);
    await env.db.prepare('INSERT INTO user(user_id,email,password,salt,is_admin,cli_token) VALUES (?,?,?,?,?,?)')
      .bind(id, email, password, salt, admin, CLI_HASH).run();
    await env.db.prepare('INSERT INTO account(account_id,email,user_id,all_receive,is_default_send) VALUES (?,?,?,1,1)')
      .bind(id, email, id).run();
    await env.db.prepare("INSERT INTO email(email_id,account_id,user_id,subject,text,to_email,unread) VALUES (?,?,?,?,?,?,?)")
      .bind(id, id, id, 'kept-message-' + id, 'existing message body ' + id, email, id === 1 ? 1 : 0).run();
  }
  await env.db.prepare("INSERT INTO account(account_id,email,user_id,all_receive,is_default_send,forward_status) VALUES (3,'alias@example.net',1,0,0,1)").run();
  await env.db.prepare("INSERT INTO attachments(att_id,user_id,email_id,account_id,key,filename,mime_type,size) VALUES (1,1,1,1,?,'kept.txt','text/plain',15)")
    .bind(ATTACHMENT_KEY).run();
  await env.db.prepare("INSERT INTO contact(contact_id,user_id,name,email,remark) VALUES (1,1,'Existing contact','friend@example.net','keep contact')").run();
  await env.db.prepare('INSERT INTO star(star_id,user_id,email_id) VALUES (1,1,1)').run();
  await env.db.prepare('INSERT INTO oauth_authorization_code(code_hash,client_id,redirect_uri,user_id,code_challenge,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind('fixture-code-hash', 'fixture-site', 'https://site.example.net/callback', 1, 'fixture-challenge', 1, 9999999999999).run();
  await env.r2.put(ATTACHMENT_KEY, 'kept attachment');
  await env.kv.put('upgrade:kept-session', 'existing-session-marker');
  const existingUser = await env.db.prepare('SELECT password FROM user WHERE user_id=1').first();
  await env.kv.put('oauth:provider:token:' + await cryptoUtils.hashSecret(EXISTING_ACCESS_TOKEN), JSON.stringify({clientId:'fixture-site',userId:1,credentialFingerprint:await cryptoUtils.hashSecret(existingUser.password)}), {expirationTtl:300});
  await env.kv.put(KvConst.SETTING, '{"title":"stale cached title"}');
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await restoreFrozen318();
});

describe('upgrades from the frozen pre-FlareMail 318 database', () => {
  it('keeps status read-only and upgrades through the real recovery endpoint without resetting data or passwords', async () => {
    const before = await completeSnapshot();
    const status = await (await api('/api/setup/status')).json();
    expect(status.code).toBe(200);
    expect(status.data).toMatchObject({ setupRequired: false, upgradeRequired: true, upgradeSupported: true });
    expect(await completeSnapshot()).toEqual(before);

    const upgraded = await (await post('/api/setup/upgrade', { setupToken: SETUP_SECRET })).json();
    expect(upgraded.code).toBe(200);
    expect(await businessSnapshot()).toEqual(before.business);
    const afterSetting = await env.db.prepare('SELECT * FROM setting').first();
    for (const [key, value] of Object.entries(before.settings[0])) expect(afterSetting[key], key).toEqual(value);
    expect((await (await api('/api/setup/status')).json()).data.upgradeRequired).toBe(false);
    expect((await (await api('/api/setting/websiteConfig')).json()).data.title).toBe('My existing mailbox');

    expect(afterSetting.oauth_provider_enabled).toBe(0);
    expect(afterSetting.oauth_provider_revision).toBe(0);
    expect(JSON.parse(afterSetting.oauth_provider_clients)).toEqual([]);
    const existingIdentity = await (await api('/oauth/userinfo', {headers:{Authorization:'Bearer '+EXISTING_ACCESS_TOKEN}})).json();
    expect(existingIdentity.sub).toBe('1');
    expect(existingIdentity.email).toBe(env.FLAREMAIL_ADMIN_EMAIL);

    // Changing the bootstrap environment password during deployment must not
    // reinitialize an existing administrator or change mailbox ownership.
    const adminCookie = await login(env.FLAREMAIL_ADMIN_EMAIL);
    const memberCookie = await login('member@example.com');
    const adminMail = await (await api('/api/email/list?accountId=1&type=0', { headers: { Cookie: adminCookie } })).json();
    expect(adminMail.code).toBe(200);
    expect(adminMail.data.list.map(item => item.subject)).toEqual(['kept-message-1']);
    const denied = await (await api('/api/email/list?accountId=1&type=0', { headers: { Cookie: memberCookie } })).json();
    expect(denied.code).not.toBe(200);
    expect((await (await api('/api/email/list?accountId=2&type=0', { headers: { Cookie: memberCookie } })).json()).data.list.map(item => item.subject))
      .toEqual(['kept-message-2']);
  });

  it('keeps saved branding, source settings and business data unchanged on repeated migrations', async () => {
    await dbInit.migrate(context());
    await env.db.prepare("UPDATE setting SET title=?, site_description=?, site_logo=?, login_copy=?, site_links=?")
      .bind('Configured mailbox', 'Saved description', 'https://images.example.net/logo.png', '{"subtitle":"Saved subtitle"}', '[{"label":"Home","url":"https://site.example.net"}]').run();
		await env.db.prepare('UPDATE setting SET oauth_provider_enabled=1,oauth_provider_revision=9,oauth_provider_clients=?').bind(JSON.stringify([{clientId:'saved-site',displayName:'My site',enabled:true,redirects:[{redirectUri:'https://site.example.net/callback',silentFrameAncestor:'https://site.example.net'}]}])).run();
		await env.db.prepare(`UPDATE runtime_config SET oauth_issuer = ?, oauth_secret = ? WHERE id = 1`)
			.bind('https://mail.example.com', 'fixture-only-repeated-upgrade-secret').run();
    const before = await completeSnapshot();
    await dbInit.migrate(context());
    await dbInit.migrate(context());
    const after = await completeSnapshot();
    expect(after.business).toEqual(before.business);
		expect(after.settings).toEqual(before.settings);
		expect(after.runtime).toEqual(before.runtime);
    expect(after.markers).toEqual(before.markers);
    expect(after.structures).toEqual(before.structures);
    const publicConfig = await (await api('/api/setting/websiteConfig')).json();
    expect(publicConfig.data.title).toBe('Configured mailbox');
    expect(publicConfig.data.siteDescription).toBe('Saved description');
  });

  it('recovers a partially applied new migration without marking it complete or replaying legacy cleanup', async () => {
    const before = await businessSnapshot();
    const partial = vi.spyOn(migrations, 'v3_19DB').mockImplementationOnce(async c => {
      await c.env.db.prepare("ALTER TABLE setting ADD COLUMN site_description TEXT NOT NULL DEFAULT ''").run();
      throw new Error('injected interruption before brand migration completion');
    });
    try {
      await expect(dbInit.migrate(context())).rejects.toThrow('injected interruption');
    } finally {
      partial.mockRestore();
    }
    expect(await env.db.prepare('SELECT version FROM schema_migrations WHERE version=319').first()).toBeNull();
    expect((await dbInit.setupStatus(context())).upgradeRequired).toBe(true);
    expect(await businessSnapshot()).toEqual(before);
    await dbInit.migrate(context());
    expect((await dbInit.setupStatus(context())).upgradeRequired).toBe(false);
    expect(await businessSnapshot()).toEqual(before);
  });

  it('repairs missing new columns even with the marker present, retaining other saved values', async () => {
    await dbInit.migrate(context());
    await env.db.prepare("UPDATE setting SET site_description='persisted description', login_copy='{\"subtitle\":\"keep me\"}'").run();
    await env.db.prepare('ALTER TABLE setting DROP COLUMN site_logo').run();
    const before = await businessSnapshot();
    expect((await dbInit.setupStatus(context())).upgradeRequired).toBe(true);
    await dbInit.migrate(context());
    const settings = await env.db.prepare('SELECT * FROM setting').first();
    expect(settings.site_logo).toBe('');
    expect(settings.site_description).toBe('persisted description');
    expect(JSON.parse(settings.login_copy).subtitle).toBe('keep me');
    expect(await businessSnapshot()).toEqual(before);
  });

  it('supports markerless safe schemas without changing existing business ownership', async () => {
    await env.db.prepare('DELETE FROM schema_migrations').run();
    const before = await businessSnapshot();
    expect((await dbInit.setupStatus(context())).upgradeSupported).toBe(true);
    await dbInit.migrate(context());
    expect((await dbInit.setupStatus(context())).upgradeRequired).toBe(false);
    expect(await businessSnapshot()).toEqual(before);
  });

  it.each([0, 2])('rejects an existing database with %i setting rows before any migration writes', async rowCount => {
    if (rowCount === 0) await env.db.prepare('DELETE FROM setting').run();
    else await env.db.prepare('INSERT INTO setting SELECT * FROM setting').run();
    const before = await completeSnapshot();
    const status = await dbInit.setupStatus(context());
    expect(status.upgradeSupported).toBe(false);
    expect(await completeSnapshot()).toEqual(before);
    await expect(dbInit.migrate(context())).rejects.toThrow();
    expect(await completeSnapshot()).toEqual(before);
  });

  it('repairs a partial provider migration without resetting saved brand values', async () => {
    await migrations.v3_19DB(context());
    await env.db.prepare("UPDATE setting SET site_description='saved before provider upgrade'").run();
    const before = await businessSnapshot();
    const partial = vi.spyOn(migrations, 'v3_20DB').mockImplementationOnce(async c => {
      await c.env.db.prepare('ALTER TABLE setting ADD COLUMN oauth_provider_enabled INTEGER NOT NULL DEFAULT 0').run();
      throw new Error('injected provider structure failure');
    });
    try {
      await expect(dbInit.migrate(context())).rejects.toThrow('injected provider');
    } finally { partial.mockRestore(); }
    expect(await env.db.prepare('SELECT version FROM schema_migrations WHERE version=320').first()).toBeNull();
    expect((await dbInit.setupStatus(context())).upgradeRequired).toBe(true);
    await dbInit.migrate(context());
    const saved = await env.db.prepare('SELECT * FROM setting').first();
    expect(saved.site_description).toBe('saved before provider upgrade');
    expect(saved.oauth_provider_enabled).toBe(0);
    expect(saved.oauth_provider_clients).toBe('[]');
    expect(await businessSnapshot()).toEqual(before);
  });

  it('recovers a marker write interruption without replaying legacy cleanup or clearing saved values', async () => {
    const before = await businessSnapshot();
    const markerStatements = new WeakSet();
    const failDb = new Proxy(env.db, {
      get(target, property) {
        if (property === 'prepare') return sql => {
          const statement = target.prepare(sql);
          if (/INSERT[\s\S]*INTO\s+schema_migrations/i.test(sql) && /\b319\b/.test(sql)) markerStatements.add(statement);
          return statement;
        };
        if (property === 'batch') return async statements => {
          if (statements.some(item => markerStatements.has(item))) {
            // Deliberately model an interrupted non-atomic historical boundary:
            // columns exist, but the success marker was never persisted.
            await target.batch(statements.filter(item => !markerStatements.has(item)));
            throw new Error('injected marker write failure');
          }
          return target.batch(statements);
        };
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(dbInit.migrate(context({...runtimeEnv(),db:failDb}))).rejects.toThrow('injected marker');
    expect(await env.db.prepare('SELECT version FROM schema_migrations WHERE version=319').first()).toBeNull();
    await env.db.prepare("UPDATE setting SET site_description='saved after interrupted marker'").run();
    await dbInit.migrate(context());
    expect((await dbInit.setupStatus(context())).upgradeRequired).toBe(false);
    expect((await env.db.prepare('SELECT site_description FROM setting').first()).site_description).toBe('saved after interrupted marker');
    expect(await businessSnapshot()).toEqual(before);
  });

  it('reports cache refresh failure and safely retries with authoritative D1 settings preserved', async () => {
    const before = await businessSnapshot();
    const failKv = new Proxy(env.kv, {
      get(target, property) {
        if (property === 'put') return async (key, ...args) => {
          if (key === KvConst.SETTING) throw new Error('injected setting cache failure');
          return target.put(key, ...args);
        };
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(dbInit.migrate(context({...runtimeEnv(),kv:failKv}))).rejects.toThrow('injected setting cache');
    const saved = await env.db.prepare('SELECT * FROM setting').first();
    await dbInit.migrate(context());
    expect((await dbInit.setupStatus(context())).upgradeRequired).toBe(false);
    expect(await env.db.prepare('SELECT * FROM setting').first()).toEqual(saved);
    expect(await businessSnapshot()).toEqual(before);
  });

});
