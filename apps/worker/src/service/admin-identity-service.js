import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';
import sessionService from './session-service';
import { isAdmin, selectPersistedAdmin } from '../security/admin-identity';

const adminIdentityService = {
	async migratePrimaryEmail(c, value, callerUserId) {
		const targetEmail = String(value || '').trim().toLowerCase();
		if (!verifyUtils.isEmail(targetEmail)) throw new BizError('Invalid target email');

		const admin = await selectPersistedAdmin(c);
		if (!admin || !isAdmin(admin) || admin.userId !== Number(callerUserId)
			|| Number(admin.status) !== 0 || Number(admin.isDel) !== 0) {
			throw new BizError('Administrator access required', 403);
		}

		const targets = await c.env.db.prepare(`
			SELECT account_id AS accountId, user_id AS userId, status, is_del AS isDel
			FROM account WHERE email = ? COLLATE NOCASE LIMIT 2
		`).bind(targetEmail).all();
		if (targets.results?.length !== 1
			|| Number(targets.results[0].userId) !== admin.userId
			|| Number(targets.results[0].status) !== 0
			|| Number(targets.results[0].isDel) !== 0) {
			throw new BizError('Target email must be one active mailbox owned by the administrator', 409);
		}

		const conflictingUser = await c.env.db.prepare(`
			SELECT user_id FROM user
			WHERE email = ? COLLATE NOCASE AND user_id <> ? LIMIT 1
		`).bind(targetEmail, admin.userId).first();
		if (conflictingUser) throw new BizError('Target email is already used as another login', 409);

		const currentAccount = await c.env.db.prepare(`
			SELECT account_id FROM account
			WHERE email = ? COLLATE NOCASE AND user_id = ? AND status = 0 AND is_del = 0
			LIMIT 1
		`).bind(admin.email, admin.userId).first();
		if (!currentAccount) throw new BizError('Current administrator login mailbox is not active', 409);

		const targetAccountId = Number(targets.results[0].accountId);
		const migrated = admin.email.toLowerCase() !== targetEmail;
		const results = await c.env.db.batch([
			c.env.db.prepare(`
				UPDATE user SET email = ?, cli_token = ''
				WHERE user_id = ? AND is_admin = 1 AND status = 0 AND is_del = 0
				  AND email = ? COLLATE NOCASE
				  AND NOT EXISTS (
					SELECT 1 FROM user other
					WHERE other.email = ? COLLATE NOCASE AND other.user_id <> ?
				  )
				  AND EXISTS (
					SELECT 1 FROM account target
					WHERE target.account_id = ? AND target.user_id = ?
					  AND target.status = 0 AND target.is_del = 0
				  )
				RETURNING user_id AS userId
			`).bind(targetEmail, admin.userId, admin.email, targetEmail, admin.userId, targetAccountId, admin.userId),
			c.env.db.prepare(`
				UPDATE account
				SET all_receive = CASE WHEN account_id = ? THEN 1 ELSE 0 END,
					is_default_send = CASE WHEN account_id = ? THEN 1 ELSE 0 END
				WHERE user_id = ?
				  AND EXISTS (
					SELECT 1 FROM user owner
					WHERE owner.user_id = ? AND owner.email = ? COLLATE NOCASE AND owner.is_admin = 1
				  )
				  AND EXISTS (
					SELECT 1 FROM account target
					WHERE target.account_id = ? AND target.user_id = ?
					  AND target.status = 0 AND target.is_del = 0
				  )
			`).bind(targetAccountId, targetAccountId, admin.userId, admin.userId, targetEmail, targetAccountId, admin.userId),
		]);
		if (!results[0]?.results?.[0]?.userId) {
			throw new BizError('Administrator email migration preconditions changed; no data was migrated', 409);
		}

		try {
			await sessionService.revokeAll(c, admin.userId);
		} finally {
			sessionService.clearCookie(c);
		}
		return { migrated, email: targetEmail };
	},
};

export default adminIdentityService;
