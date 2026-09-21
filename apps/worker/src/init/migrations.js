import emailUtils from '../utils/email-utils';
import { hasCloudflareEmail, normalizeMailProvider } from '../service/mail-provider-service';
import { normalizeConfirmation } from '../service/confirmation-policy-service';
import { emailConst } from '../const/entity-const';
import { ensureMigrationTable } from './schema';
import { managedDomains } from '../utils/managed-domain-utils';
import {
	normalizeAllowedOrigins,
	normalizeIssuer,
	normalizeRuntimeSecret,
	normalizeStoredRuntimeRow,
	normalizeTurnstileSiteKey,
} from '../service/runtime-config-service';

const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';
const TURNSTILE_TEST_SITE_KEY = '3x00000000000000000000FF';

function legacyAllowedOrigins(value) {
	if (value === undefined || value === null || value === '') return [];
	let origins = value;
	if (typeof value === 'string') {
		try {
			origins = JSON.parse(value);
		} catch {
			origins = value.split(',').map(item => item.trim()).filter(Boolean);
		}
	}
	try {
		return normalizeAllowedOrigins(origins);
	} catch {
		throw new Error('Legacy runtime configuration has an invalid FLAREMAIL_ALLOWED_ORIGINS value.');
	}
}

function optionalCredential(value, field, maxLength = 512) {
	if (value === undefined || value === null || value === '') return '';
	if (typeof value !== 'string') throw new Error(`${field} is invalid.`);
	const normalized = value.trim();
	if (!normalized || normalized.length > maxLength || /\s/.test(normalized)) {
		throw new Error(`${field} is invalid.`);
	}
	return normalized;
}

function credentialPair(first, second, label) {
	if (!!first !== !!second) throw new Error(`${label} must be configured as a complete pair.`);
	return { first, second };
}

export const migrations = {
	ensureMigrationTable,

	async hasMigrationMarker(c, version) {
		const row = await c.env.db.prepare(
			`SELECT version FROM schema_migrations WHERE version = ? LIMIT 1`
		).bind(version).first();
		return !!row;
	},

	async hasTable(c, name) {
		const row = await c.env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
		).bind(name).first();
		return !!row;
	},

	async hasColumn(c, table, column) {
		const info = await c.env.db.prepare(`PRAGMA table_info('${table}')`).all();
		return (info.results || []).some(item => item.name === column);
	},

	async v3_7Applied(c) {
		return (await this.hasMigrationMarker(c, 308)) && (await this.hasTable(c, 'send_request'));
	},

	async v3_8Applied(c) {
		return (await this.hasMigrationMarker(c, 309)) && (await this.hasTable(c, 'object_delete_queue'));
	},

	async v3_9Applied(c) {
		return (await this.hasMigrationMarker(c, 310)) && (await this.hasColumn(c, 'user', 'account_limit'));
	},

	async v3_10Applied(c) {
		return (await this.hasMigrationMarker(c, 311))
			&& (await this.hasColumn(c, 'user', 'unmatched_policy'))
			&& (await this.hasColumn(c, 'account', 'is_default_send'));
	},

	async v3_11Applied(c) {
		return (await this.hasMigrationMarker(c, 312))
			&& (await this.hasColumn(c, 'user', 'main_forward_status'))
			&& (await this.hasColumn(c, 'account', 'forward_status'));
	},

	async v3_13Applied(c) {
		return (await this.hasMigrationMarker(c, 314))
			&& (await this.hasColumn(c, 'user', 'google_sub'))
			&& (await this.hasColumn(c, 'user', 'google_email'));
	},

	async v3_14Applied(c) {
		return (await this.hasMigrationMarker(c, 315))
			&& (await this.hasColumn(c, 'setting', 'google_oauth_enabled'))
			&& (await this.hasColumn(c, 'setting', 'google_client_id'))
			&& (await this.hasColumn(c, 'setting', 'google_client_secret'));
	},

	async v3_15Applied(c) {
		return (await this.hasMigrationMarker(c, 316))
			&& (await this.hasTable(c, 'contact'));
	},

	async v3_16Applied(c) {
		return (await this.hasMigrationMarker(c, 317))
			&& (await this.hasTable(c, 'oauth_authorization_code'));
	},

	async hasSingleAdminIndex(c) {
		const row = await c.env.db.prepare(`
			SELECT sql FROM sqlite_master
			WHERE type = 'index' AND name = 'idx_user_single_admin'
		`).first();
		if (!row?.sql) return false;
		const normalized = row.sql.replace(/\s+/g, ' ').trim().toLowerCase();
		return normalized === 'create unique index idx_user_single_admin on user(is_admin) where is_admin = 1';
	},

	async v3_17Applied(c) {
		return (await this.hasMigrationMarker(c, 318))
			&& (await this.hasColumn(c, 'user', 'is_admin'))
			&& (await this.hasSingleAdminIndex(c));
	},

	async v3_19Applied(c) {
		if (!await this.hasMigrationMarker(c, 319)) return false;
		for (const column of ['site_description', 'site_logo', 'site_favicon', 'site_pwa_icons', 'site_links', 'login_copy']) {
			if (!await this.hasColumn(c, 'setting', column)) return false;
		}
		return true;
	},

	async v3_20Applied(c) {
		if (!await this.hasMigrationMarker(c, 320)) return false;
		const info = await c.env.db.prepare("PRAGMA table_info('setting')").all();
		const columns = new Map((info.results || []).map(column => [column.name, column]));
		for (const name of ['oauth_provider_enabled', 'oauth_provider_revision', 'oauth_provider_clients']) {
			if (!columns.has(name)) return false;
		}
		const defaultValue = String(columns.get('oauth_provider_clients')?.dflt_value || '').replace(/^['"]|['"]$/g, '');
		try {
			if (!Array.isArray(JSON.parse(defaultValue))) return false;
		} catch {
			return false;
		}
		return true;
	},

	async v3_21Applied(c) {
		if (!await this.hasTable(c, 'schema_migrations')) return false;
		if (!await this.hasMigrationMarker(c, 321)) return false;
		for (const table of ['managed_domain', 'installation_state', 'installation_guard']) {
			if (!await this.hasTable(c, table)) return false;
		}
		const state = await c.env.db.prepare(
			'SELECT status, revision, legacy_domain_imported AS legacyDomainImported FROM installation_state WHERE id = 1',
		).first();
		if (!state || !['pending', 'installed'].includes(state.status)
			|| !Number.isInteger(Number(state.revision))
			|| ![0, 1].includes(Number(state.legacyDomainImported))) return false;
		if (state.status === 'installed') {
			const domains = await c.env.db.prepare('SELECT COUNT(*) AS total FROM managed_domain').first();
			if (Number(domains?.total) < 1) return false;
		}
		const guard = await c.env.db.prepare('SELECT 1 AS found FROM installation_guard LIMIT 1').first();
		return !guard;
	},

	async runtimeConfigTableReady(c) {
		if (!await this.hasTable(c, 'runtime_config')) return false;
		for (const column of [
			'id', 'revision', 'allowed_origins', 'turnstile_site_key',
			'turnstile_secret', 'oauth_issuer', 'oauth_secret', 'legacy_imported', 'update_time',
		]) {
			if (!await this.hasColumn(c, 'runtime_config', column)) return false;
		}
		return true;
	},

	async readExistingRuntimeConfig(c) {
		if (!await this.hasTable(c, 'runtime_config')) return null;
		if (!await this.runtimeConfigTableReady(c)) {
			throw new Error('Existing runtime configuration schema is incomplete and requires manual recovery.');
		}
		const rows = await c.env.db.prepare(`
			SELECT id, revision, allowed_origins AS allowedOrigins,
				turnstile_site_key AS turnstileSiteKey, turnstile_secret AS turnstileSecret,
				oauth_issuer AS oauthIssuer, oauth_secret AS oauthSecret,
				legacy_imported AS legacyImported
			FROM runtime_config
			LIMIT 2
		`).all();
		if ((rows.results || []).length > 1) {
			throw new Error('Existing runtime configuration has multiple rows and requires manual recovery.');
		}
		if (!rows.results?.length) return null;
		const row = rows.results[0];
		if (Number(row.id) !== 1 || ![0, 1].includes(Number(row.legacyImported))) {
			throw new Error('Existing runtime configuration import state is invalid and requires manual recovery.');
		}
		try {
			return { value: normalizeStoredRuntimeRow(row), legacyImported: Number(row.legacyImported) };
		} catch {
			throw new Error('Existing runtime configuration is invalid and requires manual recovery.');
		}
	},

	async v3_22Applied(c) {
		if (!await this.hasTable(c, 'schema_migrations')) return false;
		if (!await this.hasMigrationMarker(c, 322)) return false;
		let current;
		try {
			current = await this.readExistingRuntimeConfig(c);
		} catch {
			return false;
		}
		if (!current || current.legacyImported !== 1) return false;
		const setting = await c.env.db.prepare(`
			SELECT oauth_provider_enabled AS providerEnabled,
				google_oauth_enabled AS googleEnabled,
				google_client_id AS googleClientId,
				google_client_secret AS googleClientSecret
			FROM setting
		`).first();
		if (!setting) return false;
		if (Number(setting.providerEnabled || 0) === 1 && !current.value.oauth.secret) return false;
		let googleClientId;
		let googleClientSecret;
		try {
			googleClientId = optionalCredential(setting.googleClientId, 'Existing Google client ID', 255);
			googleClientSecret = optionalCredential(setting.googleClientSecret, 'Existing Google client secret', 255);
			credentialPair(googleClientId, googleClientSecret, 'Existing Google credentials');
		} catch {
			return false;
		}
		return Number(setting.googleEnabled || 0) !== 1 || !!googleClientId;
	},

	async preflightRuntimeConfigMigration(c) {
		if (await this.v3_22Applied(c)) return { current: true };
		const hasUsers = await this.hasTable(c, 'user')
			&& !!await c.env.db.prepare('SELECT 1 AS found FROM user LIMIT 1').first();
		const rows = await c.env.db.prepare('SELECT * FROM setting LIMIT 2').all();
		if ((rows.results || []).length !== 1) {
			throw new Error('Legacy runtime configuration requires exactly one setting row.');
		}
		const setting = rows.results[0];
		const existing = await this.readExistingRuntimeConfig(c);

		let storedGoogleId;
		let storedGoogleSecret;
		try {
			storedGoogleId = optionalCredential(setting.google_client_id, 'Existing Google client ID', 255);
			storedGoogleSecret = optionalCredential(setting.google_client_secret, 'Existing Google client secret', 255);
			credentialPair(storedGoogleId, storedGoogleSecret, 'Existing Google credentials');
		} catch (error) {
			throw new Error(`${error.message} Manual recovery is required before upgrading.`);
		}

		if (existing) {
			if (Number(setting.oauth_provider_enabled || 0) === 1 && !existing.value.oauth.secret) {
				throw new Error('Existing runtime configuration has OAuth Provider enabled without complete credentials and requires manual recovery.');
			}
			if (Number(setting.google_oauth_enabled || 0) === 1 && !storedGoogleId) {
				throw new Error('Existing Google login is enabled without complete D1 credentials and requires manual recovery.');
			}
			return {
				current: false,
				runtime: existing.value,
				importGoogle: false,
				googleClientId: storedGoogleId,
				googleClientSecret: storedGoogleSecret,
				clearSettingTurnstileSecret: !!setting.secret_key,
			};
		}

		if (!hasUsers) {
			return {
				current: false,
				runtime: {
					revision: 0,
					allowedOrigins: [],
					turnstile: { siteKey: '', secret: '' },
					oauth: { issuer: '', secret: '' },
				},
				importGoogle: false,
				googleClientId: storedGoogleId,
				googleClientSecret: storedGoogleSecret,
				clearSettingTurnstileSecret: !!setting.secret_key,
			};
		}

		let googleClientId = storedGoogleId;
		let googleClientSecret = storedGoogleSecret;
		let importGoogle = false;
		if (!googleClientId) {
			let legacyGoogleId;
			let legacyGoogleSecret;
			try {
				legacyGoogleId = optionalCredential(c.env.FLAREMAIL_GOOGLE_CLIENT_ID, 'FLAREMAIL_GOOGLE_CLIENT_ID', 255);
				legacyGoogleSecret = optionalCredential(c.env.FLAREMAIL_GOOGLE_CLIENT_SECRET, 'FLAREMAIL_GOOGLE_CLIENT_SECRET', 255);
				credentialPair(legacyGoogleId, legacyGoogleSecret, 'Legacy Google credentials');
			} catch (error) {
				throw new Error(`Legacy runtime configuration is invalid: ${error.message} Temporarily restore a complete pair and retry the controlled upgrade.`);
			}
			if (legacyGoogleId) {
				googleClientId = legacyGoogleId;
				googleClientSecret = legacyGoogleSecret;
				importGoogle = true;
			}
		}
		if (Number(setting.google_oauth_enabled || 0) === 1 && !googleClientId) {
			throw new Error('Legacy runtime configuration has Google login enabled without complete credentials. Temporarily restore both Google variables and retry the controlled upgrade.');
		}

		let turnstileSiteKey;
		let storedTurnstileSecret;
		let legacyTurnstileSecret;
		try {
			turnstileSiteKey = normalizeTurnstileSiteKey(setting.site_key || '');
			storedTurnstileSecret = normalizeRuntimeSecret(setting.secret_key || '', 'Turnstile');
			legacyTurnstileSecret = normalizeRuntimeSecret(c.env.FLAREMAIL_TURNSTILE_SECRET || '', 'Turnstile');
		} catch {
			throw new Error('Legacy runtime configuration has invalid Turnstile credentials. Correct the stored values or FLAREMAIL_TURNSTILE_SECRET and retry the controlled upgrade.');
		}
		const turnstileSecret = storedTurnstileSecret || legacyTurnstileSecret;
		if (!turnstileSiteKey && turnstileSecret === TURNSTILE_TEST_SECRET) turnstileSiteKey = TURNSTILE_TEST_SITE_KEY;
		if (!!turnstileSiteKey !== !!turnstileSecret) {
			throw new Error('Legacy runtime configuration requires a complete Turnstile Site Key and Secret pair. Temporarily restore FLAREMAIL_TURNSTILE_SECRET or clear the incomplete D1 value, then retry.');
		}

		let oauthIssuer;
		let oauthSecret;
		try {
			oauthIssuer = normalizeIssuer(typeof c.env.FLAREMAIL_OAUTH_ISSUER === 'string'
				? c.env.FLAREMAIL_OAUTH_ISSUER.trim()
				: c.env.FLAREMAIL_OAUTH_ISSUER || '');
			oauthSecret = normalizeRuntimeSecret(c.env.FLAREMAIL_CLIENT_SECRET || '', 'OAuth');
		} catch {
			throw new Error('Legacy runtime configuration has invalid OAuth Provider credentials. Correct FLAREMAIL_OAUTH_ISSUER and FLAREMAIL_CLIENT_SECRET, then retry.');
		}
		if (!!oauthIssuer !== !!oauthSecret) {
			throw new Error('Legacy runtime configuration requires both FLAREMAIL_OAUTH_ISSUER and FLAREMAIL_CLIENT_SECRET. Temporarily restore the complete pair and retry the controlled upgrade.');
		}
		if (Number(setting.oauth_provider_enabled || 0) === 1 && !oauthIssuer) {
			throw new Error('Legacy runtime configuration has OAuth Provider enabled without its issuer and shared Secret. Temporarily restore both variables and retry the controlled upgrade.');
		}

		return {
			current: false,
			runtime: {
				revision: 0,
				allowedOrigins: legacyAllowedOrigins(c.env.FLAREMAIL_ALLOWED_ORIGINS),
				turnstile: { siteKey: turnstileSiteKey, secret: turnstileSecret },
				oauth: { issuer: oauthIssuer, secret: oauthSecret },
			},
			importGoogle,
			googleClientId,
			googleClientSecret,
			clearSettingTurnstileSecret: !!storedTurnstileSecret,
		};
	},

	async preflightManagedDomainMigration(c) {
		if (await this.v3_21Applied(c)) return;
		if (!await this.hasTable(c, 'user')) return;
		const anyUser = await c.env.db.prepare('SELECT 1 AS found FROM user LIMIT 1').first();
		if (!anyUser) return;
		if (await this.hasTable(c, 'managed_domain')) {
			const rows = await c.env.db.prepare('SELECT domain FROM managed_domain').all();
			if ((rows.results || []).length > 0) {
				try {
					managedDomains(rows.results.map(row => row.domain));
					return;
				} catch {
					throw new Error('Existing managed domain configuration is invalid and requires manual recovery.');
				}
			}
		}
		let legacyDomains;
		try {
			legacyDomains = managedDomains(c.env.FLAREMAIL_DOMAINS);
		} catch {
			legacyDomains = [];
		}
		if (legacyDomains.length === 0) {
			throw new Error(
				'Legacy managed domain migration requires a valid FLAREMAIL_DOMAINS value. '
				+ 'Temporarily restore FLAREMAIL_DOMAINS and retry the controlled upgrade.',
			);
		}
	},

	async assertCurrentLegacySchema(c) {
		const required = {
			user: ['email', 'password', 'salt', 'status', 'send_count', 'send_limit', 'forward_status', 'forward_email', 'cli_token', 'is_del'],
			account: ['email', 'name', 'user_id', 'all_receive', 'sort', 'is_del'],
			email: ['account_id', 'user_id', 'recipient', 'message_id', 'type', 'status', 'unread', 'is_del'],
			attachments: ['user_id', 'email_id', 'account_id', 'key', 'status', 'type'],
			setting: ['register', 'receive', 'add_email', 'many_email', 'auto_refresh', 'send', 'resend_tokens', 'no_recipient', 'login_domain', 'black_subject', 'black_content', 'black_from'],
			star: ['star_id', 'user_id', 'email_id'],
		};
		const missing = [];
		for (const [table, columns] of Object.entries(required)) {
			const info = await c.env.db.prepare(`PRAGMA table_info(${table})`).all();
			const existing = new Set(info.results.map(column => column.name));
			for (const column of columns) {
				if (!existing.has(column)) missing.push(`${table}.${column}`);
			}
		}
		if (missing.length > 0) {
			throw new Error(`Existing database schema is older than the supported safe-upgrade baseline. Missing: ${missing.join(', ')}`);
		}
	},

	async assertEmailNormalizationSafe(c) {
		for (const table of ['user', 'account']) {
			const collision = await c.env.db.prepare(`
				SELECT LOWER(TRIM(email)) AS normalized
				FROM ${table}
				GROUP BY LOWER(TRIM(email))
				HAVING COUNT(*) > 1
				LIMIT 1
			`).first();
			if (collision) throw new Error(`Cannot normalize ${table} email addresses because duplicates would collide.`);
		}
	},

	async assertSingleSettingRow(c) {
		const row = await c.env.db.prepare('SELECT COUNT(*) AS total FROM setting').first();
		if (Number(row?.total) !== 1) {
			throw new Error('Existing database must contain exactly one setting row.');
		}
	},

	async preflightExistingDatabase(c) {
		await this.assertCurrentLegacySchema(c);
		await this.assertSingleSettingRow(c);
		await this.assertEmailNormalizationSafe(c);
	},

	async preflightAdminIdentity(c) {
		const hasAdminColumn = await this.hasColumn(c, 'user', 'is_admin');
		const hasMarkerTable = await this.hasTable(c, 'schema_migrations');
		const hasMarker = hasMarkerTable && await this.hasMigrationMarker(c, 318);
		if (!hasAdminColumn) {
			if (hasMarker) throw new Error('Administrator identity migration is marked complete but its column is missing.');
			const { total } = await c.env.db.prepare('SELECT COUNT(*) AS total FROM user').first();
			if (Number(total) === 0) return { legacyAdminId: null };

			const configured = String(c.env.FLAREMAIL_ADMIN_EMAIL || '');
			if (!configured || configured !== configured.trim().toLowerCase()) {
				throw new Error('A canonical configured admin email is required to migrate administrator identity.');
			}
			const matches = await c.env.db.prepare(`
				SELECT user_id AS userId, status, is_del AS isDel
				FROM user WHERE email = ? LIMIT 2
			`).bind(configured).all();
			if (matches.results?.length !== 1
				|| Number(matches.results[0].status) !== 0
				|| Number(matches.results[0].isDel) !== 0) {
				throw new Error('The configured admin must identify exactly one active user before administrator identity migration.');
			}
			return { legacyAdminId: Number(matches.results[0].userId) };
		}

		const invalid = await c.env.db.prepare(
			'SELECT 1 AS found FROM user WHERE is_admin NOT IN (0, 1) OR is_admin IS NULL LIMIT 1',
		).first();
		if (invalid) throw new Error('Administrator identity data is invalid.');
		const users = await c.env.db.prepare('SELECT COUNT(*) AS total FROM user').first();
		const admins = await c.env.db.prepare(`
			SELECT user_id AS userId, status, is_del AS isDel FROM user WHERE is_admin = 1 LIMIT 2
		`).all();
		if (admins.results?.length > 1) throw new Error('Multiple persisted administrators require manual recovery.');
		if (Number(users.total) > 0 && admins.results?.length !== 1) {
			throw new Error('An existing user database must contain exactly one persisted administrator.');
		}
		if (admins.results?.length === 1
			&& (Number(admins.results[0].status) !== 0 || Number(admins.results[0].isDel) !== 0)) {
			throw new Error('The persisted administrator must be active.');
		}
		const namedIndex = await c.env.db.prepare(`
			SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_single_admin'
		`).first();
		if (namedIndex && !await this.hasSingleAdminIndex(c)) {
			throw new Error('The persisted administrator unique index is malformed.');
		}
		return { legacyAdminId: null };
	},

	async v1_1DB(c) {
		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE email ADD COLUMN type INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE email ADD COLUMN status INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE email ADD COLUMN resend_email_id TEXT;`,
			`ALTER TABLE email ADD COLUMN message TEXT;`,
			`ALTER TABLE setting ADD COLUMN resend_tokens TEXT NOT NULL DEFAULT '{}';`,
			`ALTER TABLE setting ADD COLUMN send INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN r2_domain TEXT;`,
			`ALTER TABLE setting ADD COLUMN site_key TEXT;`,
			`ALTER TABLE setting ADD COLUMN secret_key TEXT;`,
			`ALTER TABLE setting ADD COLUMN background TEXT;`,
			`ALTER TABLE setting ADD COLUMN login_opacity INTEGER NOT NULL DEFAULT 0.90;`,
			`ALTER TABLE user ADD COLUMN create_ip TEXT;`,
			`ALTER TABLE user ADD COLUMN active_ip TEXT;`,
			`ALTER TABLE user ADD COLUMN os TEXT;`,
			`ALTER TABLE user ADD COLUMN browser TEXT;`,
			`ALTER TABLE user ADD COLUMN device TEXT;`,
			`ALTER TABLE user ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE user ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE attachments ADD COLUMN status INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE attachments ADD COLUMN type INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		// Legacy upstream permission/role model (perm, role, role_perm). No runtime
		// code reads or writes these tables any more: access control is resolved by
		// resolvePermKeys() in security/admin-identity.js. They are created and
		// seeded only on fresh installs and never touched on upgrade, so existing
		// instances keep their original schema.
		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS perm (
				perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				perm_key TEXT,
				pid INTEGER NOT NULL DEFAULT 0,
				type INTEGER NOT NULL DEFAULT 2,
				sort INTEGER
			)
		`).run();

		const {permTotal} = await c.env.db.prepare(`SELECT COUNT(*) as permTotal FROM perm`).first();

		if (permTotal === 0) {
			await c.env.db.prepare(`
				INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
				(1, '邮件', NULL, 0, 0, 0),
				(2, '邮件删除', 'email:delete', 1, 2, 1),
				(3, '邮件发送', 'email:send', 1, 2, 0),
				(4, '个人设置', '', 0, 1, 2),
				(5, '用户注销', 'my:delete', 4, 2, 0),
				(6, '用户信息', NULL, 0, 1, 3),
				(7, '用户查看', 'user:query', 6, 2, 0),
				(8, '密码修改', 'user:set-pwd', 6, 2, 2),
				(9, '状态修改', 'user:set-status', 6, 2, 3),
				(10, '权限修改', 'user:set-type', 6, 2, 4),
				(11, '用户删除', 'user:delete', 6, 2, 7),
				(12, '用户收藏', 'user:star', 6, 2, 5),
				(13, '权限控制', '', 0, 1, 5),
				(14, '身份查看', 'role:query', 13, 2, 0),
				(15, '身份修改', 'role:set', 13, 2, 1),
				(16, '身份删除', 'role:delete', 13, 2, 2),
				(17, '系统设置', '', 0, 1, 6),
				(18, '设置查看', 'setting:query', 17, 2, 0),
				(19, '设置修改', 'setting:set', 17, 2, 1),
				(21, '邮箱侧栏', '', 0, 0, 1),
				(22, '邮箱查看', 'account:query', 21, 2, 0),
				(23, '邮箱添加', 'account:add', 21, 2, 1),
				(24, '邮箱删除', 'account:delete', 21, 2, 2),
				(25, '用户添加', 'user:add', 6, 2, 1),
				(26, '发件重置', 'user:reset-send', 6, 2, 6),
				(27, '邮件列表', '', 0, 1, 4),
				(28, '邮件查看', 'all-email:query', 27, 2, 0),
				(29, '邮件删除', 'all-email:delete', 27, 2, 0),
				(30, '身份添加', 'role:add', 13, 2, -1)
			`).run();
		}

		await c.env.db.prepare(`UPDATE perm SET perm_key = 'setting:clean' WHERE perm_key = 'seting:clear'`).run();
		await c.env.db.prepare(`DELETE FROM perm WHERE perm_key = 'user:star'`).run();

		// See the legacy permission-model note above v1_1DB's perm table.
		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS role (
				role_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				key TEXT,
				create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
				sort INTEGER DEFAULT 0,
				description TEXT,
				user_id INTEGER,
				is_default INTEGER DEFAULT 0,
				send_count INTEGER,
				send_type TEXT NOT NULL DEFAULT 'count',
				account_count INTEGER
			)
		`).run();

		const { roleCount } = await c.env.db.prepare(`SELECT COUNT(*) as roleCount FROM role`).first();
		if (roleCount === 0) {
			await c.env.db.prepare(`
				INSERT INTO role (
					role_id, name, key, create_time, sort, description, user_id, is_default, send_count, send_type, account_count
				) VALUES (
					1, '普通用户', NULL, '0000-00-00 00:00:00', 0, '只有普通使用权限', 0, 1, NULL, 'ban', 10
				)
			`).run();
		}

		// See the legacy permission-model note above v1_1DB's perm table.
		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS role_perm (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				role_id INTEGER,
				perm_id INTEGER
			)
		`).run();

		const {rolePermCount} = await c.env.db.prepare(`SELECT COUNT(*) as rolePermCount FROM role_perm`).first();
		if (rolePermCount === 0) {
			await c.env.db.prepare(`
				INSERT INTO role_perm (id, role_id, perm_id) VALUES
					(100, 1, 2),
					(101, 1, 21),
					(102, 1, 22),
					(103, 1, 23),
					(104, 1, 24),
					(105, 1, 4),
					(106, 1, 5),
					(107, 1, 1),
					(108, 1, 3)
			`).run();
		}
	},

	async v1_2DB(c) {
		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE email ADD COLUMN recipient TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN cc TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN bcc TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN message_id TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE email ADD COLUMN in_reply_to TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE email ADD COLUMN relation TEXT NOT NULL DEFAULT '';`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);
		await this.receiveEmailToRecipient(c);
		await this.initAccountName(c);

		try {
			await c.env.db.prepare(`
				INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
				(31,'分析页', NULL, 0, 1, 2.1),
				(32,'数据查看', 'analysis:query', 31, 2, 1)`).run();
		} catch (e) {
			console.warn(`跳过数据：${e.message}`);
		}
	},

	async v1_3DB(c) {
		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN tg_bot_token TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN tg_chat_id TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN tg_bot_status INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN forward_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN forward_status INTEGER TIME NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN rule_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN rule_type INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		const nameColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('email') WHERE name = 'to_email' limit 1`).first();
		if (nameColumn) return;

		await c.env.db.prepare(`ALTER TABLE email ADD COLUMN to_email TEXT NOT NULL DEFAULT ''`).run();
		await c.env.db.prepare(`ALTER TABLE email ADD COLUMN to_name TEXT NOT NULL DEFAULT ''`).run();
		await c.env.db.prepare(`UPDATE email SET to_email = json_extract(recipient, '$[0].address'), to_name = json_extract(recipient, '$[0].name')`).run();
	},

	async v1_3_1DB(c) {
		await c.env.db.prepare(`UPDATE email SET name = SUBSTR(send_email, 1, INSTR(send_email, '@') - 1) WHERE (name IS NULL OR name = '') AND type = ${emailConst.type.RECEIVE}`).run();
	},

	async v1_4DB(c) {
		// Legacy invitation-code table from the upstream self-service registration
		// flow. FlareMail is invite-only and creates users through the admin API,
		// so no runtime code reads or writes this table.
		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS reg_key (
				rege_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
				code TEXT NOT NULL COLLATE NOCASE DEFAULT '',
				count INTEGER NOT NULL DEFAULT 0,
				role_id INTEGER NOT NULL DEFAULT 0,
				user_id INTEGER NOT NULL DEFAULT 0,
				expire_time DATETIME,
				create_time DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`).run();

		try {
			await c.env.db.prepare(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_setting_code ON reg_key(code COLLATE NOCASE)
			`).run();
		} catch (e) {
			console.warn(`跳过创建索引：${e.message}`);
		}

		try {
			await c.env.db.prepare(`
				INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
				(33,'注册密钥', NULL, 0, 1, 5.1),
				(34,'密钥查看', 'reg-key:query', 33, 2, 0),
				(35,'密钥添加', 'reg-key:add', 33, 2, 1),
				(36,'密钥删除', 'reg-key:delete', 33, 2, 2)`).run();
		} catch (e) {
			console.warn(`跳过数据：${e.message}`);
		}

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN reg_key INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE role ADD COLUMN ban_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE role ADD COLUMN ban_email_type INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE user ADD COLUMN reg_key_id INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);
	},

	async v1_5DB(c) {
		await c.env.db.prepare(`UPDATE perm SET perm_key = 'all-email:query' WHERE perm_key = 'sys-email:query'`).run();
		await c.env.db.prepare(`UPDATE perm SET perm_key = 'all-email:delete' WHERE perm_key = 'sys-email:delete'`).run();
		try {
			await c.env.db.prepare(`ALTER TABLE role ADD COLUMN avail_domain TEXT NOT NULL DEFAULT ''`).run();
		} catch (e) {
			console.warn(`跳过字段添加：${e.message}`);
		}
	},

	async v1_6DB(c) {
		const noticeContent = '本项目仅供学习交流，禁止用于违法业务\n<br>\n请遵守当地法规，作者不承担任何法律责任';
		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN reg_verify_count INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN add_verify_count INTEGER NOT NULL DEFAULT 1;`,
			// Legacy anti-abuse counter for the upstream self-service registration
			// flow; no runtime code reads or writes it.
			`CREATE TABLE IF NOT EXISTS verify_record (
				vr_id INTEGER PRIMARY KEY AUTOINCREMENT,
				ip TEXT NOT NULL DEFAULT '',
				count INTEGER NOT NULL DEFAULT 1,
				type INTEGER NOT NULL DEFAULT 0,
				update_time DATETIME DEFAULT CURRENT_TIMESTAMP
			)`,
			`ALTER TABLE setting ADD COLUMN notice_title TEXT NOT NULL DEFAULT 'Cloud Mail';`,
			`ALTER TABLE setting ADD COLUMN notice_content TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN notice_type TEXT NOT NULL DEFAULT 'none';`,
			`ALTER TABLE setting ADD COLUMN notice_duration INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN notice_offset INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN notice_position TEXT NOT NULL DEFAULT 'top-right';`,
			`ALTER TABLE setting ADD COLUMN notice_width INTEGER NOT NULL DEFAULT 340;`,
			`ALTER TABLE setting ADD COLUMN notice INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN no_recipient INTEGER NOT NULL DEFAULT 1;`,
			`UPDATE role SET avail_domain = '' WHERE role.avail_domain LIKE '@%';`,
			`CREATE INDEX IF NOT EXISTS idx_email_user_id_account_id ON email(user_id, account_id);`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		});

		await Promise.all(promises);
		await c.env.db.prepare(`UPDATE setting SET notice_content = ? WHERE notice_content = '';`).bind(noticeContent).run();
		try {
			await c.env.db.batch([
				c.env.db.prepare(`DROP INDEX IF EXISTS idx_account_email`),
				c.env.db.prepare(`DROP INDEX IF EXISTS idx_user_email`),
				c.env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_nocase ON account (email COLLATE NOCASE)`),
				c.env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_nocase ON user (email COLLATE NOCASE)`)
			]);
		} catch (e) {
			console.warn(e.message);
		}
	},

	async v1_7DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN login_domain INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN bucket TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN region TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN endpoint TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN s3_access_key TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN s3_secret_key TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`DELETE FROM perm WHERE perm_key = 'setting:clean'`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_3DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN force_path_style INTEGER NOT NULL DEFAULT 1;`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN custom_domain TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_to TEXT NOT NULL DEFAULT 'show';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_from TEXT NOT NULL DEFAULT 'only-name';`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_text TEXT NOT NULL DEFAULT 'show';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_4DB(c) {
		try {
			// Legacy third-party login table from the upstream multi-provider model.
			// FlareMail binds Google through user.google_sub / user.google_email and
			// never reads or writes this table.
			await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS oauth (
					oauth_id INTEGER PRIMARY KEY AUTOINCREMENT,
					oauth_user_id TEXT,
					username TEXT,
					name TEXT,
					avatar TEXT,
					active INTEGER,
					trust_level INTEGER,
					silenced INTEGER,
					create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
					platform INTEGER NOT NULL DEFAULT 0,
					user_id INTEGER NOT NULL DEFAULT 0
				)
			`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN min_email_prefix INTEGER NOT NULL DEFAULT 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_5DB(c) {
		const prefixColumn = await c.env.db.prepare(
			`SELECT name FROM pragma_table_info('setting') WHERE name = 'email_prefix_filter' LIMIT 1`
		).first();
		if (!prefixColumn) {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN email_prefix_filter TEXT NOT NULL DEFAULT '';`).run();
		}
		const unreadColumn = await c.env.db.prepare(
			`SELECT name FROM pragma_table_info('email') WHERE name = 'unread' LIMIT 1`
		).first();
		if (unreadColumn) return;

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN email_prefix_filter text NOT NULL DEFAULT '';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`ALTER TABLE email ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`UPDATE email SET unread = 1;`).run();
		} catch (e) {
			console.warn(`更新错误：${e.message}`);
		}
	},

	async v2_6DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE account ADD COLUMN all_receive INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_7DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting RENAME COLUMN auto_refresh_time TO auto_refresh;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_8DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE account ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_9DB(c) {
		try {
			await c.env.db.prepare(`UPDATE setting SET auto_refresh = 5 WHERE auto_refresh = 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_0DB(c) {
		try {
			await c.env.db.batch([
				await c.env.db.prepare(`ALTER TABLE email ADD COLUMN code TEXT NOT NULL DEFAULT '';`),
				await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN ai_code INTEGER NOT NULL DEFAULT 1;`),
				await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN ai_code_filter TEXT NOT NULL DEFAULT '';`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN black_subject TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN black_content TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN black_from TEXT NOT NULL DEFAULT '';`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_1DB(c) {
		const statements = [
			`ALTER TABLE user ADD COLUMN forward_status INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE user ADD COLUMN forward_email TEXT NOT NULL DEFAULT '';`
		];

		for (const statement of statements) {
			try {
				await c.env.db.prepare(statement).run();
			} catch (e) {
				console.warn(`Skip user forwarding field: ${e.message}`);
			}
		}
	},

	async v3_2DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE user ADD COLUMN send_limit INTEGER NOT NULL DEFAULT 50;`).run();
		} catch (e) {
			console.warn(`Skip field addition: ${e.message}`);
		}
		try {
			await c.env.db.batch([
				c.env.db.prepare(`DROP TABLE IF EXISTS role`),
				c.env.db.prepare(`DROP TABLE IF EXISTS perm`),
				c.env.db.prepare(`DROP TABLE IF EXISTS role_perm`),
				c.env.db.prepare(`DROP TABLE IF EXISTS reg_key`),
				c.env.db.prepare(`DROP TABLE IF EXISTS verify_record`)
			]);
		} catch (e) {
			console.warn(`Drop table issue: ${e.message}`);
		}
	},

	async v3_3DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN cli_token TEXT NOT NULL DEFAULT '';`).run();
		} catch (e) {
			console.warn(`Skip field addition: ${e.message}`);
		}
	},

	async v3_4DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE user ADD COLUMN cli_token TEXT NOT NULL DEFAULT '';`).run();
		} catch (e) {
			console.warn(`Skip field addition: ${e.message}`);
		}
	},

	async v3_6DB(c) {
		await c.env.db.prepare(
			`UPDATE user SET cli_token = '' WHERE cli_token <> '' AND cli_token NOT LIKE 'sha256$%';`
		).run();
		for (const column of ['webhook_url', 'webhook_status']) {
			try {
				await c.env.db.prepare(`ALTER TABLE user DROP COLUMN ${column};`).run();
			} catch (error) {
				if (!error.message?.includes('no such column')) {
					console.warn(`Skip removed webhook field ${column}: ${error.message}`);
				}
			}
		}
	},

	async v3_7DB(c) {
		await this.preflightExistingDatabase(c);
		await this.ensureMigrationTable(c);
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE user SET email = LOWER(TRIM(email)), forward_email = LOWER(TRIM(forward_email))`),
			c.env.db.prepare(`UPDATE account SET email = LOWER(TRIM(email))`),
			c.env.db.prepare(`UPDATE setting SET register = 1, add_email = 1, many_email = 1`),
		]);
		await c.env.db.prepare(`
			DELETE FROM star
			WHERE star_id NOT IN (
				SELECT MIN(star_id) FROM star GROUP BY user_id, email_id
			)
		`).run();
		await c.env.db.batch([
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS send_request (
					user_id INTEGER NOT NULL,
					request_id TEXT NOT NULL,
					email_id INTEGER,
					status TEXT NOT NULL DEFAULT 'pending',
					delivery_status INTEGER,
					warning TEXT NOT NULL DEFAULT '',
					recipient_count INTEGER NOT NULL DEFAULT 0,
					quota_reserved INTEGER NOT NULL DEFAULT 0,
					create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
					completed_time DATETIME,
					PRIMARY KEY (user_id, request_id)
				)
			`),
			c.env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_star_user_email ON star(user_id, email_id)`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_user_type_del_id ON email(user_id, type, is_del, email_id)`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_attachment_user_key ON attachments(user_id, key)`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_attachment_email ON attachments(email_id)`),
			c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (308)`),
		]);
	},

	async v3_8DB(c) {
		await this.ensureMigrationTable(c);
		await c.env.db.batch([
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS object_delete_queue (
					key TEXT PRIMARY KEY,
					create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
					claim_time DATETIME
				)
			`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_attachment_key ON attachments(key)`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_attachment_account ON attachments(account_id)`),
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_object_delete_queue_time ON object_delete_queue(create_time)`),
			c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (309)`),
		]);
	},

	async v3_9DB(c) {
		await this.ensureMigrationTable(c);
		await this.ensureAccountLimitColumn(c);
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE user SET account_limit = 10 WHERE account_limit IS NULL OR account_limit < 1`),
			c.env.db.prepare(`
				UPDATE account
				SET all_receive = 1
				WHERE is_del = 0
				  AND email = (SELECT user.email FROM user WHERE user.user_id = account.user_id) COLLATE NOCASE
				  AND NOT EXISTS (
					SELECT 1 FROM account enabled
					WHERE enabled.user_id = account.user_id AND enabled.is_del = 0 AND enabled.all_receive = 1
				  )
			`),
			c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (310)`),
		]);
	},

	async v3_10DB(c) {
		await this.ensureMigrationTable(c);
		await this.ensurePhase5Columns(c);
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE user SET unmatched_policy = 'reject' WHERE unmatched_policy IS NULL OR unmatched_policy = ''`),
			c.env.db.prepare(`
				UPDATE account
				SET is_default_send = 1
				WHERE is_del = 0
				  AND email = (SELECT user.email FROM user WHERE user.user_id = account.user_id) COLLATE NOCASE
				  AND NOT EXISTS (
					SELECT 1 FROM account enabled
					WHERE enabled.user_id = account.user_id AND enabled.is_del = 0 AND enabled.is_default_send = 1
				  )
			`),
			c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (311)`),
		]);
	},

	async v3_11DB(c) {
		await this.ensureMigrationTable(c);
		const userCols = await c.env.db.prepare(`PRAGMA table_info('user')`).all();
		const userColNames = new Set((userCols.results || []).map(col => col.name));
		if (!userColNames.has('main_forward_status')) {
			try {
				await c.env.db.prepare(`ALTER TABLE user ADD COLUMN main_forward_status INTEGER NOT NULL DEFAULT 0;`).run();
			} catch (e) {
				if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
			}
		}

		const accountCols = await c.env.db.prepare(`PRAGMA table_info('account')`).all();
		const accountColNames = new Set((accountCols.results || []).map(col => col.name));
		if (!accountColNames.has('forward_status')) {
			try {
				await c.env.db.prepare(`ALTER TABLE account ADD COLUMN forward_status INTEGER NOT NULL DEFAULT 0;`).run();
			} catch (e) {
				if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
			}
		}

		await c.env.db.batch([
			c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (312)`),
		]);
	},

	async v3_13DB(c) {
		await this.ensureMigrationTable(c);
		for (const [column, definition] of [
			['google_sub', `TEXT NOT NULL DEFAULT ''`],
			['google_email', `TEXT NOT NULL DEFAULT ''`],
		]) {
			const cols = await c.env.db.prepare(`PRAGMA table_info('user')`).all();
			const colNames = new Set((cols.results || []).map(col => col.name));
			if (!colNames.has(column)) {
				try {
					await c.env.db.prepare(`ALTER TABLE user ADD COLUMN ${column} ${definition};`).run();
				} catch (e) {
					if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
				}
			}
		}
		await c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (314)`).run();
	},

	async v3_14DB(c) {
		await this.ensureMigrationTable(c);
		for (const [column, definition] of [
			['google_oauth_enabled', 'INTEGER NOT NULL DEFAULT 0'],
			['google_client_id', `TEXT NOT NULL DEFAULT ''`],
			['google_client_secret', `TEXT NOT NULL DEFAULT ''`],
		]) {
			const cols = await c.env.db.prepare(`PRAGMA table_info('setting')`).all();
			const colNames = new Set((cols.results || []).map(col => col.name));
			if (!colNames.has(column)) {
				try {
					await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN ${column} ${definition};`).run();
				} catch (e) {
					if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
				}
			}
		}
		await c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (315)`).run();
	},

	async v3_15DB(c) {
		await this.ensureMigrationTable(c);
		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS contact (
				contact_id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				name TEXT NOT NULL,
				email TEXT NOT NULL,
				phone TEXT,
				remark TEXT,
				group_name TEXT,
				create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
				update_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
				is_del INTEGER DEFAULT 0 NOT NULL
			)
		`).run();
		await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_contact_user_id ON contact(user_id, is_del)`).run();
		await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_contact_email ON contact(email)`).run();
		await c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (316)`).run();
	},

	async v3_16DB(c) {
		await this.ensureMigrationTable(c);
		await c.env.db.prepare(`
			CREATE TABLE IF NOT EXISTS oauth_authorization_code (
				code_hash TEXT PRIMARY KEY,
				client_id TEXT NOT NULL,
				redirect_uri TEXT NOT NULL,
				user_id INTEGER NOT NULL,
				code_challenge TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				used_at INTEGER
			)
		`).run();
		await c.env.db.batch([
			c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_oauth_authorization_code_expiry ON oauth_authorization_code(expires_at, used_at)`),
			c.env.db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES (317)`),
		]);
	},

	async v3_17DB(c, legacyAdminId = null) {
		await this.ensureMigrationTable(c);
		const statements = [];
		if (!await this.hasColumn(c, 'user', 'is_admin')) {
			statements.push(c.env.db.prepare(
				'ALTER TABLE user ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1))',
			));
		}
		if (legacyAdminId !== null) {
			statements.push(c.env.db.prepare(`
				UPDATE user SET is_admin = 1
				WHERE user_id = ? AND status = 0 AND is_del = 0
				RETURNING user_id
			`).bind(legacyAdminId));
			// A CHECK failure aborts the whole D1 batch if the preflight user
			// changed before this transaction began.
			statements.push(
				c.env.db.prepare('CREATE TABLE migration_318_guard (valid INTEGER NOT NULL CHECK (valid = 1))'),
				c.env.db.prepare(`
					INSERT INTO migration_318_guard(valid)
					SELECT CASE WHEN
						(SELECT COUNT(*) FROM user WHERE is_admin = 1) = 1
						AND EXISTS (
							SELECT 1 FROM user
							WHERE user_id = ? AND is_admin = 1 AND status = 0 AND is_del = 0
						)
					THEN 1 ELSE 0 END
				`).bind(legacyAdminId),
				c.env.db.prepare('DROP TABLE migration_318_guard'),
			);
		}
		statements.push(
			c.env.db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_single_admin ON user(is_admin) WHERE is_admin = 1'),
			c.env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (318)'),
		);
		await c.env.db.batch(statements);
		await this.preflightAdminIdentity(c);
	},

	async v3_19DB(c) {
		await this.ensureMigrationTable(c);
		const columns = [
			['site_description', "TEXT NOT NULL DEFAULT ''"],
			['site_logo', "TEXT NOT NULL DEFAULT ''"],
			['site_favicon', "TEXT NOT NULL DEFAULT ''"],
			['site_pwa_icons', "TEXT NOT NULL DEFAULT '{}'"],
			// Retain the historical 319 schema; custom public links are no longer used.
			['site_links', "TEXT NOT NULL DEFAULT '[]'"],
			['login_copy', "TEXT NOT NULL DEFAULT '{}'"],
		];
		const info = await c.env.db.prepare("PRAGMA table_info('setting')").all();
		const existing = new Set((info.results || []).map(column => column.name));
		const statements = columns
			.filter(([name]) => !existing.has(name))
			.map(([name, definition]) => c.env.db.prepare('ALTER TABLE setting ADD COLUMN ' + name + ' ' + definition));
		statements.push(c.env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (319)'));
		await c.env.db.batch(statements);
	},

	async v3_20DB(c) {
		const rowCount = await c.env.db.prepare('SELECT COUNT(*) AS total FROM setting').first();
		if (Number(rowCount?.total) !== 1) {
			throw new Error('OAuth provider migration requires exactly one setting row.');
		}
		await this.ensureMigrationTable(c);
		const columns = [
			['oauth_provider_enabled', 'INTEGER NOT NULL DEFAULT 0'],
			['oauth_provider_revision', 'INTEGER NOT NULL DEFAULT 0'],
			['oauth_provider_clients', "TEXT NOT NULL DEFAULT '[]'"],
		];
		const info = await c.env.db.prepare("PRAGMA table_info('setting')").all();
		const existing = new Set((info.results || []).map(column => column.name));
		const statements = columns
			.filter(([name]) => !existing.has(name))
			.map(([name, definition]) => c.env.db.prepare('ALTER TABLE setting ADD COLUMN ' + name + ' ' + definition));
		statements.push(c.env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (320)'));
		await c.env.db.batch(statements);
	},

	async v3_21DB(c) {
		await this.preflightManagedDomainMigration(c);
		const userCount = Number((await c.env.db.prepare('SELECT COUNT(*) AS total FROM user').first())?.total || 0);
		const hasDomainTable = await this.hasTable(c, 'managed_domain');
		let existingDomains = [];
		if (hasDomainTable) {
			existingDomains = (await c.env.db.prepare('SELECT domain FROM managed_domain').all()).results || [];
		}

		let legacyDomains = [];
		if (userCount > 0 && existingDomains.length === 0) {
			legacyDomains = managedDomains(c.env.FLAREMAIL_DOMAINS);
		}

		await this.ensureMigrationTable(c);
		const initialStatus = userCount > 0 ? 'installed' : 'pending';
		const initialRevision = existingDomains.length > 0 || legacyDomains.length > 0 ? 1 : 0;
		const statements = [
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS managed_domain (
					domain TEXT PRIMARY KEY COLLATE NOCASE,
					create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
				)
			`),
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS installation_state (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					status TEXT NOT NULL CHECK (status IN ('pending', 'installed')),
					revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
					legacy_domain_imported INTEGER NOT NULL DEFAULT 0 CHECK (legacy_domain_imported IN (0, 1)),
					update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
				)
			`),
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS installation_guard (
					valid INTEGER NOT NULL CHECK (valid = 1)
				)
			`),
			c.env.db.prepare(`
				INSERT OR IGNORE INTO installation_state(id, status, revision, legacy_domain_imported)
				VALUES (1, ?, ?, ?)
			`).bind(initialStatus, initialRevision, userCount > 0 ? 1 : 0),
		];
		if (existingDomains.length === 0) {
			statements.push(...legacyDomains.map(domain => c.env.db.prepare(
				'INSERT OR IGNORE INTO managed_domain(domain) VALUES (?)',
			).bind(domain)));
		}
		statements.push(c.env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (321)'));
		await c.env.db.batch(statements);

		if (!await this.v3_21Applied(c)) {
			throw new Error('Managed domain migration did not produce a complete schema.');
		}
	},

	async v3_22DB(c) {
		const plan = await this.preflightRuntimeConfigMigration(c);
		if (plan.current) return;
		await this.ensureMigrationTable(c);
		const runtime = plan.runtime;
		const statements = [
			c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS runtime_config (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
					allowed_origins TEXT NOT NULL DEFAULT '[]',
					turnstile_site_key TEXT NOT NULL DEFAULT '',
					turnstile_secret TEXT NOT NULL DEFAULT '',
					oauth_issuer TEXT NOT NULL DEFAULT '',
					oauth_secret TEXT NOT NULL DEFAULT '',
					legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK (legacy_imported IN (0, 1)),
					update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
				)
			`),
			c.env.db.prepare(`
				INSERT OR IGNORE INTO runtime_config (
					id, revision, allowed_origins, turnstile_site_key,
					turnstile_secret, oauth_issuer, oauth_secret, legacy_imported
				) VALUES (1, ?, ?, ?, ?, ?, ?, 1)
			`).bind(
				runtime.revision,
				JSON.stringify(runtime.allowedOrigins),
				runtime.turnstile.siteKey,
				runtime.turnstile.secret,
				runtime.oauth.issuer,
				runtime.oauth.secret,
			),
			c.env.db.prepare('UPDATE runtime_config SET legacy_imported = 1 WHERE id = 1'),
		];
		if (plan.importGoogle) {
			statements.push(c.env.db.prepare(`
				UPDATE setting SET google_client_id = ?, google_client_secret = ?
			`).bind(plan.googleClientId, plan.googleClientSecret));
		}
		if (plan.clearSettingTurnstileSecret) {
			statements.push(c.env.db.prepare(`UPDATE setting SET secret_key = NULL`));
		}
		statements.push(c.env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (322)'));
		await c.env.db.batch(statements);

		if (!await this.v3_22Applied(c)) {
			throw new Error('Runtime configuration migration did not produce a complete schema.');
		}
	},

	async v3_23Applied(c) {
		if (!await this.hasTable(c, 'schema_migrations') || !await this.hasMigrationMarker(c, 323)
			|| !await this.hasTable(c, 'admin_confirmation')) return false;
		try {
			normalizeConfirmation(await c.env.db.prepare('SELECT enabled, window_minutes AS windowMinutes, revision FROM admin_confirmation WHERE id = 1').first());
			return true;
		} catch { return false; }
	},

	async v3_23DB(c) {
		await c.env.db.batch([
			c.env.db.prepare(`CREATE TABLE IF NOT EXISTS admin_confirmation (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
				window_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (window_minutes BETWEEN 1 AND 10080),
				revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
			)`),
			c.env.db.prepare('INSERT OR IGNORE INTO admin_confirmation(id) VALUES (1)'),
			c.env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (323)'),
		]);
		if (!await this.v3_23Applied(c)) throw new Error('Administrator confirmation migration requires manual recovery.');
	},

	async v3_24Applied(c) {
		if (!await this.hasTable(c, 'schema_migrations') || !await this.hasMigrationMarker(c, 324)
			|| !await this.hasTable(c, 'mail_provider_config')) return false;
		try {
			normalizeMailProvider(await c.env.db.prepare('SELECT provider FROM mail_provider_config WHERE id = 1').first());
			return true;
		} catch { return false; }
	},

	async v3_24DB(c, provider = hasCloudflareEmail(c) ? 'cloudflare' : 'resend') {
		normalizeMailProvider({ provider });
		await c.env.db.batch([
			c.env.db.prepare(`CREATE TABLE IF NOT EXISTS mail_provider_config (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				provider TEXT NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend', 'cloudflare'))
			)`),
			c.env.db.prepare('INSERT OR IGNORE INTO mail_provider_config(id, provider) VALUES (1, ?)').bind(provider),
			c.env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (324)'),
		]);
		if (!await this.v3_24Applied(c)) throw new Error('Mail provider migration requires manual recovery.');
	},

	async ensurePhase5Columns(c) {
		const userCols = await c.env.db.prepare(`PRAGMA table_info('user')`).all();
		const userColNames = new Set((userCols.results || []).map(col => col.name));
		if (!userColNames.has('unmatched_policy')) {
			try {
				await c.env.db.prepare(`ALTER TABLE user ADD COLUMN unmatched_policy TEXT NOT NULL DEFAULT 'reject';`).run();
			} catch (e) {
				if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
			}
		}

		const accountCols = await c.env.db.prepare(`PRAGMA table_info('account')`).all();
		const accountColNames = new Set((accountCols.results || []).map(col => col.name));
		if (!accountColNames.has('is_default_send')) {
			try {
				await c.env.db.prepare(`ALTER TABLE account ADD COLUMN is_default_send INTEGER NOT NULL DEFAULT 0;`).run();
			} catch (e) {
				if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
			}
		}

		const sendReqTable = await c.env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'send_request'`
		).first();
		if (sendReqTable) {
			const sendReqCols = await c.env.db.prepare(`PRAGMA table_info('send_request')`).all();
			const sendReqColNames = new Set((sendReqCols.results || []).map(col => col.name));
			if (!sendReqColNames.has('send_account_id')) {
				try {
					await c.env.db.prepare(`ALTER TABLE send_request ADD COLUMN send_account_id INTEGER;`).run();
				} catch (e) {
					if (!String(e?.message || e).toLowerCase().includes('duplicate column')) throw e;
				}
			}
		}
	},

	async ensureAccountLimitColumn(c) {
		const accountLimitColumn = await c.env.db.prepare(
			`SELECT name FROM pragma_table_info('user') WHERE name = 'account_limit' LIMIT 1`
		).first();
		if (!accountLimitColumn) {
			try {
				await c.env.db.prepare(`ALTER TABLE user ADD COLUMN account_limit INTEGER NOT NULL DEFAULT 10;`).run();
			} catch (error) {
				if (!String(error?.message || error).toLowerCase().includes('duplicate column')) throw error;
			}
		}
	},

	async receiveEmailToRecipient(c) {
		const receiveEmailColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('email') WHERE name = 'receive_email' limit 1`).first();
		if (!receiveEmailColumn) return;

		const queryList = [];
		const {results} = await c.env.db.prepare('SELECT receive_email,email_id FROM email').all();
		results.forEach(emailRow => {
			const recipient = {};
			recipient.address = emailRow.receive_email;
			recipient.name = '';
			const recipientStr = JSON.stringify([recipient]);
			const sql = c.env.db.prepare('UPDATE email SET recipient = ? WHERE email_id = ?').bind(recipientStr, emailRow.email_id);
			queryList.push(sql);
		});

		queryList.push(c.env.db.prepare("ALTER TABLE email DROP COLUMN receive_email"));
		await c.env.db.batch(queryList);
	},

	async initAccountName(c) {
		const nameColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('account') WHERE name = 'name' limit 1`).first();
		if (nameColumn) return;

		await c.env.db.prepare(`ALTER TABLE account ADD COLUMN name TEXT NOT NULL DEFAULT ''`).run();
		const queryList = [];
		const {results} = await c.env.db.prepare(`SELECT account_id, email FROM account`).all();
		results.forEach(accountRow => {
			const name = emailUtils.getName(accountRow.email);
			const sql = c.env.db.prepare('UPDATE account SET name = ? WHERE account_id = ?').bind(name, accountRow.account_id);
			queryList.push(sql);
		});

		if (queryList.length > 0) {
			await c.env.db.batch(queryList);
		}
	}
};
