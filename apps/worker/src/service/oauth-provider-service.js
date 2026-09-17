import BizError from '../error/biz-error';
import cryptoUtils from '../utils/crypto-utils';
import sessionService from './session-service';
import userService from './user-service';
import accountService from './account-service';
import securityService from './security-service';
import oauthProviderConfigService from './oauth-provider-config-service';
import { isDel, userConst } from '../const/entity-const';
import { isAdmin } from '../security/admin-identity';

const CODE_TTL_MS = 90 * 1000;
const TOKEN_TTL_SECONDS = 5 * 60;
const TOKEN_PREFIX = 'oauth:provider:token:';

function randomToken() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return cryptoUtils.toBase64Url(bytes);
}

async function issuer(c) {
	return (await oauthProviderConfigService.deployment(c)).issuer || '';
}

function userRole(user) {
	return isAdmin(user) ? 'admin' : 'member';
}

async function secretsEqual(left, right) {
	if (!left || !right) return false;
	const [leftHash, rightHash] = await Promise.all([
		cryptoUtils.hashSecret(left),
		cryptoUtils.hashSecret(right),
	]);
	if (leftHash.length !== rightHash.length) return false;
	let difference = 0;
	for (let index = 0; index < leftHash.length; index++) {
		difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
	}
	return difference === 0;
}

function appendError(redirectUri, error, state) {
	const target = new URL(redirectUri);
	target.searchParams.set('error', error);
	if (state) target.searchParams.set('state', state);
	return target.toString();
}

async function activeOAuthUser(c) {
	const session = await sessionService.resolveOAuth(c);
	if (!session) return null;
	const user = await userService.selectByIdIncludeDel(c, session.userId);
	if (!user || user.isDel !== isDel.NORMAL || user.status === userConst.status.BAN) return null;
	if (session.credentialFingerprint !== await cryptoUtils.hashSecret(user.password)) return null;
	if (!sessionService.getOAuthRawToken(c)) sessionService.promoteCurrentToOAuth(c);
	return user;
}

async function readForm(c, maxBytes = 16 * 1024) {
	const contentType = String(c.req.header('Content-Type') || '').toLowerCase();
	const bytes = await c.req.arrayBuffer();
	if (bytes.byteLength > maxBytes) throw new BizError('invalid_request', 400);
	const text = new TextDecoder().decode(bytes);

	if (contentType.includes('application/json') || text.trim().startsWith('{')) {
		try {
			const json = JSON.parse(text);
			const params = new URLSearchParams();
			if (json && typeof json === 'object') {
				for (const [key, value] of Object.entries(json)) {
					if (value !== undefined && value !== null) params.set(key, String(value));
				}
			}
			return params;
		} catch {
			throw new BizError('invalid_request', 400);
		}
	}

	return new URLSearchParams(text);
}

function oauthJson(c, body, status = 200, headers = {}) {
	c.header('Cache-Control', 'no-store');
	c.header('Pragma', 'no-cache');
	for (const [name, value] of Object.entries(headers)) c.header(name, value);
	return c.json(body, status);
}

function oauthRedirect(c, location) {
	c.header('Cache-Control', 'no-store');
	c.header('Pragma', 'no-cache');
	return c.redirect(location);
}

function allowSilentAuthorizationFrame(c, redirect) {
	if (c.req.query('prompt') !== 'none') return;
	if (redirect.silentFrameAncestor) c.header('X-OAuth-Silent-Frame-Ancestor', redirect.silentFrameAncestor);
}

async function trustState(c) {
	try {
		return await oauthProviderConfigService.read(c);
	} catch {
		return null;
	}
}

const oauthProviderService = {
	issuer,

	async authorize(c) {
		await securityService.rateLimit(c, 'OAUTH_AUTHORIZE_RATE_LIMITER', 'oauth_provider_authorize', 60);
		const stateConfig = await trustState(c);
		if (!stateConfig) return oauthJson(c, { error: 'provider_not_ready' }, 503);
		if (!stateConfig.enabled) return oauthJson(c, { error: 'authorization_disabled' }, 403);
		const runtime = await oauthProviderConfigService.deployment(c);
		if (!runtime.issuerReady || !runtime.secretReady) return oauthJson(c, { error: 'provider_not_ready' }, 503);

		const clientId = c.req.query('client_id') || '';
		const redirectUri = c.req.query('redirect_uri') || '';
		const state = c.req.query('state') || '';
		const challenge = c.req.query('code_challenge') || '';
		const resolved = oauthProviderConfigService.resolveClient(stateConfig, clientId, redirectUri);
		if (!resolved) return oauthJson(c, { error: 'invalid_client_or_redirect' }, 400);
		allowSilentAuthorizationFrame(c, resolved.redirect);
		if (
			c.req.query('response_type') !== 'code'
			|| c.req.query('code_challenge_method') !== 'S256'
			|| !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)
			|| !state
			|| state.length > 512
			|| !['', 'email'].includes(c.req.query('scope') || '')
		) {
			return oauthRedirect(c, appendError(redirectUri, 'invalid_request', state));
		}

		const user = await activeOAuthUser(c);
		if (!user) {
			if (c.req.query('prompt') === 'none') return oauthRedirect(c, appendError(redirectUri, 'login_required', state));
			const returnTo = `${c.req.path}?${new URL(c.req.url).searchParams.toString()}`;
			return oauthRedirect(c, `/login?redirect=${encodeURIComponent(returnTo)}`);
		}

		const code = randomToken();
		const now = Date.now();
		await c.env.db.prepare(`DELETE FROM oauth_authorization_code WHERE expires_at < ? OR used_at IS NOT NULL`).bind(now).run();
		await c.env.db.prepare(`
			INSERT INTO oauth_authorization_code(code_hash, client_id, redirect_uri, user_id, code_challenge, created_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`).bind(await cryptoUtils.hashSecret(code), clientId, redirectUri, user.userId, challenge, now, now + CODE_TTL_MS).run();

		const target = new URL(redirectUri);
		target.searchParams.set('code', code);
		target.searchParams.set('state', state);
		return oauthRedirect(c, target.toString());
	},

	async token(c) {
		await securityService.rateLimit(c, 'OAUTH_TOKEN_RATE_LIMITER', 'oauth_provider_token', 60);
		const form = await readForm(c);
		const clientId = form.get('client_id') || '';
		const redirectUri = form.get('redirect_uri') || '';
		const stateConfig = await trustState(c);
		const runtime = await oauthProviderConfigService.deployment(c);
		const resolved = stateConfig && oauthProviderConfigService.resolveClient(stateConfig, clientId, redirectUri);
		if (!resolved || !runtime.secretReady || !await secretsEqual(form.get('client_secret') || '', runtime.secret)) {
			return oauthJson(c, { error: 'invalid_client' }, 401);
		}
		const code = form.get('code') || '';
		const verifier = form.get('code_verifier') || '';
		if (form.get('grant_type') !== 'authorization_code' || !/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) {
			return oauthJson(c, { error: 'invalid_request' }, 400);
		}

		const codeHash = await cryptoUtils.hashSecret(code);
		const row = await c.env.db.prepare(`
			SELECT code_hash, client_id, redirect_uri, user_id, code_challenge
			FROM oauth_authorization_code
			WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND used_at IS NULL AND expires_at > ?
		`).bind(codeHash, clientId, redirectUri, Date.now()).first();
		if (!row || !await secretsEqual(await cryptoUtils.hashSecret(verifier), row.code_challenge)) {
			return oauthJson(c, { error: 'invalid_grant' }, 400);
		}
		const consumed = await c.env.db.prepare(`UPDATE oauth_authorization_code SET used_at = ? WHERE code_hash = ? AND used_at IS NULL`)
			.bind(Date.now(), codeHash).run();
		if (Number(consumed.meta?.changes || 0) !== 1) return oauthJson(c, { error: 'invalid_grant' }, 400);

		const user = await userService.selectByIdIncludeDel(c, Number(row.user_id));
		if (!user || user.isDel !== isDel.NORMAL || user.status === userConst.status.BAN) {
			return oauthJson(c, { error: 'invalid_grant' }, 400);
		}
		const accessToken = randomToken();
		await c.env.kv.put(`${TOKEN_PREFIX}${await cryptoUtils.hashSecret(accessToken)}`, JSON.stringify({
			clientId,
			userId: user.userId,
			credentialFingerprint: await cryptoUtils.hashSecret(user.password),
		}), { expirationTtl: TOKEN_TTL_SECONDS });
		return oauthJson(c, {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: TOKEN_TTL_SECONDS,
			scope: 'email',
		});
	},

	async userinfo(c) {
		await securityService.rateLimit(c, 'OAUTH_USERINFO_RATE_LIMITER', 'oauth_provider_userinfo', 120);
		const token = String(c.req.header('Authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{43})$/i)?.[1];
		if (!token) return oauthJson(c, { error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'Bearer' });
		const record = await c.env.kv.get(`${TOKEN_PREFIX}${await cryptoUtils.hashSecret(token)}`, { type: 'json' });
		if (!record?.userId || !record?.clientId || !record?.credentialFingerprint) return oauthJson(c, { error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'Bearer' });
		const user = await userService.selectByIdIncludeDel(c, Number(record.userId));
		if (
			!user
			|| user.isDel !== isDel.NORMAL
			|| user.status === userConst.status.BAN
			|| record.credentialFingerprint !== await cryptoUtils.hashSecret(user.password)
		) {
			return oauthJson(c, { error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'Bearer' });
		}
		const account = await accountService.selectByEmailIncludeDel(c, user.email);
		return oauthJson(c, {
			sub: String(user.userId),
			email: user.email.toLowerCase(),
			email_verified: true,
			name: account?.name || '',
			role: userRole(user),
		});
	},

	async metadata(c) {
		const runtime = await oauthProviderConfigService.deployment(c);
		const stateConfig = await trustState(c);
		const readiness = {
			provider_enabled: stateConfig?.enabled === true,
			issuer_ready: runtime.issuerReady,
			secret_ready: runtime.secretReady,
			configuration_ready: !!stateConfig,
		};
		if (!runtime.issuerReady) return oauthJson(c, readiness);
		const base = runtime.issuer;
		return oauthJson(c, {
			issuer: base,
			authorization_endpoint: `${base}/oauth/authorize`,
			token_endpoint: `${base}/oauth/token`,
			userinfo_endpoint: `${base}/oauth/userinfo`,
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code'],
			code_challenge_methods_supported: ['S256'],
			scopes_supported: ['email'],
			token_endpoint_auth_methods_supported: ['client_secret_post'],
			...readiness,
		});
	},

	async cleanupExpiredCodes(c) {
		try {
			const now = Date.now();
			await c.env.db.prepare(`DELETE FROM oauth_authorization_code WHERE expires_at < ? OR used_at IS NOT NULL`).bind(now).run();
		} catch (e) {
			console.error('Failed to cleanup expired oauth codes:', e);
		}
	},
};

export default oauthProviderService;
