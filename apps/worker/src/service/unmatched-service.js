import BizError from '../error/biz-error';
import { assertObjectDeleteQueue } from '../utils/delete-queue-utils';
import emailService from './email-service';

const UNMATCHED_USER_ID = 0;
const UNMATCHED_ACCOUNT_ID = 0;

const unmatchedService = {
	async list(c, params) {
		let { page, size } = params;
		page = Math.max(1, Number(page) || 1);
		size = Math.min(50, Math.max(1, Number(size) || 20));
		const offset = (page - 1) * size;

		const list = await c.env.db.prepare(`
			SELECT email_id AS emailId, send_email AS sendEmail, name, to_email AS toEmail,
				subject, status, create_time AS createTime, unread
			FROM email
			WHERE user_id = ? AND account_id = ? AND is_del = 0
			ORDER BY email_id DESC
			LIMIT ? OFFSET ?
		`).bind(UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID, size, offset).all();

		const { total } = await c.env.db.prepare(`
			SELECT COUNT(*) AS total FROM email
			WHERE user_id = ? AND account_id = ? AND is_del = 0
		`).bind(UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID).first();

		const rows = list.results || [];
		await emailService.emailAddReplyTo(c, rows);
		return {
			list: rows,
			total: total || 0,
			page,
			size
		};
	},

	async getDetail(c, emailId) {
		const id = Number(emailId);
		if (!Number.isInteger(id) || id <= 0) throw new BizError('Invalid email ID');

		const detail = await c.env.db.prepare(`
			SELECT email_id AS emailId, send_email AS sendEmail, name, to_email AS toEmail,
				subject, content, type, status, unread, create_time AS createTime,
				recipient, cc, bcc
			FROM email
			WHERE email_id = ? AND user_id = ? AND account_id = ? AND is_del = 0
		`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID).first();

		if (!detail) throw new BizError('Unmatched email not found', 404);
		await emailService.emailAddReplyTo(c, [detail]);

		const attachments = await c.env.db.prepare(`
			SELECT attachment_id AS attachmentId, key, name, size, type
			FROM attachments
			WHERE email_id = ? AND user_id = ? AND account_id = ?
		`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID).all();

		detail.attachments = attachments.results || [];
		return detail;
	},

	async delete(c, emailId) {
		const id = Number(emailId);
		if (!Number.isInteger(id) || id <= 0) throw new BizError('Invalid email ID');

		const target = await c.env.db.prepare(`
			SELECT email_id FROM email
			WHERE email_id = ? AND user_id = ? AND account_id = ? AND is_del = 0
		`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID).first();

		if (!target) throw new BizError('Unmatched email not found', 404);

		await assertObjectDeleteQueue(c);
		await c.env.db.batch([
			c.env.db.prepare(`
				INSERT OR REPLACE INTO object_delete_queue(key)
				SELECT DISTINCT key FROM attachments WHERE email_id = ? AND user_id = ? AND account_id = ?
			`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID),
			c.env.db.prepare(`DELETE FROM attachments WHERE email_id = ? AND user_id = ? AND account_id = ?`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID),
			c.env.db.prepare(`DELETE FROM email WHERE email_id = ? AND user_id = ? AND account_id = ?`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID),
		]);
	},

	async getPolicy(c, adminUserId) {
		const row = await c.env.db.prepare(`
			SELECT unmatched_policy FROM user WHERE user_id = ?
		`).bind(adminUserId).first();
		return row?.unmatched_policy || 'reject';
	},

	async setPolicy(c, policy, adminUserId) {
		const validPolicies = ['reject', 'drop', 'quarantine'];
		if (!validPolicies.includes(policy)) {
			throw new BizError('Invalid unmatched policy mode. Must be reject, drop, or quarantine.');
		}
		await c.env.db.prepare(`
			UPDATE user SET unmatched_policy = ? WHERE user_id = ?
		`).bind(policy, adminUserId).run();
		return { policy };
	},

	async cleanExpired(c) {
		await assertObjectDeleteQueue(c);
		const expiredRows = await c.env.db.prepare(`
			SELECT email_id FROM email
			WHERE user_id = ? AND account_id = ?
			  AND create_time < datetime('now', '-30 days')
		`).bind(UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID).all();

		const expiredIds = (expiredRows.results || []).map(r => r.email_id);
		if (expiredIds.length === 0) return { cleanedCount: 0 };

		for (const id of expiredIds) {
			await c.env.db.batch([
				c.env.db.prepare(`
					INSERT OR REPLACE INTO object_delete_queue(key)
					SELECT DISTINCT key FROM attachments WHERE email_id = ? AND user_id = ? AND account_id = ?
				`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID),
				c.env.db.prepare(`DELETE FROM attachments WHERE email_id = ? AND user_id = ? AND account_id = ?`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID),
				c.env.db.prepare(`DELETE FROM email WHERE email_id = ? AND user_id = ? AND account_id = ?`).bind(id, UNMATCHED_USER_ID, UNMATCHED_ACCOUNT_ID),
			]);
		}
		return { cleanedCount: expiredIds.length };
	}
};

export default unmatchedService;
