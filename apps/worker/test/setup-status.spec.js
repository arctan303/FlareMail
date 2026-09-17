import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import KvConst from '../src/const/kv-const';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import { markInstalled } from './installed-instance';

const SETUP_SECRET = 'setup-secret-for-vitest-only-1234567890';
const MANUAL_PASSWORD = 'manual-setup-password-123';

function createTestContext(runtimeEnv = env) {
	const values = new Map();
	return {
		env: runtimeEnv,
		get(key) {
			return values.get(key);
		},
		set(key, value) {
			values.set(key, value);
		},
	};
}

function setupEnv(overrides = {}) {
	return {
		...env,
		SETUP_RATE_LIMITER: { limit: async () => ({ success: true }) },
		SETUP_STATUS_RATE_LIMITER: { limit: async () => ({ success: true }) },
		...overrides,
	};
}

async function createAdminAccount(password = env.FLAREMAIL_ADMIN_PASSWORD) {
	const salt = `legacy-salt-${env.FLAREMAIL_ADMIN_EMAIL}`;
	const hash = await cryptoUtils.genHashPassword(password, salt);
	const inserted = await env.db.prepare(
		'INSERT INTO user (email, password, salt, cli_token, is_admin) VALUES (?, ?, ?, ?, 1) RETURNING user_id AS userId',
	).bind(env.FLAREMAIL_ADMIN_EMAIL, hash, salt, '').first();
	await env.db.prepare('INSERT INTO account (email, user_id, all_receive, is_default_send) VALUES (?, ?, 1, 1)').bind(env.FLAREMAIL_ADMIN_EMAIL, inserted.userId).run();
}

async function api(path, options = {}, runtimeEnv = setupEnv()) {
	const request = new Request(`http://localhost${path}`, options);
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, runtimeEnv, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

function postJson(path, body, runtimeEnv, origin = 'http://localhost') {
	return api(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Origin: origin,
		},
		body: JSON.stringify(body),
	}, runtimeEnv);
}

async function hasTable(name) {
	return !!await env.db.prepare(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
	).bind(name).first();
}

async function hasColumn(table, column) {
	const info = await env.db.prepare(`PRAGMA table_info('${table}')`).all();
	return (info.results || []).some(item => item.name === column);
}

async function hasMarker(version) {
	if (!await hasTable('schema_migrations')) return false;
	return !!await env.db.prepare(
		'SELECT version FROM schema_migrations WHERE version = ? LIMIT 1',
	).bind(version).first();
}

async function databaseSafetySnapshot() {
	const tables = await env.db.prepare(`
		SELECT name, sql
		FROM sqlite_master
		WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
		ORDER BY type, name
	`).all();
	const markers = await env.db.prepare(
		'SELECT version, applied_time FROM schema_migrations ORDER BY version',
	).all();
	const users = await env.db.prepare(
		'SELECT user_id, email, cli_token, is_admin FROM user ORDER BY user_id',
	).all();
	const accounts = await env.db.prepare(
		'SELECT account_id, email, user_id FROM account ORDER BY account_id',
	).all();
	const emails = await env.db.prepare(
		'SELECT email_id, account_id, user_id, subject FROM email ORDER BY email_id',
	).all();
	const settings = await env.db.prepare('SELECT * FROM setting').all();
	return {
		tables: tables.results,
		markers: markers.results,
		users: users.results,
		accounts: accounts.results,
		emails: emails.results,
		settings: settings.results,
		settingCache: await env.kv.get(KvConst.SETTING),
	};
}

async function makeSupportedOldSchema() {
	await env.db.prepare('DELETE FROM schema_migrations WHERE version = 308').run();
	await env.db.prepare('DROP TABLE send_request').run();
}

async function restoreCurrentSchema() {
	await dbInit.migrate(createTestContext());
}

async function resetToFreshDatabase() {
	await env.db.batch([
		env.db.prepare('DROP TABLE IF EXISTS account'),
		env.db.prepare('DROP TABLE IF EXISTS attachments'),
		env.db.prepare('DROP TABLE IF EXISTS contact'),
		env.db.prepare('DROP TABLE IF EXISTS email'),
		env.db.prepare('DROP TABLE IF EXISTS object_delete_queue'),
		env.db.prepare('DROP TABLE IF EXISTS oauth'),
		env.db.prepare('DROP TABLE IF EXISTS perm'),
		env.db.prepare('DROP TABLE IF EXISTS reg_key'),
		env.db.prepare('DROP TABLE IF EXISTS role'),
		env.db.prepare('DROP TABLE IF EXISTS role_perm'),
		env.db.prepare('DROP TABLE IF EXISTS runtime_config'),
		env.db.prepare('DROP TABLE IF EXISTS admin_confirmation'),
		env.db.prepare('DROP TABLE IF EXISTS mail_provider_config'),
		env.db.prepare('DROP TABLE IF EXISTS schema_migrations'),
		env.db.prepare('DROP TABLE IF EXISTS send_request'),
		env.db.prepare('DROP TABLE IF EXISTS setting'),
		env.db.prepare('DROP TABLE IF EXISTS star'),
		env.db.prepare('DROP TABLE IF EXISTS user'),
		env.db.prepare('DROP TABLE IF EXISTS verify_record'),
		env.db.prepare('DROP TABLE IF EXISTS managed_domain'),
		env.db.prepare('DROP TABLE IF EXISTS installation_guard'),
		env.db.prepare('DROP TABLE IF EXISTS installation_state'),
		env.db.prepare('DROP TABLE IF EXISTS installation_bootstrap'),
	]);
	await env.kv.delete(KvConst.SETTING);
}

beforeAll(async () => {
	await dbInit.migrate(createTestContext());
	await createAdminAccount();
	await markInstalled(env);
});

describe.sequential('read-only setup status and controlled recovery', () => {
	it('reports a healthy database without setup or upgrade work', async () => {
		const response = await api('/api/setup/status');
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		const body = await response.json();
		expect(body.data).toMatchObject({
			setupRequired: false,
			upgradeRequired: false,
			upgradeSupported: true,
		});
		expect(body.data.adminEmail).toBeUndefined();
		expect(body.data.adminConfigMatches).toBeUndefined();
		expect(body.data.domainList).toBeUndefined();
	});

	it('assigns the configured active user once when upgrading the legacy administrator schema', async () => {
		await env.db.batch([
			env.db.prepare('DROP INDEX idx_user_single_admin'),
			env.db.prepare('DELETE FROM schema_migrations WHERE version = 318'),
			env.db.prepare('ALTER TABLE user DROP COLUMN is_admin'),
		]);
		await dbInit.migrate(createTestContext());
		const admin = await env.db.prepare('SELECT email, is_admin AS isAdmin FROM user WHERE is_admin = 1').first();
		expect(admin).toEqual({ email: env.FLAREMAIL_ADMIN_EMAIL, isAdmin: 1 });
		expect(await dbInit.v3_17Applied(createTestContext())).toBe(true);
	});

	it('rolls back every administrator migration artifact when the preflight user becomes inactive', async () => {
		await env.db.batch([
			env.db.prepare('DROP INDEX idx_user_single_admin'),
			env.db.prepare('DELETE FROM schema_migrations WHERE version = 318'),
			env.db.prepare('ALTER TABLE user DROP COLUMN is_admin'),
		]);
		const preflight = await dbInit.preflightAdminIdentity(createTestContext());
		await env.db.prepare('UPDATE user SET status = 1 WHERE user_id = ?').bind(preflight.legacyAdminId).run();
		await expect(dbInit.v3_17DB(createTestContext(), preflight.legacyAdminId)).rejects.toThrow();
		expect(await hasColumn('user', 'is_admin')).toBe(false);
		expect(await hasMarker(318)).toBe(false);
		expect(await env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_single_admin'").first()).toBeNull();
		expect(await hasTable('migration_318_guard')).toBe(false);
		await env.db.prepare('UPDATE user SET status = 0 WHERE user_id = ?').bind(preflight.legacyAdminId).run();
		await dbInit.migrate(createTestContext());
	});

	it('fails closed without the status binding and returns 429 without touching D1 or KV', async () => {
		const forbiddenStorage = () => {
			throw new Error('setup status rate limiting must finish before storage access');
		};
		const storageEnv = setupEnv({
			db: { prepare: forbiddenStorage, batch: forbiddenStorage },
			kv: new Proxy({}, { get: () => forbiddenStorage }),
		});

		const missingBinding = await api('/api/setup/status', {}, {
			...storageEnv,
			SETUP_STATUS_RATE_LIMITER: undefined,
		});
		expect(missingBinding.status).toBe(503);

		const limited = await api('/api/setup/status', {}, {
			...storageEnv,
			SETUP_STATUS_RATE_LIMITER: { limit: async () => ({ success: false }) },
		});
		expect(limited.status).toBe(429);
	});

	it('detects a supported old schema without repairing tables, markers, users, or setting cache', async () => {
		await env.db.prepare('DROP TABLE schema_migrations').run();
		await env.db.prepare('DROP TABLE send_request').run();
		await env.kv.delete(KvConst.SETTING);
		try {
			const response = await api('/api/setup/status');
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data).toMatchObject({
				setupRequired: false,
				upgradeRequired: true,
				upgradeSupported: true,
			});
			expect(await hasTable('send_request')).toBe(false);
			expect(await hasTable('schema_migrations')).toBe(false);
			expect(await env.kv.get(KvConst.SETTING)).toBeNull();
			const { total } = await env.db.prepare('SELECT COUNT(*) AS total FROM user').first();
			expect(total).toBe(1);
		} finally {
			await restoreCurrentSchema();
		}
	});

	it('rejects unavailable, incorrect, cross-site, malformed, and rate-limited upgrade attempts without migration', async () => {
		await makeSupportedOldSchema();
		try {
			const missingSecret = await postJson('/api/setup/upgrade', { setupToken: SETUP_SECRET }, setupEnv({ SETUP_SECRET: undefined }));
			expect(missingSecret.status).toBe(503);

			const wrongSecret = await postJson('/api/setup/upgrade', { setupToken: 'wrong-secret' }, setupEnv({ SETUP_SECRET }));
			expect(wrongSecret.status).toBe(403);

			const extraFields = await postJson('/api/setup/upgrade', {
				setupToken: SETUP_SECRET,
				unexpected: true,
			}, setupEnv({ SETUP_SECRET }));
			expect(extraFields.status).toBe(403);

			const crossSite = await api('/api/setup/upgrade', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Origin: 'https://evil.example',
					'Sec-Fetch-Site': 'cross-site',
				},
				body: JSON.stringify({ setupToken: SETUP_SECRET }),
			}, setupEnv({ SETUP_SECRET }));
			expect(crossSite.status).toBe(403);

			const limited = await postJson('/api/setup/upgrade', { setupToken: SETUP_SECRET }, setupEnv({
				SETUP_SECRET,
				SETUP_RATE_LIMITER: { limit: async () => ({ success: false }) },
			}));
			expect(limited.status).toBe(429);

			expect(await hasTable('send_request')).toBe(false);
			expect(await hasMarker(308)).toBe(false);
		} finally {
			await restoreCurrentSchema();
		}
	});

	it('preflights normalization collisions before direct or setup-triggered migration writes', async () => {
		const collisionEmail = ` ${env.FLAREMAIL_ADMIN_EMAIL.toUpperCase()} `;
		const businessSubject = 'preflight-must-preserve-this-email';
		const duplicateSalt = 'collision-user-salt';
		const duplicateHash = await cryptoUtils.genHashPassword(env.FLAREMAIL_ADMIN_PASSWORD, duplicateSalt);
		try {
			const admin = await env.db.prepare(
				'SELECT user_id AS userId FROM user WHERE email = ? COLLATE NOCASE LIMIT 1',
			).bind(env.FLAREMAIL_ADMIN_EMAIL).first();
			const account = await env.db.prepare(
				'SELECT account_id AS accountId FROM account WHERE user_id = ? LIMIT 1',
			).bind(admin.userId).first();

			await env.db.batch([
				env.db.prepare('DROP INDEX IF EXISTS idx_account_email_nocase'),
				env.db.prepare('DROP INDEX IF EXISTS idx_user_email_nocase'),
				env.db.prepare('ALTER TABLE user ADD COLUMN webhook_url TEXT'),
				env.db.prepare('ALTER TABLE user ADD COLUMN webhook_status INTEGER NOT NULL DEFAULT 0'),
				env.db.prepare("UPDATE user SET cli_token = 'legacy-cli-token' WHERE user_id = ?").bind(admin.userId),
				env.db.prepare('DELETE FROM schema_migrations WHERE version = 308'),
				env.db.prepare('DROP TABLE send_request'),
				env.db.prepare('INSERT INTO email (account_id, user_id, subject) VALUES (?, ?, ?)')
					.bind(account.accountId, admin.userId, businessSubject),
			]);
			const duplicate = await env.db.prepare(
				'INSERT INTO user (email, password, salt, cli_token) VALUES (?, ?, ?, ?) RETURNING user_id AS userId',
			).bind(collisionEmail, duplicateHash, duplicateSalt, 'second-legacy-token').first();
			await env.db.prepare(
				'INSERT INTO account (email, user_id) VALUES (?, ?)',
			).bind(collisionEmail, duplicate.userId).run();

			const before = await databaseSafetySnapshot();
			await expect(dbInit.migrate(createTestContext())).rejects.toThrow(
				'Cannot normalize user email addresses because duplicates would collide.',
			);
			expect(await databaseSafetySnapshot()).toEqual(before);

			const status = await api('/api/setup/status');
			expect(status.status).toBe(200);
			expect((await status.json()).data).toMatchObject({
				setupRequired: false,
				upgradeRequired: true,
				upgradeSupported: false,
			});
			expect(await databaseSafetySnapshot()).toEqual(before);

			const upgrade = await postJson(
				'/api/setup/upgrade',
				{ setupToken: SETUP_SECRET },
				setupEnv({ SETUP_SECRET }),
			);
			expect(upgrade.status).toBe(409);
			expect(await databaseSafetySnapshot()).toEqual(before);
			expect(await hasMarker(308)).toBe(false);
			expect(await hasTable('send_request')).toBe(false);
			expect(await hasColumn('user', 'webhook_url')).toBe(true);
			expect(await hasColumn('user', 'webhook_status')).toBe(true);
			const preserved = await env.db.prepare(
				'SELECT subject FROM email WHERE subject = ? LIMIT 1',
			).bind(businessSubject).first();
			expect(preserved?.subject).toBe(businessSubject);
		} finally {
			if (await hasTable('account')) {
				await env.db.prepare('DELETE FROM account WHERE email = ?').bind(collisionEmail).run();
			}
			if (await hasTable('user')) {
				await env.db.prepare('DELETE FROM user WHERE email = ?').bind(collisionEmail).run();
				await env.db.prepare('UPDATE user SET cli_token = ? WHERE email = ? COLLATE NOCASE')
					.bind('', env.FLAREMAIL_ADMIN_EMAIL).run();
				for (const column of ['webhook_url', 'webhook_status']) {
					if (await hasColumn('user', column)) {
						await env.db.prepare(`ALTER TABLE user DROP COLUMN ${column}`).run();
					}
				}
			}
			if (await hasTable('email')) {
				await env.db.prepare('DELETE FROM email WHERE subject = ?').bind(businessSubject).run();
			}
			if (await hasTable('account') && await hasTable('user')) {
				await env.db.batch([
					env.db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_nocase ON account (email COLLATE NOCASE)'),
					env.db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_nocase ON user (email COLLATE NOCASE)'),
				]);
				await restoreCurrentSchema();
			}
		}
	});

	it('fails closed when the existing schema is below the safe-upgrade baseline', async () => {
		await env.db.prepare('ALTER TABLE user DROP COLUMN cli_token').run();
		try {
			const status = await api('/api/setup/status');
			const body = await status.json();
			expect(body.data).toMatchObject({
				setupRequired: false,
				upgradeRequired: true,
				upgradeSupported: false,
			});

			const upgrade = await postJson('/api/setup/upgrade', { setupToken: SETUP_SECRET }, setupEnv({ SETUP_SECRET }));
			expect(upgrade.status).toBe(409);
			expect(await hasColumn('user', 'cli_token')).toBe(false);
		} finally {
			await dbInit.v3_4DB(createTestContext());
			await restoreCurrentSchema();
		}
	});

	it('upgrades missing current schema fields and disables replay from actual schema state', async () => {
		await env.db.prepare('DELETE FROM schema_migrations WHERE version = 314').run();
		await env.db.prepare('ALTER TABLE user DROP COLUMN google_sub').run();
		await env.db.prepare('ALTER TABLE user DROP COLUMN google_email').run();
		try {
			const loginEnv = setupEnv({
				LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
			});
			expect(await hasColumn('user', 'google_sub')).toBe(false);
			expect(await hasColumn('user', 'google_email')).toBe(false);

			const status = await api('/api/setup/status');
			const statusBody = await status.json();
			expect(statusBody.data).toMatchObject({
				setupRequired: false,
				upgradeRequired: true,
				upgradeSupported: true,
			});

			const runtimeEnv = setupEnv({ SETUP_SECRET });
			const upgraded = await postJson('/api/setup/upgrade', { setupToken: SETUP_SECRET }, runtimeEnv);
			expect(upgraded.status).toBe(200);
			expect(await hasColumn('user', 'google_sub')).toBe(true);
			expect(await hasColumn('user', 'google_email')).toBe(true);
			expect(await hasMarker(314)).toBe(true);

			const afterLogin = await postJson('/api/login', {
				email: env.FLAREMAIL_ADMIN_EMAIL,
				password: env.FLAREMAIL_ADMIN_PASSWORD,
			}, loginEnv);
			expect(afterLogin.status).toBe(200);

			const replay = await postJson('/api/setup/upgrade', { setupToken: SETUP_SECRET }, runtimeEnv);
			expect(replay.status).toBe(409);
		} finally {
			await dbInit.v3_13DB(createTestContext());
			await restoreCurrentSchema();
		}
	});

	it('rejects a healthy database upgrade even with the correct setup secret', async () => {
		const response = await postJson('/api/setup/upgrade', { setupToken: SETUP_SECRET }, setupEnv({ SETUP_SECRET }));
		expect(response.status).toBe(409);
	});

	it('requires manual recovery when an application table remains without the user table', async () => {
		await resetToFreshDatabase();
		try {
			await env.db.prepare(`
				CREATE TABLE email (
					email_id INTEGER PRIMARY KEY,
					subject TEXT
				)
			`).run();
			await env.db.prepare(
				"INSERT INTO email (email_id, subject) VALUES (1, 'residual-message')",
			).run();
			const runtimeEnv = setupEnv({ SETUP_SECRET });

			const status = await api('/api/setup/status', {}, runtimeEnv);
			expect(status.status).toBe(200);
			expect((await status.json()).data).toMatchObject({
				setupRequired: true,
				upgradeRequired: false,
				upgradeSupported: false,
			});

			const manual = await postJson('/api/setup', {
				email: env.FLAREMAIL_ADMIN_EMAIL,
				password: MANUAL_PASSWORD,
				domains: ['example.com'],
				setupSession: 'not-a-session',
			}, runtimeEnv);
			expect(manual.status).toBe(403);
			expect(await hasTable('user')).toBe(false);
			const residual = await env.db.prepare('SELECT subject FROM email WHERE email_id = 1').first();
			expect(residual?.subject).toBe('residual-message');
		} finally {
			await resetToFreshDatabase();
		}
	});

	it('keeps an empty database unchanged until a verified setup session completes installation', async () => {
		await resetToFreshDatabase();
		const runtimeEnv = setupEnv({ SETUP_SECRET });

		const status = await api('/api/setup/status', {}, runtimeEnv);
		expect(status.status).toBe(200);
		const statusBody = await status.json();
		expect(statusBody.data).toMatchObject({
			setupRequired: true,
			upgradeRequired: false,
			upgradeSupported: true,
		});
		expect(statusBody.data.automaticSetupAvailable).toBeUndefined();
		expect(await hasTable('user')).toBe(false);
		expect(await hasTable('schema_migrations')).toBe(false);
		expect(await env.kv.get(KvConst.SETTING)).toBeNull();

		const invalidSecret = await postJson('/api/setup/verify', { setupToken: 'wrong' }, runtimeEnv);
		expect(invalidSecret.status).toBe(403);
		expect(await hasTable('user')).toBe(false);

		const crossSite = await api('/api/setup/verify', {
			method: 'POST',
			headers: {
				Origin: 'https://evil.example',
				'Sec-Fetch-Site': 'cross-site',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ setupToken: SETUP_SECRET }),
		}, runtimeEnv);
		expect(crossSite.status).toBe(403);
		expect(await hasTable('user')).toBe(false);

		const limited = await postJson('/api/setup/verify', { setupToken: SETUP_SECRET }, setupEnv({
			SETUP_SECRET,
			SETUP_RATE_LIMITER: { limit: async () => ({ success: false }) },
		}));
		expect(limited.status).toBe(429);
		expect(await hasTable('user')).toBe(false);

		const verified = await postJson('/api/setup/verify', { setupToken: SETUP_SECRET }, runtimeEnv);
		expect(verified.status).toBe(200);
		const verification = (await verified.json()).data;
		expect(verification.setupSession).toBeTruthy();
		expect(Date.parse(verification.expiresAt)).toBeGreaterThan(Date.now());

		const invalid = await postJson('/api/setup', {
			setupSession: verification.setupSession,
			email: env.FLAREMAIL_ADMIN_EMAIL,
			password: MANUAL_PASSWORD,
			domains: [],
		}, runtimeEnv);
		expect(invalid.status).toBe(400);
		expect(await hasTable('user')).toBe(false);

		const failingDb = new Proxy(env.db, {
			get(target, property) {
				if (property === 'prepare') {
					return sql => {
						if (/CREATE TABLE IF NOT EXISTS user/i.test(sql)) {
							return { run: async () => { throw new Error('injected early setup migration interruption'); } };
						}
						return target.prepare(sql);
					};
				}
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		const interrupted = await postJson('/api/setup', {
			setupSession: verification.setupSession,
			email: env.FLAREMAIL_ADMIN_EMAIL,
			password: MANUAL_PASSWORD,
			domains: ['Example.COM', 'example.net'],
		}, { ...runtimeEnv, db: failingDb });
		expect(interrupted.status).toBe(500);
		expect(await hasTable('user')).toBe(false);
		expect(await hasTable('installation_bootstrap')).toBe(true);
		expect((await (await api('/api/setup/status', {}, runtimeEnv)).json()).data)
			.toMatchObject({ setupRequired: true, upgradeSupported: true });

		const setupBody = {
			setupSession: verification.setupSession,
			email: env.FLAREMAIL_ADMIN_EMAIL,
			password: MANUAL_PASSWORD,
			domains: ['Example.COM', 'example.net'],
		};
		const concurrent = await Promise.all([
			postJson('/api/setup', setupBody, runtimeEnv),
			postJson('/api/setup', setupBody, runtimeEnv),
		]);
		expect(concurrent.map(response => response.status).sort()).toEqual([200, 409]);
		expect(await hasTable('user')).toBe(true);
		const admin = await env.db.prepare('SELECT email FROM user WHERE email = ? COLLATE NOCASE').bind(env.FLAREMAIL_ADMIN_EMAIL).first();
		expect(admin?.email).toBe(env.FLAREMAIL_ADMIN_EMAIL);
		expect((await env.db.prepare('SELECT domain FROM managed_domain ORDER BY domain').all()).results)
			.toEqual([{ domain: 'example.com' }, { domain: 'example.net' }]);

		const replay = await postJson('/api/setup', setupBody, runtimeEnv);
		expect(replay.status).toBe(409);
	});

	it('requires manual recovery when the current user table is empty but business data remains', async () => {
		const orphanEmail = 'orphaned-account@example.com';
		try {
			await env.db.batch([
				env.db.prepare('DELETE FROM account'),
				env.db.prepare('DELETE FROM user'),
			]);
			await env.db.prepare(
				'INSERT INTO account (email, user_id) VALUES (?, ?)',
			).bind(orphanEmail, 999999).run();
			const runtimeEnv = setupEnv({ SETUP_SECRET });

			const status = await api('/api/setup/status', {}, runtimeEnv);
			expect(status.status).toBe(200);
			expect((await status.json()).data).toMatchObject({
				setupRequired: false,
				upgradeRequired: false,
				upgradeSupported: false,
			});

			const manual = await postJson('/api/setup', {
				email: env.FLAREMAIL_ADMIN_EMAIL,
				password: MANUAL_PASSWORD,
				domains: ['example.com'],
				setupSession: 'not-a-session',
			}, runtimeEnv);
			expect(manual.status).toBe(403);
			const orphan = await env.db.prepare(
				'SELECT user_id AS userId FROM account WHERE email = ? LIMIT 1',
			).bind(orphanEmail).first();
			expect(orphan?.userId).toBe(999999);
		} finally {
			if (await hasTable('account')) await env.db.prepare('DELETE FROM account').run();
			if (await hasTable('user')) await env.db.prepare('DELETE FROM user').run();
			await createAdminAccount();
			await markInstalled(env);
		}
	});
});
