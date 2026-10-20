import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import constant from '../const/constant';
import KvConst from '../const/kv-const';
import cryptoUtils from '../utils/crypto-utils';
import BizError from '../error/biz-error';
import { sessionEpoch, selectSecurityUser, sessionEpochColumns } from '../security/session-epoch';

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

async function currentCredentials(c, userId) {
	return selectSecurityUser(c, 'user_id = ?', [userId]);
}

function active(user) {
	return user && user.isDel === 0 && user.status === 0;
}

function isPreserved(session, current, hash) {
	return hash && current.preservedSessionHash === hash
		&& sessionEpoch(session.sessionEpoch) < sessionEpoch(current.sessionEpoch);
}

async function persistCurrentRevocation(c, session) {
	const columns = await sessionEpochColumns(c);
	const statements = [];
	const now = Date.now();
	if (columns.revocations) {
		statements.push(c.env.db.prepare('DELETE FROM session_revocation WHERE expires_at <= ?').bind(now));
		statements.push(c.env.db.prepare(`INSERT INTO session_revocation(session_hash, user_id, expires_at) VALUES (?, ?, ?)
			ON CONFLICT(session_hash) DO UPDATE SET expires_at = MAX(session_revocation.expires_at, excluded.expires_at)`)
			.bind(session.hash, session.userId, now + constant.TOKEN_EXPIRE * 1000));
	}
	if (columns.preserved) statements.push(c.env.db.prepare(`UPDATE user
		SET preserved_session_hash = CASE WHEN preserved_session_hash = ? THEN '' ELSE preserved_session_hash END
		WHERE user_id = ?`).bind(session.hash, session.userId));
	if (statements.length) await c.env.db.batch(statements);
}

async function revocationStatus(c, hash) {
	const available = !!await c.env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_revocation'").first();
	const revoked = available && !!await c.env.db.prepare('SELECT 1 AS revoked FROM session_revocation WHERE session_hash = ? AND expires_at > ?')
		.bind(hash, Date.now()).first();
	return { available, revoked };
}

async function revokedHashes(c, hashes) {
	const candidates = [...new Set(hashes.filter(hash => /^[A-Za-z0-9_-]{43}$/.test(hash || '')))];
	if (!candidates.length || !await c.env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_revocation'").first()) return new Set();
	const placeholders = candidates.map(() => '?').join(',');
	const rows = await c.env.db.prepare(`SELECT session_hash FROM session_revocation WHERE expires_at > ? AND session_hash IN (${placeholders})`)
		.bind(Date.now(), ...candidates).all();
	return new Set((rows.results || []).map(row => row.session_hash));
}

async function revokeEpoch(c, userId) {
	const columns = await sessionEpochColumns(c);
	const assignments = [];
	if (columns.epoch) assignments.push('session_epoch = session_epoch + 1');
	if (columns.preserved) assignments.push("preserved_session_hash = ''");
	if (assignments.length) await c.env.db.prepare(`UPDATE user SET ${assignments.join(', ')} WHERE user_id = ?`).bind(userId).run();
}

async function cleanupRevoked(c, userId, entries) {
	if (!entries.length) return;
	const current = await currentCredentials(c, userId);
	if (!current) return;
	const revoked = entries.filter(item => item?.hash && item.hash !== current.preservedSessionHash
		&& sessionEpoch(item.sessionEpoch) < sessionEpoch(current.sessionEpoch));
	// Current-epoch records can become the initiator of a concurrent binding.
	// Removing their index membership caps authority; their KV TTL bounds orphans.
	await Promise.all(revoked.flatMap(item => [
		c.env.kv.delete(sessionKey(item.hash)),
		c.env.kv.delete(recentAuthKey(item.hash)),
		c.env.kv.delete(KvConst.ADMIN_CONFIRMATION + item.hash),
	]));
}

const sessionService = {
	matchesEpoch(session, current) {
		return !!session && !!current && Number(session.userId) === Number(current.userId)
			&& (sessionEpoch(session.sessionEpoch) === sessionEpoch(current.sessionEpoch)
				|| isPreserved(session, current, session.hash));
	},

	async create(c, userId, credentialFingerprint, authenticatedSnapshot = null) {
		const current = await currentCredentials(c, userId);
		const snapshot = authenticatedSnapshot || current;
		if (!active(current) || !snapshot || credentialFingerprint !== await cryptoUtils.hashSecret(current.password)
			|| sessionEpoch(snapshot.sessionEpoch) !== sessionEpoch(current.sessionEpoch)
			|| (snapshot.googleLoginSub !== undefined && snapshot.googleLoginSub !== current.googleSub)) {
			throw new BizError('Authentication expired', 401);
		}
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = toBase64Url(bytes);
		const hash = await hashToken(token);
		const now = Date.now();

		let authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userId, { type: 'json' });
		if (!authInfo || authInfo.version !== SESSION_VERSION || !Array.isArray(authInfo.sessions)) {
			authInfo = { version: SESSION_VERSION, sessions: [] };
		}
		const latest = await currentCredentials(c, userId);
		if (!active(latest) || credentialFingerprint !== await cryptoUtils.hashSecret(latest.password)) {
			throw new BizError('Authentication expired', 401);
		}
		// Revoked stale index entries do not consume session slots. Preserve the
		// authentication snapshot for the new record instead of upgrading it.
		const denied = await revokedHashes(c, [...authInfo.sessions.map(item => item?.hash), latest.preservedSessionHash]);
		const filterNow = Date.now();
		const authorizedEntry = item => /^[A-Za-z0-9_-]{43}$/.test(item?.hash || '') && !denied.has(item.hash)
			&& Number.isSafeInteger(item.createdAt) && item.createdAt <= filterNow && item.createdAt + constant.TOKEN_EXPIRE * 1000 > filterNow
			&& (item.hash === latest.preservedSessionHash || sessionEpoch(item.sessionEpoch) === sessionEpoch(latest.sessionEpoch));
		const removed = authInfo.sessions.filter(item => !authorizedEntry(item));
		authInfo.sessions = authInfo.sessions.filter(authorizedEntry);
		// A stale writer may have dropped the retained session from the KV index.
		// Restore it before applying the cap, so it occupies one of the five slots.
		if (latest.preservedSessionHash && !denied.has(latest.preservedSessionHash)
			&& !authInfo.sessions.some(item => item.hash === latest.preservedSessionHash)) {
			const kept = await c.env.kv.get(sessionKey(latest.preservedSessionHash), { type: 'json' });
			if (kept?.version === SESSION_VERSION && kept.userId === userId
				&& kept.credentialFingerprint === credentialFingerprint && Number.isSafeInteger(kept.createdAt)
				&& kept.createdAt <= filterNow && kept.createdAt + constant.TOKEN_EXPIRE * 1000 > filterNow
				&& isPreserved(kept, latest, latest.preservedSessionHash)) {
				authInfo.sessions.unshift({ hash: latest.preservedSessionHash, createdAt: kept.createdAt, sessionEpoch: sessionEpoch(kept.sessionEpoch) });
			}
		}

		if (sessionEpoch(snapshot.sessionEpoch) === sessionEpoch(latest.sessionEpoch)) {
			authInfo.sessions.push({ hash, createdAt: now, sessionEpoch: sessionEpoch(snapshot.sessionEpoch) });
		}
		while (authInfo.sessions.length > MAX_SESSIONS_PER_USER) {
			const index = authInfo.sessions.findIndex(item => item?.hash !== latest.preservedSessionHash);
			removed.push(...authInfo.sessions.splice(index < 0 ? 0 : index, 1));
		}
		await cleanupRevoked(c, userId, removed);

		const session = {
			version: SESSION_VERSION,
			userId,
			credentialFingerprint,
			sessionEpoch: sessionEpoch(snapshot.sessionEpoch),
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
		if (!session || session.version !== SESSION_VERSION || !Number.isInteger(session.userId)
			|| !Number.isSafeInteger(session.createdAt) || session.createdAt > Date.now()
			|| session.createdAt + constant.TOKEN_EXPIRE * 1000 <= Date.now()) {
			return null;
		}

		const authInfo = await c.env.kv.get(KvConst.AUTH_INFO + session.userId, { type: 'json' });
		const current = await currentCredentials(c, session.userId);
		const revocation = await revocationStatus(c, hash);
		const indexed = authInfo?.version === SESSION_VERSION && Array.isArray(authInfo.sessions)
			&& authInfo.sessions.some(item => item.hash === hash);
		if (revocation.revoked || !active(current) || (!(revocation.available && isPreserved(session, current, hash))
			&& (!indexed || sessionEpoch(session.sessionEpoch) !== sessionEpoch(current.sessionEpoch)))
			|| session.credentialFingerprint !== await cryptoUtils.hashSecret(current.password)) return null;

		return { ...session, hash };
	},

	async revokeCurrent(c) {
		const resolved = await this.resolve(c);
		if (resolved) {
			// Clear D1's retained-session authority before KV cleanup. Its old epoch
			// then remains invalid even if a stale index writer restores membership.
			await persistCurrentRevocation(c, resolved);
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
		const current = await currentCredentials(c, userId);
		await revokeEpoch(c, userId);
		const authKey = KvConst.AUTH_INFO + userId;
		const authInfo = await c.env.kv.get(authKey, { type: 'json' });
		// The index grants authority; orphaned records must stay unusable if cleanup fails.
		await c.env.kv.delete(authKey);
		const entries = authInfo?.version === SESSION_VERSION && Array.isArray(authInfo.sessions) ? authInfo.sessions : [];
		if (current?.preservedSessionHash) entries.push({ hash: current.preservedSessionHash });
		if (entries.length) {
			await Promise.all(entries
				.filter(item => item?.hash)
				.flatMap(item => [
					c.env.kv.delete(sessionKey(item.hash)),
					c.env.kv.delete(recentAuthKey(item.hash)),
					c.env.kv.delete(KvConst.ADMIN_CONFIRMATION + item.hash),
				]));
		}
	},

	async revokeOthers(c, userId, preservedHash) {
		const authKey = KvConst.AUTH_INFO + userId;
		const authInfo = await c.env.kv.get(authKey, { type: 'json' });
		if (authInfo?.version !== SESSION_VERSION || !Array.isArray(authInfo.sessions)) return;
		// D1 already revoked the old epoch. Never rewrite the index here: a
		// legitimate new login may append to it while physical cleanup is running.
		await cleanupRevoked(c, userId, authInfo.sessions.filter(item => item?.hash !== preservedHash));
	},

	clearCookie(c) {
		for (const name of [PROD_COOKIE, DEV_COOKIE, PROD_OAUTH_COOKIE, DEV_OAUTH_COOKIE]) {
			deleteCookie(c, name, { path: '/', secure: name === PROD_COOKIE || name === PROD_OAUTH_COOKIE });
		}
	},
};

export default sessionService;
