import app from '../hono/hono';
import result from '../model/result';
import emailService from '../service/email-service';
import accountService from '../service/account-service';
import userContext from '../security/user-context';
import { isDel } from '../const/entity-const';
import orm from '../entity/orm';
import email from '../entity/email';
import { att } from '../entity/att';
import { and, eq, desc, asc, gt, count, or, like, inArray, sql } from 'drizzle-orm';
import { readableMailBody } from '../utils/mail-text';
import BizError from '../error/biz-error';
import securityService from '../service/security-service';
import { readSendBody } from './send-body';

function textToHtml(text) {
	return String(text || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/\n/g, '<br>');
}

async function selectOwnedEmail(c, emailId, userId) {
	if (!Number.isInteger(emailId) || emailId <= 0) return null;
	return emailService.selectById(c, emailId, userId);
}

// GET /cli/accounts
app.get('/cli/accounts', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'cli-accounts', 60);
	const userId = userContext.getUserId(c);
	const list = await accountService.list(c, { size: 50 }, userId);
	return c.json(result.ok(list.map(a => ({
		id: a.accountId,
		email: a.email,
		name: a.name
	}))));
});

// GET /cli/emails?page=1&size=20&accountId=1&q=keyword&type=0
app.get('/cli/emails', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'cli-emails', 60);
	const userId = userContext.getUserId(c);
	const q = c.req.query();
	const page = q.page === undefined ? 1 : Number(q.page);
	const size = q.size === undefined ? 20 : Number(q.size);
	if (!Number.isInteger(page) || page < 1) throw new BizError('Invalid page number.');
	if (!Number.isInteger(size) || size < 1 || size > 50) throw new BizError('Invalid page size.');
	const offset = (page - 1) * size;
	const accountId = q.accountId === undefined || q.accountId === '' ? null : Number(q.accountId);
	const type = q.type !== undefined ? Number(q.type) : 0;
	const keyword = (q.q || '').trim();
	const afterId = q.afterId === undefined ? null : Number(q.afterId);
	if (afterId !== null && (!Number.isSafeInteger(afterId) || afterId < 0)) throw new BizError('Invalid afterId.');
	if (afterId !== null && page !== 1) throw new BizError('Incremental scans require page=1.');
	if (q.unread !== undefined && !['true', 'false'].includes(q.unread)) throw new BizError('unread must be true or false.');
	if (accountId !== null && (!Number.isInteger(accountId) || accountId <= 0)) throw new BizError('Invalid account ID.');
	if (![0, 1].includes(type)) throw new BizError('Invalid email type.');
	if (new TextEncoder().encode(keyword).length > 48) throw new BizError('Search keyword is too long.');

	const conditions = [
		eq(email.userId, userId),
		eq(email.type, type),
		eq(email.isDel, isDel.NORMAL)
	];
	if (afterId !== null) conditions.push(gt(email.emailId, afterId));
	if (q.unread !== undefined) conditions.push(eq(email.unread, q.unread === 'true' ? 0 : 1));

	if (accountId) {
		conditions.push(eq(email.accountId, accountId));
	}

	if (keyword) {
		conditions.push(or(
			like(email.subject, `%${keyword}%`),
			like(email.sendEmail, `%${keyword}%`),
			like(email.toEmail, `%${keyword}%`),
			like(email.name, `%${keyword}%`),
			like(email.text, `%${keyword}%`),
			like(email.content, `%${keyword}%`)
		));
	}

	const [list, totalRow] = await Promise.all([
		// Compute the visibility barrier in the same SELECT snapshot as the rows.
		// An earlier ID may still be saving attachments while later IDs are ready.
		orm(c).select({ ...email, scanPendingId: afterId === null ? sql`NULL` : sql`(
			SELECT MIN(p.email_id) FROM email p WHERE p.user_id=${userId} AND p.type=${type}
			AND p.status=6 AND p.is_del=1 AND p.email_id>${afterId}
			${accountId ? sql`AND p.account_id=${accountId}` : sql``})` }).from(email)
			.where(and(...conditions))
			.orderBy(afterId === null ? desc(email.emailId) : asc(email.emailId))
			.limit(size)
			.offset(offset)
			.all(),
		orm(c).select({ total: count() }).from(email)
			.where(and(...conditions))
			.get()
	]);
	await emailService.emailAddReplyTo(c, list);

	const emailIds = list.map(item => item.emailId);
	const attachmentRows = emailIds.length > 0
		? await orm(c).select({ emailId: att.emailId }).from(att)
			.where(and(inArray(att.emailId, emailIds), eq(att.status, 0)))
			.groupBy(att.emailId)
			.all()
		: [];
	const attachmentEmailIds = new Set(attachmentRows.map(item => item.emailId));
	const items = list.map(e => ({
		id: e.emailId,
		from: `${e.name || ''} <${e.sendEmail || ''}>`.trim(),
		to: e.toEmail,
		replyTo: e.replyTo,
		subject: e.subject,
		date: e.createTime,
		unread: e.unread === 0,
		hasAtt: attachmentEmailIds.has(e.emailId)
	}));

	const pendingId = list[0]?.scanPendingId;
	const maximumId = items.length ? Math.max(...items.map(item => item.id)) : afterId;
	return c.json(result.ok({
		total: totalRow.total,
		page,
		size,
		list: items,
		nextAfterId: pendingId == null ? maximumId : Math.min(maximumId, pendingId - 1),
		scanPending: pendingId != null
	}));
});

// GET /cli/emails/:id
app.get('/cli/emails/:id', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'cli-email-detail', 60);
	const userId = userContext.getUserId(c);
	const emailId = Number(c.req.param('id'));

	const emailRow = await selectOwnedEmail(c, emailId, userId);

	if (!emailRow) {
		throw new BizError('邮件不存在', 404);
	}

	const attList = await orm(c).select().from(att)
		.where(and(eq(att.emailId, emailId), eq(att.status, 0)))
		.all();

	const readable = readableMailBody(emailRow);

	return c.json(result.ok({
		id: emailRow.emailId,
		from: `${emailRow.name || ''} <${emailRow.sendEmail || ''}>`.trim(),
		to: emailRow.toEmail,
		replyTo: emailRow.replyTo,
		cc: emailRow.cc,
		subject: emailRow.subject,
		date: emailRow.createTime,
		...readable,
		attachments: attList.map(a => ({
			filename: a.filename,
			size: a.size,
			mimeType: a.mimeType,
			url: `/api/cli/attachments/${a.key}`
		}))
	}));
});

// POST /cli/emails/send
app.post('/cli/emails/send', async (c) => {
	await securityService.rateLimit(c, 'SEND_RATE_LIMITER', 'cli-email-send', 10);
	const userId = userContext.getUserId(c);
	const params = await readSendBody(c);
	if (!params.requestId) throw new BizError('requestId is required for idempotent CLI sending.');

	const { to, subject, body, cc, accountId } = params;

	if (!to || !subject) {
		throw new BizError('to and subject are required');
	}
	if (Array.isArray(cc) ? cc.length > 0 : String(cc || '').trim()) {
		throw new BizError('CC recipients are not supported by the CLI endpoint.');
	}

	let useAccountId = accountId;
	if (!useAccountId) {
		const accounts = await accountService.list(c, { size: 1 }, userId);
		if (!accounts.length) {
			throw new BizError('No email account available');
		}
		useAccountId = accounts[0].accountId;
	}

	const sendParams = {
		accountId: useAccountId,
		receiveEmail: [to],
		subject,
		text: body || '',
		content: textToHtml(body),
		cc: cc || '',
		sendType: 'new',
		requestId: params.requestId,
	};

	const result_ = await emailService.send(c, sendParams, userId);
	const sent = Array.isArray(result_) ? result_[0] : result_;
	return c.json(result.ok({ id: sent.emailId, status: sent.status, requestId: sent.requestId || params.requestId, warning: sent.deliveryWarning || null }));
});

// POST /cli/emails/:id/reply
app.post('/cli/emails/:id/reply', async (c) => {
	await securityService.rateLimit(c, 'SEND_RATE_LIMITER', 'cli-email-reply', 10);
	const userId = userContext.getUserId(c);
	const emailId = Number(c.req.param('id'));
	const params = await readSendBody(c);
	if (!params.requestId) throw new BizError('requestId is required for idempotent CLI sending.');

	const original = await selectOwnedEmail(c, emailId, userId);

	if (!original) {
		throw new BizError('邮件不存在', 404);
	}
	if (Array.isArray(params.cc) ? params.cc.length > 0 : String(params.cc || '').trim()) {
		throw new BizError('CC recipients are not supported by the CLI endpoint.');
	}

	let replyRecipients = original.type === 0
		? (original.replyTo || []).map(item => item.address).filter(Boolean)
		: [];
	if (original.type === 0 && replyRecipients.length === 0) replyRecipients = [original.sendEmail];
	if (original.type === 1) {
		try {
			replyRecipients = JSON.parse(original.recipient || '[]')
				.map(item => item?.address)
				.filter(Boolean);
		} catch {
			replyRecipients = [];
		}
		if (replyRecipients.length === 0 && original.toEmail) replyRecipients = [original.toEmail];
	}
	replyRecipients = [...new Set(replyRecipients.filter(Boolean))];
	if (replyRecipients.length === 0) throw new BizError('No reply recipient is available for this message.', 400);
	const baseSubject = String(original.subject || '').replace(/^(?:(?:re|回复)\s*[:：]\s*)+/i, '');
	const replySubject = `Re: ${baseSubject}`;

	const quoteHeader = `\n\n--- Original message ---\nFrom: ${original.name || original.sendEmail}\nDate: ${original.createTime}\nSubject: ${original.subject}\n\n`;
	const originalBody = readableMailBody(original).body;
	const body = (params.body || '') + quoteHeader + (originalBody ? `> ${originalBody.split('\n').join('\n> ')}` : '');

	const originalAccount = await accountService.selectOwnedById(c, original.accountId, userId);
	const fallbackAccounts = originalAccount ? [] : await accountService.list(c, { size: 1 }, userId);
	const replyAccountId = originalAccount?.accountId || fallbackAccounts[0]?.accountId;
	if (!replyAccountId) throw new BizError('No email account available');

	const sendParams = {
		accountId: replyAccountId,
		receiveEmail: replyRecipients,
		subject: replySubject,
		text: body,
		content: textToHtml(body),
		cc: params.cc || '',
		sendType: 'reply',
		emailId,
		requestId: params.requestId,
	};

	const result_ = await emailService.send(c, sendParams, userId);
	const sent = Array.isArray(result_) ? result_[0] : result_;
	return c.json(result.ok({ id: sent.emailId, status: sent.status, requestId: sent.requestId || params.requestId, warning: sent.deliveryWarning || null }));
});

// PUT /cli/emails/:id/read
app.put('/cli/emails/:id/read', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'cli-email-read', 30);
	const userId = userContext.getUserId(c);
	const emailId = Number(c.req.param('id'));
	if (!await selectOwnedEmail(c, emailId, userId)) throw new BizError('邮件不存在', 404);
	await emailService.read(c, { emailIds: [emailId] }, userId);
	return c.json(result.ok());
});

// DELETE /cli/emails/:id
app.delete('/cli/emails/:id', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'cli-email-delete', 30);
	const userId = userContext.getUserId(c);
	const emailId = Number(c.req.param('id'));
	if (!await selectOwnedEmail(c, emailId, userId)) throw new BizError('邮件不存在', 404);
	await emailService.delete(c, { emailIds: String(emailId) }, userId);
	return c.json(result.ok());
});
