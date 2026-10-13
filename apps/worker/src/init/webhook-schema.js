export const WEBHOOK_TABLE_COLUMNS = {
	webhook_config: ['account_id', 'user_id', 'url', 'secret', 'enabled', 'mode', 'allowlist', 'revision', 'updated_at'],
	webhook_delivery: ['event_id', 'account_id', 'user_id', 'email_id', 'mailbox', 'event_type', 'revision', 'status', 'attempts', 'next_at', 'lease_until', 'lease_token', 'http_status', 'error', 'created_at', 'updated_at'],
};

export function webhookSchemaStatements(db) {
	return [
		db.prepare(`CREATE TABLE IF NOT EXISTS webhook_config (
			account_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
			url TEXT NOT NULL, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
			mode TEXT NOT NULL CHECK(mode IN ('all','allowlist')), allowlist TEXT NOT NULL DEFAULT '[]',
			revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
		)`),
		db.prepare(`CREATE TABLE IF NOT EXISTS webhook_delivery (
			event_id TEXT PRIMARY KEY NOT NULL, account_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
			email_id INTEGER, mailbox TEXT NOT NULL, event_type TEXT NOT NULL, revision INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
			next_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '',
			http_status INTEGER, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
			UNIQUE(email_id)
		)`),
		db.prepare('CREATE INDEX IF NOT EXISTS idx_webhook_due ON webhook_delivery(status, next_at)'),
		db.prepare('CREATE INDEX IF NOT EXISTS idx_webhook_owner ON webhook_delivery(user_id, account_id, created_at)'),
	];
}

export async function webhookSchemaValid(c, allowMissing = false) {
	const defaults = {
		webhook_config: { enabled: '0', allowlist: "'[]'", revision: '1' },
		webhook_delivery: { status: "'pending'", attempts: '0', lease_until: '0', lease_token: "''", error: "''" },
	};
	for (const [table, columns] of Object.entries(WEBHOOK_TABLE_COLUMNS)) {
		const info = (await c.env.db.prepare(`PRAGMA table_info('${table}')`).all()).results || [];
		if (!info.length && allowMissing) continue;
		if (info.length !== columns.length || !columns.every(name => info.some(column => column.name === name))) return false;
		const primary = table === 'webhook_config' ? 'account_id' : 'event_id';
		const text = new Set(['url','secret','mode','allowlist','event_id','mailbox','event_type','status','lease_token','error']);
		if (info.some(column => column.type !== (text.has(column.name) ? 'TEXT' : 'INTEGER') || column.pk !== (column.name === primary ? 1 : 0))) return false;
		if (info.some(column => column.notnull !== (['email_id','http_status'].includes(column.name) || (table === 'webhook_config' && column.name === primary) ? 0 : 1))) return false;
		if (info.some(column => column.dflt_value !== (defaults[table][column.name] ?? null))) return false;
		const indexes = (await c.env.db.prepare(`PRAGMA index_list('${table}')`).all()).results || [];
		if (table === 'webhook_delivery') {
			let uniqueEmail = false;
			for (const index of indexes.filter(index => index.unique)) {
				const fields = (await c.env.db.prepare(`PRAGMA index_info('${index.name.replaceAll("'", "''")}')`).all()).results || [];
				if (fields.length === 1 && fields[0].name === 'email_id' && !index.partial) uniqueEmail = true;
			}
			if (!uniqueEmail) return false;
		}
	}
	for (const [name, columns] of [['idx_webhook_due',['status','next_at']], ['idx_webhook_owner',['user_id','account_id','created_at']]]) {
		const object = await c.env.db.prepare('SELECT type,tbl_name FROM sqlite_master WHERE name=?').bind(name).first();
		if (!object && allowMissing) continue;
		if (object?.type !== 'index' || object.tbl_name !== 'webhook_delivery') return false;
		const indexes = (await c.env.db.prepare("PRAGMA index_list('webhook_delivery')").all()).results || [];
		if (!indexes.some(index => index.name === name && !index.unique && !index.partial)) return false;
		const fields = (await c.env.db.prepare(`PRAGMA index_info('${name}')`).all()).results || [];
		if (fields.length !== columns.length || fields.some((field, index) => field.name !== columns[index])) return false;
	}
	return true;
}
