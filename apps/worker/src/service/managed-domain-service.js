import BizError from '../error/biz-error';
import { managedDomains } from '../utils/managed-domain-utils';

function normalizeInput(value) {
	if (!Array.isArray(value) || value.length === 0) {
		throw new BizError('At least one managed domain is required.');
	}
	if (value.some(domain => typeof domain !== 'string' || !domain.trim() || domain.includes('@'))) {
		throw new BizError('Managed domains must be domain names without @.');
	}
	let domains;
	try {
		domains = managedDomains(value);
	} catch {
		throw new BizError('Invalid managed domain.');
	}
	if (domains.length !== value.length) throw new BizError('Managed domains must be unique.');
	return domains;
}

const managedDomainService = {
	normalizeInput,

	async get(c) {
		let state;
		try {
			state = await c.env.db.prepare(
				'SELECT revision, status FROM installation_state WHERE id = 1',
			).first();
		} catch (error) {
			if (/no such table/i.test(String(error?.message || ''))) {
				throw new BizError('Database upgrade required before reading managed domains.', 503);
			}
			throw error;
		}
		if (!state || state.status !== 'installed') {
			throw new BizError('System setup has not been completed.', 503);
		}
		const rows = await c.env.db.prepare(
			'SELECT domain FROM managed_domain ORDER BY domain',
		).all();
		return {
			domains: (rows.results || []).map(row => row.domain),
			revision: Number(state.revision),
		};
	},

	async suffixes(c) {
		return (await this.get(c)).domains.map(domain => `@${domain}`);
	},

	async containsEmail(c, email) {
		const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
		return (await this.get(c)).domains.includes(domain);
	},

	async add(c, params) {
		if (!params || typeof params !== 'object' || Array.isArray(params)
			|| Object.keys(params).some(key => !['domains', 'revision'].includes(key))) {
			throw new BizError('Invalid managed domain request.');
		}
		const domains = normalizeInput(params.domains);
		const revision = params.revision;
		if (!Number.isInteger(revision) || revision < 0) throw new BizError('Invalid managed domain revision.');

		const current = await this.get(c);
		if (current.revision !== revision) throw new BizError('Managed domains changed; reload and try again.', 409);
		if (domains.some(domain => current.domains.includes(domain))) {
			throw new BizError('A managed domain is already configured.', 409);
		}

		try {
			await c.env.db.batch([
				c.env.db.prepare('DELETE FROM installation_guard'),
				c.env.db.prepare(`
					INSERT INTO installation_guard(valid)
					SELECT CASE WHEN EXISTS (
						SELECT 1 FROM installation_state
						WHERE id = 1 AND status = 'installed' AND revision = ?
					) THEN 1 ELSE 0 END
				`).bind(revision),
				...domains.map(domain => c.env.db.prepare(
					'INSERT INTO managed_domain(domain) VALUES (?)',
				).bind(domain)),
				c.env.db.prepare(`
					UPDATE installation_state
					SET revision = revision + 1, update_time = CURRENT_TIMESTAMP
					WHERE id = 1 AND status = 'installed' AND revision = ?
				`).bind(revision),
				c.env.db.prepare('DELETE FROM installation_guard'),
			]);
		} catch (error) {
			const latest = await this.get(c);
			if (latest.revision !== revision) throw new BizError('Managed domains changed; reload and try again.', 409);
			if (domains.some(domain => latest.domains.includes(domain))) {
				throw new BizError('A managed domain is already configured.', 409);
			}
			throw error;
		}
		return this.get(c);
	},
};

export default managedDomainService;
