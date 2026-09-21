import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import adminIdentityService from '../src/service/admin-identity-service';
import KvConst from '../src/const/kv-const';
import userService from '../src/service/user-service';
import { markInstalled } from './installed-instance';

const ADMIN_PASSWORD = 'persisted-admin-password';
const MEMBER_PASSWORD = 'persisted-member-password';
const TARGET_EMAIL = 'admin-new@example.com';

function context(runtimeEnv = env) {
	const values = new Map();
	return { env: runtimeEnv, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, options = {}, runtimeEnv = env) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request(`http://localhost${path}`, options), runtimeEnv, execution);
	await waitOnExecutionContext(execution);
	return response;
}

async function createUser(email, password, isAdmin = false) {
	const material = await cryptoUtils.hashPassword(password);
	const row = await env.db.prepare(`
		INSERT INTO user(email, password, salt, is_admin)
		VALUES (?, ?, ?, ?) RETURNING user_id AS userId
	`).bind(email, material.hash, material.salt, isAdmin ? 1 : 0).first();
	await env.db.prepare(`
		INSERT INTO account(email, user_id, all_receive, is_default_send)
		VALUES (?, ?, 1, 1)
	`).bind(email, row.userId).run();
	return row.userId;
}

async function login(email, password, runtimeEnv = env) {
	const response = await request('/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
		body: JSON.stringify({ email, password }),
	}, { ...runtimeEnv, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) } });
	const cookie = (response.headers.get('set-cookie') || '').match(/mail_session_dev=([^;,]+)/)?.[1];
	return { response, cookie: cookie ? `mail_session_dev=${cookie}` : '' };
}

async function sessionHash(cookie) {
	return cryptoUtils.hashSecret(cookie.slice(cookie.indexOf('=') + 1));
}

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env);
	await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, window_minutes = 1440 WHERE id = 1').run();
	await createUser(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD, true);
	await createUser('member@example.com', MEMBER_PASSWORD);
});

describe.sequential('persisted administrator identity', () => {
	it('enforces one administrator and records the migration structure', async () => {
		expect(await dbInit.v3_17Applied(context())).toBe(true);
		const marker = await env.db.prepare('SELECT version FROM schema_migrations WHERE version = 318').first();
		expect(marker?.version).toBe(318);
		await expect(env.db.prepare("UPDATE user SET is_admin = 1 WHERE email = 'member@example.com'").run())
			.rejects.toThrow();
	});

	it('does not transfer permissions when the environment points to a member', async () => {
		const driftEnv = { ...env, FLAREMAIL_ADMIN_EMAIL: 'member@example.com' };
		const adminLogin = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD, driftEnv);
		const adminList = await request('/api/user/list?num=1&size=20&status=-1&isDel=0', {
			headers: { Cookie: adminLogin.cookie },
		}, driftEnv);
		expect(adminList.status).toBe(200);
		const protectedAdmin = await request('/api/user/setStatus', {
			method: 'PUT',
			headers: { Cookie: adminLogin.cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: (await env.db.prepare('SELECT user_id FROM user WHERE is_admin = 1').first()).user_id, status: 1 }),
		}, driftEnv);
		expect(protectedAdmin.status).toBe(400);

		const memberLogin = await login('member@example.com', MEMBER_PASSWORD, driftEnv);
		const memberList = await request('/api/user/list?num=1&size=20&status=-1&isDel=0', {
			headers: { Cookie: memberLogin.cookie },
		}, driftEnv);
		expect(memberList.status).toBe(403);

		const status = await request('/api/setup/status', {}, {
			...driftEnv,
			SETUP_STATUS_RATE_LIMITER: { limit: async () => ({ success: true }) },
		});
		const statusJson = await status.json();
		expect(statusJson.data.setupRequired).toBe(false);
		expect(statusJson.data.adminEmail).toBeUndefined();
		expect(statusJson.data.adminConfigMatches).toBeUndefined();
		expect(statusJson.data.domainList).toBeUndefined();
		for (const configuredAdmin of ['', 'missing@example.com']) {
			const missingEnv = { ...env, FLAREMAIL_ADMIN_EMAIL: configuredAdmin };
			const persistedLogin = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD, missingEnv);
			const response = await request('/api/user/list?num=1&size=20&status=-1&isDel=0', {
				headers: { Cookie: persistedLogin.cookie },
			}, missingEnv);
			expect(response.status).toBe(200);
		}
	});

	it('grants members exactly the documented permission set', async () => {
		const memberLogin = await login('member@example.com', MEMBER_PASSWORD);
		const memberHeaders = {
			Cookie: memberLogin.cookie,
			Origin: 'http://localhost',
			'Content-Type': 'application/json',
		};
		const permissive = {
			...env,
			EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) },
			SEND_RATE_LIMITER: { limit: async () => ({ success: true }) },
		};

		// The set itself is the contract: assert it element by element so that
		// adding or removing a key cannot pass unnoticed.
		const info = await request('/api/my/loginUserInfo', { headers: { Cookie: memberLogin.cookie } });
		expect(info.status).toBe(200);
		expect((await info.json()).data.permKeys).toEqual([
			'email:delete', 'account:add', 'account:query', 'account:delete', 'email:send',
		]);

		// Every route mapped from those keys must clear the permission guard.
		// A business-level 400 still proves the guard let the request through.
		for (const [method, path] of [
			['GET', '/api/account/list?accountId=0&size=30'],
			['POST', '/api/account/add'],
			['DELETE', '/api/account/delete'],
			['POST', '/api/email/send'],
			['DELETE', '/api/email/delete'],
		]) {
			const response = await request(path, {
				method,
				headers: memberHeaders,
				body: method === 'GET' ? undefined : JSON.stringify({}),
			}, permissive);
			expect(response.status, `${method} ${path}`).not.toBe(403);
		}

		// Routes outside the set stay refused.
		for (const path of [
			'/api/user/list?num=1&size=20&status=-1&isDel=0',
			'/api/setting/query',
			'/api/unmatched/list',
		]) {
			const denied = await request(path, { headers: { Cookie: memberLogin.cookie } });
			expect(denied.status, path).toBe(403);
		}
	});

	it('keeps primary-email data atomic when the D1 batch fails', async () => {
		const admin = await env.db.prepare('SELECT user_id AS userId, email FROM user WHERE is_admin = 1').first();
		const rollbackTarget = 'admin-rollback@example.com';
		await env.db.prepare('INSERT INTO account(email, user_id) VALUES (?, ?)').bind(rollbackTarget, admin.userId).run();
		const failingDb = new Proxy(env.db, {
			get(target, property) {
				if (property === 'batch') return async () => { throw new Error('injected administrator migration failure'); };
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		await expect(adminIdentityService.migratePrimaryEmail(
			{ env: { ...env, db: failingDb } }, rollbackTarget, admin.userId,
		)).rejects.toThrow('injected administrator migration failure');
		expect((await env.db.prepare('SELECT email FROM user WHERE user_id = ?').bind(admin.userId).first()).email).toBe(admin.email);
		await env.db.prepare('DELETE FROM account WHERE email = ?').bind(rollbackTarget).run();
	});

	it('rejects invalid primary targets without changing administrator data', async () => {
		const admin = await env.db.prepare('SELECT user_id AS userId, email FROM user WHERE is_admin = 1').first();
		const { cookie } = await login(admin.email, ADMIN_PASSWORD);
		const before = await env.db.prepare('SELECT email, cli_token AS cliToken FROM user WHERE user_id = ?').bind(admin.userId).first();
		const response = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: 'member@example.com' }),
		});
		expect(response.status).toBe(409);
		expect(await env.db.prepare('SELECT email, cli_token AS cliToken FROM user WHERE user_id = ?').bind(admin.userId).first()).toEqual(before);
	});

	it('requires a persisted administrator, recent authentication, and a trusted Origin', async () => {
		const member = await login('member@example.com', MEMBER_PASSWORD);
		const memberAttempt = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: member.cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: env.FLAREMAIL_ADMIN_EMAIL }),
		});
		expect(memberAttempt.status).toBe(403);

		const admin = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		await env.kv.delete(KvConst.RECENT_AUTH + await sessionHash(admin.cookie));
		const withoutRecentAuth = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: admin.cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: env.FLAREMAIL_ADMIN_EMAIL }),
		});
		expect(withoutRecentAuth.status).toBe(428);

		const hostileOrigin = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: admin.cookie, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: env.FLAREMAIL_ADMIN_EMAIL }),
		});
		expect(hostileOrigin.status).toBe(403);
	});

	it('converges session cleanup when KV revocation fails after the D1 commit', async () => {
		const admin = await env.db.prepare('SELECT user_id AS userId, email FROM user WHERE is_admin = 1').first();
		const retryEmail = 'admin-retry@example.com';
		const cliToken = 'phase29-cli-token';
		await env.db.prepare('INSERT INTO account(email, user_id) VALUES (?, ?)').bind(retryEmail, admin.userId).run();
		await env.db.prepare('UPDATE user SET cli_token = ? WHERE user_id = ?')
			.bind(`sha256$${await cryptoUtils.hashSecret(cliToken)}`, admin.userId).run();
		const cliEnv = { ...env, EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) } };
		expect((await request('/api/cli/accounts', { headers: { Authorization: `Bearer ${cliToken}` } }, cliEnv)).status).toBe(200);

		const first = await login(admin.email, ADMIN_PASSWORD);
		const second = await login(admin.email, ADMIN_PASSWORD);
		const sessionHashes = await Promise.all([first.cookie, second.cookie].map(sessionHash));
		let failed = false;
		const failingKv = new Proxy(env.kv, {
			get(target, property) {
				if (property === 'delete') {
					return async key => {
						if (!failed && String(key).startsWith(KvConst.SESSION)) {
							failed = true;
							throw new Error('injected KV revocation failure');
						}
						return target.delete(key);
					};
				}
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const failedMigration = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: first.cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: retryEmail }),
		}, { ...env, kv: failingKv });
		expect(failedMigration.status).toBe(500);
		expect(await env.db.prepare('SELECT email, cli_token AS cliToken FROM user WHERE user_id = ?').bind(admin.userId).first())
			.toEqual({ email: retryEmail, cliToken: '' });
		expect((await login(admin.email, ADMIN_PASSWORD)).response.status).toBe(401);
		expect((await request('/api/cli/accounts', { headers: { Authorization: `Bearer ${cliToken}` } }, cliEnv)).status).toBe(401);

		const recoveryLogin = await login(retryEmail, ADMIN_PASSWORD);
		const replay = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: recoveryLogin.cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: retryEmail }),
		});
		expect(replay.status).toBe(200);
		expect((await replay.json()).data.migrated).toBe(false);
		for (const hash of sessionHashes) {
			expect(await env.kv.get(KvConst.SESSION + hash)).toBeNull();
			expect(await env.kv.get(KvConst.RECENT_AUTH + hash)).toBeNull();
		}
		expect(await env.kv.get(KvConst.AUTH_INFO + admin.userId)).toBeNull();
	});

	it('migrates the primary email while preserving identity and revoking credentials', async () => {
		const admin = await env.db.prepare(`
			SELECT user_id AS userId, email, password, salt FROM user WHERE is_admin = 1
		`).first();
		await env.db.prepare(`
			UPDATE user SET google_sub = 'phase29-google-sub', google_email = 'phase29@gmail.com',
				cli_token = 'sha256$old-cli-token'
			WHERE user_id = ?
		`).bind(admin.userId).run();
		await env.db.prepare(`
			INSERT INTO account(email, user_id, all_receive, is_default_send)
			VALUES (?, ?, 0, 0)
		`).bind(TARGET_EMAIL, admin.userId).run();

		const firstSession = await login(admin.email, ADMIN_PASSWORD);
		const secondSession = await login(admin.email, ADMIN_PASSWORD);
		const response = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: firstSession.cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: TARGET_EMAIL }),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ migrated: true, email: TARGET_EMAIL });
		expect(response.headers.get('set-cookie')).toContain('mail_session_dev=;');

		const migrated = await env.db.prepare(`
			SELECT user_id AS userId, email, password, salt, is_admin AS isAdmin,
				google_sub AS googleSub, google_email AS googleEmail, cli_token AS cliToken
			FROM user WHERE user_id = ?
		`).bind(admin.userId).first();
		expect(migrated).toMatchObject({
			userId: admin.userId,
			email: TARGET_EMAIL,
			password: admin.password,
			salt: admin.salt,
			isAdmin: 1,
			googleSub: 'phase29-google-sub',
			googleEmail: 'phase29@gmail.com',
			cliToken: '',
		});
		const accounts = await env.db.prepare(`
			SELECT email, all_receive AS allReceive, is_default_send AS isDefaultSend
			FROM account WHERE user_id = ? ORDER BY email
		`).bind(admin.userId).all();
		expect(accounts.results).toEqual(expect.arrayContaining([
			{ email: TARGET_EMAIL, allReceive: 1, isDefaultSend: 1 },
			{ email: 'admin-retry@example.com', allReceive: 0, isDefaultSend: 0 },
			{ email: env.FLAREMAIL_ADMIN_EMAIL, allReceive: 0, isDefaultSend: 0 },
		]));
		expect(accounts.results).toHaveLength(3);

		const revoked = await request('/api/my/loginUserInfo', { headers: { Cookie: secondSession.cookie } });
		expect(revoked.status).toBe(401);
		expect((await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD)).response.status).toBe(401);
		const newLogin = await login(TARGET_EMAIL, ADMIN_PASSWORD, { ...env, FLAREMAIL_ADMIN_EMAIL: env.FLAREMAIL_ADMIN_EMAIL });
		expect(newLogin.response.status).toBe(200);
		const info = await request('/api/my/loginUserInfo', { headers: { Cookie: newLogin.cookie } }, { ...env, FLAREMAIL_ADMIN_EMAIL: env.FLAREMAIL_ADMIN_EMAIL });
		expect((await info.json()).data).toMatchObject({ email: TARGET_EMAIL, type: 0, accountLimit: 0 });
		expect((await userService.selectByGoogleSub({ env }, 'phase29-google-sub')).userId).toBe(admin.userId);

		const subject = 'phase29 old address still receives';
		const raw = [
			'From: sender@outside.test',
			`To: ${env.FLAREMAIL_ADMIN_EMAIL}`,
			`Subject: ${subject}`,
			'',
			'old address delivery',
		].join('\r\n');
		let rejection = null;
		await worker.email({
			from: 'sender@outside.test',
			to: env.FLAREMAIL_ADMIN_EMAIL,
			raw: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(raw));
					controller.close();
				},
			}),
			setReject: reason => { rejection = reason; },
			forward: async () => undefined,
		}, env, createExecutionContext());
		expect(rejection).toBeNull();
		const received = await env.db.prepare('SELECT user_id AS userId FROM email WHERE subject = ?').bind(subject).first();
		expect(received?.userId).toBe(admin.userId);

		const replay = await request('/api/admin/migrate-primary-email', {
			method: 'POST',
			headers: { Cookie: newLogin.cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetEmail: TARGET_EMAIL }),
		}, { ...env, FLAREMAIL_ADMIN_EMAIL: env.FLAREMAIL_ADMIN_EMAIL });
		expect(replay.status).toBe(200);
		expect((await replay.json()).data.migrated).toBe(false);
	});

  it('uses the shared disabled policy for primary-email migration and still requires an owned mailbox', async () => {
    await env.db.prepare('UPDATE admin_confirmation SET enabled = 0 WHERE id = 1').run();
    const admin = await env.db.prepare('SELECT user_id AS userId,email FROM user WHERE is_admin = 1').first();
    const { cookie } = await login(admin.email, ADMIN_PASSWORD);
    await env.kv.delete(KvConst.RECENT_AUTH + await sessionHash(cookie));
    const headers = { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' };
    const refused = await request('/api/admin/migrate-primary-email', { method: 'POST', headers, body: JSON.stringify({ targetEmail: 'member@example.com' }) });
    expect(refused.status).toBe(409);
    const target = 'admin-unified-off@example.com';
    await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind(target, admin.userId).run();
    const moved = await request('/api/admin/migrate-primary-email', { method: 'POST', headers, body: JSON.stringify({ targetEmail: target }) });
    expect(moved.status).toBe(200);
    expect((await env.db.prepare('SELECT email,is_admin FROM user WHERE user_id = ?').bind(admin.userId).first())).toEqual({ email: target, is_admin: 1 });
    expect((await request('/api/my/loginUserInfo', { headers: { Cookie: cookie } })).status).toBe(401);
  });
});
