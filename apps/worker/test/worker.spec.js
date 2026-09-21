import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils, { PBKDF2_ITERATIONS } from '../src/utils/crypto-utils';
import sanitizeEmailHtml from '../src/utils/html-sanitizer';
import userService from '../src/service/user-service';
import accountService from '../src/service/account-service';
import emailService from '../src/service/email-service';
import starService from '../src/service/star-service';
import attService from '../src/service/att-service';
import { normalizeSendParams } from '../src/utils/send-validator';
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

beforeAll(async () => {
	await dbInit.migrate(createTestContext());
	await markInstalled(env);
	await createLegacyUser(env.FLAREMAIL_ADMIN_EMAIL, env.FLAREMAIL_ADMIN_PASSWORD, '', true);
});

afterEach(async () => {
	await env.db.prepare("UPDATE mail_provider_config SET provider = 'resend' WHERE id = 1").run();
});

async function createLegacyUser(email, password, cliToken = '', isAdmin = false) {
	const salt = `legacy-salt-${email}`;
	const hash = await cryptoUtils.genHashPassword(password, salt);
	const inserted = await env.db.prepare(
		'INSERT INTO user (email, password, salt, cli_token, is_admin) VALUES (?, ?, ?, ?, ?) RETURNING user_id AS userId',
	).bind(email, hash, salt, cliToken, isAdmin ? 1 : 0).first();
	await env.db.prepare('INSERT INTO account (email, user_id) VALUES (?, ?)').bind(email, inserted.userId).run();
	return inserted.userId;
}

async function api(path, options = {}, runtimeEnv = env) {
	const request = new Request(`http://localhost${path}`, options);
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
	const setCookie = response.headers.get('set-cookie');
	expect(setCookie).toContain('HttpOnly');
	expect(setCookie).toContain('SameSite=Strict');
	return setCookie.split(';')[0];
}

describe('local Workers test environment', () => {
	it('keeps PBKDF2 within the Cloudflare Workers production limit', () => {
		expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100000);
	});

	it('provides isolated D1, KV and R2 bindings', async () => {
		expect(env.db).toBeDefined();
		expect(env.kv).toBeDefined();
		expect(env.r2).toBeDefined();

		await env.kv.put('test:binding', 'local');
		expect(await env.kv.get('test:binding')).toBe('local');

		await env.r2.put('test/binding.txt', 'local');
		const object = await env.r2.get('test/binding.txt');
		expect(await object.text()).toBe('local');

		const settingTable = await env.db.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'setting'",
		).first();
		expect(settingTable?.name).toBe('setting');
	});

	it('serves public website configuration from the local database', async () => {
		const request = new Request('http://localhost/api/setting/websiteConfig', {
			headers: { Origin: 'http://localhost:8787' },
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		const body = await response.json();
		expect(body.code).toBe(200);
		expect(body.data.domainList).toEqual(['@example.com']);
	});

	it('runs the scheduled maintenance handler locally', async () => {
		const inserted = await env.db.prepare(
			'INSERT INTO user (email, password, salt, send_count) VALUES (?, ?, ?, ?)',
		).bind('scheduled-test@example.com', 'test-hash', 'test-salt', 3).run();
		expect(inserted.meta.changes).toBe(1);

		const before = await env.db.prepare(
			'SELECT send_count AS sendCount FROM user WHERE email = ?',
		).bind('scheduled-test@example.com').first();
		expect(before.sendCount).toBe(3);

		const controller = createScheduledController({
			cron: '0 16 * * *',
			scheduledTime: Date.now(),
		});
		const ctx = createExecutionContext();

		await worker.scheduled(controller, env, ctx);
		await waitOnExecutionContext(ctx);

		const after = await env.db.prepare(
			'SELECT send_count AS sendCount FROM user WHERE email = ?',
		).bind('scheduled-test@example.com').first();
		expect(after.sendCount).toBe(0);
	});
});

describe('security regression coverage', () => {
	let attachmentOwnerId;
	let attachmentOwnerCookie;
	it('does not grant credentialed CORS access to untrusted origins', async () => {
		const read = await api('/api/setting/websiteConfig', {
			headers: { Origin: 'https://evil.example' },
		});
		expect(read.status).toBe(200);
		expect(read.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(read.headers.get('Access-Control-Allow-Credentials')).toBeNull();

		const preflight = await api('/api/my/forward', {
			method: 'OPTIONS',
			headers: {
				Origin: 'https://evil.example',
				'Access-Control-Request-Method': 'PUT',
				'Access-Control-Request-Headers': 'Content-Type',
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBeNull();
		expect(preflight.headers.get('Access-Control-Allow-Methods')).toBeNull();
	});

	it('grants credentialed CORS access only to explicitly configured origins', async () => {
		const response = await api('/api/setting/websiteConfig', {
			headers: { Origin: 'http://localhost:8787' },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8787');
		expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
	});

	it('uses persisted extra origins and ignores obsolete environment values at runtime', async () => {
		await env.db.prepare(`UPDATE runtime_config SET allowed_origins = ? WHERE id = 1`)
			.bind('["https://trusted.example"]')
			.run();
		const trusted = await api('/api/setting/websiteConfig', {
			headers: { Origin: 'https://trusted.example' },
		}, { ...env, FLAREMAIL_ALLOWED_ORIGINS: ['https://wrong.example'] });
		expect(trusted.headers.get('Access-Control-Allow-Origin')).toBe('https://trusted.example');

		const obsoleteEnvironment = await api('/api/setting/websiteConfig', {
			headers: { Origin: 'https://wrong.example' },
		}, { ...env, FLAREMAIL_ALLOWED_ORIGINS: ['https://wrong.example'] });
		expect(obsoleteEnvironment.headers.get('Access-Control-Allow-Origin')).toBeNull();

		await env.db.prepare(`UPDATE runtime_config SET allowed_origins = ? WHERE id = 1`)
			.bind('["http://localhost:8787"]')
			.run();
	});

	it('rejects simple cross-site mutations while preserving non-browser server calls', async () => {
		const simpleCrossSite = await api('/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' },
			body: '{}',
		});
		expect(simpleCrossSite.status).toBe(403);

		const browserWithoutOrigin = await api('/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
			body: JSON.stringify({ email: 'nobody@example.com', password: 'irrelevant' }),
		});
		expect(browserWithoutOrigin.status).toBe(403);

		const serverCall = await api('/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: 'nobody@example.com', password: 'irrelevant' }),
		}, { ...env, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) } });
		expect(serverCall.status).toBe(401);
	});

	it('rejects browser mutations from untrusted origins', async () => {
		const response = await api('/api/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'https://evil.example',
				'Sec-Fetch-Site': 'cross-site',
			},
			body: JSON.stringify({ email: 'nobody@example.com', password: 'irrelevant' }),
		});
		expect(response.status).toBe(403);
		expect((await response.json()).code).toBe(403);
		expect(response.headers.get('set-cookie')).toBeNull();
	});

	it('sanitizes active content and blocks remote images by default', () => {
		const sanitized = sanitizeEmailHtml(`
			<body style="color: red; background-image: url(https://tracker.example/pixel)">
				<script>alert(1)</script>
				<svg onload="alert(2)"><script>alert(3)</script></svg>
				<ul style='list-style: image-set("https://tracker.example/list.png")'><li>tracked</li></ul>
				<a href="javascript:alert(4)" onclick="alert(5)">unsafe</a>
				<img src="https://tracker.example/pixel.png" onerror="alert(6)">
				<img src="{{domain}}attachments/safe.png">
			</body>
		`);

		expect(sanitized).not.toMatch(/<script|<svg|onerror|onclick|javascript:|background-image|image-set|list-style/i);
		expect(sanitized).toContain('data-remote-src="https://tracker.example/pixel.png"');
		expect(sanitized).toContain('src="{{domain}}attachments/safe.png"');
	});

	it('uses HttpOnly sessions, upgrades legacy hashes and invalidates logout', async () => {
		const email = 'session-user@example.com';
		const password = 'legacy-password-long-enough';
		const userId = await createLegacyUser(email, password);
		const cookie = await login(email, password);

		const loginBody = await (await api('/api/my/loginUserInfo', {
			headers: { Cookie: cookie },
		})).json();
		expect(loginBody.code).toBe(200);
		expect(loginBody.data.email).toBe(email);

		const upgraded = await env.db.prepare('SELECT salt FROM user WHERE user_id = ?').bind(userId).first();
		expect(upgraded.salt).toMatch(/^pbkdf2-sha256\$100000\$/);

		const bearerOnly = await (await api('/api/my/loginUserInfo', {
			headers: { Authorization: 'Bearer legacy-session-id' },
		})).json();
		expect(bearerOnly.code).toBe(401);

		const logoutResponse = await api('/api/logout', {
			method: 'DELETE',
			headers: { Cookie: cookie, Origin: 'http://localhost:8787' },
		});
		expect((await logoutResponse.json()).code).toBe(200);

		const afterLogout = await (await api('/api/my/loginUserInfo', {
			headers: { Cookie: cookie },
		})).json();
		expect(afterLogout.code).toBe(401);
	});

	it('revokes web and CLI access when a user is banned', async () => {
		const email = 'banned-user@example.com';
		const password = 'another-legacy-password';
		const userId = await createLegacyUser(email, password, 'cl_plaintext_legacy');
		const cookie = await login(email, password);

		await userService.setStatus({ env }, { userId, status: 1 });
		const webResult = await (await api('/api/my/loginUserInfo', {
			headers: { Cookie: cookie },
		})).json();
		expect(webResult.code).toBe(401);
		expect(await userService.verifyCliToken({ env }, 'cl_plaintext_legacy')).toBeNull();

		const row = await env.db.prepare('SELECT cli_token AS cliToken FROM user WHERE user_id = ?').bind(userId).first();
		expect(row.cliToken).toBe('');
	});

	it('serves attachments only to their owning user', async () => {
		const ownerEmail = 'attachment-owner@example.com';
		const attackerEmail = 'attachment-attacker@example.com';
		const ownerPassword = 'owner-password-long-enough';
		const attackerPassword = 'attacker-password-long-enough';
		const ownerId = await createLegacyUser(ownerEmail, ownerPassword);
		attachmentOwnerId = ownerId;
		await createLegacyUser(attackerEmail, attackerPassword);
		const ownerCookie = await login(ownerEmail, ownerPassword);
		attachmentOwnerCookie = ownerCookie;
		const attackerCookie = await login(attackerEmail, attackerPassword);
		const key = 'attachments/private.txt';

		await env.r2.put(key, 'owner-only');
		await env.db.prepare(
			'INSERT INTO attachments (user_id, email_id, account_id, key, filename, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)',
		).bind(ownerId, 1, 1, key, 'private.txt', 'text/plain', 10).run();

		const ownerResponse = await api(`/api/attachment/${key}`, { headers: { Cookie: ownerCookie } });
		expect(ownerResponse.status).toBe(200);
		expect(new TextDecoder().decode(await ownerResponse.arrayBuffer())).toBe('owner-only');
		expect(ownerResponse.headers.get('cache-control')).toBe('private, no-store');

		const attackerResponse = await api(`/api/attachment/${key}`, { headers: { Cookie: attackerCookie } });
		const attackerBody = await attackerResponse.json();
		expect(attackerBody.code).toBe(404);

		const unauthenticated = await (await api(`/api/attachment/${key}`)).json();
		expect(unauthenticated.code).toBe(401);
		const malformed = await (await api('/api/attachment/attachments/%E0%A4%A', {
			headers: { Cookie: ownerCookie },
		})).json();
		expect(malformed.code).toBe(404);

		const selfServiceAlias = await api('/api/account/add', {
			method: 'POST',
			headers: {
				Cookie: ownerCookie,
				Origin: 'http://localhost:8787',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ email: 'owner-self-service@example.com' }),
		});
		expect(selfServiceAlias.status).toBe(200);
		expect((await accountService.selectByEmailIncludeDel({ env }, 'owner-self-service@example.com')).userId).toBe(ownerId);

		const kvKey = 'attachments/private-kv.txt';
		await env.kv.put(kvKey, 'kv-owner-only', {metadata: {contentType: 'text/plain'}});
		await env.db.prepare(
			'INSERT INTO attachments (user_id, email_id, account_id, key, filename, mime_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)',
		).bind(ownerId, 1, 1, kvKey, 'private-kv.txt', 'text/plain', 13).run();
		const kvResponse = await api(`/api/attachment/${kvKey}`, {
			headers: { Cookie: ownerCookie },
		}, {...env, r2: undefined});
		expect(new TextDecoder().decode(await kvResponse.arrayBuffer())).toBe('kv-owner-only');
	});

	it('stores only a hash of newly generated CLI tokens', async () => {
		const alias = await accountService.adminAdd({ env }, {
			userId: attachmentOwnerId,
			email: 'owner-alias@example.com',
		});
		expect(alias.userId).toBe(attachmentOwnerId);
		const token = await userService.genCliToken({ env }, attachmentOwnerId);
		const row = await env.db.prepare('SELECT cli_token AS cliToken FROM user WHERE user_id = ?')
			.bind(attachmentOwnerId).first();
		expect(row.cliToken).toMatch(/^sha256\$/);
		expect(row.cliToken).not.toContain(token);
		const verified = await userService.verifyCliToken({ env }, token);
		expect(verified.userId).toBe(attachmentOwnerId);
	});

	it('rejects sessions whose verified password hash changed before use', async () => {
		const email = 'credential-race@example.com';
		const password = 'credential-race-password';
		const userId = await createLegacyUser(email, password);
		const cookie = await login(email, password);
		const replacement = await cryptoUtils.hashPassword('replacement-password-long');
		await env.db.prepare('UPDATE user SET password = ?, salt = ? WHERE user_id = ?')
			.bind(replacement.hash, replacement.salt, userId).run();

		const response = await (await api('/api/my/loginUserInfo', {
			headers: { Cookie: cookie },
		})).json();
		expect(response.code).toBe(401);
	});

	it('removes obsolete webhook columns and clears legacy CLI tokens during upgrade', async () => {
		await env.db.prepare("ALTER TABLE user ADD COLUMN webhook_url TEXT NOT NULL DEFAULT ''").run();
		await env.db.prepare('ALTER TABLE user ADD COLUMN webhook_status INTEGER NOT NULL DEFAULT 0').run();
		await env.db.prepare("UPDATE user SET cli_token = 'legacy-token' WHERE email = ?")
			.bind('session-user@example.com').run();
		const beforeUsers = await env.db.prepare('SELECT COUNT(*) AS total FROM user').first();
		const beforeAttachments = await env.db.prepare('SELECT COUNT(*) AS total FROM attachments').first();

		await dbInit.v3_6DB(createTestContext());
		await dbInit.v3_6DB(createTestContext());

		const columns = await env.db.prepare('PRAGMA table_info(user)').all();
		expect(columns.results.map(column => column.name)).not.toContain('webhook_url');
		expect(columns.results.map(column => column.name)).not.toContain('webhook_status');
		const legacy = await env.db.prepare('SELECT cli_token AS cliToken FROM user WHERE email = ?')
			.bind('session-user@example.com').first();
		expect(legacy.cliToken).toBe('');
		const hashed = await env.db.prepare('SELECT cli_token AS cliToken FROM user WHERE user_id = ?')
			.bind(attachmentOwnerId).first();
		expect(hashed.cliToken).toMatch(/^sha256\$/);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM user').first()).total).toBe(beforeUsers.total);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM attachments').first()).total).toBe(beforeAttachments.total);
		expect(attachmentOwnerCookie).toBeTruthy();
	});
});

describe('outgoing mail and forwarding boundaries', () => {
	async function send(cookie, body, runtimeEnv = env) {
		return api('/api/email/send', {
			method: 'POST',
			headers: {
				Cookie: cookie,
				Origin: 'http://localhost:8787',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		}, runtimeEnv);
	}

	async function accountIdFor(email) {
		return (await env.db.prepare('SELECT account_id AS accountId FROM account WHERE email = ?').bind(email).first()).accountId;
	}

	it('persists a new object when reusing an authenticated inline image', async () => {
		const sender = 'inline-image-sender@example.com';
		const recipient = 'inline-image-recipient@example.com';
		const senderId = await createLegacyUser(sender, 'inline-image-sender-password');
		await createLegacyUser(recipient, 'inline-image-recipient-password');
		const accountId = await accountIdFor(sender);
		const sourceEmail = await env.db.prepare(
			`INSERT INTO email(user_id, account_id, type, status, subject) VALUES (?, ?, 0, 0, 'source inline') RETURNING email_id AS emailId`
		).bind(senderId, accountId).first();
		const oldKey = 'attachments/legacy-inline-image.png';
		const bytes = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
		await env.r2.put(oldKey, bytes, { httpMetadata: { contentType: 'image/png' } });
		await env.db.prepare(`
			INSERT INTO attachments(user_id, email_id, account_id, key, filename, mime_type, size, type)
			VALUES (?, ?, ?, ?, 'inline.png', 'image/png', ?, 1)
		`).bind(senderId, sourceEmail.emailId, accountId, oldKey, bytes.byteLength).run();

		const cookie = await login(sender, 'inline-image-sender-password');
		const response = await send(cookie, {
			accountId,
			receiveEmail: [recipient],
			subject: 'reused inline image',
			content: `<p>copy</p><img src="/api/attachment/${encodeURIComponent(oldKey)}">`,
			requestId: 'request_inline_image_copy_0001',
		});
		expect(response.status).toBe(200);
		const copied = await env.db.prepare(`
			SELECT a.key
			FROM attachments a JOIN email e ON e.email_id = a.email_id
			WHERE e.user_id = ? AND e.subject = 'reused inline image'
			ORDER BY a.att_id DESC LIMIT 1
		`).bind(senderId).first();
		expect(copied.key).not.toBe(oldKey);
		const copiedObject = await env.r2.get(copied.key);
		expect(copiedObject).not.toBeNull();
		expect(Array.from(new Uint8Array(await copiedObject.arrayBuffer()))).toEqual(Array.from(bytes));
		const authenticated = await api(`/api/attachment/${encodeURIComponent(copied.key)}`, {
			headers: { Cookie: cookie },
		});
		expect(authenticated.status).toBe(200);
	});

	it('enforces attachment byte boundaries using decoded sizes', () => {
		const base = {
			accountId: 1,
			receiveEmail: ['recipient@outside.test'],
			subject: 'size boundary',
			content: '<p>body</p>',
		};
		expect(() => normalizeSendParams({
			...base,
			attachments: [
				{ filename: 'one.bin', type: 'application/octet-stream', content: new ArrayBuffer(10 * 1024 * 1024) },
				{ filename: 'two.bin', type: 'application/octet-stream', content: new ArrayBuffer(10 * 1024 * 1024) },
			],
		})).not.toThrow();
		expect(() => normalizeSendParams({
			...base,
			attachments: [{ filename: 'large.bin', type: 'application/octet-stream', content: new ArrayBuffer(10 * 1024 * 1024 + 1) }],
		})).toThrow(/10 MB/);
		expect(() => normalizeSendParams({
			...base,
			attachments: [
				{ filename: 'a.bin', type: 'application/octet-stream', content: new ArrayBuffer(8 * 1024 * 1024) },
				{ filename: 'b.bin', type: 'application/octet-stream', content: new ArrayBuffer(8 * 1024 * 1024) },
				{ filename: 'c.bin', type: 'application/octet-stream', content: new ArrayBuffer(4 * 1024 * 1024 + 1) },
			],
		})).toThrow(/20 MB/);
	});

	it('rejects recipient and attachment limit violations before creating a sent record', async () => {
		const sender = 'validation-sender@example.com';
		const recipient = 'validation-recipient@example.com';
		const senderId = await createLegacyUser(sender, 'validation-password-long');
		await createLegacyUser(recipient, 'recipient-password-long');
		const cookie = await login(sender, 'validation-password-long');
		const accountId = await accountIdFor(sender);

		const tooManyRecipients = await send(cookie, {
			accountId,
			receiveEmail: Array.from({ length: 21 }, (_, i) => `person${i}@outside.test`),
			subject: 'too many recipients',
			content: '<p>test</p>',
		});
		expect(tooManyRecipients.status).toBe(400);

		const tooManyAttachments = await send(cookie, {
			accountId,
			receiveEmail: [recipient],
			subject: 'too many attachments',
			content: '<p>test</p>',
			attachments: Array.from({ length: 11 }, (_, i) => ({
				filename: `file-${i}.txt`,
				content: 'YQ==',
				type: 'text/plain',
			})),
		});
		expect(tooManyAttachments.status).toBe(400);
		const state = await env.db.prepare(
			'SELECT send_count AS sendCount, (SELECT COUNT(*) FROM email WHERE user_id = ? AND type = 1) AS sentTotal FROM user WHERE user_id = ?',
		).bind(senderId, senderId).first();
		expect(state.sendCount).toBe(0);
		expect(state.sentTotal).toBe(0);
	});

	it('reserves a daily quota atomically under concurrent sends', async () => {
		const sender = 'quota-sender@example.com';
		const recipient = 'quota-recipient@example.com';
		const senderId = await createLegacyUser(sender, 'quota-password-long');
		const recipientId = await createLegacyUser(recipient, 'quota-recipient-password');
		await env.db.prepare('UPDATE user SET send_limit = 1 WHERE user_id = ?').bind(senderId).run();
		const cookie = await login(sender, 'quota-password-long');
		const body = {
			accountId: await accountIdFor(sender),
			receiveEmail: [recipient],
			subject: 'quota race',
			content: '<p>only one should be delivered</p>',
		};

		const responses = await Promise.all([send(cookie, body), send(cookie, body)]);
		expect(responses.map(response => response.status).sort()).toEqual([200, 403]);
		const quota = await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(senderId).first();
		expect(quota.sendCount).toBe(1);
		const senderTotal = await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ? AND type = 1').bind(senderId).first();
		const recipientTotal = await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ? AND type = 0').bind(recipientId).first();
		expect(senderTotal.total).toBe(1);
		expect(recipientTotal.total).toBe(1);
	});

	it('splits mixed recipients and treats provider transport errors as an unknown accepted state', async () => {
		await env.db.prepare("UPDATE mail_provider_config SET provider = 'cloudflare' WHERE id = 1").run();
		const sender = 'mixed-sender@example.com';
		const recipient = 'mixed-recipient@example.com';
		const senderId = await createLegacyUser(sender, 'mixed-password-long');
		const recipientId = await createLegacyUser(recipient, 'mixed-recipient-password');
		const cookie = await login(sender, 'mixed-password-long');
		const body = {
			accountId: await accountIdFor(sender),
			receiveEmail: [recipient, 'friend@outside.test'],
			subject: 'mixed delivery',
			content: '<p>mixed delivery</p>',
		};
		const provider = { send: vi.fn(async () => ({ messageId: 'cf-message-1' })) };
		const accepted = await send(cookie, body, { ...env, email: provider });
		expect(accepted.status).toBe(200);
		expect(provider.send).toHaveBeenCalledTimes(1);
		expect(provider.send.mock.calls[0][0].to).toEqual(['friend@outside.test']);
		const internal = await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ? AND type = 0').bind(recipientId).first();
		expect(internal.total).toBe(1);

		const failureSender = 'provider-failure@example.com';
		const failureId = await createLegacyUser(failureSender, 'provider-failure-password');
		const failureCookie = await login(failureSender, 'provider-failure-password');
		const unknown = await send(failureCookie, {
			...body,
			accountId: await accountIdFor(failureSender),
			receiveEmail: ['friend@outside.test'],
		}, { ...env, email: { send: vi.fn(async () => { throw new Error('provider detail'); }) } });
		expect(unknown.status).toBe(200);
		const unknownBody = await unknown.json();
		expect(unknownBody.data[0].status).toBe(5);
		expect(unknownBody.data[0].deliveryWarning).toMatch(/do not resend/i);
		const failureState = await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(failureId).first();
		expect(failureState.sendCount).toBe(1);
		const failedMail = await env.db.prepare('SELECT status, message FROM email WHERE user_id = ? AND type = 1').bind(failureId).first();
		expect(failedMail.status).toBe(5);
		expect(failedMail.message).not.toContain('provider detail');
	});

	it('allows one external forwarding target but rejects managed-domain loops', async () => {
		const mailbox = 'forward-owner@example.com';
		const userId = await createLegacyUser(mailbox, 'forward-password-long');
		const cookie = await login(mailbox, 'forward-password-long');
		const update = body => api('/api/my/forward', {
			method: 'PUT',
			headers: { Cookie: cookie, Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		const loop = await update({ forwardStatus: 0, forwardEmail: 'other@example.com' });
		expect(loop.status).toBe(400);
		const accepted = await update({ forwardStatus: 0, forwardEmail: 'trusted@qq.com' });
		expect(accepted.status).toBe(200);
		const row = await env.db.prepare('SELECT forward_status AS forwardStatus, forward_email AS forwardEmail FROM user WHERE user_id = ?').bind(userId).first();
		expect(row).toEqual({ forwardStatus: 0, forwardEmail: 'trusted@qq.com' });
	});

	it('recovers inbound SAVING rows without misclassifying outgoing rows', async () => {
		const userId = await createLegacyUser('recovery@example.com', 'recovery-password-long');
		const accountId = await accountIdFor('recovery@example.com');
		const inserted = await env.db.batch([
			env.db.prepare('INSERT INTO email (user_id, account_id, type, status) VALUES (?, ?, 0, 6) RETURNING email_id AS emailId').bind(userId, accountId),
			env.db.prepare("INSERT INTO email (user_id, account_id, type, status, create_time) VALUES (?, ?, 1, 6, datetime('now', '-10 minutes')) RETURNING email_id AS emailId").bind(userId, accountId),
		]);
		await worker.scheduled(createScheduledController({ cron: '0 16 * * *', scheduledTime: Date.now() }), env, createExecutionContext());
		const inboundId = inserted[0].results[0].emailId;
		const outboundId = inserted[1].results[0].emailId;
		const rows = await env.db.prepare('SELECT email_id AS emailId, status FROM email WHERE email_id IN (?, ?) ORDER BY email_id').bind(inboundId, outboundId).all();
		expect(rows.results).toEqual([{ emailId: inboundId, status: 0 }, { emailId: outboundId, status: 8 }]);
	});

	it('does not fail or resend a fresh outgoing request while scheduled maintenance runs', async () => {
		await env.db.prepare("UPDATE mail_provider_config SET provider = 'cloudflare' WHERE id = 1").run();
		const sender = 'scheduled-send@example.com';
		const userId = await createLegacyUser(sender, 'scheduled-send-password');
		const accountId = await accountIdFor(sender);
		const requestId = 'request_scheduled_send_0001';
		const outgoing = await env.db.prepare(`
			INSERT INTO email(user_id, account_id, type, status, subject)
			VALUES (?, ?, 1, 6, 'in progress') RETURNING email_id AS emailId
		`).bind(userId, accountId).first();
		const unlinkedOutgoing = await env.db.prepare(`
			INSERT INTO email(user_id, account_id, type, status, subject)
			VALUES (?, ?, 1, 6, 'not linked yet') RETURNING email_id AS emailId
		`).bind(userId, accountId).first();
		await env.db.prepare(`
			INSERT INTO send_request(user_id, request_id, email_id, recipient_count, quota_reserved)
			VALUES (?, ?, ?, 1, 1)
		`).bind(userId, requestId, outgoing.emailId).run();
		await env.db.prepare(`
			INSERT INTO send_request(user_id, request_id)
			VALUES (?, 'request_unlinked_send_0001')
		`).bind(userId).run();

		const scheduledContext = createExecutionContext();
		await worker.scheduled(
			createScheduledController({ cron: '0 16 * * *', scheduledTime: Date.now() }),
			env,
			scheduledContext,
		);
		await waitOnExecutionContext(scheduledContext);
		expect((await env.db.prepare('SELECT status FROM email WHERE email_id = ?').bind(outgoing.emailId).first()).status).toBe(6);
		expect((await env.db.prepare('SELECT status FROM email WHERE email_id = ?').bind(unlinkedOutgoing.emailId).first()).status).toBe(6);

		const provider = { send: vi.fn(async () => ({ messageId: 'must-not-send' })) };
		const cookie = await login(sender, 'scheduled-send-password');
		const response = await send(cookie, {
			accountId,
			receiveEmail: ['friend@outside.test'],
			subject: 'same in-progress request',
			content: '<p>must not resend</p>',
			requestId,
		}, { ...env, email: provider });
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.data[0].status).toBe(5);
		expect(body.data[0].deliveryWarning).toMatch(/do not resend/i);
		expect(provider.send).not.toHaveBeenCalled();
	});

	it('preserves unread state on repeated schema upgrades', async () => {
		const row = await env.db.prepare('SELECT email_id AS emailId FROM email ORDER BY email_id LIMIT 1').first();
		await env.db.prepare('UPDATE email SET unread = 0 WHERE email_id = ?').bind(row.emailId).run();
		await dbInit.migrate(createTestContext());
		await dbInit.migrate(createTestContext());
		const preserved = await env.db.prepare('SELECT unread FROM email WHERE email_id = ?').bind(row.emailId).first();
		expect(preserved.unread).toBe(0);
		const migration = await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 308').first();
		expect(migration.total).toBe(1);
		const cleanupMigration = await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 309').first();
		expect(cleanupMigration.total).toBe(1);
	});

	it('receives raw MIME bytes without corrupting binary attachments and forwards only after storage', async () => {
		const recipient = 'mime-recipient@example.com';
		const userId = await createLegacyUser(recipient, 'mime-recipient-password');
		await env.db.prepare('UPDATE user SET forward_status = 0, forward_email = ? WHERE user_id = ?')
			.bind('verified@qq.com', userId).run();
		const attachmentBytes = Uint8Array.from([0, 255, 128, 65, 66]);
		const attachmentBase64 = btoa(String.fromCharCode(...attachmentBytes));
		const raw = [
			'From: Sender <sender@outside.test>',
			`To: ${recipient}`,
			'Subject: =?UTF-8?B?5rWL6K+V6ZmE5Lu2?=',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="mail-boundary"',
			'',
			'--mail-boundary',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'hello',
			'--mail-boundary',
			'Content-Type: application/octet-stream',
			'Content-Disposition: attachment; filename="bytes.bin"',
			'Content-Transfer-Encoding: base64',
			'',
			attachmentBase64,
			'--mail-boundary--',
			'',
		].join('\r\n');
		const forward = vi.fn(async () => undefined);
		const message = {
			from: 'sender@outside.test',
			to: recipient,
			raw: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(raw));
					controller.close();
				},
			}),
			setReject: vi.fn(),
			forward,
		};

		await worker.email(message, env, createExecutionContext());
		expect(message.setReject).not.toHaveBeenCalled();
		expect(forward).toHaveBeenCalledWith('verified@qq.com');
		const received = await env.db.prepare('SELECT email_id AS emailId, subject FROM email WHERE user_id = ? AND type = 0 ORDER BY email_id DESC LIMIT 1').bind(userId).first();
		expect(received.subject).toBe('测试附件');
		const attachment = await env.db.prepare('SELECT key FROM attachments WHERE email_id = ?').bind(received.emailId).first();
		const stored = await env.r2.get(attachment.key);
		expect(Array.from(new Uint8Array(await stored.arrayBuffer()))).toEqual(Array.from(attachmentBytes));
	});

	it('marks inbound mail failed and skips forwarding when attachment storage fails', async () => {
		const recipient = 'attachment-failure-recipient@example.com';
		const userId = await createLegacyUser(recipient, 'attachment-failure-password');
		await env.db.prepare('UPDATE user SET forward_status = 0, forward_email = ? WHERE user_id = ?')
			.bind('verified@qq.com', userId).run();
		const raw = [
			'From: sender@outside.test',
			`To: ${recipient}`,
			'Subject: storage failure',
			'MIME-Version: 1.0',
			'Content-Type: multipart/mixed; boundary="failure-boundary"',
			'',
			'--failure-boundary',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'body',
			'--failure-boundary',
			'Content-Type: application/octet-stream',
			'Content-Disposition: attachment; filename="failed.bin"',
			'Content-Transfer-Encoding: base64',
			'',
			'AQID',
			'--failure-boundary--',
			'',
		].join('\r\n');
		const forward = vi.fn(async () => undefined);
		const message = {
			from: 'sender@outside.test',
			to: recipient,
			raw: new ReadableStream({ start(controller) {
				controller.enqueue(new TextEncoder().encode(raw));
				controller.close();
			} }),
			setReject: vi.fn(),
			forward,
		};
		const failingR2 = {
			put: vi.fn(async () => { throw new Error('injected R2 failure'); }),
			get: env.r2.get.bind(env.r2),
			delete: env.r2.delete.bind(env.r2),
		};
		await worker.email(message, { ...env, r2: failingR2 }, createExecutionContext());
		expect(forward).not.toHaveBeenCalled();
		const received = await env.db.prepare('SELECT status, is_del AS isDel, message FROM email WHERE user_id = ? AND type = 0 ORDER BY email_id DESC LIMIT 1').bind(userId).first();
		expect(received.status).toBe(8);
		expect(received.isDel).toBe(0);
		expect(received.message).toMatch(/attachments could not be stored/i);
	});

	it('rate limits authenticated CLI attachment downloads before reading storage', async () => {
		const emailAddress = 'cli-attachment-limit@example.com';
		const userId = await createLegacyUser(emailAddress, 'cli-attachment-password');
		const token = await userService.genCliToken({ env }, userId);
		const accountId = await accountIdFor(emailAddress);
		const key = 'attachments/cli-rate-limit.txt';
		await env.r2.put(key, 'private');
		await env.db.prepare(
			'INSERT INTO attachments (user_id, email_id, account_id, key, filename, mime_type, size) VALUES (?, 1, ?, ?, ?, ?, 7)',
		).bind(userId, accountId, key, 'private.txt', 'text/plain').run();
		const response = await api(`/api/cli/attachments/${key}`, {
			headers: { Authorization: `Bearer ${token}` },
		}, {
			...env,
			EMAIL_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
		});
		expect(response.status).toBe(429);
		const missingRequestId = await api('/api/cli/emails/send', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ to: 'friend@outside.test', subject: 'missing id', body: 'test', accountId }),
		});
		expect(missingRequestId.status).toBe(400);
	});

	it('provides reliable CLI metadata, validation and reply-account selection', async () => {
		const mailbox = 'cli-contract@example.com';
		const correspondent = 'cli-correspondent@example.com';
		const userId = await createLegacyUser(mailbox, 'cli-contract-password');
		await createLegacyUser(correspondent, 'cli-correspondent-password');
		const alias = await accountService.adminAdd({ env }, {
			userId,
			email: 'cli-contract-alias@example.com',
		});
		const original = await env.db.prepare(`
			INSERT INTO email(user_id, account_id, type, status, send_email, subject, text, unread)
			VALUES (?, ?, 0, 0, ?, 'CLI contract original', 'body', 0)
			RETURNING email_id AS emailId
		`).bind(userId, alias.accountId, correspondent).first();
		await env.db.prepare(`
			INSERT INTO attachments(user_id, email_id, account_id, key, filename, mime_type, size, status, type)
			VALUES (?, ?, ?, 'attachments/cli-contract.txt', 'contract.txt', 'text/plain', 4, 0, 0)
		`).bind(userId, original.emailId, alias.accountId).run();
		const token = await userService.genCliToken({ env }, userId);
		const headers = { Authorization: `Bearer ${token}` };

		const listResponse = await api('/api/cli/emails?page=1&size=20&type=0&q=CLI%20contract', { headers });
		expect(listResponse.status).toBe(200);
		const listed = (await listResponse.json()).data.list;
		expect(listed).toHaveLength(1);
		expect(listed[0].id).toBe(original.emailId);
		expect(listed[0].hasAtt).toBe(true);

		const longSearch = await api(`/api/cli/emails?q=${encodeURIComponent('邮'.repeat(17))}`, { headers });
		expect(longSearch.status).toBe(400);
		const invalidType = await api('/api/cli/emails?type=9', { headers });
		expect(invalidType.status).toBe(400);
		for (const request of [
			api('/api/cli/emails/99999999', { headers }),
			api('/api/cli/emails/99999999/read', { method: 'PUT', headers }),
			api('/api/cli/emails/99999999', { method: 'DELETE', headers }),
		]) {
			expect((await request).status).toBe(404);
		}

		const accountId = await accountIdFor(mailbox);
		const sendPayload = {
			to: mailbox,
			accountId,
			subject: 'CLI first response request ID',
			body: 'self delivery',
			requestId: 'cli_contract_send_0001',
		};
		const firstSend = await api('/api/cli/emails/send', {
			method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(sendPayload),
		});
		const firstSendBody = await firstSend.json();
		expect(firstSend.status).toBe(200);
		expect(firstSendBody.data.requestId).toBe(sendPayload.requestId);
		const replay = await api('/api/cli/emails/send', {
			method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(sendPayload),
		});
		expect((await replay.json()).data.id).toBe(firstSendBody.data.id);

		const ccRejected = await api('/api/cli/emails/send', {
			method: 'POST',
			headers: { ...headers, 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...sendPayload, requestId: 'cli_contract_send_cc01', cc: correspondent }),
		});
		expect(ccRejected.status).toBe(400);

		const replyPayload = { body: 'reply', requestId: 'cli_contract_reply_01' };
		const reply = await api(`/api/cli/emails/${original.emailId}/reply`, {
			method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(replyPayload),
		});
		const replyBody = await reply.json();
		expect(reply.status).toBe(200);
		expect(replyBody.data.requestId).toBe(replyPayload.requestId);
		const outgoing = await env.db.prepare('SELECT account_id AS accountId FROM email WHERE email_id = ?')
			.bind(replyBody.data.id).first();
		expect(outgoing.accountId).toBe(alias.accountId);
	});

	it('does not allow a reply to reference another user message', async () => {
		const attacker = 'reply-attacker@example.com';
		const victim = 'reply-victim@example.com';
		const attackerId = await createLegacyUser(attacker, 'reply-attacker-password');
		const victimId = await createLegacyUser(victim, 'reply-victim-password');
		const victimAccountId = await accountIdFor(victim);
		const original = await env.db.prepare(
			'INSERT INTO email (user_id, account_id, type, status, message_id, subject) VALUES (?, ?, 0, 0, ?, ?) RETURNING email_id AS emailId',
		).bind(victimId, victimAccountId, '<victim-message@outside.test>', 'private subject').first();
		const cookie = await login(attacker, 'reply-attacker-password');
		const response = await send(cookie, {
			accountId: await accountIdFor(attacker),
			receiveEmail: [victim],
			subject: 'attempted cross-user reply',
			content: '<p>test</p>',
			sendType: 'reply',
			emailId: original.emailId,
		});
		expect(response.status).toBe(404);
		const quota = await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(attackerId).first();
		expect(quota.sendCount).toBe(0);
	});

	it('returns accepted with a warning after an irreversible external side effect even if final persistence fails', async () => {
		await env.db.prepare("UPDATE mail_provider_config SET provider = 'cloudflare' WHERE id = 1").run();
		const sender = 'accepted-persistence@example.com';
		const userId = await createLegacyUser(sender, 'accepted-persistence-password');
		const cookie = await login(sender, 'accepted-persistence-password');
		let providerAccepted = false;
		const failingDb = new Proxy(env.db, {
			get(target, property) {
				if (property === 'prepare') {
					return sql => {
						if (providerAccepted && /^\s*update\s+"?email"?/i.test(sql)) {
							throw new Error('injected final persistence failure');
						}
						return target.prepare(sql);
					};
				}
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const response = await send(cookie, {
			accountId: await accountIdFor(sender),
			receiveEmail: ['friend@outside.test'],
			subject: 'accepted before local failure',
			content: '<p>accepted</p>',
		}, {
			...env,
			db: failingDb,
			email: { send: vi.fn(async () => {
				providerAccepted = true;
				return { messageId: 'accepted-before-db-failure' };
			}) },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data[0].deliveryWarning).toMatch(/persistence was incomplete/i);
		const quota = await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(userId).first();
		expect(quota.sendCount).toBe(1);
	});

	it('replays a completed request ID without sending or charging quota twice', async () => {
		await env.db.prepare("UPDATE mail_provider_config SET provider = 'cloudflare' WHERE id = 1").run();
		const sender = 'idempotent-sender@example.com';
		const userId = await createLegacyUser(sender, 'idempotent-sender-password');
		const cookie = await login(sender, 'idempotent-sender-password');
		const provider = { send: vi.fn(async () => ({ messageId: 'idempotent-provider-id' })) };
		const body = {
			accountId: await accountIdFor(sender),
			receiveEmail: ['friend@outside.test'],
			subject: 'idempotent delivery',
			content: '<p>only once</p>',
			requestId: 'request_idempotent_0001',
		};
		const first = await send(cookie, body, { ...env, email: provider });
		const second = await send(cookie, body, { ...env, email: provider });
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		const firstBody = await first.json();
		const secondBody = await second.json();
		expect(secondBody.data[0].emailId).toBe(firstBody.data[0].emailId);
		expect(secondBody.data[0].idempotentReplay).toBe(true);
		expect(provider.send).toHaveBeenCalledTimes(1);
		expect((await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(userId).first()).sendCount).toBe(1);
	});

	it('safely reclaims a stale pending request that has no outgoing email row', async () => {
		const sender = 'stale-claim@example.com';
		const recipient = 'stale-claim-recipient@example.com';
		const userId = await createLegacyUser(sender, 'stale-claim-password');
		await createLegacyUser(recipient, 'stale-claim-recipient-password');
		const requestId = 'request_stale_claim_0001';
		await env.db.prepare('UPDATE user SET send_count = 1 WHERE user_id = ?').bind(userId).run();
		await env.db.prepare(`
			INSERT INTO send_request(user_id, request_id, recipient_count, quota_reserved, create_time)
			VALUES (?, ?, 1, 1, datetime('now', '-10 minutes'))
		`).bind(userId, requestId).run();
		const cookie = await login(sender, 'stale-claim-password');
		const response = await send(cookie, {
			accountId: await accountIdFor(sender),
			receiveEmail: [recipient],
			subject: 'safe stale retry',
			content: '<p>retry once</p>',
			requestId,
		});
		expect(response.status).toBe(200);
		expect((await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(userId).first()).sendCount).toBe(1);
		expect((await env.db.prepare('SELECT status FROM send_request WHERE user_id = ? AND request_id = ?').bind(userId, requestId).first()).status).toBe('accepted');
	});

	it('recovers a pending request with an email row as unknown without calling the provider again', async () => {
		await env.db.prepare("UPDATE mail_provider_config SET provider = 'cloudflare' WHERE id = 1").run();
		const sender = 'pending-with-email@example.com';
		const userId = await createLegacyUser(sender, 'pending-with-email-password');
		const accountId = await accountIdFor(sender);
		const requestId = 'request_pending_email_0001';
		const outgoing = await env.db.prepare(`
			INSERT INTO email(user_id, account_id, type, status, subject)
			VALUES (?, ?, 1, 6, 'pending') RETURNING email_id AS emailId
		`).bind(userId, accountId).first();
		await env.db.prepare('UPDATE user SET send_count = 1 WHERE user_id = ?').bind(userId).run();
		await env.db.prepare(`
			INSERT INTO send_request(user_id, request_id, email_id, recipient_count, quota_reserved, create_time)
			VALUES (?, ?, ?, 1, 1, datetime('now', '-10 minutes'))
		`).bind(userId, requestId, outgoing.emailId).run();
		const provider = { send: vi.fn(async () => ({ messageId: 'must-not-send' })) };
		const cookie = await login(sender, 'pending-with-email-password');
		const response = await send(cookie, {
			accountId,
			receiveEmail: ['friend@outside.test'],
			subject: 'pending replay',
			content: '<p>must not resend</p>',
			requestId,
		}, { ...env, email: provider });
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data[0].status).toBe(5);
		expect(body.data[0].deliveryWarning).toMatch(/do not resend/i);
		expect(provider.send).not.toHaveBeenCalled();
		expect((await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(userId).first()).sendCount).toBe(1);
	});

	it('keeps all warnings when provider outcome is unknown and one internal recipient fails', async () => {
		await env.db.prepare("UPDATE mail_provider_config SET provider = 'cloudflare' WHERE id = 1").run();
		const sender = 'partial-internal@example.com';
		const firstRecipient = 'partial-first@example.com';
		const secondRecipient = 'partial-second@example.com';
		const senderId = await createLegacyUser(sender, 'partial-internal-password');
		const firstId = await createLegacyUser(firstRecipient, 'partial-first-password');
		const secondId = await createLegacyUser(secondRecipient, 'partial-second-password');
		const cookie = await login(sender, 'partial-internal-password');
		let emailInsertCount = 0;
		let providerAttempted = false;
		const failingDb = new Proxy(env.db, {
			get(target, property) {
				if (property === 'prepare') {
					return sql => {
						if (/^\s*insert\s+into\s+"?email"?/i.test(sql) && ++emailInsertCount === 3) {
							throw new Error('injected second-recipient failure');
						}
						if (providerAttempted && /^\s*update\s+"?email"?/i.test(sql)) {
							throw new Error('injected final persistence failure');
						}
						return target.prepare(sql);
					};
				}
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const response = await send(cookie, {
			accountId: await accountIdFor(sender),
			receiveEmail: [firstRecipient, secondRecipient, 'friend@outside.test'],
			subject: 'partial internal delivery',
			content: '<p>partial</p>',
		}, {
			...env,
			db: failingDb,
			email: { send: vi.fn(async () => {
				providerAttempted = true;
				throw new Error('injected provider timeout');
			}) },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data[0].deliveryWarning).toMatch(/1 internal recipient/i);
		expect(body.data[0].deliveryWarning).toMatch(/do not resend/i);
		expect(body.data[0].deliveryWarning).toMatch(/persistence was incomplete/i);
		expect((await env.db.prepare('SELECT send_count AS sendCount FROM user WHERE user_id = ?').bind(senderId).first()).sendCount).toBe(3);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ? AND type = 0').bind(firstId).first()).total).toBe(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ? AND type = 0').bind(secondId).first()).total).toBe(0);
	});

	it('does not deliver internal mail to a soft-deleted user', async () => {
		const sender = 'deleted-target-sender@example.com';
		const recipient = 'deleted-target@example.com';
		await createLegacyUser(sender, 'deleted-target-sender-password');
		const recipientId = await createLegacyUser(recipient, 'deleted-target-password');
		await userService.delete({ env }, recipientId);
		const cookie = await login(sender, 'deleted-target-sender-password');
		const response = await send(cookie, {
			accountId: await accountIdFor(sender),
			receiveEmail: [recipient],
			subject: 'deleted target',
			content: '<p>must bounce</p>',
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data[0].status).toBe(3);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ?').bind(recipientId).first()).total).toBe(0);
	});

	it('preserves existing production settings when introducing the migration marker', async () => {
		await env.db.prepare(`UPDATE setting SET auto_refresh = 1, notice_content = ''`).run();
		await env.db.prepare('DELETE FROM schema_migrations WHERE version IN (308, 309, 310)').run();
		const before = await env.db.prepare('SELECT auto_refresh AS autoRefresh, notice_content AS noticeContent FROM setting').first();
		const beforeCounts = await Promise.all(['user', 'account', 'email', 'attachments'].map(async table =>
			(await env.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first()).total
		));
		await dbInit.migrate(createTestContext());
		const after = await env.db.prepare('SELECT auto_refresh AS autoRefresh, notice_content AS noticeContent FROM setting').first();
		expect(after).toEqual(before);
		const afterCounts = await Promise.all(['user', 'account', 'email', 'attachments'].map(async table =>
			(await env.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first()).total
		));
		expect(afterCounts).toEqual(beforeCounts);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 308').first()).total).toBe(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 309').first()).total).toBe(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 310').first()).total).toBe(1);
	});

	it('upgrades a version 308 database with the attachment cleanup queue without changing business data', async () => {
		const beforeCounts = await Promise.all(['user', 'account', 'email', 'attachments'].map(async table =>
			(await env.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first()).total
		));
		await env.db.prepare('DROP TABLE object_delete_queue').run();
		await env.db.prepare('DELETE FROM schema_migrations WHERE version IN (309, 310)').run();

		await dbInit.migrate(createTestContext());
		const columns = await env.db.prepare(`PRAGMA table_info(object_delete_queue)`).all();
		expect(columns.results.map(column => column.name)).toEqual(expect.arrayContaining(['key', 'create_time', 'claim_time']));
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 309').first()).total).toBe(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 310').first()).total).toBe(1);
		const afterCounts = await Promise.all(['user', 'account', 'email', 'attachments'].map(async table =>
			(await env.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first()).total
		));
		expect(afterCounts).toEqual(beforeCounts);
	});

	it('self-heals a dropped structure whose migration marker is still present', async () => {
		// Unlike the upgrade tests above (which delete markers), this keeps every
		// marker and drops only a structure. migrate() must notice via its
		// structural check and rebuild the table without touching business data.
		const mailbox = 'structure-heal@example.com';
		const userId = await createLegacyUser(mailbox, 'structure-heal-password');
		const accountId = await accountIdFor(mailbox);
		await env.db.prepare(
			"INSERT INTO email(user_id, account_id, type, status, subject) VALUES (?, ?, 0, 0, 'structure-heal keeps me')"
		).bind(userId, accountId).run();
		const beforeTotal = (await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ?').bind(userId).first()).total;

		await env.db.prepare('DROP TABLE object_delete_queue').run();
		await dbInit.migrate(createTestContext());

		const table = await env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'object_delete_queue'`
		).first();
		expect(table?.name).toBe('object_delete_queue');
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 309').first()).total).toBe(1);
		const afterTotal = (await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE user_id = ?').bind(userId).first()).total;
		expect(afterTotal).toBe(beforeTotal);
	});

	it('upgrades a real version 309 schema with mailbox limits and a default unified inbox without losing data', async () => {
		const mailbox = 'migration-310@example.com';
		const userId = await createLegacyUser(mailbox, 'migration-310-password');
		const primary = await accountService.selectByEmail({ env }, mailbox);
		await env.db.prepare('UPDATE account SET all_receive = 0 WHERE user_id = ?').bind(userId).run();
		await env.db.prepare("INSERT INTO email(user_id, account_id, type, status, subject) VALUES (?, ?, 0, 0, 'migration 310 keeps me')")
			.bind(userId, primary.accountId).run();

		await env.db.prepare('DELETE FROM schema_migrations WHERE version = 310').run();
		await env.db.prepare('ALTER TABLE user DROP COLUMN account_limit').run();
		const oldColumns = await env.db.prepare(`PRAGMA table_info(user)`).all();
		expect(oldColumns.results.map(column => column.name)).not.toContain('account_limit');
		const beforeCounts = await Promise.all(['user', 'account', 'email', 'attachments', 'setting'].map(async table =>
			(await env.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first()).total
		));

		await dbInit.migrate(createTestContext());

		const columns = await env.db.prepare(`PRAGMA table_info(user)`).all();
		expect(columns.results.map(column => column.name)).toContain('account_limit');
		expect((await env.db.prepare('SELECT account_limit AS accountLimit FROM user WHERE user_id = ?').bind(userId).first()).accountLimit).toBe(10);
		expect((await env.db.prepare('SELECT all_receive AS allReceive FROM account WHERE account_id = ?').bind(primary.accountId).first()).allReceive).toBe(1);
		expect((await env.db.prepare("SELECT COUNT(*) AS total FROM email WHERE user_id = ? AND subject = 'migration 310 keeps me'").bind(userId).first()).total).toBe(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM schema_migrations WHERE version = 310').first()).total).toBe(1);
		const afterCounts = await Promise.all(['user', 'account', 'email', 'attachments', 'setting'].map(async table =>
			(await env.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first()).total
		));
		expect(afterCounts).toEqual(beforeCounts);
	});

	it('omits credential fields from admin user lists and ignores setting mass assignment', async () => {
		await env.db.prepare("UPDATE user SET cli_token = 'sha256$not-a-real-token' WHERE is_admin = 1").run();
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, env.FLAREMAIL_ADMIN_PASSWORD);
		const usersResponse = await api('/api/user/list?num=1&size=50&status=-1&isDel=0', {
			headers: { Cookie: cookie },
		});
		expect(usersResponse.status).toBe(200);
		const users = (await usersResponse.json()).data.list;
		expect(users.length).toBeGreaterThan(0);
		for (const listedUser of users) {
			expect(listedUser).not.toHaveProperty('password');
			expect(listedUser).not.toHaveProperty('salt');
			expect(listedUser).not.toHaveProperty('cliToken');
		}

		for (const emailFilter of ['a'.repeat(49), '邮'.repeat(17)]) {
			const invalidFilter = await api(`/api/user/list?num=1&size=20&status=-1&isDel=0&email=${encodeURIComponent(emailFilter)}`, {
				headers: { Cookie: cookie },
			});
			expect(invalidFilter.status).toBe(400);
		}

		const settingsResponse = await api('/api/setting/set', {
			method: 'PUT',
			headers: { Cookie: cookie, Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
			body: JSON.stringify({ receive: 0, register: 0, r2Domain: 'https://public.example' }),
		});
		expect(settingsResponse.status).toBe(200);
		const settings = await env.db.prepare('SELECT receive, register, r2_domain AS r2Domain FROM setting').first();
		expect(settings.receive).toBe(0);
		expect(settings.register).toBe(1);
		// r2Domain became an admin-configurable setting (c044fde), so the
		// request value is applied; register remains mass-assignment-guarded.
		expect(settings.r2Domain).toBe('https://public.example');
	});

	it('deletes user metadata atomically and garbage-collects only unreferenced attachment objects', async () => {
		const victimId = await createLegacyUser('delete-cleanup@example.com', 'delete-cleanup-password');
		const survivorId = await createLegacyUser('delete-survivor@example.com', 'delete-survivor-password');
		const accountId = await accountIdFor('delete-cleanup@example.com');
		const survivorAccountId = await accountIdFor('delete-survivor@example.com');
		const emails = await env.db.batch([
			env.db.prepare('INSERT INTO email(user_id, account_id, type, status) VALUES (?, ?, 0, 0) RETURNING email_id AS emailId').bind(victimId, accountId),
			env.db.prepare('INSERT INTO email(user_id, account_id, type, status) VALUES (?, ?, 0, 0) RETURNING email_id AS emailId').bind(victimId, accountId),
			env.db.prepare('INSERT INTO email(user_id, account_id, type, status) VALUES (?, ?, 0, 0) RETURNING email_id AS emailId').bind(survivorId, survivorAccountId),
		]);
		const emailIds = emails.map(item => item.results[0].emailId);
		const sharedKey = 'attachments/shared-delete-cleanup.bin';
		const orphanKey = 'attachments/orphan-delete-cleanup.bin';
		await env.r2.put(sharedKey, Uint8Array.from([1, 2, 3]));
		await env.r2.put(orphanKey, Uint8Array.from([4, 5, 6]));
		await env.db.batch(emailIds.slice(0, 2).flatMap((emailId, index) => [
			env.db.prepare('INSERT INTO attachments(user_id, email_id, account_id, key, type) VALUES (?, ?, ?, ?, 0)')
				.bind(victimId, emailId, accountId, index === 0 ? sharedKey : orphanKey),
			env.db.prepare('INSERT INTO star(user_id, email_id) VALUES (?, ?)').bind(victimId, emailId),
		]));
		await env.db.prepare('INSERT INTO attachments(user_id, email_id, account_id, key, type) VALUES (?, ?, ?, ?, 0)')
			.bind(survivorId, emailIds[2], survivorAccountId, sharedKey).run();

		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, env.FLAREMAIL_ADMIN_PASSWORD);
		const response = await api(`/api/user/delete?userIds=${victimId}`, {
			method: 'DELETE',
			headers: { Cookie: cookie, Origin: 'http://localhost:8787' },
		});
		expect(response.status).toBe(200);
		expect(await env.r2.get(sharedKey)).not.toBeNull();
		expect(await env.r2.get(orphanKey)).not.toBeNull();
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM attachments WHERE user_id = ?').bind(victimId).first()).total).toBe(0);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM star WHERE user_id = ?').bind(victimId).first()).total).toBe(0);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM user WHERE user_id = ?').bind(victimId).first()).total).toBe(0);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM object_delete_queue WHERE key IN (?, ?)').bind(sharedKey, orphanKey).first()).total).toBe(2);

		await env.db.prepare(`UPDATE object_delete_queue SET create_time = datetime('now', '-8 days') WHERE key IN (?, ?)`)
			.bind(sharedKey, orphanKey).run();
		await attService.cleanupDeleteQueue({ env });
		expect(await env.r2.get(sharedKey)).not.toBeNull();
		expect(await env.r2.get(orphanKey)).toBeNull();
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM object_delete_queue WHERE key = ?').bind(sharedKey).first()).total).toBe(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM object_delete_queue WHERE key = ?').bind(orphanKey).first()).total).toBe(0);

		await userService.physicsDelete({ env }, { userIds: String(survivorId) });
		await attService.cleanupDeleteQueue({ env });
		expect(await env.r2.get(sharedKey)).not.toBeNull();
		await env.db.prepare(`UPDATE object_delete_queue SET create_time = datetime('now', '-8 days') WHERE key = ?`)
			.bind(sharedKey).run();
		await attService.cleanupDeleteQueue({ env });
		expect(await env.r2.get(sharedKey)).toBeNull();
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM object_delete_queue WHERE key = ?').bind(sharedKey).first()).total).toBe(0);
	});

	it('claims orphan cleanup once and requeues a failed object deletion', async () => {
		const onceKey = 'attachments/gc-claim-once.bin';
		await env.db.prepare(`
			INSERT OR REPLACE INTO object_delete_queue(key, create_time)
			VALUES (?, datetime('now', '-8 days'))
		`).bind(onceKey).run();
		const deleteOnce = vi.fn(async () => undefined);
		const cleanupEnv = { ...env, r2: { delete: deleteOnce } };
		await Promise.all([
			attService.cleanupDeleteQueue({ env: cleanupEnv }),
			attService.cleanupDeleteQueue({ env: cleanupEnv }),
		]);
		expect(deleteOnce).toHaveBeenCalledTimes(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM object_delete_queue WHERE key = ?').bind(onceKey).first()).total).toBe(0);

		const key = 'attachments/gc-claim-failure.bin';
		await env.db.prepare(`
			INSERT OR REPLACE INTO object_delete_queue(key, create_time)
			VALUES (?, datetime('now', '-8 days'))
		`).bind(key).run();
		const deleteObject = vi.fn(async () => { throw new Error('injected R2 failure'); });
		await attService.cleanupDeleteQueue({ env: { ...env, r2: { delete: deleteObject } } });
		expect(deleteObject).toHaveBeenCalledTimes(1);
		const queued = await env.db.prepare('SELECT claim_time AS claimTime FROM object_delete_queue WHERE key = ?').bind(key).first();
		expect(queued).not.toBeNull();
		expect(queued.claimTime).toBeNull();
	});

	it('keeps attachment data when an atomic permanent-delete batch fails', async () => {
		const victimId = await createLegacyUser('delete-failure@example.com', 'delete-failure-password');
		const accountId = await accountIdFor('delete-failure@example.com');
		const emailRow = await env.db.prepare('INSERT INTO email(user_id, account_id, type, status) VALUES (?, ?, 0, 0) RETURNING email_id AS emailId')
			.bind(victimId, accountId).first();
		const key = 'attachments/delete-failure.bin';
		await env.r2.put(key, Uint8Array.from([7, 8, 9]));
		await env.db.prepare('INSERT INTO attachments(user_id, email_id, account_id, key, type) VALUES (?, ?, ?, ?, 0)')
			.bind(victimId, emailRow.emailId, accountId, key).run();
		const failingDb = new Proxy(env.db, {
			get(target, property) {
				if (property === 'batch') return async () => { throw new Error('injected D1 batch failure'); };
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});

		await expect(userService.physicsDelete({ env: { ...env, db: failingDb } }, { userIds: String(victimId) }))
			.rejects.toThrow('injected D1 batch failure');
		expect(await env.r2.get(key)).not.toBeNull();
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM attachments WHERE user_id = ?').bind(victimId).first()).total).toBe(1);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM user WHERE user_id = ?').bind(victimId).first()).total).toBe(1);
	});

	it('permanently deletes an alias with more than 100 emails without bound-parameter overflow', async () => {
		const ownerId = await createLegacyUser('alias-owner@example.com', 'alias-owner-password');
		const alias = await env.db.prepare('INSERT INTO account(email, user_id, is_del) VALUES (?, ?, 1) RETURNING account_id AS accountId')
			.bind('old-alias@example.com', ownerId).first();
		await env.db.prepare(`
			WITH RECURSIVE counter(value) AS (
				SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 101
			)
			INSERT INTO email(user_id, account_id, type, status, subject)
			SELECT ?, ?, 0, 0, 'alias cleanup ' || value FROM counter
		`).bind(ownerId, alias.accountId).run();
		await env.db.prepare(`
			INSERT INTO star(user_id, email_id)
			SELECT ?, email_id FROM email WHERE account_id = ?
		`).bind(ownerId, alias.accountId).run();

		await accountService.physicsDelete({ env }, { accountId: alias.accountId });
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE account_id = ?').bind(alias.accountId).first()).total).toBe(0);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM star WHERE user_id = ?').bind(ownerId).first()).total).toBe(0);
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM account WHERE account_id = ?').bind(alias.accountId).first()).total).toBe(0);
	});

	it('normalizes managed domains and enforces the ordinary mailbox quota atomically', async () => {
		const userId = await createLegacyUser('mailbox-quota@example.com', 'mailbox-quota-password');
		await env.db.prepare('UPDATE user SET account_limit = 2 WHERE user_id = ?').bind(userId).run();
		const runtimeEnv = { ...env, FLAREMAIL_DOMAINS: JSON.stringify(['@Example.COM']) };

		const added = await accountService.add({ env: runtimeEnv }, { email: 'quota-alias@EXAMPLE.com' }, userId);
		expect(added.email).toBe('quota-alias@example.com');
		expect(added.accountCount).toBe(2);
		await expect(accountService.add({ env: runtimeEnv }, { email: 'quota-third@example.com' }, userId))
			.rejects.toMatchObject({ name: 'BizError', code: 403 });
		let invalidDomainError;
		try {
			await accountService.add({ env: runtimeEnv }, { email: 'quota@outside.test' }, userId);
		} catch (error) {
			invalidDomainError = error;
		}
		expect(invalidDomainError).toMatchObject({ name: 'BizError', code: 400 });

		const concurrentUserId = await createLegacyUser('mailbox-concurrent@example.com', 'mailbox-concurrent-password');
		await env.db.prepare('UPDATE user SET account_limit = 2 WHERE user_id = ?').bind(concurrentUserId).run();
		const attempts = await Promise.allSettled([
			accountService.add({ env }, { email: 'concurrent-one@example.com' }, concurrentUserId),
			accountService.add({ env }, { email: 'concurrent-two@example.com' }, concurrentUserId),
		]);
		expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
		expect(await accountService.countUserAccount({ env }, concurrentUserId)).toBe(2);

		const loweredUserId = await createLegacyUser('mailbox-lowered@example.com', 'mailbox-lowered-password');
		await env.db.prepare('UPDATE user SET account_limit = 2 WHERE user_id = ?').bind(loweredUserId).run();
		const staleUser = await userService.selectById({ env }, loweredUserId);
		await env.db.prepare('UPDATE user SET account_limit = 1 WHERE user_id = ?').bind(loweredUserId).run();
		await expect(accountService.createForUser({ env }, 'lowered-stale@example.com', staleUser))
			.rejects.toMatchObject({ name: 'BizError', code: 403 });
		expect(await accountService.countUserAccount({ env }, loweredUserId)).toBe(1);
	});

	it('keeps the persisted administrator unlimited when the environment points to a member', async () => {
		const adminRow = await env.db.prepare('SELECT user_id AS userId FROM user WHERE is_admin = 1').first();
		const adminId = adminRow.userId;
		await env.db.prepare('UPDATE user SET account_limit = 1 WHERE user_id = ?').bind(adminId).run();
		const driftEmail = 'mailbox-unlimited@example.com';
		await createLegacyUser(driftEmail, 'mailbox-unlimited-password');
		const runtimeEnv = { ...env, FLAREMAIL_ADMIN_EMAIL: driftEmail };
		for (let index = 1; index <= 12; index++) {
			await accountService.add({ env: runtimeEnv }, { email: `unlimited-${index}@example.com` }, adminId);
		}
		expect(await accountService.countUserAccount({ env }, adminId)).toBe(13);
	});

	it('filters unread and attachment mail before pagination with consistent counts and ownership', async () => {
        const uid = await createLegacyUser('filter-owner@example.com', 'filter-test-password');
        const outsiderId = await createLegacyUser('filter-outsider@example.com', 'filter-other-password');
        const acc = await accountService.selectByEmail({ env }, 'filter-owner@example.com');
        const other = await accountService.selectByEmail({ env }, 'filter-outsider@example.com');
        const ids = [];
        for (let i = 0; i < 65; i++) {
            const row = await env.db.prepare('INSERT INTO email (user_id,account_id,subject,unread,type,is_del) VALUES (?,?,?,?,0,0) RETURNING email_id')
                .bind(uid, acc.accountId, `filter-message-${i}`, i === 0 || i === 64 ? 0 : 1).first();
            ids.push(row.email_id);
        }
        await env.db.prepare('INSERT INTO email (user_id,account_id,subject,unread) VALUES (?,?,?,0)').bind(outsiderId,other.accountId,'filter-message-secret').run();
        for (const id of [ids[0], ids[64]]) {
            await env.db.prepare('INSERT INTO attachments (user_id,account_id,email_id,key,type,status) VALUES (?,?,?,?,0,0)')
                .bind(uid,acc.accountId,id,`filter-test-${id}`).run();
        }
        // Inline and retired attachments must not make a mail appear in the attachment category.
        await env.db.prepare('INSERT INTO attachments (user_id,account_id,email_id,key,type,status) VALUES (?,?,?,?,1,0)')
            .bind(uid,acc.accountId,ids[2],'filter-inline').run();
        await env.db.prepare('INSERT INTO attachments (user_id,account_id,email_id,key,type,status) VALUES (?,?,?,?,0,1)')
            .bind(uid,acc.accountId,ids[3],'filter-retired').run();
        const params = { accountId: acc.accountId, allReceive: 0, size: 1, type: 0, timeSort: 0 };
        for (const filter of ['unread','has_att']) {
            const first = await emailService.list({ env }, { ...params, filter }, uid);
            expect(first.total).toBe(2);
            expect(first.list.map(mail => mail.emailId)).toEqual([ids[64]]);
            const next = await emailService.list({ env }, { ...params, filter, emailId: ids[64] }, uid);
            expect(next.total).toBe(2);
            expect(next.list.map(mail => mail.emailId)).toEqual([ids[0]]);
            const search = await emailService.list({ env }, { ...params, filter, keyword: 'message-0' }, uid);
            expect(search.total).toBe(1);
            expect(search.list[0].emailId).toBe(ids[0]);
            await expect(emailService.list({ env }, { ...params, filter, accountId: other.accountId }, uid)).rejects.toMatchObject({ code: 404 });
        }
        expect((await emailService.list({ env }, params, uid)).total).toBe(65);
        await expect(emailService.list({ env }, { ...params, filter: 'invalid' }, uid)).rejects.toMatchObject({ code: 400 });
    });

	it('shows all owned mailboxes in the unified inbox without crossing user boundaries', async () => {
		const ownerId = await createLegacyUser('unified-owner@example.com', 'unified-owner-password');
		const outsiderId = await createLegacyUser('unified-outsider@example.com', 'unified-outsider-password');
		const primary = await accountService.selectByEmail({ env }, 'unified-owner@example.com');
		await env.db.prepare('UPDATE account SET all_receive = 1 WHERE account_id = ?').bind(primary.accountId).run();
		const alias = await accountService.add({ env }, { email: 'unified-alias@example.com' }, ownerId);
		const mailboxes = await accountService.list({ env }, { accountId: 0, size: 20 }, ownerId);
		expect(mailboxes[0].email).toBe('unified-owner@example.com');
		expect(mailboxes[0].allReceive).toBe(1);
		const outsider = await accountService.selectByEmail({ env }, 'unified-outsider@example.com');
		await env.db.batch([
			env.db.prepare("INSERT INTO email(user_id, account_id, type, status, subject) VALUES (?, ?, 0, 0, 'primary owned')").bind(ownerId, primary.accountId),
			env.db.prepare("INSERT INTO email(user_id, account_id, type, status, subject) VALUES (?, ?, 0, 0, 'alias owned')").bind(ownerId, alias.accountId),
			env.db.prepare("INSERT INTO email(user_id, account_id, type, status, subject) VALUES (?, ?, 0, 0, 'outsider secret')").bind(outsiderId, outsider.accountId),
		]);

		const unified = await emailService.list({ env }, {
			accountId: primary.accountId,
			allReceive: 1,
			emailId: 0,
			timeSort: 0,
			size: 20,
			type: 0,
		}, ownerId);
		expect(unified.list.map(item => item.subject)).toEqual(expect.arrayContaining(['primary owned', 'alias owned']));
		expect(unified.list.map(item => item.subject)).not.toContain('outsider secret');
        const individual=await emailService.list({env},{accountId:alias.accountId,allReceive:0,type:0,size:20},ownerId);
        expect(individual.total).toBe(1);expect(individual.list[0].subject).toBe('alias owned');
        for(const mail of unified.list) await starService.add({env},{emailId:mail.emailId},ownerId);
        const foreign=(await emailService.list({env},{accountId:outsider.accountId,allReceive:0,type:0,size:20},outsiderId)).list[0];
        await starService.add({env},{emailId:foreign.emailId},outsiderId);
        const single=await starService.list({env},{accountId:alias.accountId,size:20},ownerId);
        expect(single.total).toBe(1);expect(single.list[0].subject).toBe('alias owned');
        expect((await starService.list({env},{size:1,offset:1},ownerId)).list).toHaveLength(1);
        expect((await starService.list({env},{size:20},ownerId)).total).toBe(2);
        expect((await starService.list({env},{accountId:outsider.accountId,size:20},ownerId)).total).toBe(0);
        await expect(starService.list({env},{accountId:'invalid'},ownerId)).rejects.toMatchObject({code:400});
	});

	it('lets only the administrator change an ordinary mailbox quota without deleting mailboxes', async () => {
		const memberId = await createLegacyUser('quota-managed@example.com', 'quota-managed-password');
		const memberCookie = await login('quota-managed@example.com', 'quota-managed-password');
		const forbidden = await api('/api/user/updateAccountLimit', {
			method: 'PUT',
			headers: { Cookie: memberCookie, Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: memberId, accountLimit: 3 }),
		});
		expect(forbidden.status).toBe(403);

		const adminRow = await userService.selectByEmailIncludeDel({ env }, env.FLAREMAIL_ADMIN_EMAIL);
		expect(adminRow).toBeDefined();
		const adminCookie = await login(env.FLAREMAIL_ADMIN_EMAIL, env.FLAREMAIL_ADMIN_PASSWORD);
		const updated = await api('/api/user/updateAccountLimit', {
			method: 'PUT',
			headers: { Cookie: adminCookie, Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: memberId, accountLimit: 3 }),
		});
		expect(updated.status).toBe(200);
		expect((await userService.selectById({ env }, memberId)).accountLimit).toBe(3);
		expect(await accountService.countUserAccount({ env }, memberId)).toBe(1);
	});

	it('supports marking emails as read and unread', async () => {
		const userId = await createLegacyUser('unread-test@example.com', 'unread-test-password');
		const userCookie = await login('unread-test@example.com', 'unread-test-password');
		const acc = await accountService.selectByEmail({ env }, 'unread-test@example.com');

		const inserted = await env.db.prepare(
			"INSERT INTO email(user_id, account_id, type, status, unread, subject) VALUES (?, ?, 0, 0, 0, 'unread-target') RETURNING email_id AS emailId"
		).bind(userId, acc.accountId).first();

		// Initially unread = 0 (UNREAD)
		expect(inserted.emailId).toBeDefined();

		// Mark as read via PUT /api/email/read
		const readRes = await api('/api/email/read', {
			method: 'PUT',
			headers: { Cookie: userCookie, Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
			body: JSON.stringify({ emailIds: [inserted.emailId] }),
		});
		expect(readRes.status).toBe(200);

		const readRow = await env.db.prepare('SELECT unread FROM email WHERE email_id = ?').bind(inserted.emailId).first();
		expect(readRow.unread).toBe(1); // READ

		// Mark as unread via PUT /api/email/unread
		const unreadRes = await api('/api/email/unread', {
			method: 'PUT',
			headers: { Cookie: userCookie, Origin: 'http://localhost:8787', 'Content-Type': 'application/json' },
			body: JSON.stringify({ emailIds: [inserted.emailId] }),
		});
		expect(unreadRes.status).toBe(200);

		const unreadRow = await env.db.prepare('SELECT unread FROM email WHERE email_id = ?').bind(inserted.emailId).first();
		expect(unreadRow.unread).toBe(0); // UNREAD
	});
});
