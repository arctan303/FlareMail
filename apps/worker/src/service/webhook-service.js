import BizError from '../error/biz-error';

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS = [60000, 300000, 1800000, 7200000];
const MAX_AGE = 86400000;
const configProjection = `account_id AS accountId, user_id AS userId, url, secret, enabled, mode, allowlist, revision, updated_at AS updatedAt`;
const selectConfig = `SELECT ${configProjection} FROM webhook_config WHERE user_id = ? AND account_id = ?`;
const selectDelivery = `SELECT event_id AS eventId, account_id AS accountId, user_id AS userId,
	email_id AS emailId, mailbox, event_type AS event, revision, status, attempts, next_at AS nextAt,
	lease_until AS leaseUntil, http_status AS httpStatus, error, created_at AS createdAt, updated_at AS updatedAt
	FROM webhook_delivery`;

export function normalizeWebhookUrl(value) {
	let url;
	try { url = new URL(value); } catch { throw new BizError('Invalid webhook URL.'); }
	const host = url.hostname.toLowerCase();
	if (typeof value !== 'string' || value.length > 2048 || url.protocol !== 'https:' || url.username || url.password
		|| url.hash || (url.port && url.port !== '443') || host.length > 253
		|| !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
		|| /(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(host)) {
		throw new BizError('Use a public HTTPS hostname on port 443, without credentials or a fragment.');
	}
	return url.href;
}

function normalizeAllowlist(value) {
	if (!Array.isArray(value) || value.length > 100 || value.some(address => typeof address !== 'string'
		|| address.length > 254 || !/^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(address.trim()))) {
		throw new BizError('Allowlist must contain at most 100 complete email addresses.');
	}
	return [...new Set(value.map(address => address.trim().toLowerCase()))];
}

function validateSecret(secret) {
	if (typeof secret !== 'string' || !/^[\x21-\x7e]{32,256}$/.test(secret)) throw new BizError('Webhook secret must be 32–256 printable ASCII characters without spaces.');
	return secret;
}

function generatedSecret() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function publicConfig(row, accountId) {
	if (!row?.url) return { accountId, url: '', enabled: false, mode: null, allowlist: [], hasSecret: false, revision: row?.revision || 0 };
	const { secret, userId, ...safe } = row;
	return { ...safe, enabled: !!row.enabled, allowlist: JSON.parse(row.allowlist), hasSecret: !!secret };
}

async function ready(c) {
	const marker = await c.env.db.prepare('SELECT 1 FROM schema_migrations WHERE version = 327').first();
	if (!marker) throw new BizError('Upgrade the database in system settings to enable webhooks.', 503);
}

async function ownedAccount(c, userId, accountId) {
	if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new BizError('Invalid account ID.');
	const row = await c.env.db.prepare('SELECT email FROM account WHERE account_id = ? AND user_id = ? AND is_del = 0')
		.bind(accountId, userId).first();
	if (!row) throw new BizError('Mailbox not found.', 404);
	return row;
}

function validRevision(value) {
	if (!Number.isSafeInteger(value) || value < 0) throw new BizError('A current configuration revision is required.');
}

function cancelOld(db, userId, accountId) {
	return db.prepare(`UPDATE webhook_delivery SET status = 'cancelled', error = 'configuration_changed', updated_at = ?
		WHERE user_id = ? AND account_id = ? AND status IN ('pending','sending')
		AND revision <> COALESCE((SELECT revision FROM webhook_config WHERE user_id = ? AND account_id = ?), -1)`)
		.bind(Date.now(), userId, accountId, userId, accountId);
}

const webhookService = {
	async completeReceive(c, status, emailId) {
		const update = c.env.db.prepare('UPDATE email SET status=?, is_del=0 WHERE email_id=?').bind(status, emailId);
		const available = await c.env.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webhook_config'").first();
		if (!available) { await update.run(); return; }
		// Commit readable mail and its outbox event together, only after the
		// attachment path succeeds. Legacy SAVING-row recovery cannot emit events.
		await c.env.db.batch([update, c.env.db.prepare(`INSERT OR IGNORE INTO webhook_delivery
			(event_id,account_id,user_id,email_id,mailbox,event_type,revision,next_at,created_at,updated_at)
			SELECT lower(hex(randomblob(16))),e.account_id,e.user_id,e.email_id,a.email,'email.received',w.revision,?,?,?
			FROM email e JOIN webhook_config w ON w.account_id=e.account_id AND w.user_id=e.user_id
			JOIN account a ON a.account_id=w.account_id AND a.user_id=w.user_id AND a.is_del=0
			JOIN user u ON u.user_id=w.user_id AND u.is_del=0 AND u.status=0
			WHERE e.email_id=? AND e.type=0 AND e.status=0 AND e.is_del=0 AND w.enabled=1
			AND (w.mode='all' OR EXISTS (SELECT 1 FROM json_each(w.allowlist) WHERE value=lower(trim(e.send_email))))`)
			.bind(Date.now(), Date.now(), Date.now(), emailId)]);
	},
	async get(c, userId, accountId) {
		await ownedAccount(c, userId, accountId);
		await ready(c);
		return publicConfig(await c.env.db.prepare(selectConfig).bind(userId, accountId).first(), accountId);
	},
	async save(c, userId, accountId, body) {
		await ownedAccount(c, userId, accountId);
		await ready(c);
		if (!body || typeof body !== 'object' || Array.isArray(body)
			|| Object.keys(body).some(key => !['revision', 'url', 'enabled', 'mode', 'allowlist', 'secret'].includes(key))
			|| typeof body.enabled !== 'boolean' || !['all', 'allowlist'].includes(body.mode)) throw new BizError('Invalid webhook configuration. Choose all senders or allowlist.');
		validRevision(body.revision);
		const url = normalizeWebhookUrl(body.url);
		const allowlist = JSON.stringify(normalizeAllowlist(body.allowlist ?? []));
		const previous = await c.env.db.prepare(selectConfig).bind(userId, accountId).first();
		const generated = !previous?.secret && body.secret === undefined ? generatedSecret() : null;
		const secret = validateSecret(body.secret ?? (previous?.secret || generated));
		const now = Date.now();
		const statement = body.revision === 0
			? c.env.db.prepare(`INSERT OR IGNORE INTO webhook_config(account_id,user_id,url,secret,enabled,mode,allowlist,revision,updated_at) VALUES (?,?,?,?,?,?,?,1,?) RETURNING ${configProjection}`)
				.bind(accountId, userId, url, secret, +body.enabled, body.mode, allowlist, now)
			: c.env.db.prepare(`UPDATE webhook_config SET url=?, secret=?, enabled=?, mode=?, allowlist=?, revision=revision+1, updated_at=? WHERE user_id=? AND account_id=? AND revision=? RETURNING ${configProjection}`)
				.bind(url, secret, +body.enabled, body.mode, allowlist, now, userId, accountId, body.revision);
		const results = await c.env.db.batch([statement, cancelOld(c.env.db, userId, accountId)]);
		if (results[0].meta.changes !== 1) throw new BizError('Configuration changed. Reload and retry.', 409);
		const config = publicConfig(results[0].results[0], accountId);
		return generated ? { ...config, secret: generated } : config;
	},
	async remove(c, userId, accountId, revision) {
		await ownedAccount(c, userId, accountId); await ready(c); validRevision(revision);
		const results = await c.env.db.batch([
			// Retain only a revision tombstone so delete/recreate cannot revive old
			// deliveries or let a stale editor overwrite a new configuration.
			c.env.db.prepare("UPDATE webhook_config SET url='', secret='', enabled=0, mode='all', allowlist='[]', revision=revision+1, updated_at=? WHERE user_id=? AND account_id=? AND revision=? AND url<>''").bind(Date.now(), userId, accountId, revision),
			cancelOld(c.env.db, userId, accountId),
		]);
		if (results[0].meta.changes !== 1) throw new BizError('Configuration changed. Reload and retry.', 409);
		return { accountId, deleted: true };
	},
	async rotate(c, userId, accountId, revision) {
		const config = await this.get(c, userId, accountId);
		const secret = generatedSecret();
		const { url, enabled, mode, allowlist } = config;
		if (!config.hasSecret) throw new BizError('Save a webhook configuration first.', 409);
		return { ...await this.save(c, userId, accountId, { revision, url, enabled, mode, allowlist, secret }), secret };
	},
	async deliveries(c, userId, accountId, before) {
		await ownedAccount(c, userId, accountId); await ready(c);
		const parts = before === undefined ? [Number.MAX_SAFE_INTEGER, ''] : String(before).split(':');
		const time = Number(parts[0]); const id = parts[1];
		if (parts.length !== 2 || !Number.isSafeInteger(time) || time <= 0 || !/^[a-zA-Z0-9-]{0,64}$/.test(id)) throw new BizError('Invalid delivery cursor.');
		const rows = (await c.env.db.prepare(`${selectDelivery} WHERE user_id=? AND account_id=? AND (created_at < ? OR (created_at = ? AND event_id < ?)) ORDER BY created_at DESC, event_id DESC LIMIT 50`)
			.bind(userId, accountId, time, time, id).all()).results || [];
		return { list: rows, nextBefore: rows.length === 50 ? `${rows.at(-1).createdAt}:${rows.at(-1).eventId}` : null };
	},
	async test(c, userId, accountId) {
		const account = await ownedAccount(c, userId, accountId); await ready(c);
		const config = await c.env.db.prepare(selectConfig).bind(userId, accountId).first();
		if (!config?.url) throw new BizError('Save a webhook configuration first.', 409);
		const eventId = crypto.randomUUID(); const now = Date.now();
		await c.env.db.prepare(`INSERT INTO webhook_delivery(event_id,account_id,user_id,mailbox,event_type,revision,next_at,created_at,updated_at) VALUES (?,?,?,?, 'webhook.test',?,?,?,?)`)
			.bind(eventId, accountId, userId, account.email, config.revision, now, now, now).run();
		await this.deliver(c, eventId);
		return await c.env.db.prepare(`${selectDelivery} WHERE user_id=? AND event_id=?`).bind(userId, eventId).first();
	},
	async retry(c, userId, accountId, eventId) {
		await ownedAccount(c, userId, accountId); await ready(c);
		const result = await c.env.db.prepare(`UPDATE webhook_delivery SET status='pending', attempts=0, next_at=?, error='', updated_at=?
			WHERE user_id=? AND account_id=? AND event_id=? AND status='failed' AND created_at>?
			AND EXISTS (SELECT 1 FROM webhook_config w WHERE w.account_id=webhook_delivery.account_id AND w.user_id=webhook_delivery.user_id
			AND w.revision=webhook_delivery.revision AND (w.enabled=1 OR webhook_delivery.event_type='webhook.test'))`)
			.bind(Date.now(), Date.now(), userId, accountId, eventId, Date.now() - MAX_AGE).run();
		if (result.meta.changes !== 1) throw new BizError('Delivery is unavailable for retry. Check its state and configuration.', 409);
		this.kick(c);
		return { eventId, status: 'pending' };
	},
	kick(c, emailId) {
		const task = this.drain(c, emailId).catch(() => console.warn('Webhook delivery task failed; pending events remain queued.'));
		try { c.executionCtx?.waitUntil(task); } catch { /* Non-HTTP callers may have no execution context. */ }
		return task;
	},
	async drain(c, emailId) {
		const exists = await c.env.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webhook_delivery'").first();
		if (!exists) return;
		const now = Date.now();
		const rows = (await c.env.db.prepare(`SELECT event_id AS eventId FROM webhook_delivery WHERE
			(status='pending' OR (status='sending' AND lease_until<=?)) AND next_at<=?
			${emailId === undefined ? '' : 'AND email_id=?'} ORDER BY next_at LIMIT 3`)
			.bind(...[now, now, ...(emailId === undefined ? [] : [emailId])]).all()).results || [];
		await Promise.all(rows.map(row => this.deliver(c, row.eventId)));
		await c.env.db.prepare("DELETE FROM webhook_delivery WHERE status IN ('delivered','failed','cancelled') AND updated_at < ?")
			.bind(now - 7 * MAX_AGE).run();
	},
	async deliver(c, eventId) {
		const now = Date.now(); const lease = crypto.randomUUID();
		const row = await c.env.db.prepare(`UPDATE webhook_delivery SET status='sending', attempts=attempts+1,
			lease_until=?, lease_token=?, updated_at=? WHERE event_id=? AND next_at<=? AND
			(status='pending' OR (status='sending' AND lease_until<=?)) RETURNING *`)
			.bind(now + 30000, lease, now, eventId, now, now).first();
		if (!row) return;
		const config = await c.env.db.prepare(`SELECT w.* FROM webhook_config w
			JOIN account a ON a.account_id=w.account_id AND a.user_id=w.user_id AND a.is_del=0
			JOIN user u ON u.user_id=w.user_id AND u.is_del=0 AND u.status=0
			WHERE w.account_id=? AND w.user_id=? AND w.revision=? AND w.url<>'' AND (w.enabled=1 OR ?='webhook.test')
			AND (? IS NULL OR EXISTS (SELECT 1 FROM email e WHERE e.email_id=? AND e.user_id=w.user_id AND e.account_id=w.account_id AND e.is_del=0 AND e.status=0 AND e.type=0))`)
			.bind(row.account_id, row.user_id, row.revision, row.event_type, row.email_id, row.email_id).first();
		let status = 'cancelled'; let error = 'configuration_changed'; let httpStatus = null;
		if (config && now - row.created_at < MAX_AGE && row.attempts <= MAX_ATTEMPTS) {
			try {
				const url = normalizeWebhookUrl(config.url);
				const response = await fetch(url, {
					method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
					headers: { 'Content-Type': 'application/json', 'X-FlareMail-Webhook-Secret': validateSecret(config.secret) },
					body: JSON.stringify({ event: row.event_type, eventId, emailId: row.email_id, mailbox: row.mailbox }),
				});
				httpStatus = response.status;
				await response.body?.cancel();
				status = response.ok ? 'delivered' : 'pending';
				error = response.ok ? '' : 'http_error';
			} catch { status = 'pending'; error = 'network_or_target_error'; }
			if (status === 'pending' && row.attempts >= MAX_ATTEMPTS) status = 'failed';
		} else if (config) { status = 'failed'; error = 'expired'; }
		await c.env.db.prepare(`UPDATE webhook_delivery SET status=?, error=?, http_status=?, next_at=?, lease_until=0, lease_token='', updated_at=?
			WHERE event_id=? AND status='sending' AND lease_token=?`)
			.bind(status, error, httpStatus, Date.now() + (RETRY_DELAYS[row.attempts - 1] || 0), Date.now(), eventId, lease).run();
	},
};

export default webhookService;
