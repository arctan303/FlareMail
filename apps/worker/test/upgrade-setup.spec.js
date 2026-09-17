
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import baseline320 from './fixtures/schema-320.json';
import baseline321 from './fixtures/schema-321.json';

const PASSWORD = 'preserved-320-user-password';
const SETUP_SECRET = 'fixture-only-install-secret-320';
const ADMIN = 'owner@example.com';
const ATTACHMENT_KEY = 'attachments/upgrade-320/keep.txt';
const PROVIDER_SECRET = 'fixture-only-provider-shared-secret';
const clients = [{
  clientId: 'fixture-site', displayName: 'Existing site', enabled: true,
  redirects: [{redirectUri: 'https://site.example.net/callback', silentFrameAncestor: null}],
}];
const allow = { limit: async () => ({ success: true }) };
const businessTables = ['user', 'account', 'email', 'attachments', 'contact', 'star', 'oauth_authorization_code'];
const quote = name => '"' + name.replaceAll('"', '""') + '"';

function runtime(overrides = {}) {
  return {
    ...env,
    SETUP_SECRET,
    FLAREMAIL_ADMIN_EMAIL: ADMIN,
    FLAREMAIL_ADMIN_PASSWORD: 'new-deploy-value-must-not-reset-password',
    FLAREMAIL_DOMAINS: ['example.com', 'example.net'],
    FLAREMAIL_OAUTH_ISSUER: 'https://mail.example.com/',
    FLAREMAIL_CLIENT_SECRET: PROVIDER_SECRET,
    FLAREMAIL_GOOGLE_CLIENT_ID: 'old-env-google-id',
    FLAREMAIL_GOOGLE_CLIENT_SECRET: 'fixture-only-old-env-google-secret',
    // This retired setting must not participate in preflight or import.
    FLAREMAIL_PROJECT_LINK: 'unused-invalid-value',
    FLAREMAIL_ALLOWED_ORIGINS: ['https://extra.example.net'],
    LOGIN_RATE_LIMITER: allow,
    SETUP_RATE_LIMITER: allow,
    SETUP_STATUS_RATE_LIMITER: allow,
    EMAIL_RATE_LIMITER: allow,
    ...overrides,
  };
}

function context(config = runtime()) {
  const values = new Map();
  return { env: config, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, { method = 'GET', body, cookie, origin = 'http://localhost', config = runtime() } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('http://localhost' + path, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), config, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function login(email = ADMIN, password = PASSWORD) {
  const response = await request('/api/login', {method: 'POST', body: {email, password}});
  expect((await response.json()).code).toBe(200);
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  return response.headers.get('set-cookie').split(';')[0];
}

async function snapshot() {
  const data = {};
  for (const table of businessTables) {
    data[table] = (await env.db.prepare('SELECT * FROM ' + quote(table) + ' ORDER BY 1').all()).results;
  }
  data.attachment = await (await env.r2.get(ATTACHMENT_KEY)).text();
  data.session = await env.kv.get('upgrade320:preserved-session');
  return data;
}

async function fullSnapshot() {
  return {
    business: await snapshot(),
    settings: (await env.db.prepare('SELECT * FROM setting').all()).results,
    runtime: await env.db.prepare("SELECT 1 FROM sqlite_master WHERE name='runtime_config' AND type='table'").first()
      ? (await env.db.prepare('SELECT * FROM runtime_config ORDER BY 1').all()).results : null,
    structures: (await env.db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB '_*' ORDER BY name").all()).results,
    versions: (await env.db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).results,
  };
}

async function seedBaseline(baseline) {
  const tables = await env.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_*'").all();
  for (const {name} of tables.results) await env.db.prepare('DROP TABLE ' + quote(name)).run();
  for (const entry of baseline.schema) await env.db.prepare(entry.sql).run();
  const settings = {
    ...baseline.settings,
    title: 'Existing private mailbox',
    site_description: 'Keep my brand',
    site_links: JSON.stringify([{label: 'Home', url: 'https://example.com'}]),
    black_subject: 'keep-existing-filter',
    google_client_id: 'saved-google-id',
    google_client_secret: 'fixture-only-saved-google-secret',
    resend_tokens: '{"example.com":"fixture-only-saved-resend-token"}',
    oauth_provider_enabled: 1,
    oauth_provider_revision: 7,
    oauth_provider_clients: JSON.stringify(clients),
  };
  const columns = Object.keys(settings);
  await env.db.prepare('INSERT INTO setting (' + columns.map(quote).join(',') + ') VALUES (' + columns.map(() => '?').join(',') + ')')
    .bind(...columns.map(key => settings[key])).run();
  for (const version of baseline.versions) {
    await env.db.prepare("INSERT INTO schema_migrations(version,applied_time) VALUES (?, '2026-09-14 00:00:00')").bind(version).run();
  }
  for (const [id,email,admin] of [[1, ADMIN, 1], [2, 'member@example.net', 0]]) {
    const salt = 'fixture-320-salt-' + id;
    const hash = await cryptoUtils.genHashPassword(PASSWORD, salt);
    await env.db.prepare('INSERT INTO user(user_id,email,password,salt,is_admin,cli_token) VALUES (?,?,?,?,?,?)')
      .bind(id,email,hash,salt,admin,'sha256$'+'b'.repeat(64)).run();
    await env.db.prepare('INSERT INTO account(account_id,email,user_id,all_receive,is_default_send) VALUES (?,?,?,1,1)')
      .bind(id,email,id).run();
    await env.db.prepare('INSERT INTO email(email_id,account_id,user_id,subject,text,to_email) VALUES (?,?,?,?,?,?)')
      .bind(id,id,id,'preserved-'+id,'existing message '+id,email).run();
  }
  await env.db.prepare("INSERT INTO account(account_id,email,user_id,all_receive,is_default_send) VALUES (3,'alias@example.net',1,0,0)").run();
  await env.db.prepare("INSERT INTO attachments(att_id,user_id,email_id,account_id,key,filename,mime_type,size) VALUES (1,1,1,1,?,'keep.txt','text/plain',14)")
    .bind(ATTACHMENT_KEY).run();
  await env.db.prepare("INSERT INTO contact(contact_id,user_id,name,email) VALUES (1,1,'Existing contact','friend@example.net')").run();
  await env.db.prepare('INSERT INTO star(star_id,user_id,email_id) VALUES (1,1,1)').run();
  await env.db.prepare('INSERT INTO oauth_authorization_code(code_hash,client_id,redirect_uri,user_id,code_challenge,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind('fixture-320-code','fixture-site','https://site.example.net/callback',1,'fixture-challenge',1,9999999999999).run();
  if (baseline.schemaMarker === 321) {
    await env.db.prepare("INSERT INTO installation_state(id,status,revision,legacy_domain_imported) VALUES (1,'installed',3,1)").run();
    await env.db.batch(['example.com','example.net'].map(domain => env.db.prepare('INSERT INTO managed_domain(domain) VALUES (?)').bind(domain)));
  }
  await env.r2.put(ATTACHMENT_KEY, 'kept old bytes');
  await env.kv.put('upgrade320:preserved-session', 'keep-session-value');
}

describe.each([baseline320, baseline321])('upgrade from frozen FlareMail schema $schemaMarker', (baseline) => {
  beforeEach(() => seedBaseline(baseline));
  it('refuses password login until legacy login protection has been migrated, while keeping controlled upgrade available', async () => {
    await env.db.prepare('UPDATE setting SET site_key = ?').bind('1x00000000000000000000AA').run();
    const config = runtime({FLAREMAIL_TURNSTILE_SECRET:'1x0000000000000000000000000000000AA'});
    const before = await fullSnapshot();
    const security = await request('/api/login/security', {config});
    expect(security.status).toBe(503);
    const refused = await request('/api/login', {method:'POST',body:{email:ADMIN,password:PASSWORD},config});
    expect(refused.status).toBe(503);
    expect(refused.headers.get('set-cookie')).toBeNull();
    expect(await fullSnapshot()).toEqual(before);
    const upgraded = await request('/api/setup/upgrade', {method:'POST',body:{setupToken:SETUP_SECRET},config});
    expect(upgraded.status).toBe(200);
    const restored = await request('/api/login/security', {config});
    expect(restored.status).toBe(200);
    expect((await restored.json()).data.siteKey).toBe('1x00000000000000000000AA');
    const loginResponse = await request('/api/login', {method:'POST',body:{email:ADMIN,password:PASSWORD},config});
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('reads status without writes and preserves existing identity, mail, attachments and configuration through recovery upgrade', async () => {
    const before = await fullSnapshot();
    const status = await (await request('/api/setup/status')).json();
    expect(status.data).toMatchObject({setupRequired: false, upgradeRequired: true, upgradeSupported: true});
    expect(await fullSnapshot()).toEqual(before);
    const result = await (await request('/api/setup/upgrade', {method:'POST', body:{setupToken:SETUP_SECRET}})).json();
    expect(result.code).toBe(200);
    expect(await snapshot()).toEqual(before.business);
    const settings = await env.db.prepare('SELECT * FROM setting').first();
    for (const [key,value] of Object.entries(before.settings[0])) expect(settings[key],key).toEqual(value);
    expect((await (await request('/api/setup/status')).json()).data).toMatchObject({setupRequired:false,upgradeRequired:false});

    const adminCookie = await login();
    const domains = await (await request('/api/admin/domains',{cookie:adminCookie})).json();
    expect(domains.data.domains).toEqual(['example.com','example.net']);
    const memberCookie = await login('member@example.net');
    const ownMail = await (await request('/api/email/list?accountId=2&type=0',{cookie:memberCookie})).json();
    expect(ownMail.data.list.map(item=>item.subject)).toEqual(['preserved-2']);
    expect((await (await request('/api/email/list?accountId=1&type=0',{cookie:memberCookie})).json()).code).not.toBe(200);
    expect((await (await request('/api/login',{method:'POST',body:{email:ADMIN,password:'new-deploy-value-must-not-reset-password'}})).json()).code).not.toBe(200);
  });

  it('retains added domains and saved configuration across repeated upgrades and conflicting obsolete environment values', async () => {
    await dbInit.migrate(context());
    const cookie = await login();
    const read = await (await request('/api/admin/domains',{cookie})).json();
    const added = await (await request('/api/admin/domains',{
      method:'POST',cookie,body:{domains:['later.example.org'],revision:read.data.revision},
    })).json();
    expect(added.code).toBe(200);
    const before = await fullSnapshot();
    const config = runtime({
      FLAREMAIL_DOMAINS:['wrong.example.org'],
      FLAREMAIL_ADMIN_EMAIL:'wrong@wrong.example.org',
      FLAREMAIL_CLIENT_SECRET:'fixture-different-secret-must-not-overwrite',
      FLAREMAIL_OAUTH_ISSUER:'https://wrong.example.org',
    });
    await dbInit.migrate(context(config));
    await dbInit.migrate(context(config));
    expect(await fullSnapshot()).toEqual(before);
    const reread = await (await request('/api/admin/domains',{cookie,config})).json();
    expect(reread.data.domains).toEqual(['example.com','example.net','later.example.org']);
    const provider = await (await request('/api/setting/oauth-provider',{cookie,config})).json();
    expect(provider.data).toMatchObject({enabled:true,revision:7,clients});
  });

  it('imports runtime credentials once, keeps database Google values and restricts shared-secret disclosure', async () => {
    await dbInit.migrate(context());
    const adminCookie = await login();
    const memberCookie = await login('member@example.net');
    const state = await (await request('/api/setting/runtime',{cookie:adminCookie})).json();
    expect(state.code).toBe(200);
    expect(state.data).not.toHaveProperty('projectLink');
    expect(state.data).toMatchObject({
      allowedOrigins:['https://extra.example.net'],
      oauth:{issuer:'https://mail.example.com',secretConfigured:true},
    });
    const generalResponse = await request('/api/setting/query',{cookie:adminCookie});
    const generalText = await generalResponse.text();
    expect(JSON.parse(generalText).data.googleClientId).toBe('saved-google-id');
    const publicData = (await (await request('/api/setting/websiteConfig')).json()).data;
    for (const field of ['projectLink', 'siteLinks', 'links']) {
      expect(JSON.parse(generalText).data).not.toHaveProperty(field);
      expect(publicData).not.toHaveProperty(field);
    }
    for (const secret of [PROVIDER_SECRET,'fixture-only-saved-google-secret','fixture-only-saved-resend-token']) {
      expect(generalText).not.toContain(secret);
      expect(JSON.stringify(state)).not.toContain(secret);
    }
    const before = await fullSnapshot();
    const reveal = await (await request('/api/setting/runtime/oauth-secret',{
      method:'POST',cookie:adminCookie,body:{password:PASSWORD},
    })).json();
    expect(reveal.data.secret).toBe(PROVIDER_SECRET);
    expect(await fullSnapshot()).toEqual(before);
    for (const options of [
      {cookie:adminCookie,body:{password:'wrong-fixture-password'}},
      {cookie:memberCookie,body:{password:PASSWORD}},
      {cookie:adminCookie,origin:'https://extra.example.net',body:{password:PASSWORD}},
      {body:{password:PASSWORD}},
    ]) {
      const denied = await request('/api/setting/runtime/oauth-secret',{method:'POST',...options});
      const text = await denied.text();
      expect(JSON.parse(text).code).not.toBe(200);
      expect(text).not.toContain(PROVIDER_SECRET);
    }
    const changedEnvironment = runtime({
      FLAREMAIL_CLIENT_SECRET:'new-env-secret-must-not-replace-saved',
      FLAREMAIL_OAUTH_ISSUER:'https://wrong.example.org',
      FLAREMAIL_PROJECT_LINK:true,
      FLAREMAIL_ALLOWED_ORIGINS:['https://wrong.example.org'],
      FLAREMAIL_GOOGLE_CLIENT_SECRET:'new-env-google-must-not-replace-saved',
    });
    await dbInit.migrate(context(changedEnvironment));
    const reread = await (await request('/api/setting/runtime',{cookie:adminCookie,config:changedEnvironment})).json();
    expect(reread.data).toEqual(state.data);
    const secondReveal = await (await request('/api/setting/runtime/oauth-secret',{
      method:'POST',cookie:adminCookie,body:{password:PASSWORD},config:changedEnvironment,
    })).json();
    expect(secondReveal.data.secret).toBe(PROVIDER_SECRET);
  });

  it('keeps runtime secrets and saved clients unchanged when authorization is toggled', async () => {
    await dbInit.migrate(context());
    const cookie = await login();
    const reauth = await (await request('/api/my/reauth/password',{method:'POST',cookie,body:{password:PASSWORD}})).json();
    expect(reauth.code).toBe(200);
    const runtimeBefore = await (await request('/api/setting/runtime',{cookie})).json();
    for (const enabled of [false,true]) {
      const current = await (await request('/api/setting/oauth-provider',{cookie})).json();
      const saved = await (await request('/api/setting/oauth-provider/enabled',{
        method:'PUT',cookie,body:{enabled,revision:current.data.revision},
      })).json();
      expect(saved.code).toBe(200);
      expect(saved.data.clients).toEqual(clients);
      expect((await (await request('/api/setting/runtime',{cookie})).json()).data).toEqual(runtimeBefore.data);
      const secret = await request('/api/setting/runtime/oauth-secret',{method:'POST',cookie,body:{password:PASSWORD}});
      expect(secret.headers.get('Cache-Control')).toContain('no-store');
      expect((await secret.json()).data.secret).toBe(PROVIDER_SECRET);
    }
  });

  it('rejects recovery writes without valid installation credentials and rejects reinstalling an existing instance', async () => {
    const before = await fullSnapshot();
    expect((await (await request('/api/setup/upgrade',{
      method:'POST',body:{setupToken:'wrong-fixture-token'},
    })).json()).code).not.toBe(200);
    expect(await fullSnapshot()).toEqual(before);
    const verify = await (await request('/api/setup/verify',{method:'POST',body:{setupToken:SETUP_SECRET}})).json();
    expect(verify.code).not.toBe(200);
    expect(await fullSnapshot()).toEqual(before);
  });

  it('rejects incomplete legacy Provider credentials before any migration writes', async () => {
    const before = await fullSnapshot();
    const config = runtime({FLAREMAIL_CLIENT_SECRET:undefined});
    const status = await (await request('/api/setup/status',{config})).json();
    expect(status.data).toMatchObject({setupRequired:false,upgradeRequired:true,upgradeSupported:false});
    const failed = await request('/api/setup/upgrade',{method:'POST',body:{setupToken:SETUP_SECRET},config});
    expect(failed.status).toBe(409);
    expect((await failed.json()).message || '').not.toBe('');
    expect(await fullSnapshot()).toEqual(before);
  });

  if (baseline.schemaMarker === 321) {
    it('upgrades the previously installed 321 state without the obsolete domain or administrator environment fields', async () => {
      const config = runtime({FLAREMAIL_DOMAINS:undefined, FLAREMAIL_ADMIN_EMAIL:undefined, FLAREMAIL_ADMIN_PASSWORD:undefined});
      const before = await snapshot();
      const response = await request('/api/setup/upgrade',{method:'POST',body:{setupToken:SETUP_SECRET},config});
      expect(response.status).toBe(200);
      expect(await snapshot()).toEqual(before);
      const cookie = await login();
      const domains = await (await request('/api/admin/domains',{cookie,config})).json();
      expect(domains.data).toEqual({domains:['example.com','example.net'],revision:3});
      const secret = await (await request('/api/setting/runtime/oauth-secret',{method:'POST',cookie,body:{password:PASSWORD},config})).json();
      expect(secret.data.secret).toBe(PROVIDER_SECRET);
    });
  }


});
