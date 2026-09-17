import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const GOOGLE_SUB = 'google-sub-12345';
const GOOGLE_EMAIL = 'admin@gmail.com';
const KID = 'test-kid';

function createTestContext() {
	const values = new Map();
	return {
		env,
		get(key) {
			return values.get(key);
		},
		set(key, value) {
			values.set(key, value);
		},
	};
}

function b64url(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const textEncoder = new TextEncoder();

async function createLegacyUser(email, password, isAdmin = false) {
	const salt = `legacy-salt-${email}`;
	const hash = await cryptoUtils.genHashPassword(password, salt);
	const inserted = await env.db.prepare(
		'INSERT INTO user (email, password, salt, cli_token, is_admin) VALUES (?, ?, ?, ?, ?) RETURNING user_id AS userId',
	).bind(email, hash, salt, '', isAdmin ? 1 : 0).first();
	await env.db.prepare('INSERT INTO account (email, user_id) VALUES (?, ?)').bind(email, inserted.userId).run();
	return inserted.userId;
}

async function api(path, options = {}, runtimeEnv = env, baseUrl = 'http://localhost') {
	const request = new Request(`${baseUrl}${path}`, options);
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, runtimeEnv, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function login(email, password) {
	const loginEnv = {
		...env,
		LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	};
	const response = await api('/api/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Origin: 'http://localhost:8787',
		},
		body: JSON.stringify({ email, password }),
	}, loginEnv);
	const body = await response.json();
	expect(body.code).toBe(200);
	return response.headers.get('set-cookie').split(';')[0];
}

async function sessionHash(cookie) {
	const rawToken = cookie.slice(cookie.indexOf('=') + 1);
	return cryptoUtils.hashSecret(rawToken);
}

async function clearRecent(cookie) {
	await env.kv.delete(KvConst.RECENT_AUTH + await sessionHash(cookie));
}

async function reauthPassword(cookie, password) {
	return api('/api/my/reauth/password', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Origin: 'http://localhost:8787',
			Cookie: cookie,
		},
		body: JSON.stringify({ password }),
	}, {
		...oauthEnv,
		LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	});
}

const oauthEnv = {
	...env,
	OAUTH_START_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_CALLBACK_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_BIND_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

let testKeys;
let jwks;

beforeAll(async () => {
	await dbInit.migrate(createTestContext());
	await markInstalled(env);
	await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, window_minutes = 1440 WHERE id = 1').run();
	await createLegacyUser(env.FLAREMAIL_ADMIN_EMAIL, env.FLAREMAIL_ADMIN_PASSWORD, true);
	testKeys = await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	);
	const jwk = await crypto.subtle.exportKey('jwk', testKeys.publicKey);
	jwk.kid = KID;
	jwk.alg = 'RS256';
	jwk.use = 'sig';
	jwks = { keys: [jwk] };
});

afterAll(() => {
	vi.unstubAllGlobals();
});

let adminCookie = null;

async function getAdminBindState() {
	adminCookie = await login(env.FLAREMAIL_ADMIN_EMAIL, env.FLAREMAIL_ADMIN_PASSWORD);
	return adminCookie;
}

async function ensureGoogleConfigured(enabled = 1) {
	const cookie = await getAdminBindState();
	const response = await api('/api/setting/set', {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
			Origin: 'http://localhost',
			Cookie: cookie,
		},
		body: JSON.stringify({
			googleOauthEnabled: enabled,
			googleClientId: CLIENT_ID,
			googleClientSecret: CLIENT_SECRET,
		}),
	});
	const body = await response.json();
	expect(body.code).toBe(200);
}

async function makeIdToken({ nonce, sub = GOOGLE_SUB, email = GOOGLE_EMAIL, aud = CLIENT_ID, iss = 'accounts.google.com', exp, tamper = false }) {
	const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
	const payload = {
		iss,
		aud,
		sub,
		email,
		email_verified: true,
		nonce,
		exp: exp || Math.floor(Date.now() / 1000) + 3600,
		iat: Math.floor(Date.now() / 1000),
	};
	const enc = object => b64url(textEncoder.encode(JSON.stringify(object)));
	const data = `${enc(header)}.${enc(payload)}`;
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', testKeys.privateKey, textEncoder.encode(data));
	const token = `${data}.${b64url(new Uint8Array(signature))}`;
	if (!tamper) return token;
	return token.slice(0, -4) + (token.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
}

function stubGoogleFetch(idToken) {
	vi.stubGlobal('fetch', async url => {
		const urlStr = String(url);
		if (urlStr === 'https://oauth2.googleapis.com/token') {
			return new Response(JSON.stringify({ id_token: idToken }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		if (urlStr === 'https://www.googleapis.com/oauth2/v3/certs') {
			return new Response(JSON.stringify(jwks), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		throw new Error('Unexpected fetch: ' + urlStr);
	});
}

async function startOAuth(path, cookie, runtimeEnv = oauthEnv, baseUrl = 'http://localhost') {
	const response = await api(path, {
		redirect: 'manual',
		headers: cookie ? { Cookie: cookie } : {},
	}, runtimeEnv, baseUrl);
	expect(response.status).toBe(302);
	const url = new URL(response.headers.get('location'));
	const transactionSetCookie = response.headers.get('set-cookie') || '';
	return {
		state: url.searchParams.get('state'),
		nonce: url.searchParams.get('nonce'),
		transactionCookie: transactionSetCookie.split(';')[0] || '',
		transactionSetCookie,
	};
}

function callbackOptions(start) {
	return {
		redirect: 'manual',
		headers: { Cookie: start.transactionCookie },
	};
}

async function loginViaOAuth(sub = GOOGLE_SUB) {
	const start = await startOAuth('/login/oauth/start');
	stubGoogleFetch(await makeIdToken({ nonce: start.nonce, sub }));
	return api(`/login/oauth/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
}

describe('Google OAuth login and binding', () => {

	it('migrates oauth columns on user and setting tables', async () => {
		const userInfo = await env.db.prepare(`PRAGMA table_info('user')`).all();
		const userNames = (userInfo.results || []).map(col => col.name);
		expect(userNames).toContain('google_sub');
		expect(userNames).toContain('google_email');

		const settingInfo = await env.db.prepare(`PRAGMA table_info('setting')`).all();
		const settingNames = (settingInfo.results || []).map(col => col.name);
		expect(settingNames).toContain('google_oauth_enabled');
		expect(settingNames).toContain('google_client_id');
		expect(settingNames).toContain('google_client_secret');
	});

	it('disables Google login when credentials are not configured', async () => {
		const security = await api('/api/login/security');
		const securityBody = await security.json();
		expect(securityBody.data.oauthEnabled).toBe(false);

		const start = await api('/login/oauth/start', { redirect: 'manual' });
		expect(start.status).toBe(404);
	});

	it('disables bind and unbind when credentials are not configured', async () => {
		const cookie = await getAdminBindState();

		const bindStart = await api('/oauth/bind/start', {
			redirect: 'manual',
			headers: { Cookie: cookie },
		});
		expect(bindStart.status).toBe(404);

		const unbind = await api('/oauth/unbind', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost:8787',
				Cookie: cookie,
			},
		});
		expect(unbind.status).toBe(404);
	});

	it('enables Google login when credentials are configured and the switch is on', async () => {
		await ensureGoogleConfigured(1);
		const security = await api('/api/login/security');
		const body = await security.json();
		expect(body.data.oauthEnabled).toBe(true);
	});

	it('Google 登录完整保留原邮件 OAuth 授权请求并回流', async () => {
		await ensureGoogleConfigured(1);
		const email = 'google-provider-return@example.com';
		const sub = 'google-provider-return-sub';
		await createLegacyUser(email, 'google-provider-return-password');
		await env.db.prepare('UPDATE user SET google_sub = ?, google_email = ? WHERE email = ?')
			.bind(sub, 'google-provider-return@gmail.com', email).run();
		const returnTo = '/oauth/authorize?' + new URLSearchParams({
			response_type: 'code',
			client_id: 'main',
			redirect_uri: 'https://app.example.com/auth/callback',
			scope: 'email',
			state: 'original-ai-state',
			code_challenge: 'c'.repeat(43),
			code_challenge_method: 'S256',
		}).toString();
		const start = await startOAuth(`/login/oauth/start?return_to=${encodeURIComponent(returnTo)}`);
		stubGoogleFetch(await makeIdToken({ nonce: start.nonce, sub, email: 'google-provider-return@gmail.com' }));
		const callback = await api(`/login/oauth/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);

		expect(callback.status).toBe(302);
		expect(callback.headers.get('location')).toBe(returnTo);
		const returned = new URL(callback.headers.get('location'), 'http://localhost');
		expect(returned.searchParams.get('client_id')).toBe('main');
		expect(returned.searchParams.get('state')).toBe('original-ai-state');
		expect(returned.searchParams.get('code_challenge')).toBe('c'.repeat(43));
	});

	it('renews a reused oauth transaction cookie with secure browser attributes', async () => {
		await ensureGoogleConfigured(1);
		const first = await startOAuth('/login/oauth/start');
		const second = await startOAuth('/login/oauth/start', first.transactionCookie);

		expect(second.transactionCookie).toBe(first.transactionCookie);
		expect(second.transactionSetCookie).toContain('HttpOnly');
		expect(second.transactionSetCookie).toContain('SameSite=Lax');
		expect(second.transactionSetCookie).toContain('Path=/');
		expect(second.transactionSetCookie).toContain('Max-Age=600');

		const secure = await startOAuth('/login/oauth/start', undefined, oauthEnv, 'https://mail.example');
		expect(secure.transactionCookie).toMatch(/^__Host-mail_oauth_transaction=/);
		expect(secure.transactionSetCookie).toContain('Secure');
		expect(secure.transactionSetCookie).toContain('HttpOnly');
		expect(secure.transactionSetCookie).toContain('SameSite=Lax');
		expect(secure.transactionSetCookie).toContain('Path=/');
		expect(secure.transactionSetCookie).toContain('Max-Age=600');
	});

	it('keeps login disabled while the admin switch is off but still allows binding', async () => {
		await ensureGoogleConfigured(0);

		const security = await api('/api/login/security');
		expect((await security.json()).data.oauthEnabled).toBe(false);

		const loginStart = await api('/login/oauth/start', { redirect: 'manual' });
		expect(loginStart.status).toBe(404);

		const cookie = await getAdminBindState();
		const bindStart = await api('/oauth/bind/start', {
			redirect: 'manual',
			headers: { Cookie: cookie },
		});
		expect(bindStart.status).toBe(302);

		await ensureGoogleConfigured(1);
	});

	it('masks the client secret in system settings queries', async () => {
		await ensureGoogleConfigured(1);
		const cookie = await getAdminBindState();
		const response = await api('/api/setting/query', { headers: { Cookie: cookie } });
		const body = await response.json();
		expect(body.code).toBe(200);
		expect(body.data.googleClientSecret).not.toBe(CLIENT_SECRET);
		expect(body.data.googleClientSecret).toContain('******');
		expect(body.data.googleClientId).toBe(CLIENT_ID);
	});

	it('allows binding, login and unbind for normal users', async () => {
		await ensureGoogleConfigured(1);
		await createLegacyUser('normal@example.com', 'normal-user-password');
		const cookie = await login('normal@example.com', 'normal-user-password');

		const bindStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce, sub: 'normal-google-sub', email: 'normal@gmail.com' }));
		const bindCallback = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(bindCallback.status).toBe(302);
		expect(bindCallback.headers.get('location')).toContain('/settings?oauth=bound');

		const bound = await env.db.prepare(
			`SELECT google_sub AS googleSub, google_email AS googleEmail FROM user WHERE email = ? COLLATE NOCASE`,
		).bind('normal@example.com').first();
		expect(bound.googleSub).toBe('normal-google-sub');
		expect(bound.googleEmail).toBe('normal@gmail.com');

		// Login as normal user via OAuth
		const loginStart = await startOAuth('/login/oauth/start');
		stubGoogleFetch(await makeIdToken({ nonce: loginStart.nonce, sub: 'normal-google-sub', email: 'normal@gmail.com' }));
		const loginCallback = await api(`/login/oauth/callback?code=test-code&state=${loginStart.state}`, callbackOptions(loginStart), oauthEnv);
		expect(loginCallback.status).toBe(302);
		const sessionCookie = loginCallback.headers.get('set-cookie').split(';')[0];

		const info = await api('/api/my/loginUserInfo', { headers: { Cookie: sessionCookie } });
		expect(info.status).toBe(200);
		expect((await info.json()).data.email).toBe('normal@example.com');
	});

	it('binds, logs in and unbinds the admin Google account', async () => {
		await ensureGoogleConfigured(1);
		const cookie = await getAdminBindState();

		// Bind: the start leg requires the session cookie, but the callback
		// leg must not rely on the SameSite=Strict cookie (cross-site redirect).
		const bindStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce }));
		const bindCallback = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(bindCallback.status).toBe(302);
		expect(bindCallback.headers.get('location')).toContain('/settings?oauth=bound');

		const bound = await env.db.prepare(
			`SELECT google_sub AS googleSub, google_email AS googleEmail FROM user WHERE email = ? COLLATE NOCASE`,
		).bind(env.FLAREMAIL_ADMIN_EMAIL).first();
		expect(bound.googleSub).toBe(GOOGLE_SUB);
		expect(bound.googleEmail).toBe(GOOGLE_EMAIL);

		// Login via OAuth
		const loginCallback = await loginViaOAuth();
		expect(loginCallback.status).toBe(302);
		expect(loginCallback.headers.get('location')).toContain('/inbox?oauth=1');
		const sessionCookie = loginCallback.headers.get('set-cookie').split(';')[0];
		expect(loginCallback.headers.get('set-cookie')).toContain('HttpOnly');

		const info = await api('/api/my/loginUserInfo', { headers: { Cookie: sessionCookie } });
		expect(info.status).toBe(200);
		const infoBody = await info.json();
		expect(infoBody.data.googleEmail).toBe(GOOGLE_EMAIL);

		const reauth = await reauthPassword(sessionCookie, env.FLAREMAIL_ADMIN_PASSWORD);
		expect(reauth.status).toBe(200);

		// Unbind revokes all sessions
		const unbind = await api('/oauth/unbind', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost:8787',
				Cookie: sessionCookie,
			},
		}, oauthEnv);
		expect(unbind.status).toBe(200);

		const unbound = await env.db.prepare(
			`SELECT google_sub AS googleSub, google_email AS googleEmail FROM user WHERE email = ? COLLATE NOCASE`,
		).bind(env.FLAREMAIL_ADMIN_EMAIL).first();
		expect(unbound.googleSub).toBe('');
		expect(unbound.googleEmail).toBe('');

		const afterUnbind = await api('/api/my/loginUserInfo', { headers: { Cookie: sessionCookie } });
		expect(afterUnbind.status).toBe(401);
	});

	it('does not grant password recent-auth to a Google login session', async () => {
		await ensureGoogleConfigured(1);
		const email = 'oauth-no-recent@example.com';
		const password = 'oauth-no-recent-password';
		const sub = 'oauth-no-recent-sub';
		await createLegacyUser(email, password);
		const passwordCookie = await login(email, password);
		const bindStart = await startOAuth('/oauth/bind/start', passwordCookie);
		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce, sub, email: 'oauth-no-recent@gmail.com' }));
		await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);

		const loginStart = await startOAuth('/login/oauth/start');
		stubGoogleFetch(await makeIdToken({ nonce: loginStart.nonce, sub, email: 'oauth-no-recent@gmail.com' }));
		const loginCallback = await api(`/login/oauth/callback?code=test-code&state=${loginStart.state}`, callbackOptions(loginStart), oauthEnv);
		const googleCookie = loginCallback.headers.get('set-cookie').split(';')[0];

		const status = await (await api('/api/my/reauth/status', { headers: { Cookie: googleCookie } })).json();
		expect(status.data).toEqual({ method: 'password', enabled: true, windowMinutes: 1440, revision: 0, valid: false, expiresAt: null });
		const tokenResponse = await api('/api/my/genCliToken', {
			method: 'POST',
			headers: {
				Cookie: googleCookie,
				Origin: 'http://localhost:8787',
			},
		});
		expect(tokenResponse.status).toBe(428);
	});

	it('requires recent authentication before starting or completing a Google bind', async () => {
		await ensureGoogleConfigured(1);
		const email = 'oauth-bind-guard@example.com';
		const password = 'oauth-bind-guard-password';
		await createLegacyUser(email, password);
		const cookie = await login(email, password);

		const jsonStart = await api('/oauth/bind/start?response=json', {
			headers: { Cookie: cookie },
		}, oauthEnv);
		expect(jsonStart.status).toBe(200);
		expect(jsonStart.headers.get('Cache-Control')).toBe('no-store');
		const jsonStartBody = await jsonStart.json();
		expect(new URL(jsonStartBody.data.url).origin).toBe('https://accounts.google.com');

		await clearRecent(cookie);

		const start = await api('/oauth/bind/start', {
			redirect: 'manual',
			headers: { Cookie: cookie },
		}, oauthEnv);
		expect(start.status).toBe(428);
		const row = await env.db.prepare('SELECT google_sub AS googleSub FROM user WHERE email = ?').bind(email).first();
		expect(row.googleSub).toBe('');
	});

	it('requires recent authentication before unbinding Google', async () => {
		await ensureGoogleConfigured(1);
		const email = 'oauth-unbind-guard@example.com';
		const password = 'oauth-unbind-guard-password';
		const sub = 'oauth-unbind-guard-sub';
		await createLegacyUser(email, password);
		const cookie = await login(email, password);
		const bindStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce, sub, email: 'oauth-unbind-guard@gmail.com' }));
		await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		await clearRecent(cookie);

		const blocked = await api('/oauth/unbind', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost:8787',
				Cookie: cookie,
			},
		}, oauthEnv);
		expect(blocked.status).toBe(428);
		const stillBound = await env.db.prepare('SELECT google_sub AS googleSub FROM user WHERE email = ?').bind(email).first();
		expect(stillBound.googleSub).toBe(sub);
	});

	it.each([1, 0])('rejects an in-flight bind callback after the initiating session logs out (policy %s)', async enabled => {
		await env.db.prepare('UPDATE admin_confirmation SET enabled = ? WHERE id = 1').bind(enabled).run();
		await ensureGoogleConfigured(1);
		const email = `oauth-bind-logout-${enabled}@example.com`;
		const password = 'oauth-bind-logout-password';
		await createLegacyUser(email, password);
		const cookie = await login(email, password);
		const bindStart = await startOAuth('/oauth/bind/start', cookie);

		const logout = await api('/api/logout', {
			method: 'DELETE',
			headers: {
				Cookie: cookie,
				Origin: 'http://localhost:8787',
			},
		});
		expect(logout.status).toBe(200);

		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce, sub: 'oauth-bind-logout-sub' }));
		const callback = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(callback.headers.get('location')).toContain('/settings?oauth_err=reauth_required');
		const row = await env.db.prepare('SELECT google_sub AS googleSub FROM user WHERE email = ?').bind(email).first();
		expect(row.googleSub).toBe('');
		await env.db.prepare('UPDATE admin_confirmation SET enabled = 1 WHERE id = 1').run();
	});

	it('rejects an in-flight bind callback after its recent-auth proof expires', async () => {
		await ensureGoogleConfigured(1);
		const email = 'oauth-bind-expired-recent@example.com';
		const password = 'oauth-bind-expired-recent-password';
		await createLegacyUser(email, password);
		const cookie = await login(email, password);
		const bindStart = await startOAuth('/oauth/bind/start', cookie);
		await clearRecent(cookie);

		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce, sub: 'oauth-bind-expired-recent-sub' }));
		const callback = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(callback.headers.get('location')).toContain('/settings?oauth_err=reauth_required');
		const row = await env.db.prepare('SELECT google_sub AS googleSub FROM user WHERE email = ?').bind(email).first();
		expect(row.googleSub).toBe('');
	});

	it.each([1, 0])('rejects an in-flight bind callback after the initiating session changes its password (policy %s)', async enabled => {
		await env.db.prepare('UPDATE admin_confirmation SET enabled = ? WHERE id = 1').bind(enabled).run();
		await ensureGoogleConfigured(1);
		const email = `oauth-bind-password-change-${enabled}@example.com`;
		const oldPassword = 'oauth-bind-password-before';
		const newPassword = 'oauth-bind-password-after';
		await createLegacyUser(email, oldPassword);
		const cookie = await login(email, oldPassword);
		const bindStart = await startOAuth('/oauth/bind/start', cookie);

		const reset = await api('/api/my/resetPassword', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost:8787',
				Cookie: cookie,
			},
			body: JSON.stringify({ password: newPassword }),
		}, oauthEnv);
		expect(reset.status).toBe(200);

		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce, sub: 'oauth-bind-password-change-sub' }));
		const callback = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(callback.headers.get('location')).toContain('/settings?oauth_err=reauth_required');
		const row = await env.db.prepare('SELECT google_sub AS googleSub FROM user WHERE email = ?').bind(email).first();
		expect(row.googleSub).toBe('');
		await env.db.prepare('UPDATE admin_confirmation SET enabled = 1 WHERE id = 1').run();
	});

	it('rejects an in-flight login callback after the switch is turned off', async () => {
		await ensureGoogleConfigured(1);
		const start = await startOAuth('/login/oauth/start');
		await ensureGoogleConfigured(0);
		stubGoogleFetch(await makeIdToken({ nonce: start.nonce }));
		const response = await api(`/login/oauth/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/login');
		await ensureGoogleConfigured(1);
	});

	it('rejects an invalid googleOauthEnabled value', async () => {
		await ensureGoogleConfigured(1);
		const cookie = await getAdminBindState();
		const response = await api('/api/setting/set', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost',
				Cookie: cookie,
			},
			body: JSON.stringify({ googleOauthEnabled: 2 }),
		});
		expect(response.status).toBe(400);
	});

	it('rejects a replayed oauth state', async () => {
		await ensureGoogleConfigured(1);
		const cookie = await getAdminBindState();
		const bindStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce }));

		const first = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(first.status).toBe(302);
		expect(first.headers.get('location')).toContain('/settings?oauth=bound');

		const second = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(second.status).toBe(302);
		expect(second.headers.get('location')).toContain('/settings?oauth_err=expired');
	});

	it('rejects an unknown oauth state', async () => {
		await ensureGoogleConfigured(1);
		stubGoogleFetch(await makeIdToken({ nonce: 'irrelevant-nonce' }));
		const response = await api('/login/oauth/callback?code=test-code&state=unknown-state', {
			redirect: 'manual',
		}, oauthEnv);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?oauth_err=expired');
	});

	it('rejects an oauth callback opened by a different browser transaction', async () => {
		await ensureGoogleConfigured(1);
		const victimStart = await startOAuth('/login/oauth/start');
		const otherBrowserStart = await startOAuth('/login/oauth/start');

		const response = await api(`/login/oauth/callback?code=test-code&state=${victimStart.state}`, {
			redirect: 'manual',
			headers: { Cookie: otherBrowserStart.transactionCookie },
		}, oauthEnv);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?oauth_err=expired');
	});

	it('rejects an oauth state at the wrong callback endpoint', async () => {
		await ensureGoogleConfigured(1);
		const loginStart = await startOAuth('/login/oauth/start');

		const response = await api(`/oauth/bind/callback?code=test-code&state=${loginStart.state}`,
			callbackOptions(loginStart), oauthEnv);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/settings?oauth_err=expired');
	});

	it('enforces rate limits on oauth endpoints', async () => {
		await ensureGoogleConfigured(1);
		const limitingEnv = {
			...env,
			OAUTH_START_RATE_LIMITER: { limit: async () => ({ success: false }) },
		};
		const response = await api('/login/oauth/start', { redirect: 'manual' }, limitingEnv);
		expect(response.status).toBe(429);
	});

	it('rejects an id_token with a wrong nonce', async () => {
		await ensureGoogleConfigured(1);
		const start = await startOAuth('/login/oauth/start');
		stubGoogleFetch(await makeIdToken({ nonce: 'wrong-nonce' }));
		const response = await api(`/login/oauth/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?oauth_err=failed');
	});

	it('rejects an id_token with a wrong audience', async () => {
		await ensureGoogleConfigured(1);
		const start = await startOAuth('/login/oauth/start');
		stubGoogleFetch(await makeIdToken({ nonce: start.nonce, aud: 'other-client' }));
		const response = await api(`/login/oauth/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?oauth_err=failed');
	});

	it('rejects an expired id_token', async () => {
		await ensureGoogleConfigured(1);
		const start = await startOAuth('/login/oauth/start');
		stubGoogleFetch(await makeIdToken({ nonce: start.nonce, exp: Math.floor(Date.now() / 1000) - 60 }));
		const response = await api(`/login/oauth/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?oauth_err=expired');
	});

	it('rejects an id_token with a tampered signature', async () => {
		await ensureGoogleConfigured(1);
		const start = await startOAuth('/login/oauth/start');
		stubGoogleFetch(await makeIdToken({ nonce: start.nonce, tamper: true }));
		const response = await api(`/login/oauth/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('/login?oauth_err=failed');
	});

	it('rejects login for a banned user bound to the Google account', async () => {
		await ensureGoogleConfigured(1);
		await createLegacyUser('banned@example.com', 'banned-user-password');
		await env.db.prepare(
			`UPDATE user SET status = 1, google_sub = ? WHERE email = 'banned@example.com'`,
		).bind('banned-sub').run();

		const response = await loginViaOAuth('banned-sub');
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('oauth_err=unbound');
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	it('rejects login for a soft-deleted user bound to the Google account', async () => {
		await ensureGoogleConfigured(1);
		await createLegacyUser('deleted@example.com', 'deleted-user-password');
		await env.db.prepare(
			`UPDATE user SET is_del = 1, google_sub = ? WHERE email = 'deleted@example.com'`,
		).bind('deleted-sub').run();

		const response = await loginViaOAuth('deleted-sub');
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toContain('oauth_err=unbound');
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	it('rebinding replaces the previous Google account', async () => {
		await ensureGoogleConfigured(1);
		const cookie = await getAdminBindState();

		const firstStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: firstStart.nonce }));
		await api(`/oauth/bind/callback?code=test-code&state=${firstStart.state}`, callbackOptions(firstStart), oauthEnv);

		const secondStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: secondStart.nonce, sub: 'google-sub-replacement', email: 'admin2@gmail.com' }));
		const rebind = await api(`/oauth/bind/callback?code=test-code&state=${secondStart.state}`, callbackOptions(secondStart), oauthEnv);
		expect(rebind.status).toBe(302);
		expect(rebind.headers.get('location')).toContain('/settings?oauth=bound');

		const row = await env.db.prepare(
			`SELECT google_sub AS googleSub, google_email AS googleEmail FROM user WHERE email = ? COLLATE NOCASE`,
		).bind(env.FLAREMAIL_ADMIN_EMAIL).first();
		expect(row.googleSub).toBe('google-sub-replacement');
		expect(row.googleEmail).toBe('admin2@gmail.com');

		// The old Google account can no longer log in.
		const oldLogin = await loginViaOAuth();
		expect(oldLogin.status).toBe(302);
		expect(oldLogin.headers.get('location')).toContain('oauth_err=unbound');
	});

	it('rejects binding a Google account already bound to another user', async () => {
		await ensureGoogleConfigured(1);
		await createLegacyUser('other@example.com', 'other-user-password');
		await env.db.prepare(
			`UPDATE user SET google_sub = ? WHERE email = 'other@example.com'`,
		).bind('shared-sub').run();

		const cookie = await getAdminBindState();
		const before = await env.db.prepare(
			`SELECT google_sub AS googleSub FROM user WHERE email = ? COLLATE NOCASE`,
		).bind(env.FLAREMAIL_ADMIN_EMAIL).first();

		const bindStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce, sub: 'shared-sub' }));
		const callback = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(callback.status).toBe(302);
		expect(callback.headers.get('location')).toContain('/settings?oauth_err=already_bound');

		const after = await env.db.prepare(
			`SELECT google_sub AS googleSub FROM user WHERE email = ? COLLATE NOCASE`,
		).bind(env.FLAREMAIL_ADMIN_EMAIL).first();
		expect(after.googleSub).toBe(before.googleSub);
	});

	it('invalidates OAuth sessions when the password changes', async () => {
		await ensureGoogleConfigured(1);
		const cookie = await getAdminBindState();
		const bindStart = await startOAuth('/oauth/bind/start', cookie);
		stubGoogleFetch(await makeIdToken({ nonce: bindStart.nonce }));
		await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);

		const loginCallback = await loginViaOAuth();
		expect(loginCallback.status).toBe(302);
		const sessionCookie = loginCallback.headers.get('set-cookie').split(';')[0];
		const reauth = await reauthPassword(sessionCookie, env.FLAREMAIL_ADMIN_PASSWORD);
		expect(reauth.status).toBe(200);

		const reset = await api('/api/my/resetPassword', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost:8787',
				Cookie: sessionCookie,
			},
			body: JSON.stringify({ password: 'new-admin-password-123' }),
		}, oauthEnv);
		expect(reset.status).toBe(200);

		const afterReset = await api('/api/my/loginUserInfo', { headers: { Cookie: sessionCookie } });
		expect(afterReset.status).toBe(401);

		// Restore original admin password for subsequent tests
		const newCookie = await login(env.FLAREMAIL_ADMIN_EMAIL, 'new-admin-password-123');
		await api('/api/my/resetPassword', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost:8787',
				Cookie: newCookie,
			},
			body: JSON.stringify({ password: env.FLAREMAIL_ADMIN_PASSWORD }),
		}, oauthEnv);
	});

	it('refreshes JWKS on key rotation with unknown kid', async () => {
		await ensureGoogleConfigured(1);
		const cookie = await getAdminBindState();
		const bindStart = await startOAuth('/oauth/bind/start', cookie);

		// Generate a second rotated key pair
		const rotatedKeys = await crypto.subtle.generateKey(
			{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
			true,
			['sign', 'verify'],
		);
		const rotatedJwk = await crypto.subtle.exportKey('jwk', rotatedKeys.publicKey);
		rotatedJwk.kid = 'rotated-kid-2';
		rotatedJwk.alg = 'RS256';
		rotatedJwk.use = 'sig';

		// First response only has old key, second response (forceRefresh) has rotated key
		let fetchCount = 0;
		vi.stubGlobal('fetch', async url => {
			const urlStr = String(url);
			if (urlStr === 'https://oauth2.googleapis.com/token') {
				const header = { alg: 'RS256', kid: 'rotated-kid-2', typ: 'JWT' };
				const payload = {
					iss: 'accounts.google.com',
					aud: CLIENT_ID,
					sub: 'rotated-sub',
					email: 'rotated@gmail.com',
					email_verified: true,
					nonce: bindStart.nonce,
					exp: Math.floor(Date.now() / 1000) + 3600,
					iat: Math.floor(Date.now() / 1000),
				};
				const enc = object => b64url(textEncoder.encode(JSON.stringify(object)));
				const data = `${enc(header)}.${enc(payload)}`;
				const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rotatedKeys.privateKey, textEncoder.encode(data));
				const token = `${data}.${b64url(new Uint8Array(signature))}`;
				return new Response(JSON.stringify({ id_token: token }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}
			if (urlStr === 'https://www.googleapis.com/oauth2/v3/certs') {
				fetchCount++;
				return new Response(JSON.stringify({ keys: [jwks.keys[0], rotatedJwk] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}
			throw new Error('Unexpected fetch: ' + urlStr);
		});

		const callback = await api(`/oauth/bind/callback?code=test-code&state=${bindStart.state}`, callbackOptions(bindStart), oauthEnv);
		expect(callback.status).toBe(302);
		expect(callback.headers.get('location')).toContain('/settings?oauth=bound');
	});

  it('binds, replaces and unbinds Google without a password proof when the global policy is off', async () => {
    await ensureGoogleConfigured();
    await env.db.prepare('UPDATE admin_confirmation SET enabled = 0 WHERE id = 1').run();
    try {
      const email = 'oauth-unified-off@example.com'; const password = 'oauth-unified-off-password';
      const userId = await createLegacyUser(email, password);
      const cookie = await login(email, password); await clearRecent(cookie);
      for (const sub of ['unified-off-first', 'unified-off-replacement']) {
        const start = await startOAuth('/oauth/bind/start', cookie);
        stubGoogleFetch(await makeIdToken({ nonce: start.nonce, sub }));
        const callback = await api(`/oauth/bind/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
        expect(callback.headers.get('location')).toContain('/settings?oauth=bound');
        expect((await env.db.prepare('SELECT google_sub FROM user WHERE user_id = ?').bind(userId).first()).google_sub).toBe(sub);
        const replay = await api(`/oauth/bind/callback?code=test-code&state=${start.state}`, callbackOptions(start), oauthEnv);
        expect(replay.headers.get('location')).toContain('oauth_err=expired');
      }
      const unbind = await api('/oauth/unbind', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' } }, oauthEnv);
      expect(unbind.status).toBe(200);
      expect((await env.db.prepare('SELECT google_sub FROM user WHERE user_id = ?').bind(userId).first()).google_sub).toBe('');
      expect((await api('/api/my/loginUserInfo', { headers: { Cookie: cookie } })).status).toBe(401);
    } finally {
      await env.db.prepare('UPDATE admin_confirmation SET enabled = 1 WHERE id = 1').run();
    }
  });
});
