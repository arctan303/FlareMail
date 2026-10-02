import { getTableColumns } from 'drizzle-orm';
import user from '../entity/user';

// Keep password login and the administrator's additive upgrade available on
// an intact pre-326 database. Read the epoch in the same SELECT as credentials.
export async function sessionEpochColumns(c) {
	const columns = await c.env.db.prepare("PRAGMA table_info('user')").all();
	const names = new Set((columns.results || []).map(column => column.name));
	const revocations = !!await c.env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_revocation'").first();
	const migrated = revocations && !!await c.env.db.prepare('SELECT version FROM schema_migrations WHERE version = 326').first();
	return { epoch: names.has('session_epoch'), preserved: names.has('preserved_session_hash'), revocations, migrated };
}

export async function selectSecurityUser(c, predicate, values) {
	// SELECT * observes credentials and whatever epoch columns actually exist
	// in one D1 snapshot, including when an additive upgrade runs concurrently.
	const row = await c.env.db.prepare(`SELECT * FROM user WHERE ${predicate}`).bind(...values).first();
	if (!row) return null;
	const result = Object.fromEntries(Object.entries(getTableColumns(user)).map(([name, column]) => [name, row[column.name]]));
	return { ...result, sessionEpoch: sessionEpoch(row.session_epoch), preservedSessionHash: row.preserved_session_hash || '' };
}

export function sessionEpoch(value) {
	return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
