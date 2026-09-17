import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import userService from '../src/service/user-service';
import { markInstalled } from './installed-instance';

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

async function api(path, options = {}, runtimeEnv = env) {
	const request = new Request(`http://localhost${path}`, options);
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, runtimeEnv, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function createUser(email, password) {
	const salt = `recent-auth-salt-${email}`;
	const hash = await cryptoUtils.genHashPassword(password, salt);
	const inserted = await env.db.prepare(
		'INSERT INTO user (email, password, salt, cli_token) VALUES (?, ?, ?, ?) RETURNING user_id AS userId',
	).bind(email, hash, salt, '').first();
	await env.db.prepare('INSERT INTO account (email, user_id) VALUES (?, ?)').bind(email, inserted.userId).run();
	return inserted.userId;
}

async function login(email, password) {
	const response = await api('/api/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Origin: 'http://localhost:8787',
		},
		body: JSON.stringify({ email, password }),
	}, {
		...env,
		LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	});
	expect(response.status).toBe(200);
	expect((await response.clone().json()).code).toBe(200);
	return response.headers.get('set-cookie').split(';')[0];
}

function mutationHeaders(cookie) {
	return {
		Cookie: cookie,
		Origin: 'http://localhost:8787',
		'Content-Type': 'application/json',
	};
}

async function sessionHash(cookie) {
	const rawToken = cookie.slice(cookie.indexOf('=') + 1);
	return cryptoUtils.hashSecret(rawToken);
}

async function clearRecent(cookie) {
	await env.kv.delete(KvConst.RECENT_AUTH + await sessionHash(cookie));
}

async function reauth(cookie, password, runtimeEnv = env) {
	return api('/api/my/reauth/password', {
		method: 'POST',
		headers: mutationHeaders(cookie),
		body: JSON.stringify({ password }),
	}, runtimeEnv);
}

beforeAll(async () => {
	await dbInit.migrate(createTestContext());
	await markInstalled(env);
	await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, window_minutes = 1440 WHERE id = 1').run();
});

describe('session-scoped recent authentication', () => {
	it('grants password logins the configured one-day server-side confirmation window', async () => {
		const email = 'recent-login@example.com';
		const password = 'recent-login-password';
		await createUser(email, password);
		const cookie = await login(email, password);

		const response = await api('/api/my/reauth/status', { headers: { Cookie: cookie } });
		const body = await response.json();
		expect(body.code).toBe(200);
		expect(body.data).toMatchObject({ method: 'password', valid: true });
		expect(body.data.expiresAt).toBeGreaterThan(Date.now());
		expect(body.data.expiresAt).toBeLessThanOrEqual(Date.now() + 86400_000);
	});

	it('keeps reauthentication isolated to one session', async () => {
		const email = 'recent-isolation@example.com';
		const password = 'recent-isolation-password';
		await createUser(email, password);
		const firstCookie = await login(email, password);
		const secondCookie = await login(email, password);
		await clearRecent(firstCookie);
		await clearRecent(secondCookie);

		const granted = await reauth(firstCookie, password, {
			...env,
			LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
		});
		expect((await granted.json()).data.valid).toBe(true);

		const firstStatus = await (await api('/api/my/reauth/status', { headers: { Cookie: firstCookie } })).json();
		const secondStatus = await (await api('/api/my/reauth/status', { headers: { Cookie: secondCookie } })).json();
		expect(firstStatus.data.valid).toBe(true);
		expect(secondStatus.data).toMatchObject({ method: 'password', enabled: true, windowMinutes: 1440, valid: false, expiresAt: null });
	});

	it('returns 403 for a wrong password without logging out the session', async () => {
		const email = 'recent-wrong-password@example.com';
		const password = 'recent-correct-password';
		await createUser(email, password);
		const cookie = await login(email, password);
		await clearRecent(cookie);

		const rejected = await reauth(cookie, 'recent-wrong-password', {
			...env,
			LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
		});
		expect(rejected.status).toBe(403);
		expect((await rejected.json()).code).toBe(403);

		const malformed = await api('/api/my/reauth/password', {
			method: 'POST',
			headers: mutationHeaders(cookie),
			body: '{',
		}, {
			...env,
			LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
		});
		expect(malformed.status).toBe(403);

		const info = await api('/api/my/loginUserInfo', { headers: { Cookie: cookie } });
		expect((await info.json()).code).toBe(200);
	});

	it('returns 429 when the login limiter rejects a password reauthentication', async () => {
		const email = 'recent-limited@example.com';
		const password = 'recent-limited-password';
		const userId = await createUser(email, password);
		const cookie = await login(email, password);
		await clearRecent(cookie);
		let limiterKey = null;

		const response = await reauth(cookie, password, {
			...env,
			LOGIN_RATE_LIMITER: {
				limit: async ({ key }) => {
					limiterKey = key;
					return { success: false };
				},
			},
		});
		expect(response.status).toBe(429);
		expect((await response.json()).code).toBe(429);
		expect(limiterKey).toBe(`user:${userId}`);
	});

	it('treats expired records as invalid and removes them', async () => {
		const email = 'recent-expired@example.com';
		const password = 'recent-expired-password';
		const userId = await createUser(email, password);
		const cookie = await login(email, password);
		const hash = await sessionHash(cookie);
		const authenticatedAt = Date.now() - 86400_001;
		await env.kv.put(KvConst.RECENT_AUTH + hash, JSON.stringify({
			version: 2,
			revision: 0,
			userId,
			method: 'password',
			authenticatedAt,
			expiresAt: authenticatedAt + 86400_000,
		}), { expirationTtl: 600 });

		const status = await (await api('/api/my/reauth/status', { headers: { Cookie: cookie } })).json();
		expect(status.data).toMatchObject({ method: 'password', enabled: true, windowMinutes: 1440, valid: false, expiresAt: null });
		expect(await env.kv.get(KvConst.RECENT_AUTH + hash)).toBeNull();
	});

	it('requires recent auth for CLI creation and atomically invalidates the old token on rotation', async () => {
		const email = 'recent-cli@example.com';
		const password = 'recent-cli-password';
		const userId = await createUser(email, password);
		const cookie = await login(email, password);
		await clearRecent(cookie);

		const blocked = await api('/api/my/genCliToken', {
			method: 'POST',
			headers: mutationHeaders(cookie),
		});
		expect(blocked.status).toBe(428);
		expect((await env.db.prepare('SELECT cli_token AS cliToken FROM user WHERE user_id = ?').bind(userId).first()).cliToken).toBe('');

		await reauth(cookie, password, {
			...env,
			LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
		});
		const first = await (await api('/api/my/genCliToken', {
			method: 'POST',
			headers: mutationHeaders(cookie),
		})).json();
		const second = await (await api('/api/my/genCliToken', {
			method: 'POST',
			headers: mutationHeaders(cookie),
		})).json();
		expect(first.data.token).not.toBe(second.data.token);
		expect(await userService.verifyCliToken({ env }, first.data.token)).toBeNull();
		expect((await userService.verifyCliToken({ env }, second.data.token)).userId).toBe(userId);
		const stored = await env.db.prepare('SELECT cli_token AS cliToken FROM user WHERE user_id = ?').bind(userId).first();
		expect(stored.cliToken).toMatch(/^sha256\$/);
		expect(stored.cliToken).not.toContain(second.data.token);
	});

	it('allows CLI revocation without recent auth', async () => {
		const email = 'recent-cli-revoke@example.com';
		const password = 'recent-cli-revoke-password';
		const userId = await createUser(email, password);
		const cookie = await login(email, password);
		const token = await userService.genCliToken({ env }, userId);
		await clearRecent(cookie);

		const response = await api('/api/my/revokeCliToken', {
			method: 'POST',
			headers: mutationHeaders(cookie),
		});
		expect(response.status).toBe(200);
		expect(await userService.verifyCliToken({ env }, token)).toBeNull();
	});

	it('blocks password changes without recent auth and revokes the session after an authorized change', async () => {
		const email = 'recent-password-change@example.com';
		const password = 'recent-password-before';
		await createUser(email, password);
		const cookie = await login(email, password);
		await clearRecent(cookie);
		const before = await env.db.prepare('SELECT password, salt FROM user WHERE email = ?').bind(email).first();

		const blocked = await api('/api/my/resetPassword', {
			method: 'PUT',
			headers: mutationHeaders(cookie),
			body: JSON.stringify({ password: 'recent-password-after' }),
		});
		expect(blocked.status).toBe(428);
		const afterBlocked = await env.db.prepare('SELECT password, salt FROM user WHERE email = ?').bind(email).first();
		expect(afterBlocked).toEqual(before);

		await reauth(cookie, password, {
			...env,
			LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
		});
		const changed = await api('/api/my/resetPassword', {
			method: 'PUT',
			headers: mutationHeaders(cookie),
			body: JSON.stringify({ password: 'recent-password-after' }),
		});
		expect(changed.status).toBe(200);
		const after = await api('/api/my/loginUserInfo', { headers: { Cookie: cookie } });
		expect(after.status).toBe(401);
	});

	it('removes the recent-auth marker when the session logs out', async () => {
		const email = 'recent-logout@example.com';
		const password = 'recent-logout-password';
		await createUser(email, password);
		const cookie = await login(email, password);
		const key = KvConst.RECENT_AUTH + await sessionHash(cookie);
		expect(await env.kv.get(key)).not.toBeNull();

		await api('/api/logout', {
			method: 'DELETE',
			headers: mutationHeaders(cookie),
		});
		expect(await env.kv.get(key)).toBeNull();
	});
});
