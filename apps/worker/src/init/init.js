import settingService from '../service/setting-service';
import { isMailProviderUpgradePending } from '../service/mail-provider-service';
import userService from '../service/user-service';
import { intDB, ensureMigrationTable } from './schema';
import { migrations } from './migrations';
import { SCHEMA_PATCH_CATALOG, LATEST_SCHEMA_VERSION, getPatchMeta } from './patch-catalog';
import BizError from '../error/biz-error';
import setupSessionService from '../service/setup-session-service';
import managedDomainService from '../service/managed-domain-service';
import cryptoUtils from '../utils/crypto-utils';
import verifyUtils from '../utils/verify-utils';
import emailUtils from '../utils/email-utils';
import { isConfirmationUpgradePending } from '../service/confirmation-policy-service';

const APPLICATION_TABLES = [
	'account',
	'attachments',
	'contact',
	'email',
	'object_delete_queue',
	'oauth',
	'perm',
	'reg_key',
	'role',
	'role_perm',
	'admin_confirmation',
	'mail_provider_config',
	'runtime_config',
	'schema_migrations',
	'send_request',
	'setting',
	'star',
	'verify_record',
];

const USER_OWNED_TABLES = [
	'account',
	'attachments',
	'contact',
	'email',
	'object_delete_queue',
	'oauth',
	'send_request',
	'star',
];

const BOOTSTRAP_SCHEMA_TABLES = [
	'account',
	'attachments',
	'contact',
	'email',
	'installation_guard',
	'installation_state',
	'managed_domain',
	'object_delete_queue',
	'oauth',
	'oauth_authorization_code',
	'perm',
	'reg_key',
	'role',
	'role_perm',
	'admin_confirmation',
	'mail_provider_config',
	'runtime_config',
	'schema_migrations',
	'send_request',
	'setting',
	'star',
	'user',
	'verify_record',
];

const dbInit = {
	...migrations,
	intDB,
	ensureMigrationTable,

	async migrate(c) {
		let existingUserTable = await c.env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`
		).first();
		const bootstrap = await c.env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'installation_bootstrap'`,
		).first();
		if (bootstrap) {
			const anyUser = existingUserTable
				? await c.env.db.prepare('SELECT 1 AS found FROM user LIMIT 1').first()
				: null;
			if (!anyUser && !await this.hasUserOwnedData(c)) {
				await c.env.db.batch(BOOTSTRAP_SCHEMA_TABLES.map(table => (
					c.env.db.prepare(`DROP TABLE IF EXISTS ${table}`)
				)));
				existingUserTable = null;
			}
		}
		let adminPreflight = { legacyAdminId: null };
		if (existingUserTable) {
			const anyUser = await c.env.db.prepare('SELECT 1 AS found FROM user LIMIT 1').first();
			if (!anyUser && !await this.hasUserOwnedData(c)) {
				existingUserTable = null;
			}
		}
		if (existingUserTable) {
			// This must remain before intDB, marker creation, token cleanup, or any
			// other migration write. Unsupported/colliding legacy databases are
			// handed back for manual recovery without partial mutation.
			await migrations.preflightExistingDatabase(c);
			adminPreflight = await migrations.preflightAdminIdentity(c);
			await migrations.preflightManagedDomainMigration(c);
			await migrations.preflightRuntimeConfigMigration(c);
		}
		await intDB(c);
		await ensureMigrationTable(c);

		// A migration is "applied" only when both its version marker and the
		// structures it creates are present.
		const v308Applied = await migrations.v3_7Applied(c);
		const v309Applied = await migrations.v3_8Applied(c);
		const v310Applied = await migrations.v3_9Applied(c);
		const v311Applied = await migrations.v3_10Applied(c);
		const v312Applied = await migrations.v3_11Applied(c);
		const v314Applied = await migrations.v3_13Applied(c);
		const v315Applied = await migrations.v3_14Applied(c);
		const v316Applied = await migrations.v3_15Applied(c);
		const v317Applied = await migrations.v3_16Applied(c);
		const v318Applied = await migrations.v3_17Applied(c);
		const v319Applied = await migrations.v3_19Applied(c);
		const v320Applied = await migrations.v3_20Applied(c);
		const v321Applied = await migrations.v3_21Applied(c);
		const v322Applied = await migrations.v3_22Applied(c);
		const v323Applied = await migrations.v3_23Applied(c);
		const v324Applied = await migrations.v3_24Applied(c);
		const legacyModernApplied = v308Applied && v309Applied && v310Applied && v311Applied
			&& v312Applied && v314Applied && v315Applied && v316Applied && v317Applied && v318Applied;

		if (legacyModernApplied && v319Applied && v320Applied && v321Applied && v322Applied && v323Applied && v324Applied) {
			await settingService.refresh(c);
			return;
		}

		if (existingUserTable) {
			if (!legacyModernApplied) {
				await migrations.v3_6DB(c);
				if (!v308Applied) await migrations.v3_7DB(c);
				if (!v309Applied) await migrations.v3_8DB(c);
				if (!v310Applied) await migrations.v3_9DB(c);
				if (!v311Applied) await migrations.v3_10DB(c);
				if (!v312Applied) await migrations.v3_11DB(c);
				if (!v314Applied) await migrations.v3_13DB(c);
				if (!v315Applied) await migrations.v3_14DB(c);
				if (!v316Applied) await migrations.v3_15DB(c);
				if (!v317Applied) await migrations.v3_16DB(c);
				if (!v318Applied) await migrations.v3_17DB(c, adminPreflight.legacyAdminId);
			}
			if (!v319Applied) await migrations.v3_19DB(c);
			if (!v320Applied) await migrations.v3_20DB(c);
			if (!v321Applied) await migrations.v3_21DB(c);
			if (!v322Applied) await migrations.v3_22DB(c);
			if (!v323Applied) await migrations.v3_23DB(c);
			if (!v324Applied) await migrations.v3_24DB(c);
			await settingService.refresh(c);
			return;
		}

		await migrations.v1_1DB(c);
		await migrations.v1_2DB(c);
		await migrations.v1_3DB(c);
		await migrations.v1_3_1DB(c);
		await migrations.v1_4DB(c);
		await migrations.v1_5DB(c);
		await migrations.v1_6DB(c);
		await migrations.v1_7DB(c);
		await migrations.v2DB(c);
		await migrations.v2_3DB(c);
		await migrations.v2_4DB(c);
		await migrations.v2_5DB(c);
		await migrations.v2_6DB(c);
		await migrations.v2_7DB(c);
		await migrations.v2_8DB(c);
		await migrations.v2_9DB(c);
		await migrations.v3_0DB(c);
		await migrations.v3_1DB(c);
		await migrations.v3_2DB(c);
		await migrations.v3_3DB(c);
		await migrations.v3_4DB(c);
		await migrations.v3_6DB(c);
		await migrations.v3_7DB(c);
		await migrations.v3_8DB(c);
		await migrations.v3_9DB(c);
		await migrations.v3_10DB(c);
		await migrations.v3_11DB(c);
		await migrations.v3_13DB(c);
		await migrations.v3_14DB(c);
		await migrations.v3_15DB(c);
		await migrations.v3_16DB(c);
		await migrations.v3_17DB(c);
		await migrations.v3_19DB(c);
		await migrations.v3_20DB(c);
		await migrations.v3_21DB(c);
		await migrations.v3_22DB(c);
		await migrations.v3_23DB(c);
		await migrations.v3_24DB(c, 'resend');

		await settingService.refresh(c);
	},

	async setupStatus(c) {
		const userTable = await c.env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`
		).first();
		if (!userTable) {
			const residualTable = await this.findApplicationTable(c);
			const bootstrap = await c.env.db.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'installation_bootstrap'`,
			).first();
			const setupSupported = !residualTable || !!bootstrap;
			return {
				setupRequired: true,
				upgradeRequired: false,
				upgradeSupported: setupSupported,
			};
		}

		const anyUser = await c.env.db.prepare(
			`SELECT 1 AS found FROM user LIMIT 1`
		).first();
		const schema = await this.inspectExistingSchema(c);

		if (!anyUser) {
			if (schema.current) {
				const installation = await c.env.db.prepare(
					'SELECT status FROM installation_state WHERE id = 1',
				).first();
				if (installation?.status === 'installed') {
					return {
						setupRequired: false,
						upgradeRequired: false,
						upgradeSupported: false,
					};
				}
			}
			const setupSupported = schema.upgradeSupported && !await this.hasUserOwnedData(c);
			return {
				setupRequired: true,
				upgradeRequired: false,
				upgradeSupported: setupSupported,
			};
		}

		return {
			setupRequired: false,
			upgradeRequired: !schema.current,
			upgradeBlocking: !schema.compatible,
			upgradeSupported: schema.upgradeSupported,
		};
	},

	async inspectExistingSchema(c) {
		let upgradeSupported = true;
		try {
			await this.preflightExistingDatabase(c);
			await this.preflightAdminIdentity(c);
			await this.preflightManagedDomainMigration(c);
			await this.preflightRuntimeConfigMigration(c);
		} catch (error) {
			if (!this.requiresManualRecovery(error)) {
				throw error;
			}
			upgradeSupported = false;
		}

		if (!upgradeSupported || !await this.hasTable(c, 'schema_migrations')) {
			return { current: false, compatible: false, upgradeSupported };
		}

		const applied = await Promise.all([
			this.v3_7Applied(c),
			this.v3_8Applied(c),
			this.v3_9Applied(c),
			this.v3_10Applied(c),
			this.v3_11Applied(c),
			this.v3_13Applied(c),
			this.v3_14Applied(c),
			this.v3_15Applied(c),
			this.v3_16Applied(c),
			this.v3_17Applied(c),
			this.v3_19Applied(c),
			this.v3_20Applied(c),
			this.v3_21Applied(c),
			this.v3_22Applied(c),
			this.v3_23Applied(c),
			this.v3_24Applied(c),
		]);

		return {
			current: applied.every(Boolean),
			// Validate every supported core migration, not just MAX(version).
			compatible: applied.slice(0, -2).every(Boolean)
				&& (applied.at(-2) || await isConfirmationUpgradePending(c))
				&& (applied.at(-1) || await isMailProviderUpgradePending(c)),
			upgradeSupported: true
		};
	},

	requiresManualRecovery(error) {
		const message = String(error?.message || '').toLowerCase();
		return message.includes('older than the supported safe-upgrade baseline')
			|| message.includes('email addresses because duplicates would collide')
			|| message.includes('administrator identity')
			|| message.includes('configured admin')
			|| message.includes('persisted administrator')
			|| message.includes('multiple persisted administrators')
			|| message.includes('exactly one setting row')
			|| message.includes('legacy managed domain')
			|| message.includes('existing managed domain')
			|| message.includes('legacy runtime configuration')
			|| message.includes('existing runtime configuration')
			|| message.includes('existing google');
	},

	async findApplicationTable(c) {
		const placeholders = APPLICATION_TABLES.map(() => '?').join(', ');
		return c.env.db.prepare(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'table' AND name IN (${placeholders})
			LIMIT 1
		`).bind(...APPLICATION_TABLES).first();
	},

	async hasUserOwnedData(c) {
		const placeholders = USER_OWNED_TABLES.map(() => '?').join(', ');
		const existing = await c.env.db.prepare(`
			SELECT name
			FROM sqlite_master
			WHERE type = 'table' AND name IN (${placeholders})
		`).bind(...USER_OWNED_TABLES).all();
		const tables = (existing.results || []).map(row => row.name);
		if (tables.length === 0) return false;
		const predicates = tables
			.map(table => `EXISTS(SELECT 1 FROM ${table} LIMIT 1)`)
			.join('\nOR ');
		const row = await c.env.db.prepare(`SELECT (${predicates}) AS found`).first();
		return Number(row?.found || 0) === 1;
	},

	async setup(c, params) {
		if (!params || typeof params !== 'object' || Array.isArray(params)
			|| Object.keys(params).length !== 4
			|| !['setupSession', 'email', 'password', 'domains'].every(key => Object.hasOwn(params, key))) {
			throw new BizError('Invalid setup request.');
		}
		await setupSessionService.require(c, params.setupSession);
		const domains = managedDomainService.normalizeInput(params.domains);
		const email = String(params.email || '').trim().toLowerCase();
		if (!verifyUtils.isEmail(email)) throw new BizError('Invalid administrator email.');
		if (!domains.includes(emailUtils.getDomain(email))) {
			throw new BizError('Administrator email must use a managed domain.');
		}
		const passwordError = cryptoUtils.passwordPolicyError(params.password);
		if (passwordError) throw new BizError(passwordError);
		const status = await this.setupStatus(c);
		if (!status.setupRequired) {
			throw new BizError('System setup has already been completed', 409);
		}
		if (!status.upgradeSupported) {
			throw new BizError('This database schema requires manual recovery before setup.', 409);
		}

		await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS installation_bootstrap (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					owner TEXT NOT NULL DEFAULT '',
					lease_expires_at INTEGER NOT NULL DEFAULT 0,
					started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
				)
			`).run();
		await c.env.db.prepare('INSERT OR IGNORE INTO installation_bootstrap(id) VALUES (1)').run();
		const owner = crypto.randomUUID();
		const now = Date.now();
		const claim = await c.env.db.prepare(`
			UPDATE installation_bootstrap
			SET owner = ?, lease_expires_at = ?
			WHERE id = 1 AND (owner = '' OR lease_expires_at <= ?)
			RETURNING owner
		`).bind(owner, now + 10 * 60_000, now).first();
		if (claim?.owner !== owner) throw new BizError('Setup is already in progress.', 409);
		try {
			await this.migrate(c);
			await setupSessionService.require(c, params.setupSession);
			const finalStatus = await this.setupStatus(c);
			if (!finalStatus.setupRequired || !finalStatus.upgradeSupported) {
				throw new BizError('System setup is no longer available in the current state.', 409);
			}
			await userService.createInitialAdmin(c, { email, password: params.password, domains });
		} catch (error) {
			await c.env.db.prepare(`
				UPDATE installation_bootstrap SET owner = '', lease_expires_at = 0 WHERE id = 1 AND owner = ?
			`).bind(owner).run().catch(() => {});
			const latest = await this.setupStatus(c);
			if (!latest.setupRequired) throw new BizError('System setup has already been completed', 409);
			throw error;
		}
		await c.env.db.prepare('DROP TABLE IF EXISTS installation_bootstrap').run();
		return { adminEmail: email };
	},

	async setupUpgrade(c) {
		const status = await this.setupStatus(c);
		if (status.setupRequired || !status.upgradeRequired) {
			throw new BizError('Database upgrade is not available in the current state.', 409);
		}
		if (!status.upgradeSupported) {
			try {
				await this.preflightManagedDomainMigration(c);
				await this.preflightRuntimeConfigMigration(c);
			} catch (error) {
				const message = String(error?.message || '');
				if (message.includes('FLAREMAIL_DOMAINS')
					|| message.toLowerCase().includes('runtime configuration')
					|| message.includes('Google')) {
					throw new BizError(error.message, 409);
				}
			}
			throw new BizError('This database schema is older than the supported safe-upgrade baseline.', 409);
		}

		await this.migrate(c);

		const completed = await this.setupStatus(c);
		if (completed.upgradeRequired) {
			throw new Error('Database upgrade did not produce a current schema');
		}
		return { upgraded: true };
	},

	async upgrade(c) {
		await this.migrate(c);
		return { upgraded: true };
	},

	async getSchemaInfo(c) {
		const hasMigrationTable = await this.hasTable(c, 'schema_migrations');
		let appliedRows = [];
		if (hasMigrationTable) {
			const rows = await c.env.db.prepare(
				'SELECT version, applied_time AS appliedTime FROM schema_migrations ORDER BY version DESC'
			).all();
			appliedRows = rows.results || [];
		}

		const appliedSet = new Set(appliedRows.map(r => Number(r.version)));
		const maxAppliedVersion = appliedRows.length > 0
			? Math.max(...appliedRows.map(r => Number(r.version)))
			: null;

		const currentMeta = maxAppliedVersion ? getPatchMeta(maxAppliedVersion) : null;
		const latestMeta = getPatchMeta(LATEST_SCHEMA_VERSION);

		const status = await this.setupStatus(c);

		const history = appliedRows.map(row => {
			const meta = getPatchMeta(row.version);
			return {
				version: Number(row.version),
				label: meta.label,
				descKey: meta.descKey,
				appliedTime: row.appliedTime,
			};
		});

		const pendingPatches = SCHEMA_PATCH_CATALOG
			.filter(p => !appliedSet.has(p.version))
			.map(p => ({
				version: p.version,
				label: p.label,
				descKey: p.descKey,
			}));

		return {
			currentVersion: currentMeta ? {
				id: currentMeta.version,
				label: currentMeta.label,
			} : null,
			latestVersion: {
				id: latestMeta.version,
				label: latestMeta.label,
			},
			upgradeRequired: status.upgradeRequired,
			upgradeBlocking: status.upgradeBlocking,
			upgradeSupported: status.upgradeSupported,
			pendingPatches,
			history,
		};
	}
};

export { dbInit };
