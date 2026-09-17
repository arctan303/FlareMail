import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

// Only the untouched 322 -> 323 transition is optional for login. A missing
// table with an applied marker is corruption and must never become a default policy.
export async function isConfirmationUpgradePending(c) {
	const tables = await c.env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('admin_confirmation', 'schema_migrations')").all();
	const names = tables.results.map(row => row.name);
	if (names.includes('admin_confirmation') || !names.includes('schema_migrations')) return false;
	return !await c.env.db.prepare('SELECT version FROM schema_migrations WHERE version = 323').first();
}

export class ConfirmationUpgradeRequired extends BizError {
	constructor() { super(t('confirmationUpgradeRequired'), 503); }
}

export const DEFAULT_CONFIRMATION_MINUTES = 1440;
// A confirmation cannot outlive the seven-day login session.
export const MAX_CONFIRMATION_MINUTES = 10080;

export function normalizeConfirmation(row) {
	if (!row || ![0, 1].includes(row.enabled)
		|| !Number.isSafeInteger(row.revision) || row.revision < 0
		|| !Number.isInteger(row.windowMinutes) || row.windowMinutes < 1
		|| row.windowMinutes > MAX_CONFIRMATION_MINUTES) {
		throw new BizError('Settings confirmation policy is invalid.', 503);
	}
	return { enabled: row.enabled === 1, windowMinutes: row.windowMinutes, revision: row.revision };
}

// Keep the existing singleton table so upgrades preserve the saved policy.
const confirmationPolicyService = {
	async read(c) {
		let row;
		try {
			row = await c.env.db.prepare('SELECT enabled, window_minutes AS windowMinutes, revision FROM admin_confirmation WHERE id = 1').first();
		} catch (error) {
			if (String(error.message).includes('no such table: admin_confirmation') && await isConfirmationUpgradePending(c)) {
				throw new ConfirmationUpgradeRequired();
			}
			throw error;
		}
		return normalizeConfirmation(row);
	},

	async update(c, body) {
		if (!body || typeof body !== 'object' || Array.isArray(body)
			|| Object.keys(body).length !== 3
			|| typeof body.enabled !== 'boolean'
			|| !Number.isInteger(body.windowMinutes) || body.windowMinutes < 1
			|| body.windowMinutes > MAX_CONFIRMATION_MINUTES
			|| !Number.isSafeInteger(body.revision) || body.revision < 0) {
			throw new BizError('Provide an enabled switch and a whole number of minutes from 1 to 10080.');
		}
		const result = await c.env.db.prepare(`
			UPDATE admin_confirmation SET enabled = ?, window_minutes = ?, revision = revision + 1
			WHERE id = 1 AND revision = ?
		`).bind(body.enabled ? 1 : 0, body.windowMinutes, body.revision).run();
		if (Number(result.meta?.changes) !== 1) {
			throw new BizError('Confirmation settings changed; reload and try again.', 409);
		}
		return this.read(c);
	},
};

export default confirmationPolicyService;
