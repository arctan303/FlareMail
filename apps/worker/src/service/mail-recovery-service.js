import BizError from '../error/biz-error';
import { assertObjectDeleteQueue } from '../utils/delete-queue-utils';
import managedDomainService from './managed-domain-service';
import sanitizeEmailHtml from '../utils/html-sanitizer';
import { isAdmin } from '../security/admin-identity';

const activeUserSql = 'EXISTS (SELECT 1 FROM user u WHERE u.user_id=e.user_id AND u.is_del=0 AND u.status=0)';
// A deleted alias keeps ownership, but is never silently restored with a message.
const ownedTrashSql = `e.user_id=? AND e.is_del=1 AND e.status<>6 AND ${activeUserSql}
	AND EXISTS (SELECT 1 FROM account a WHERE a.account_id=e.account_id AND a.user_id=e.user_id)`;
const restoreTrashSql = `${ownedTrashSql} AND EXISTS (SELECT 1 FROM account a WHERE a.account_id=e.account_id AND a.user_id=e.user_id AND a.is_del=0)`;
const withinRetentionSql = "e.deleted_at IS NOT NULL AND e.deleted_at>datetime('now','-30 days')";
const snapshotLimit = 10000;
const snapshotBatch = 40;

async function recoveryReady(c) {
	const columns = (await c.env.db.prepare("PRAGMA table_info('email')").all()).results || [];
	return columns.some(column => column.name === 'deleted_at' && column.type === 'TEXT')
		&& columns.some(column => column.name === 'trash_revision' && column.type === 'INTEGER' && column.notnull === 1)
		&& !!await c.env.db.prepare('SELECT 1 AS ready FROM schema_migrations WHERE version=329').first();
}
async function requireRecoverySchema(c) {
	if (!await recoveryReady(c)) throw new BizError('Apply database upgrade 329 before using Trash.', 503);
}

function positiveId(value) {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id <= 0) throw new BizError('Invalid ID.', 400);
	return id;
}

function selectedIds(value) {
	if (!Array.isArray(value) || !value.length || value.length > 50) throw new BizError('Select between 1 and 50 messages.', 400);
	return [...new Set(value.map(positiveId))];
}

function pageParams(params = {}) {
	const page = params.page === undefined ? 1 : positiveId(params.page);
	const size = params.size === undefined ? 20 : positiveId(params.size);
	if (size > 50 || !Number.isSafeInteger((page - 1) * size)) throw new BizError('Invalid page size.', 400);
	return { page, size, offset: (page - 1) * size };
}

async function activeUser(c, userId) {
	const row = await c.env.db.prepare(`SELECT user_id AS userId,email,is_admin AS isAdmin,account_limit AS accountLimit
		FROM user WHERE user_id=? AND is_del=0 AND status=0`).bind(positiveId(userId)).first();
	if (!row) throw new BizError('Your session has expired.', 401);
	return row;
}

function guardStatements(c, sql, bindings, expected) {
	return [c.env.db.prepare('DELETE FROM installation_guard'), c.env.db.prepare(`INSERT INTO installation_guard(valid)
		SELECT CASE WHEN (SELECT COUNT(*) FROM email e WHERE ${sql})=? THEN 1 ELSE 0 END`).bind(...bindings, expected)];
}

async function applyBatch(c, statements) {
	try { return await c.env.db.batch([...statements, c.env.db.prepare('DELETE FROM installation_guard')]); }
	catch (error) {
		if (/CHECK constraint failed|constraint.*valid/i.test(String(error?.message || ''))) throw new BizError('Selection changed; refresh and try again.', 409);
		throw error;
	}
}

async function deleteWhere(c, where, bindings, expected) {
	await assertObjectDeleteQueue(c);
	const eligible = `SELECT e.email_id FROM email e WHERE ${where}`;
	const attachmentWhere = `email_id IN (${eligible}) AND EXISTS
		(SELECT 1 FROM email e WHERE e.email_id=attachments.email_id AND e.account_id=attachments.account_id AND e.user_id=attachments.user_id)`;
	const results = await applyBatch(c, [...guardStatements(c, where, bindings, expected),
		c.env.db.prepare(`INSERT OR IGNORE INTO object_delete_queue(key) SELECT DISTINCT key FROM attachments WHERE ${attachmentWhere} AND key<>''`).bind(...bindings),
		c.env.db.prepare(`DELETE FROM attachments WHERE ${attachmentWhere}`).bind(...bindings),
		c.env.db.prepare(`DELETE FROM star WHERE email_id IN (${eligible})`).bind(...bindings),
		c.env.db.prepare(`DELETE FROM email AS e WHERE ${where} RETURNING email_id AS emailId`).bind(...bindings)]);
	return { emailIds: results[5].results.map(row => row.emailId), deletedCount: expected };
}

const mailRecoveryService = {
	async list(c, params, userId) {
		await activeUser(c, userId);
		await requireRecoverySchema(c);
		const { page, size, offset } = pageParams(params);
		const keyword = String(params?.keyword || '').trim();
		if (new TextEncoder().encode(keyword).length > 64) throw new BizError('Search keyword is too long.', 400);
		let where = `${ownedTrashSql} AND ${withinRetentionSql}`;
		const bindings = [userId];
		if (keyword) { where += ' AND (e.subject LIKE ? OR e.send_email LIKE ? OR e.to_email LIKE ? OR e.text LIKE ?)'; bindings.push(...Array(4).fill(`%${keyword}%`)); }
		const count = await c.env.db.prepare(`SELECT COUNT(*) AS total FROM email e WHERE ${where}`).bind(...bindings).first();
		const rows = await c.env.db.prepare(`SELECT e.email_id AS emailId,e.account_id AS accountId,e.type,e.subject,e.send_email AS sendEmail,
			e.to_email AS toEmail,e.name,e.create_time AS createTime,e.unread,e.deleted_at AS deletedAt,datetime(e.deleted_at,'+30 days') AS expiresAt,
			a.email AS mailbox,a.is_del AS accountDeleted,
			EXISTS (SELECT 1 FROM attachments t WHERE t.email_id=e.email_id AND t.user_id=e.user_id AND t.account_id=e.account_id AND t.type=0) AS hasAttachments
			FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id
			WHERE ${where} ORDER BY e.email_id DESC LIMIT ? OFFSET ?`).bind(...bindings, size, offset).all();
		return { list: (rows.results || []).map(row => ({ ...row, canRestore: row.accountDeleted === 0 })), total: count.total, page, size };
	},

	async detail(c, id, userId) {
		await activeUser(c, userId);
		await requireRecoverySchema(c);
		const emailId = positiveId(id);
		const stored = await c.env.db.prepare(`SELECT e.*,a.is_del AS accountDeleted,a.email AS mailbox FROM email e
			JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id WHERE ${ownedTrashSql} AND ${withinRetentionSql} AND e.email_id=?`).bind(userId, emailId).first();
		if (!stored) throw new BizError('Message not found in Trash.', 404);
		const row = Object.fromEntries(Object.entries(stored).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
		const attachments = await c.env.db.prepare(`SELECT att_id AS attId,key,filename,mime_type AS mimeType,size,type FROM attachments
			WHERE email_id=? AND user_id=? AND account_id=? AND status=0 AND type=0`).bind(emailId, userId, row.accountId).all();
		return { ...row, bcc: row.type === 1 && row.userId === userId ? row.bcc : '[]', content: sanitizeEmailHtml(row.content), attachments: attachments.results || [], canRestore: row.accountDeleted === 0 };
	},

	async restore(c, body, userId) {
		await activeUser(c, userId);
		await requireRecoverySchema(c);
		const ids = selectedIds(body?.emailIds);
		const where = `${restoreTrashSql} AND ${withinRetentionSql} AND e.email_id IN (${ids.map(() => '?').join(',')})`;
		const bindings = [userId, ...ids];
		const results = await applyBatch(c, [...guardStatements(c, where, bindings, ids.length),
			c.env.db.prepare(`UPDATE email AS e SET is_del=0 WHERE ${where} RETURNING email_id AS emailId`).bind(...bindings)]);
		return { emailIds: results[2].results.map(row => row.emailId), restoredCount: ids.length };
	},

	async purge(c, body, userId) {
		await activeUser(c, userId);
		await requireRecoverySchema(c);
		const ids = selectedIds(body?.emailIds);
		const where = `${ownedTrashSql} AND e.email_id IN (${ids.map(() => '?').join(',')})`;
		const bindings = [userId, ...ids];
		// Queue and metadata removal commit together. The existing delayed collector
		// checks references across every user before removing a shared R2 object.
		return deleteWhere(c, where, bindings, ids.length);
	},

	async previewEmpty(c, userId) {
		await activeUser(c, userId);
		await requireRecoverySchema(c);
		const rows = await c.env.db.prepare(`SELECT e.email_id AS id,e.deleted_at AS deletedAt,e.trash_revision AS trashRevision FROM email e WHERE ${ownedTrashSql} ORDER BY e.email_id LIMIT ?`).bind(userId, snapshotLimit).all();
		const count = await c.env.db.prepare(`SELECT COUNT(*) AS n FROM email e WHERE ${ownedTrashSql}`).bind(userId).first();
		const token = crypto.randomUUID();
		await c.env.kv.put('trash-empty:' + token, JSON.stringify({ userId, sessionHash: c.get?.('session')?.hash || '', items: rows.results || [] }), { expirationTtl: 300 });
		return { token, count: rows.results.length, total: count.n, limited: count.n > rows.results.length };
	},

	async emptyTrash(c, body, userId) {
		await activeUser(c, userId);
		await requireRecoverySchema(c);
		const token = body?.token, offset = body?.offset ?? 0;
		if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token) || !Number.isSafeInteger(offset) || offset < 0 || offset % snapshotBatch !== 0) throw new BizError('Invalid Trash snapshot.', 400);
		const receipt = await c.env.kv.get('trash-empty:' + token, { type: 'json' });
		if (!receipt || receipt.userId !== userId || receipt.sessionHash !== (c.get?.('session')?.hash || '')) throw new BizError('Trash snapshot expired; refresh and confirm again.', 409);
		const items = receipt.items.slice(offset, offset + snapshotBatch);
		if (!items.length) return { deletedCount: 0, nextOffset: null };
		if (items.some(item => !Number.isSafeInteger(item.trashRevision) || item.trashRevision < 0)) throw new BizError('Trash snapshot expired; refresh and confirm again.', 409);
		// A deletion generation is never reused after restore/re-delete, even
		// when both deletion timestamps fall in the same second.
		const where = `${ownedTrashSql} AND (${items.map(() => '(e.email_id=? AND e.trash_revision=?)').join(' OR ')})`;
		const bindings = [userId, ...items.flatMap(item => [item.id, item.trashRevision])];
		const count = await c.env.db.prepare(`SELECT COUNT(*) AS n FROM email e WHERE ${where}`).bind(...bindings).first();
		const result = count.n ? await deleteWhere(c, where, bindings, count.n) : { deletedCount: 0 };
		return { ...result, nextOffset: offset + items.length < receipt.items.length ? offset + snapshotBatch : null };
	},

	async cleanup(c) {
		if (!await recoveryReady(c)) return { deletedCount: 0, upgradeRequired: true };
		const expired = "e.is_del=1 AND e.status<>6 AND e.deleted_at IS NOT NULL AND e.deleted_at<=datetime('now','-30 days')";
		const rows = await c.env.db.prepare(`SELECT e.email_id AS id FROM email e WHERE ${expired} ORDER BY e.deleted_at,e.email_id LIMIT 90`).all();
		const ids = rows.results.map(row => row.id);
		if (!ids.length) return { deletedCount: 0 };
		const where = `${expired} AND e.email_id IN (${ids.map(() => '?').join(',')})`;
		try { return await deleteWhere(c, where, ids, ids.length); }
		catch (error) { if (error?.code === 409) return { deletedCount: 0, changed: true }; throw error; }
	},

	async aliases(c, params, userId) {
		const user = await activeUser(c, userId);
		const { page, size, offset } = pageParams(params);
		const state = await managedDomainService.get(c);
		const activeDomains = new Set(state.entries.filter(entry => entry.enabled).map(entry => entry.domain));
		const where = 'user_id=? AND is_del=1 AND email<>? COLLATE NOCASE';
		const rows = await c.env.db.prepare(`SELECT account_id AS accountId,email,name FROM account WHERE ${where} ORDER BY account_id DESC LIMIT ? OFFSET ?`).bind(userId, user.email, size, offset).all();
		const count = await c.env.db.prepare(`SELECT COUNT(*) AS total FROM account WHERE ${where}`).bind(userId, user.email).first();
		return { list: (rows.results || []).map(row => ({ ...row, domainActive: activeDomains.has(row.email.split('@').at(-1).toLowerCase()) })), total: count.total, page, size };
	},

	async restoreAlias(c, body, userId) {
		const user = await activeUser(c, userId);
		const accountId = positiveId(body?.accountId);
		const row = await c.env.db.prepare('SELECT email FROM account WHERE account_id=? AND user_id=? AND is_del=1 AND email<>? COLLATE NOCASE').bind(accountId, userId, user.email).first();
		if (!row) throw new BizError('Deleted alias not found.', 404);
		const state = await managedDomainService.get(c);
		if (!state.entries.some(entry => entry.enabled && entry.domain === row.email.split('@').at(-1).toLowerCase())) throw new BizError('Enable the alias domain before restoring it.', 403);
		// The revision predicate and current user/quota checks live in the same
		// statement as restoration, including changes after the preflight above.
		const restored = await c.env.db.prepare(`UPDATE account SET is_del=0 WHERE account_id=? AND user_id=? AND is_del=1
			AND email=? COLLATE NOCASE AND EXISTS (SELECT 1 FROM installation_state WHERE id=1 AND revision=?)
			AND EXISTS (SELECT 1 FROM user u WHERE u.user_id=account.user_id AND u.is_del=0 AND u.status=0 AND u.email<>account.email COLLATE NOCASE
			AND (u.is_admin=1 OR (SELECT COUNT(*) FROM account a WHERE a.user_id=u.user_id AND a.is_del=0)<u.account_limit))
			RETURNING account_id AS accountId,email,name`).bind(accountId, userId, row.email, state.revision).first();
		if (!restored) throw new BizError('Alias or domain changed, or mailbox limit reached; refresh and try again.', 409);
		return { ...restored, accountCount: (await c.env.db.prepare('SELECT COUNT(*) AS n FROM account WHERE user_id=? AND is_del=0').bind(userId).first()).n,
			accountLimit: isAdmin(user) ? 0 : user.accountLimit };
	},
};

export default mailRecoveryService;
