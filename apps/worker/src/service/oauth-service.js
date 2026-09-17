import BizError from '../error/biz-error';
import { isAdmin } from '../security/admin-identity';
import KvConst from '../const/kv-const';
import cryptoUtils from '../utils/crypto-utils';
import userService from './user-service';
import sessionService from './session-service';
import settingService from './setting-service';
import { userConst } from '../const/entity-const';
import { getCookie, setCookie } from 'hono/cookie';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const STATE_TTL_SECONDS = 600;
const PROD_TRANSACTION_COOKIE = '__Host-mail_oauth_transaction';
const DEV_TRANSACTION_COOKIE = 'mail_oauth_transaction_dev';

let jwksCache = null;
let jwksCacheAt = 0;

function isHttps(c) {
	return new URL(c.req.url).protocol === 'https:';
}

function transactionCookieName(c) {
	return isHttps(c) ? PROD_TRANSACTION_COOKIE : DEV_TRANSACTION_COOKIE;
}

function randomSecret() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return cryptoUtils.toBase64Url(bytes);
}

function constantTimeEqual(left, right) {
	if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
}

function base64UrlToBytes(value) {
	const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
	return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function getGoogleJwks(forceRefresh = false) {
	const now = Date.now();
	if (!forceRefresh && jwksCache && now - jwksCacheAt < 3600_000) {
		return jwksCache;
	}
	const response = await fetch(GOOGLE_JWKS_ENDPOINT);
	if (!response.ok) {
		throw new BizError('Failed to fetch Google signing keys', 502);
	}
	jwksCache = await response.json();
	jwksCacheAt = now;
	return jwksCache;
}

async function exchangeCode(code, clientId, clientSecret, redirectUri) {
	const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: redirectUri,
		}),
	});
	if (!response.ok) {
		throw new BizError('OAuth authorization failed', 502);
	}
	const data = await response.json();
	if (!data.id_token) {
		throw new BizError('OAuth authorization failed', 502);
	}
	return data.id_token;
}

async function verifyIdToken(idToken, clientId, nonce) {
	const parts = String(idToken).split('.');
	if (parts.length !== 3) {
		throw new BizError('OAuth authorization failed', 400);
	}
	const [headerB64, payloadB64, signatureB64] = parts;

	let header;
	let payload;
	try {
		header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
		payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
	} catch {
		throw new BizError('OAuth authorization failed', 400);
	}

	if (header.alg !== 'RS256') {
		throw new BizError('OAuth authorization failed', 400);
	}
	if (!Number.isInteger(payload.exp) || payload.exp * 1000 < Date.now()) {
		throw new BizError('OAuth authorization expired', 400);
	}
	if (!Number.isInteger(payload.iat) || payload.iat > Math.floor(Date.now() / 1000) + 60) {
		throw new BizError('OAuth authorization failed', 400);
	}
	if (!GOOGLE_ISSUERS.includes(payload.iss)) {
		throw new BizError('OAuth authorization failed', 400);
	}
	if (payload.aud !== clientId) {
		throw new BizError('OAuth authorization failed', 400);
	}
	if (payload.nonce !== nonce) {
		throw new BizError('OAuth authorization failed', 400);
	}
	if (payload.email && payload.email_verified !== true) {
		throw new BizError('OAuth email not verified', 400);
	}

	let jwks = await getGoogleJwks();
	let jwk = (jwks.keys || []).find(item => item.kid === header.kid);
	if (!jwk) {
		// Key rotation fallback: force refresh JWKS once
		jwks = await getGoogleJwks(true);
		jwk = (jwks.keys || []).find(item => item.kid === header.kid);
	}
	if (!jwk) {
		throw new BizError('OAuth signing key not found', 400);
	}

	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['verify'],
	);
	const signature = base64UrlToBytes(signatureB64);
	const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
	const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
	if (!valid) {
		throw new BizError('OAuth authorization failed', 400);
	}

	return { sub: payload.sub, email: payload.email || '' };
}

const oauthService = {
	async getCredentials(c) {
		try {
			const settingRow = await settingService.query(c);
			return {
				clientId: (settingRow.googleClientId || '').trim(),
				clientSecret: (settingRow.googleClientSecret || '').trim(),
			};
		} catch {
			return { clientId: '', clientSecret: '' };
		}
	},

	async configured(c) {
		try {
			const { clientId, clientSecret } = await this.getCredentials(c);
			return !!(clientId && clientSecret);
		} catch {
			return false;
		}
	},

	async enabled(c) {
		try {
			const settingRow = await settingService.query(c);
			const { clientId, clientSecret } = await this.getCredentials(c);
			return settingRow.googleOauthEnabled === 1 && !!(clientId && clientSecret);
		} catch {
			return false;
		}
	},

	isAdmin(c, userRow) {
		return isAdmin(userRow);
	},

	redirectUri(c, path) {
		return new URL(c.req.url).origin + path;
	},

	async issueState(c, redirectPath, userId = null, sessionHash = null, returnTo = '') {
		const stateBytes = new Uint8Array(32);
		crypto.getRandomValues(stateBytes);
		const state = cryptoUtils.toBase64Url(stateBytes);

		const nonceBytes = new Uint8Array(32);
		crypto.getRandomValues(nonceBytes);
		const nonce = cryptoUtils.toBase64Url(nonceBytes);
		let transactionSecret = getCookie(c, transactionCookieName(c));
		if (!/^[A-Za-z0-9_-]{43}$/.test(transactionSecret || '')) {
			transactionSecret = randomSecret();
		}
		setCookie(c, transactionCookieName(c), transactionSecret, {
			httpOnly: true,
			secure: isHttps(c),
			sameSite: 'Lax',
			path: '/',
			maxAge: STATE_TTL_SECONDS,
		});

		const record = {
			nonce,
			redirectPath,
			createdAt: Date.now(),
			transactionHash: await cryptoUtils.hashSecret(transactionSecret),
		};
		if (userId) {
			record.userId = userId;
		}
		if (sessionHash) {
			record.sessionHash = sessionHash;
		}
		if (returnTo) {
			record.returnTo = returnTo;
		}

		await c.env.kv.put(KvConst.OAUTH_STATE + state, JSON.stringify(record), {
			expirationTtl: STATE_TTL_SECONDS,
		});

		return { state, nonce };
	},

	async consumeState(c, state, expectedRedirectPath) {
		if (!state) return null;
		const key = KvConst.OAUTH_STATE + state;
		const record = await c.env.kv.get(key, { type: 'json' });
		if (record) await c.env.kv.delete(key);
		if (!record || record.redirectPath !== expectedRedirectPath || !record.transactionHash) return null;

		const transactionSecret = getCookie(c, transactionCookieName(c));
		if (!transactionSecret) return null;
		const transactionHash = await cryptoUtils.hashSecret(transactionSecret);
		if (!constantTimeEqual(record.transactionHash, transactionHash)) return null;
		return record;
	},

	async buildAuthUrl(c, state, nonce, redirectPath) {
		const { clientId } = await this.getCredentials(c);
		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: this.redirectUri(c, redirectPath),
			response_type: 'code',
			scope: 'openid email',
			state,
			nonce,
			access_type: 'online',
			prompt: 'select_account',
		});
		return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
	},

	async verifyCallback(c, code, state, expectedRedirectPath) {
		const record = await this.consumeState(c, state, expectedRedirectPath);
		if (!record?.nonce || !record?.redirectPath) {
			throw new BizError('OAuth request is invalid or expired', 400);
		}
		const { clientId, clientSecret } = await this.getCredentials(c);
		if (!clientId || !clientSecret) {
			throw new BizError('Google login is not configured', 404);
		}
		const redirectUri = this.redirectUri(c, record.redirectPath);
		const idToken = await exchangeCode(code, clientId, clientSecret, redirectUri);
		const payload = await verifyIdToken(idToken, clientId, record.nonce);
		return {
			sub: payload.sub,
			email: payload.email || '',
			userId: record.userId || null,
			sessionHash: record.sessionHash || null,
			returnTo: record.returnTo || '',
		};
	},

	safeAuthorizationReturn(c, value) {
		if (!value) return '';
		try {
			const origin = new URL(c.req.url).origin;
			const target = new URL(value, origin);
			if (target.origin !== origin || target.pathname !== '/oauth/authorize') return '';
			return `${target.pathname}${target.search}`;
		} catch {
			return '';
		}
	},

	async loginByGoogleSub(c, sub) {
		const userRow = await userService.selectByGoogleSub(c, sub);
		if (!userRow || userRow.status === userConst.status.BAN) {
			return null;
		}
		await userService.updateUserInfo(c, userRow.userId);
		await sessionService.create(c, userRow.userId, await cryptoUtils.hashSecret(userRow.password));
		return userRow.userId;
	},

	async bind(c, userId, sub, email) {
		const userRow = await userService.selectByIdIncludeDel(c, userId);
		if (!userRow || userRow.isDel !== 0 || userRow.status === userConst.status.BAN) {
			throw new BizError('User not found or unavailable', 404);
		}
		const existing = await userService.selectByGoogleSubIncludeDel(c, sub);
		if (existing && existing.userId !== userId) {
			throw new BizError('This Google account is already bound to another user', 409);
		}
		await userService.updateGoogleBinding(c, userId, sub, email);
	},

	async unbind(c, userId) {
		await userService.clearGoogleBinding(c, userId);
		await sessionService.revokeAll(c, userId);
	},
};

export default oauthService;
