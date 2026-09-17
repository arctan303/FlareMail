import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const ADMIN_EMAIL = 'runtime-admin@example.com';
const ADMIN_PASSWORD = 'runtime-admin-password';
const MEMBER_EMAIL = 'runtime-member@example.com';
const MEMBER_PASSWORD = 'runtime-member-password';
const OAUTH_SECRET = 'runtime-provider-secret';
const TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
const CLIENTS = [{
	clientId: 'runtime-client',
	displayName: 'Runtime Client',
	enabled: true,
	redirects: [{ redirectUri: 'https://client.example.com/callback', silentFrameAncestor: null }],
}];
const allow = { limit: async () => ({ success: true }) };

function context(runtimeEnv = env) {
	const values = new Map();
	return { env: runtimeEnv, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, { method = 'GET', body, cookie, origin, runtimeEnv = env } = {}) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request(`http://localhost${path}`, {
		method,
		headers: {
			...(origin ? { Origin: origin } : {}),
			...(cookie ? { Cookie: cookie } : {}),
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	}), runtimeEnv, execution);
	await waitOnExecutionContext(execution);
	return response;
}

async function createUser(email, password, isAdmin = false) {
	const material = await cryptoUtils.hashPassword(password);
	const row = await env.db.prepare(`
		INSERT INTO user(email, password, salt, is_admin)
		VALUES (?, ?, ?, ?) RETURNING user_id AS userId
	`).bind(email, material.hash, material.salt, isAdmin ? 1 : 0).first();
	await env.db.prepare('INSERT INTO account(email, user_id) VALUES (?, ?)').bind(email, row.userId).run();
}

async function login(email, password) {
	const response = await request('/api/login', {
		method: 'POST',
		origin: 'http://localhost',
		body: { email, password },
		runtimeEnv: { ...env, LOGIN_RATE_LIMITER: allow },
	});
	expect(response.status).toBe(200);
	return response.headers.get('set-cookie').split(';')[0];
}

async function sessionHash(cookie) {
	return cryptoUtils.hashSecret(cookie.slice(cookie.indexOf('=') + 1));
}

async function putRuntime(cookie, body, options = {}) {
	return request('/api/setting/runtime', {
		method: 'PUT',
		cookie,
		origin: 'http://localhost',
		body,
		...options,
	});
}

async function resetConfiguration() {
	// These cases explicitly exercise enabled administrator confirmation.
	await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, window_minutes = 10, revision = 0 WHERE id = 1').run();
	await env.db.batch([
		env.db.prepare(`
			UPDATE runtime_config
			SET revision = 0, allowed_origins = '[]',
				turnstile_site_key = '', turnstile_secret = '', oauth_issuer = '', oauth_secret = '',
				legacy_imported = 1
			WHERE id = 1
		`),
		env.db.prepare(`
			UPDATE setting
			SET oauth_provider_enabled = 0, oauth_provider_revision = 0, oauth_provider_clients = ?,
				site_key = NULL, secret_key = NULL, google_oauth_enabled = 0,
				google_client_id = '', google_client_secret = '', resend_tokens = '{}'
		`).bind(JSON.stringify(CLIENTS)),
	]);
}

function coordinatedDatabase(database) {
	let arrived = 0;
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const coordinated = sql => /UPDATE\s+(runtime_config|setting)\s+SET[\s\S]*(oauth_secret|oauth_provider_enabled|google_oauth_enabled)/i.test(sql);
	const wrap = (statement, shouldCoordinate) => new Proxy(statement, {
		get(target, property) {
			if (property === 'bind') return (...args) => wrap(target.bind(...args), shouldCoordinate);
			if (property === 'run' && shouldCoordinate) {
				return async () => {
					arrived += 1;
					if (arrived === 2) release();
					await gate;
					return target.run();
				};
			}
			const value = target[property];
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	return new Proxy(database, {
		get(target, property) {
			if (property === 'prepare') {
				return sql => wrap(target.prepare(sql), coordinated(sql));
			}
			const value = target[property];
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env, ['example.com'], []);
	await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, true);
	await createUser(MEMBER_EMAIL, MEMBER_PASSWORD);
});

beforeEach(resetConfiguration);

describe.sequential('private runtime configuration', () => {
	it('creates marker 322 with closed defaults and exposes no secret in ordinary reads', async () => {
		expect(await dbInit.v3_22Applied(context())).toBe(true);
		expect((await env.db.prepare("PRAGMA table_info('runtime_config')").all()).results.map(column => column.name)).not.toContain('project_link');
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const response = await request('/api/setting/runtime', { cookie: admin });
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toContain('no-store');
		const text = await response.text();
		expect(JSON.parse(text).data).toEqual({
			revision: 0,
			allowedOrigins: [],
			turnstile: { siteKey: '', secretConfigured: false },
			oauth: { issuer: '', secretConfigured: false },
		});
		expect(text).not.toContain('turnstile_secret');
		expect(text).not.toContain('oauth_secret');

		const member = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
		expect((await request('/api/setting/runtime', { cookie: member })).status).toBe(403);
		expect((await request('/api/setting/runtime', {
			cookie: admin,
			origin: 'https://evil.example',
		})).status).toBe(403);
	});

	it('updates only submitted sections with explicit secret actions and revision CAS', async () => {
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		await env.kv.delete(KvConst.RECENT_AUTH + await sessionHash(admin));
		expect((await putRuntime(admin, { revision: 0, allowedOrigins: ['https://initial.example'] })).status).toBe(428);

		const reauth = await request('/api/my/reauth/password', {
			method: 'POST',
			cookie: admin,
			origin: 'http://localhost',
			body: { password: ADMIN_PASSWORD },
			runtimeEnv: { ...env, LOGIN_RATE_LIMITER: allow },
		});
		expect(reauth.status).toBe(200);
		const initialOrigins = await putRuntime(admin, { revision: 0, allowedOrigins: ['https://initial.example'] });
		expect((await initialOrigins.json()).data).toMatchObject({ revision: 1, allowedOrigins: ['https://initial.example'] });
		expect((await putRuntime(admin, { revision: 0, allowedOrigins: [] })).status).toBe(409);

		const turnstile = await putRuntime(admin, {
			revision: 1,
			turnstile: { siteKey: '3x00000000000000000000FF', secretAction: 'replace', secret: TURNSTILE_SECRET },
		});
		expect((await turnstile.json()).data).toMatchObject({
			revision: 2,
			turnstile: { siteKey: '3x00000000000000000000FF', secretConfigured: true },
		});
		const beforeInvalid = await env.db.prepare('SELECT * FROM runtime_config WHERE id = 1').first();
		expect((await putRuntime(admin, {
			revision: 2,
			turnstile: { siteKey: '', secretAction: 'keep' },
		})).status).toBe(400);
		expect(await env.db.prepare('SELECT * FROM runtime_config WHERE id = 1').first()).toEqual(beforeInvalid);

		const oauth = await putRuntime(admin, {
			revision: 2,
			oauth: { issuer: 'https://mail.example.com/', secretAction: 'replace', secret: OAUTH_SECRET },
		});
		expect((await oauth.json()).data).toMatchObject({
			revision: 3,
			oauth: { issuer: 'https://mail.example.com', secretConfigured: true },
		});
		const origins = await putRuntime(admin, {
			revision: 3,
			allowedOrigins: ['https://extra.example'],
		});
		expect((await origins.json()).data).toMatchObject({
			revision: 4,
			allowedOrigins: ['https://extra.example'],
			turnstile: { secretConfigured: true },
			oauth: { secretConfigured: true },
		});

		const oldRoute = await request('/api/setting/set', {
			method: 'PUT',
			cookie: admin,
			origin: 'http://localhost',
			body: { siteKey: 'obsolete-bypass' },
		});
		expect(oldRoute.status).toBe(400);
		expect((await env.db.prepare('SELECT revision FROM runtime_config WHERE id = 1').first()).revision).toBe(4);
	});

	it('rejects removed link fields without partially updating runtime settings', async () => {
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const before = await env.db.prepare('SELECT * FROM runtime_config').first();
		for (const obsolete of [{ projectLink: false }, { siteLinks: [] }, { links: [] }]) {
			const response = await putRuntime(admin, { revision: 0, allowedOrigins: ['https://must-not-save.example'], ...obsolete });
			expect(response.status).toBe(400);
		}
		expect(await env.db.prepare('SELECT * FROM runtime_config').first()).toEqual(before);
	});

	it('ignores an obsolete column on an already installed 322 database', async () => {
		await env.db.prepare('ALTER TABLE runtime_config ADD COLUMN project_link INTEGER NOT NULL DEFAULT 1 CHECK (project_link IN (0, 1))').run();
		await env.db.prepare('UPDATE runtime_config SET project_link = 0 WHERE id = 1').run();
		const before = await env.db.prepare('SELECT * FROM runtime_config').first();
		await dbInit.migrate(context({ ...env, FLAREMAIL_PROJECT_LINK: 'unused-invalid-value' }));
		expect(await env.db.prepare('SELECT * FROM runtime_config').first()).toEqual(before);
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const response = await putRuntime(admin, { revision: 0, allowedOrigins: ['https://extra.example'] });
		expect(response.status).toBe(200);
		expect((await response.json()).data).not.toHaveProperty('projectLink');
		expect((await env.db.prepare('SELECT project_link FROM runtime_config').first()).project_link).toBe(0);
	});

	it('reveals the OAuth Secret only after a fresh current-admin password check', async () => {
		await env.db.prepare(`
			UPDATE runtime_config SET oauth_issuer = ?, oauth_secret = ? WHERE id = 1
		`).bind('https://mail.example.com', OAUTH_SECRET).run();
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const member = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
		const reveal = await request('/api/setting/runtime/oauth-secret', {
			method: 'POST', cookie: admin, origin: 'http://localhost', body: { password: ADMIN_PASSWORD },
			runtimeEnv: { ...env, LOGIN_RATE_LIMITER: allow },
		});
		expect(reveal.status).toBe(200);
		expect(reveal.headers.get('Cache-Control')).toContain('no-store');
		expect((await reveal.json()).data).toEqual({ secret: OAUTH_SECRET });

		for (const options of [
			{ cookie: admin, origin: 'http://localhost', body: { password: 'wrong-password' } },
			{ cookie: member, origin: 'http://localhost', body: { password: ADMIN_PASSWORD } },
			{ cookie: admin, origin: 'https://evil.example', body: { password: ADMIN_PASSWORD } },
			{ cookie: admin, origin: 'http://localhost', body: {} },
		]) {
			const denied = await request('/api/setting/runtime/oauth-secret', {
				method: 'POST',
				...options,
				runtimeEnv: { ...env, LOGIN_RATE_LIMITER: allow },
			});
			const text = await denied.text();
			expect(denied.status).not.toBe(200);
			expect(text).not.toContain(OAUTH_SECRET);
		}
		const limited = await request('/api/setting/runtime/oauth-secret', {
			method: 'POST', cookie: admin, origin: 'http://localhost', body: { password: ADMIN_PASSWORD },
			runtimeEnv: { ...env, LOGIN_RATE_LIMITER: { limit: async () => ({ success: false }) } },
		});
		expect(limited.status).toBe(429);
		expect(await limited.text()).not.toContain(OAUTH_SECRET);
	});

	it('uses persisted extra origins for business CORS without relaxing runtime administration', async () => {
		await env.db.prepare(`UPDATE runtime_config SET allowed_origins = ? WHERE id = 1`)
			.bind('["https://extra.example"]')
			.run();
		const publicRead = await request('/api/setting/websiteConfig', { origin: 'https://extra.example' });
		expect(publicRead.status).toBe(200);
		expect(publicRead.headers.get('Access-Control-Allow-Origin')).toBe('https://extra.example');

		const businessMutation = await request('/api/login', {
			method: 'POST',
			origin: 'https://extra.example',
			body: { email: 'missing@example.com', password: 'irrelevant-password' },
			runtimeEnv: { ...env, LOGIN_RATE_LIMITER: allow },
		});
		expect(businessMutation.status).toBe(401);
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const protectedRead = await request('/api/setting/runtime', {
			cookie: admin,
			origin: 'https://extra.example',
		});
		expect(protectedRead.status).toBe(403);
	});

	it('keeps stored Google and Resend credentials when their returned masks are saved unchanged', async () => {
		const googleSecret = 'stored-google-secret';
		const resendSecret = 'stored-resend-secret';
		await env.db.prepare(`
			UPDATE setting SET google_client_id = ?, google_client_secret = ?, resend_tokens = ?
		`).bind('stored-google-id', googleSecret, JSON.stringify({ 'example.com': resendSecret })).run();
		await env.kv.delete(KvConst.SETTING);
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const query = await request('/api/setting/query', { cookie: admin });
		const data = (await query.json()).data;
		expect(data.googleClientSecret).not.toBe(googleSecret);
		expect(data.resendTokens['example.com']).not.toBe(resendSecret);

		const saved = await request('/api/setting/set', {
			method: 'PUT', cookie: admin, origin: 'http://localhost',
			body: {
				googleClientId: data.googleClientId,
				googleClientSecret: data.googleClientSecret,
				resendTokens: data.resendTokens,
			},
		});
		expect(saved.status).toBe(200);
		const stored = await env.db.prepare(`
			SELECT google_client_id AS googleClientId, google_client_secret AS googleClientSecret,
				resend_tokens AS resendTokens FROM setting
		`).first();
		expect(stored).toEqual({
			googleClientId: 'stored-google-id',
			googleClientSecret: googleSecret,
			resendTokens: JSON.stringify({ 'example.com': resendSecret }),
		});

		const partialClear = await request('/api/setting/set', {
			method: 'PUT', cookie: admin, origin: 'http://localhost', body: { googleClientSecret: '' },
		});
		expect(partialClear.status).toBe(400);
		expect((await env.db.prepare('SELECT google_client_secret AS secret FROM setting').first()).secret).toBe(googleSecret);
	});

	it('requires strict same-origin and recent authentication for Google and Resend updates only', async () => {
		await env.db.prepare(`UPDATE runtime_config SET allowed_origins = ? WHERE id = 1`)
			.bind('["https://extra.example"]')
			.run();
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const before = await env.db.prepare(`
			SELECT google_client_id AS googleClientId, google_client_secret AS googleClientSecret,
				resend_tokens AS resendTokens FROM setting
		`).first();

		const crossOrigin = await request('/api/setting/set', {
			method: 'PUT', cookie: admin, origin: 'https://extra.example',
			body: {
				googleClientId: 'cross-origin-id',
				googleClientSecret: 'cross-origin-secret',
				resendTokens: { 'example.com': 'cross-origin-resend' },
			},
		});
		expect(crossOrigin.status).toBe(403);
		expect(await env.db.prepare(`
			SELECT google_client_id AS googleClientId, google_client_secret AS googleClientSecret,
				resend_tokens AS resendTokens FROM setting
		`).first()).toEqual(before);

		await env.kv.delete(KvConst.RECENT_AUTH + await sessionHash(admin));
		const ordinary = await request('/api/setting/set', {
			method: 'PUT', cookie: admin, origin: 'https://extra.example', body: { background: 'https://cdn.example/bg.jpg' },
		});
		expect(ordinary.status).toBe(200);
		const expired = await request('/api/setting/set', {
			method: 'PUT', cookie: admin, origin: 'http://localhost',
			body: { googleClientId: 'fresh-id', googleClientSecret: 'fresh-secret' },
		});
		expect(expired.status).toBe(428);

		const reauth = await request('/api/my/reauth/password', {
			method: 'POST', cookie: admin, origin: 'http://localhost', body: { password: ADMIN_PASSWORD },
			runtimeEnv: { ...env, LOGIN_RATE_LIMITER: allow },
		});
		expect(reauth.status).toBe(200);
		const saved = await request('/api/setting/set', {
			method: 'PUT', cookie: admin, origin: 'http://localhost',
			body: {
				googleClientId: 'fresh-id',
				googleClientSecret: 'fresh-secret',
				resendTokens: { 'example.com': 'fresh-resend-token' },
			},
		});
		expect(saved.status).toBe(200);
		expect(await env.db.prepare(`
			SELECT google_client_id AS googleClientId, google_client_secret AS googleClientSecret,
				resend_tokens AS resendTokens FROM setting
		`).first()).toEqual({
			googleClientId: 'fresh-id',
			googleClientSecret: 'fresh-secret',
			resendTokens: JSON.stringify({ 'example.com': 'fresh-resend-token' }),
		});
	});

	it('fails login closed when installed runtime security configuration is invalid', async () => {
		await env.db.prepare(`UPDATE runtime_config SET allowed_origins = 'not-json' WHERE id = 1`).run();
		const security = await request('/api/login/security');
		expect(security.status).toBe(503);
		const loginResponse = await request('/api/login', {
			method: 'POST', origin: 'http://localhost', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
			runtimeEnv: { ...env, LOGIN_RATE_LIMITER: allow },
		});
		expect(loginResponse.status).toBe(503);
		expect(loginResponse.headers.get('set-cookie')).toBeNull();
	});

	it('atomically prevents Google enable from racing with credential clearing', async () => {
		await env.db.prepare(`
			UPDATE setting SET google_oauth_enabled = 0,
				google_client_id = 'race-google-id', google_client_secret = 'race-google-secret'
		`).run();
		await env.kv.delete(KvConst.SETTING);
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const runtimeEnv = { ...env, db: coordinatedDatabase(env.db) };
		const [enabled, cleared] = await Promise.all([
			request('/api/setting/set', {
				method: 'PUT', cookie: admin, origin: 'http://localhost',
				body: { googleOauthEnabled: 1 }, runtimeEnv,
			}),
			request('/api/setting/set', {
				method: 'PUT', cookie: admin, origin: 'http://localhost',
				body: { googleClientId: '', googleClientSecret: '' }, runtimeEnv,
			}),
		]);
		expect([enabled.status, cleared.status].sort()).toEqual([200, 409]);
		const stored = await env.db.prepare(`
			SELECT google_oauth_enabled AS enabled, google_client_id AS clientId,
				google_client_secret AS clientSecret FROM setting
		`).first();
		expect(Number(stored.enabled) === 1).toBe(!!stored.clientId && !!stored.clientSecret);
	});

	it('logs ORM query structure without parameter secrets only when explicitly enabled', async () => {
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const secret = 'orm-log-must-not-print-this-secret';
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const saved = await request('/api/setting/set', {
				method: 'PUT', cookie: admin, origin: 'http://localhost',
				body: { resendTokens: { 'example.com': secret } },
				runtimeEnv: { ...env, ORM_LOG: 'true' },
			});
			expect(saved.status).toBe(200);
			const output = log.mock.calls.flat().join(' ');
			expect(output).toContain('update');
			expect(output).not.toContain(secret);
		} finally {
			log.mockRestore();
		}

		const disabled = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			const saved = await request('/api/setting/set', {
				method: 'PUT', cookie: admin, origin: 'http://localhost',
				body: { resendTokens: { 'example.com': 'disabled-log-secret' } },
				runtimeEnv: { ...env, ORM_LOG: 'false' },
			});
			expect(saved.status).toBe(200);
			expect(disabled).not.toHaveBeenCalled();
		} finally {
			disabled.mockRestore();
		}
	});

	it('atomically prevents provider enable from racing with OAuth credential clearing', async () => {
		await env.db.prepare(`
			UPDATE runtime_config SET oauth_issuer = ?, oauth_secret = ? WHERE id = 1
		`).bind('https://mail.example.com', OAUTH_SECRET).run();
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const db = coordinatedDatabase(env.db);
		const runtimeEnv = { ...env, db };
		const [enabled, cleared] = await Promise.all([
			request('/api/setting/oauth-provider/enabled', {
				method: 'PUT', cookie: admin, origin: 'http://localhost',
				body: { enabled: true, revision: 0 }, runtimeEnv,
			}),
			putRuntime(admin, {
				revision: 0,
				oauth: { issuer: '', secretAction: 'clear' },
			}, { runtimeEnv }),
		]);
		expect([enabled.status, cleared.status].sort()).toEqual([200, 409]);
		const provider = await env.db.prepare('SELECT oauth_provider_enabled AS enabled FROM setting').first();
		const runtime = await env.db.prepare('SELECT oauth_issuer AS issuer, oauth_secret AS secret FROM runtime_config WHERE id = 1').first();
		expect(Number(provider.enabled) === 1).toBe(!!runtime.issuer && !!runtime.secret);
	});
});
