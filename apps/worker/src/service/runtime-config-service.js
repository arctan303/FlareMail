import BizError from '../error/biz-error';
import cryptoUtils from '../utils/crypto-utils';

const MAX_ORIGINS = 32;
const MAX_SECRET_LENGTH = 512;

function validOrigin(value, { issuer = false } = {}) {
	if (typeof value !== 'string' || !value || value.length > 255 || value.includes('*')) {
		throw new BizError(issuer ? 'Invalid OAuth issuer.' : 'Invalid origin.');
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new BizError(issuer ? 'Invalid OAuth issuer.' : 'Invalid origin.');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
		|| url.pathname !== '/' || url.search || url.hash) {
		throw new BizError(issuer ? 'Invalid OAuth issuer.' : 'Invalid origin.');
	}
	if (issuer && url.protocol !== 'https:' && url.hostname !== '127.0.0.1') {
		throw new BizError('Invalid OAuth issuer.');
	}
	return url.origin;
}

export function normalizeAllowedOrigins(value) {
	if (!Array.isArray(value) || value.length > MAX_ORIGINS) {
		throw new BizError('Invalid allowed origins.');
	}
	const result = value.map(origin => validOrigin(origin));
	if (new Set(result).size !== result.length) throw new BizError('Duplicate allowed origin.');
	return result.sort();
}

export function normalizeIssuer(value) {
	if (value === '') return '';
	return validOrigin(value, { issuer: true });
}

export function normalizeRuntimeSecret(value, field, { allowEmpty = true } = {}) {
	if (value === '' && allowEmpty) return '';
	if (typeof value !== 'string' || !value || value.length > MAX_SECRET_LENGTH || /\s/.test(value)) {
		throw new BizError(`Invalid ${field} secret.`);
	}
	return value;
}

export function normalizeTurnstileSiteKey(value) {
	if (value === '') return '';
	if (typeof value !== 'string' || value.length > 255 || /\s/.test(value)) {
		throw new BizError('Invalid Turnstile site key.');
	}
	return value;
}

export function normalizeStoredRuntimeRow(row) {
	if (!row || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 0) {
		throw new BizError('Runtime configuration is invalid.', 500);
	}
	let allowedOrigins;
	let turnstileSiteKey;
	let turnstileSecret;
	let oauthIssuer;
	let oauthSecret;
	try {
		allowedOrigins = normalizeAllowedOrigins(JSON.parse(row.allowedOrigins));
		turnstileSiteKey = normalizeTurnstileSiteKey(row.turnstileSiteKey || '');
		turnstileSecret = normalizeRuntimeSecret(row.turnstileSecret || '', 'Turnstile');
		oauthIssuer = normalizeIssuer(row.oauthIssuer || '');
		oauthSecret = normalizeRuntimeSecret(row.oauthSecret || '', 'OAuth');
	} catch {
		throw new BizError('Runtime configuration is invalid.', 500);
	}
	if (!!turnstileSiteKey !== !!turnstileSecret || !!oauthIssuer !== !!oauthSecret) {
		throw new BizError('Runtime configuration is invalid.', 500);
	}
	return {
		revision: Number(row.revision),
		allowedOrigins,
		turnstile: { siteKey: turnstileSiteKey, secret: turnstileSecret },
		oauth: { issuer: oauthIssuer, secret: oauthSecret },
	};
}

async function read(c) {
	let row;
	try {
		row = await c.env.db.prepare(`
			SELECT revision, allowed_origins AS allowedOrigins,
				turnstile_site_key AS turnstileSiteKey, turnstile_secret AS turnstileSecret,
				oauth_issuer AS oauthIssuer, oauth_secret AS oauthSecret
			FROM runtime_config WHERE id = 1
		`).first();
	} catch (error) {
		if (/no such table/i.test(String(error?.message || ''))) {
			throw new BizError('Runtime configuration is unavailable.', 503);
		}
		throw error;
	}
	if (!row) throw new BizError('Runtime configuration is unavailable.', 503);
	return normalizeStoredRuntimeRow(row);
}

function publicValue(row) {
	return {
		revision: row.revision,
		allowedOrigins: row.allowedOrigins,
		turnstile: { siteKey: row.turnstile.siteKey, secretConfigured: !!row.turnstile.secret },
		oauth: { issuer: row.oauth.issuer, secretConfigured: !!row.oauth.secret },
	};
}

function requireSection(section, name, primaryKey) {
	if (!section || typeof section !== 'object' || Array.isArray(section)) {
		throw new BizError(`Invalid ${name} configuration.`);
	}
	const allowed = new Set([primaryKey, 'secretAction', 'secret']);
	if (Object.keys(section).some(key => !allowed.has(key))
		|| !Object.hasOwn(section, primaryKey)
		|| !['keep', 'replace', 'clear'].includes(section.secretAction)) {
		throw new BizError(`Invalid ${name} configuration.`);
	}
}

function applySecret(section, current, field) {
	if (section.secretAction === 'keep') {
		if (Object.hasOwn(section, 'secret')) throw new BizError(`Invalid ${field} secret action.`);
		return current;
	}
	if (section.secretAction === 'clear') {
		if (Object.hasOwn(section, 'secret') && section.secret !== '') {
			throw new BizError(`Invalid ${field} secret action.`);
		}
		return '';
	}
	return normalizeRuntimeSecret(section.secret, field, { allowEmpty: false });
}

const runtimeConfigService = {
	read,
	async private(c) {
		return read(c);
	},
	async get(c) {
		return publicValue(await read(c));
	},

	async update(c, body) {
		if (!body || typeof body !== 'object' || Array.isArray(body)
			|| !Number.isSafeInteger(body.revision) || body.revision < 0) {
			throw new BizError('Invalid runtime configuration request.');
		}
		const keys = Object.keys(body);
		if (keys.some(key => !['revision', 'allowedOrigins', 'turnstile', 'oauth'].includes(key))
			|| keys.length < 2) {
			throw new BizError('Invalid runtime configuration request.');
		}
		const current = await read(c);
		if (current.revision !== body.revision) {
			throw new BizError('Runtime configuration changed; reload and try again.', 409);
		}
		const next = structuredClone(current);
		if (Object.hasOwn(body, 'allowedOrigins')) {
			next.allowedOrigins = normalizeAllowedOrigins(body.allowedOrigins);
		}
		if (Object.hasOwn(body, 'turnstile')) {
			requireSection(body.turnstile, 'Turnstile', 'siteKey');
			next.turnstile.siteKey = normalizeTurnstileSiteKey(body.turnstile.siteKey);
			next.turnstile.secret = applySecret(body.turnstile, current.turnstile.secret, 'Turnstile');
			if (!!next.turnstile.siteKey !== !!next.turnstile.secret) {
				throw new BizError('Turnstile site key and secret must be configured together.');
			}
		}
		if (Object.hasOwn(body, 'oauth')) {
			requireSection(body.oauth, 'OAuth', 'issuer');
			next.oauth.issuer = normalizeIssuer(body.oauth.issuer);
			next.oauth.secret = applySecret(body.oauth, current.oauth.secret, 'OAuth');
			if (!!next.oauth.issuer !== !!next.oauth.secret) {
				throw new BizError('OAuth issuer and secret must be configured together.');
			}
			if (!next.oauth.secret) {
				const provider = await c.env.db.prepare('SELECT oauth_provider_enabled AS enabled FROM setting').first();
				if (Number(provider?.enabled) === 1) {
					throw new BizError('Disable OAuth authorization before clearing its runtime credentials.', 409);
				}
			}
		}
		const saved = await c.env.db.prepare(`
			UPDATE runtime_config SET allowed_origins = ?,
				turnstile_site_key = ?, turnstile_secret = ?, oauth_issuer = ?, oauth_secret = ?,
				revision = revision + 1, update_time = CURRENT_TIMESTAMP
			WHERE id = 1 AND revision = ?
				AND (? <> '' OR NOT EXISTS (
					SELECT 1 FROM setting WHERE oauth_provider_enabled = 1
				))
		`).bind(
			JSON.stringify(next.allowedOrigins),
			next.turnstile.siteKey,
			next.turnstile.secret,
			next.oauth.issuer,
			next.oauth.secret,
			body.revision,
			next.oauth.secret,
		).run();
		if (Number(saved.meta?.changes || 0) !== 1) {
			throw new BizError('Runtime configuration changed; reload and try again.', 409);
		}
		return this.get(c);
	},

	async revealOauthSecret(c, password) {
		if (typeof password !== 'string' || !password || password.length > 256) {
			throw new BizError('Invalid administrator password.', 403);
		}
		const user = c.get('user');
		if (!user || !await cryptoUtils.verifyPassword(password, user.salt, user.password)) {
			throw new BizError('Invalid administrator password.', 403);
		}
		return { secret: (await read(c)).oauth.secret };
	},
};

export default runtimeConfigService;
