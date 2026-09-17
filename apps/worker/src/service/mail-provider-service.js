import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

export function hasCloudflareEmail(c) {
	return typeof c.env.email?.send === 'function';
}

export async function isMailProviderUpgradePending(c) {
	const table = await c.env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mail_provider_config'").first();
	if (table) return false;
	const marker = await c.env.db.prepare('SELECT version FROM schema_migrations WHERE version = 324').first();
	return !marker;
}

export function normalizeMailProvider(row) {
	if (!row || !['resend', 'cloudflare'].includes(row.provider)) {
		throw new BizError(t('mailProviderInvalid'), 503);
	}
	return row.provider;
}

const mailProviderService = {
	async read(c) {
		try {
			const row = await c.env.db.prepare('SELECT provider FROM mail_provider_config WHERE id = 1').first();
			return { mailProvider: normalizeMailProvider(row), mailProviderUpgradeRequired: false };
		} catch (error) {
			if (/no such table: mail_provider_config/i.test(String(error?.message || '')) && await isMailProviderUpgradePending(c)) {
				// Preserve the installed instance's routing until its administrator upgrades.
				return { mailProvider: hasCloudflareEmail(c) ? 'cloudflare' : 'resend', mailProviderUpgradeRequired: true };
			}
			throw error;
		}
	},
	async prepareUpdate(c, provider) {
		normalizeMailProvider({ provider });
		if ((await this.read(c)).mailProviderUpgradeRequired) throw new BizError(t('mailProviderUpgradeRequired'), 503);
		if (provider === 'cloudflare' && !hasCloudflareEmail(c)) throw new BizError(t('cloudflareEmailNotBound'), 503);
		return c.env.db.prepare('UPDATE mail_provider_config SET provider = ? WHERE id = 1').bind(provider);
	},
};

export default mailProviderService;
