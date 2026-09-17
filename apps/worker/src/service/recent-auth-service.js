import BizError from '../error/biz-error';
import KvConst from '../const/kv-const';
import constant from '../const/constant';
import sessionService from './session-service';
import confirmationPolicyService from './confirmation-policy-service';
import { isAdmin } from '../security/admin-identity';

// Version 2 replaces both the fixed ten-minute and administrator-only proofs.
const RECENT_AUTH_VERSION = 2;
const REQUIRED_METHOD = 'password';
const SESSION_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function recentAuthKey(sessionHash) {
	return KvConst.RECENT_AUTH + sessionHash;
}

function requireSession(session, userId) {
	const now = Date.now();
	if (!Number.isInteger(userId) || !SESSION_HASH_PATTERN.test(session?.hash || '')
		|| session.userId !== userId || !Number.isSafeInteger(session.createdAt)
		|| session.createdAt > now || session.createdAt + constant.TOKEN_EXPIRE * 1000 <= now) {
		throw new BizError('Authentication required', 401);
	}
}

function proofExpiry(authenticatedAt, policy, session) {
	return Math.min(authenticatedAt + policy.windowMinutes * 60000,
		session.createdAt + constant.TOKEN_EXPIRE * 1000);
}

const recentAuthService = {
	async status(c, session = c.get('session'), userId = c.get('user')?.userId) {
		// A disabled policy skips only reauthentication, never session validation.
		requireSession(session, userId);
		const policy = await confirmationPolicyService.read(c);
		const key = recentAuthKey(session.hash);
		const record = await c.env.kv.get(key, { type: 'json' });
		const now = Date.now();
		const valid = record?.version === RECENT_AUTH_VERSION
			&& record.userId === userId && record.method === REQUIRED_METHOD
			&& record.revision === policy.revision
			&& Number.isSafeInteger(record.authenticatedAt)
			&& record.authenticatedAt >= session.createdAt && record.authenticatedAt <= now
			&& Number.isSafeInteger(record.expiresAt) && record.expiresAt > now
			&& record.expiresAt === proofExpiry(record.authenticatedAt, policy, session);
		if (!valid && record) await c.env.kv.delete(key);
		return { ...policy, method: REQUIRED_METHOD, valid, expiresAt: valid ? record.expiresAt : null };
	},

	async grant(c, session = c.get('session'), userId = c.get('user')?.userId) {
		requireSession(session, userId);
		const policy = await confirmationPolicyService.read(c);
		const authenticatedAt = Date.now();
		const expiresAt = proofExpiry(authenticatedAt, policy, session);
		await c.env.kv.put(recentAuthKey(session.hash), JSON.stringify({
			version: RECENT_AUTH_VERSION, userId, method: REQUIRED_METHOD,
			revision: policy.revision, authenticatedAt, expiresAt,
		}), { expirationTtl: Math.max(60, Math.ceil((expiresAt - authenticatedAt) / 1000)) });
		return { ...policy, method: REQUIRED_METHOD, valid: true, expiresAt };
	},

	async require(c, session = c.get('session'), userId = c.get('user')?.userId) {
		const status = await this.status(c, session, userId);
		if (status.enabled && !status.valid) {
			throw new BizError('Recent authentication required', 428);
		}
		return status;
	},

	async requireSettings(c) {
		if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
		return this.require(c);
	},

	async requireByHash(c, sessionHash, userId) {
		const session = await sessionService.resolveByHash(c, sessionHash);
		if (!session || session.userId !== userId) {
			throw new BizError('Recent authentication required', 428);
		}
		return this.require(c, session, userId);
	},

	async revoke(c, sessionOrHash) {
		const sessionHash = typeof sessionOrHash === 'string' ? sessionOrHash : sessionOrHash?.hash;
		if (SESSION_HASH_PATTERN.test(sessionHash || '')) {
			await c.env.kv.delete(recentAuthKey(sessionHash));
		}
	},
};

export default recentAuthService;
