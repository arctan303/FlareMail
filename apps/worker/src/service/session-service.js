import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import constant from '../const/constant';
import KvConst from '../const/kv-const';

const PROD_COOKIE = '__Host-mail_session';
const DEV_COOKIE = 'mail_session_dev';
const PROD_OAUTH_COOKIE = '__Host-mail_oauth_session';
const DEV_OAUTH_COOKIE = 'mail_oauth_session_dev';
const SESSION_VERSION = 2;
const MAX_SESSIONS_PER_USER = 5;

function toBase64Url(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function hashToken(token) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return toBase64Url(new Uint8Array(digest));
}

function isHttps(c) {
	return new URL(c.req.url).protocol === 'https:';
}

function cookieName(c) {
	return isHttps(c) ? PROD_COOKIE : DEV_COOKIE;
}

function oauthCookieName(c) {
	return isHttps(c) ? PROD_OAUTH_COOKIE : DEV_OAUTH_COOKIE;
}

function setOAuthCookie(c, token) {
	setCookie(c, oauthCookieName(c), token, {
		httpOnly: true,
		secure: isHttps(c),
		sameSite: 'Lax',
		path: '/',
		maxAge: constant.TOKEN_EXPIRE,
	});
}

function sessionKey(hash) {
	return KvConst.SESSION + hash;
}

function recentAuthKey(hash) {
	return KvConst.RECENT_AUTH + hash;
}

const sessionService = {
	async create(c, userId, credentialFingerprint) {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = toBase64Url(bytes);
		const hash = await hashToken(token);
		const now = Date.now();

		let authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userId, { type: 'json' });
		if (!authInfo || authInfo.version !== SESSION_VERSION || !Array.isArray(authInfo.sessions)) {
			authInfo = { version: SESSION_VERSION, sessions: [] };
		}

		authInfo.sessions.push({ hash, createdAt: now });
		while (authInfo.sessions.length > MAX_SESSIONS_PER_USER) {
			const removed = authInfo.sessions.shift();
			if (removed?.hash) {
				await Promise.all([
					c.env.kv.delete(sessionKey(removed.hash)),
					c.env.kv.delete(recentAuthKey(removed.hash)),
					c.env.kv.delete(KvConst.ADMIN_CONFIRMATION + removed.hash),
				]);
			}
		}

		const session = {
			version: SESSION_VERSION,
			userId,
			credentialFingerprint,
			createdAt: now,
		};
		await Promise.all([
			c.env.kv.put(sessionKey(hash), JSON.stringify(session), { expirationTtl: constant.TOKEN_EXPIRE }),
			c.env.kv.put(KvConst.AUTH_INFO + userId, JSON.stringify(authInfo), {
				expirationTtl: constant.TOKEN_EXPIRE,
			}),
		]);

		setCookie(c, cookieName(c), token, {
			httpOnly: true,
			secure: isHttps(c),
			sameSite: 'Strict',
			path: '/',
			maxAge: constant.TOKEN_EXPIRE,
		});
		setOAuthCookie(c, token);

		return { ...session, hash };
	},

	getRawToken(c) {
		return getCookie(c, cookieName(c)) || null;
	},

	getOAuthRawToken(c) {
		return getCookie(c, oauthCookieName(c)) || null;
	},

	async resolve(c) {
		const token = this.getRawToken(c);
		if (!token) return null;

		const hash = await hashToken(token);
		return this.resolveByHash(c, hash);
	},

	async resolveOAuth(c) {
		const oauthToken = this.getOAuthRawToken(c);
		if (oauthToken) return this.resolveByHash(c, await hashToken(oauthToken));

		// Sessions created before OAuth support only have the Strict mail cookie.
		// Once the browser is back on the mail origin, validate that session and
		// mint the matching Lax cookie so the original authorization can resume.
		const legacyToken = this.getRawToken(c);
		if (!legacyToken) return null;
		return this.resolveByHash(c, await hashToken(legacyToken));
	},

	promoteCurrentToOAuth(c) {
		const legacyToken = this.getRawToken(c);
		if (legacyToken) setOAuthCookie(c, legacyToken);
	},

	async resolveByHash(c, hash) {
		if (!/^[A-Za-z0-9_-]{43}$/.test(hash || '')) return null;
		const session = await c.env.kv.get(sessionKey(hash), { type: 'json' });
		if (!session || session.version !== SESSION_VERSION || !Number.isInteger(session.userId)) {
			return null;
		}

		const authInfo = await c.env.kv.get(KvConst.AUTH_INFO + session.userId, { type: 'json' });
		if (
			!authInfo ||
			authInfo.version !== SESSION_VERSION ||
			!Array.isArray(authInfo.sessions) ||
			!authInfo.sessions.some(item => item.hash === hash)
		) {
			return null;
		}

		return { ...session, hash };
	},

	async revokeCurrent(c) {
		const resolved = await this.resolve(c);
		if (resolved) {
			const authKey = KvConst.AUTH_INFO + resolved.userId;
			const authInfo = await c.env.kv.get(authKey, { type: 'json' });
			if (authInfo?.version === SESSION_VERSION && Array.isArray(authInfo.sessions)) {
				authInfo.sessions = authInfo.sessions.filter(item => item.hash !== resolved.hash);
				if (authInfo.sessions.length > 0) {
					await c.env.kv.put(authKey, JSON.stringify(authInfo), {
						expirationTtl: constant.TOKEN_EXPIRE,
					});
				} else {
					await c.env.kv.delete(authKey);
				}
			}
			await Promise.all([
				c.env.kv.delete(sessionKey(resolved.hash)),
				c.env.kv.delete(recentAuthKey(resolved.hash)),
				c.env.kv.delete(KvConst.ADMIN_CONFIRMATION + resolved.hash),
			]);
		}
		this.clearCookie(c);
	},

	async revokeAll(c, userId) {
		const authKey = KvConst.AUTH_INFO + userId;
		const authInfo = await c.env.kv.get(authKey, { type: 'json' });
		if (authInfo?.version === SESSION_VERSION && Array.isArray(authInfo.sessions)) {
			await Promise.all(authInfo.sessions
				.filter(item => item?.hash)
				.flatMap(item => [
					c.env.kv.delete(sessionKey(item.hash)),
					c.env.kv.delete(recentAuthKey(item.hash)),
					c.env.kv.delete(KvConst.ADMIN_CONFIRMATION + item.hash),
				]));
		}
		await c.env.kv.delete(authKey);
	},

	clearCookie(c) {
		for (const name of [PROD_COOKIE, DEV_COOKIE, PROD_OAUTH_COOKIE, DEV_OAUTH_COOKIE]) {
			deleteCookie(c, name, { path: '/', secure: name === PROD_COOKIE || name === PROD_OAUTH_COOKIE });
		}
	},
};

export default sessionService;
