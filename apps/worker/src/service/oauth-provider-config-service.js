import BizError from '../error/biz-error';
import settingService from './setting-service';
import runtimeConfigService from './runtime-config-service';
import { readLimitedBytes } from '../utils/req-utils';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLIENTS = 32;
const MAX_REDIRECTS = 16;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const ALLOWED_CLIENT_KEYS = new Set(['clientId', 'displayName', 'enabled', 'redirects']);
const ALLOWED_REDIRECT_KEYS = new Set(['redirectUri', 'silentFrameAncestor']);

function hasOnlyKeys(value, allowed) {
	return Object.keys(value).every(key => allowed.has(key));
}

function validatedUrl(raw, field, { originOnly = false } = {}) {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > (originOnly ? 255 : 2048) || raw.includes('*')) {
		throw new BizError(`Invalid ${field}.`);
	}
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new BizError(`Invalid ${field}.`);
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
		throw new BizError(`Invalid ${field}.`);
	}
	if (url.protocol === 'http:' && url.hostname !== '127.0.0.1') {
		throw new BizError(`Invalid ${field}.`);
	}
	if (originOnly) {
		if (url.pathname !== '/' || url.search) throw new BizError(`Invalid ${field}.`);
		return url.origin;
	}
	return url.toString();
}

function normalizeRedirect(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !hasOnlyKeys(value, ALLOWED_REDIRECT_KEYS)) {
		throw new BizError('Invalid OAuth redirect.');
	}
	const redirectUri = validatedUrl(value.redirectUri, 'redirect URI');
	let silentFrameAncestor = value.silentFrameAncestor;
	if (silentFrameAncestor === undefined || silentFrameAncestor === null || silentFrameAncestor === '') {
		silentFrameAncestor = null;
	} else {
		silentFrameAncestor = validatedUrl(silentFrameAncestor, 'silent frame ancestor', { originOnly: true });
	}
	return { redirectUri, silentFrameAncestor };
}

function normalizeClients(value) {
	if (!Array.isArray(value) || value.length > MAX_CLIENTS) {
		throw new BizError('Invalid OAuth clients.');
	}
	const clientIds = new Set();
	return value.map(item => {
		if (!item || typeof item !== 'object' || Array.isArray(item) || !hasOnlyKeys(item, ALLOWED_CLIENT_KEYS)) {
			throw new BizError('Invalid OAuth client.');
		}
		if (typeof item.clientId !== 'string' || !CLIENT_ID_PATTERN.test(item.clientId) || clientIds.has(item.clientId)) {
			throw new BizError('Invalid or duplicate OAuth client ID.');
		}
		if (typeof item.displayName !== 'string') throw new BizError('Invalid OAuth client display name.');
		const displayName = item.displayName.trim();
		if (displayName.length < 1 || displayName.length > 80) throw new BizError('Invalid OAuth client display name.');
		if (typeof item.enabled !== 'boolean') throw new BizError('Invalid OAuth client enabled state.');
		if (!Array.isArray(item.redirects) || item.redirects.length < 1 || item.redirects.length > MAX_REDIRECTS) {
			throw new BizError('Invalid OAuth client redirects.');
		}
		const redirects = item.redirects.map(normalizeRedirect);
		const redirectUris = new Set(redirects.map(redirect => redirect.redirectUri));
		if (redirectUris.size !== redirects.length) throw new BizError('Duplicate OAuth redirect URI.');
		clientIds.add(item.clientId);
		return { clientId: item.clientId, displayName, enabled: item.enabled, redirects };
	});
}

async function deployment(c) {
	const runtime = await runtimeConfigService.private(c);
	const issuer = runtime.oauth.issuer || null;
	const secret = runtime.oauth.secret;
	return {
		issuer,
		secret,
		issuerReady: !!issuer,
		secretReady: secret.length > 0,
	};
}

async function readRow(c) {
	const rows = await c.env.db.prepare(`
		SELECT oauth_provider_enabled AS enabled,
			oauth_provider_revision AS revision,
			oauth_provider_clients AS clientsJson
		FROM setting
		LIMIT 2
	`).all();
	if (rows.results?.length !== 1) {
		throw new BizError('OAuth provider configuration requires exactly one setting row.', 409);
	}
	const row = rows.results[0];
	if (![0, 1].includes(Number(row.enabled)) || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 0) {
		throw new BizError('OAuth provider configuration is invalid.', 500);
	}
	let clients;
	try {
		clients = normalizeClients(JSON.parse(row.clientsJson));
	} catch {
		throw new BizError('OAuth provider configuration is invalid.', 500);
	}
	return {
		enabled: Number(row.enabled) === 1,
		revision: Number(row.revision),
		clients,
	};
}

async function refreshSettingCache(c) {
	try {
		await settingService.refresh(c);
	} catch {
		console.warn('OAuth provider settings were saved but the general setting cache could not be refreshed.');
	}
}

async function casResult(c, statement) {
	const result = await statement.run();
	if (Number(result.meta?.changes || 0) !== 1) {
		throw new BizError('OAuth provider configuration changed; reload and try again.', 409);
	}
	await refreshSettingCache(c);
	return oauthProviderConfigService.get(c);
}

function validRevision(value) {
	return Number.isSafeInteger(value) && value >= 0;
}

export async function readLimitedJsonObject(c) {
	const bytes = await readLimitedBytes(c, MAX_BODY_BYTES, 'OAuth provider request body is too large.');
	let value;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new BizError('Invalid OAuth provider request body.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new BizError('Invalid OAuth provider request body.');
	}
	return value;
}

export function requireSameOrigin(c) {
	const origin = c.req.header('Origin');
	if (!origin || origin !== new URL(c.req.url).origin) {
		throw new BizError('Same-origin request required.', 403);
	}
}

export function requireSameOriginRead(c) {
	const origin = c.req.header('Origin');
	const fetchSite = String(c.req.header('Sec-Fetch-Site') || '').toLowerCase();
	if ((origin && origin !== new URL(c.req.url).origin)
		|| (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
		throw new BizError('Same-origin request required.', 403);
	}
}

const oauthProviderConfigService = {
	normalizeClients,
	deployment,

	async read(c) {
		return readRow(c);
	},

	async get(c) {
		const state = await readRow(c);
		const runtime = await deployment(c);
		return {
			...state,
			issuerReady: runtime.issuerReady,
			secretReady: runtime.secretReady,
		};
	},

	resolveClient(state, clientId, redirectUri) {
		const client = state.clients.find(item => item.enabled && item.clientId === clientId);
		if (!client) return null;
		const redirect = client.redirects.find(item => item.redirectUri === redirectUri);
		return redirect ? { client, redirect } : null;
	},

	async setEnabled(c, body) {
		if (!hasOnlyKeys(body, new Set(['enabled', 'revision']))
			|| typeof body.enabled !== 'boolean' || !validRevision(body.revision)) {
			throw new BizError('Invalid OAuth provider enabled request.');
		}
		const current = await readRow(c);
		if (current.revision !== body.revision) {
			throw new BizError('OAuth provider configuration changed; reload and try again.', 409);
		}
		if (body.enabled) {
			const runtime = await deployment(c);
			if (!runtime.issuerReady || !runtime.secretReady || !current.clients.some(client => client.enabled)) {
				throw new BizError('OAuth provider is not ready to enable.');
			}
		}
		return casResult(c, c.env.db.prepare(`
			UPDATE setting
			SET oauth_provider_enabled = ?, oauth_provider_revision = oauth_provider_revision + 1
			WHERE oauth_provider_revision = ?
				AND (? = 0 OR EXISTS (
					SELECT 1 FROM runtime_config
					WHERE id = 1 AND oauth_issuer <> '' AND oauth_secret <> ''
				))
		`).bind(body.enabled ? 1 : 0, body.revision, body.enabled ? 1 : 0));
	},

	async setClients(c, body) {
		if (!hasOnlyKeys(body, new Set(['revision', 'clients'])) || !validRevision(body.revision)) {
			throw new BizError('Invalid OAuth provider clients request.');
		}
		const clients = normalizeClients(body.clients);
		const current = await readRow(c);
		if (current.revision !== body.revision) {
			throw new BizError('OAuth provider configuration changed; reload and try again.', 409);
		}
		if (current.enabled && !clients.some(client => client.enabled)) {
			throw new BizError('An enabled OAuth provider requires at least one enabled client.');
		}
		return casResult(c, c.env.db.prepare(`
			UPDATE setting
			SET oauth_provider_clients = ?, oauth_provider_revision = oauth_provider_revision + 1
			WHERE oauth_provider_revision = ?
		`).bind(JSON.stringify(clients), body.revision));
	},
};

export default oauthProviderConfigService;
