// Domain admission is checked again at the database boundary. A request which
// passed a preflight before a domain was disabled must not create an orphaned
// identity or start storing a new message afterwards.
const installed = "EXISTS (SELECT 1 FROM installation_state WHERE id=1 AND status='installed')";
const active = value => `EXISTS (SELECT 1 FROM managed_domain WHERE domain=substr(${value},instr(${value},'@')+1) COLLATE NOCASE AND enabled=1)`;
const revision = "UPDATE installation_state SET revision=revision+1,update_time=CURRENT_TIMESTAMP WHERE id=1 AND status='installed';";

export const DOMAIN_TRIGGERS = {
	domain_account_insert: `CREATE TRIGGER domain_account_insert BEFORE INSERT ON account WHEN ${installed} AND NOT ${active('NEW.email')} BEGIN SELECT RAISE(ABORT,'Managed domain is inactive.'); END`,
	domain_user_insert: `CREATE TRIGGER domain_user_insert BEFORE INSERT ON user WHEN ${installed} AND NOT ${active('NEW.email')} BEGIN SELECT RAISE(ABORT,'Managed domain is inactive.'); END`,
	domain_account_update: `CREATE TRIGGER domain_account_update BEFORE UPDATE OF email ON account WHEN lower(NEW.email)<>lower(OLD.email) AND ${installed} AND NOT ${active('NEW.email')} BEGIN SELECT RAISE(ABORT,'Managed domain is inactive.'); END`,
	domain_user_update: `CREATE TRIGGER domain_user_update BEFORE UPDATE OF email ON user WHEN lower(NEW.email)<>lower(OLD.email) AND ${installed} AND NOT ${active('NEW.email')} BEGIN SELECT RAISE(ABORT,'Managed domain is inactive.'); END`,
	domain_message_insert: `CREATE TRIGGER domain_message_insert BEFORE INSERT ON email WHEN ${installed} AND NEW.status=6 AND (NOT ${active('CASE WHEN NEW.type=1 THEN NEW.send_email ELSE NEW.to_email END')} OR (NEW.account_id>0 AND NOT EXISTS (SELECT 1 FROM account a WHERE a.account_id=NEW.account_id AND a.user_id=NEW.user_id AND a.is_del=0 AND a.email=CASE WHEN NEW.type=1 THEN NEW.send_email ELSE NEW.to_email END COLLATE NOCASE))) BEGIN SELECT RAISE(ABORT,'Managed domain is inactive.'); END`,
};
for (const table of ['account', 'user']) {
	for (const event of ['INSERT', 'DELETE', `UPDATE OF email,is_del,status${table === 'account' ? ',user_id' : ''}`]) {
		const name = `domain_revision_${table}_${event.split(' ')[0].toLowerCase()}`;
		DOMAIN_TRIGGERS[name] = `CREATE TRIGGER ${name} AFTER ${event} ON ${table} BEGIN ${revision} END`;
	}
}

function sameSql(a, b) { return String(a).replace(/\s+/g, ' ').trim() === String(b).replace(/\s+/g, ' ').trim(); }

export async function domainSchemaValid(c, allowMissing = false) {
	const columns = (await c.env.db.prepare("PRAGMA table_info('managed_domain')").all()).results || [];
	const column = columns.find(item => item.name === 'enabled');
	if (!column && !allowMissing) return false;
	if (column && (column.type !== 'INTEGER' || column.notnull !== 1 || column.dflt_value !== '1' || column.pk !== 0)) return false;
	if (column) {
		const table = await c.env.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='managed_domain'").first();
		if (!String(table?.sql || '').replace(/\s+/g,'').toLowerCase().includes('check(enabledin(0,1))')) return false;
	}
	if (column && await c.env.db.prepare('SELECT 1 FROM managed_domain WHERE enabled NOT IN (0,1) OR enabled IS NULL LIMIT 1').first()) return false;
	for (const [name, sql] of Object.entries(DOMAIN_TRIGGERS)) {
		const row = await c.env.db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').bind(name).first();
		if (!row && allowMissing) continue;
		if (row?.type !== 'trigger' || !sameSql(row.sql, sql)) return false;
	}
	return true;
}

export function domainSchemaStatements(db, addColumn) {
	return [
		...(addColumn ? [db.prepare('ALTER TABLE managed_domain ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))')] : []),
		...Object.values(DOMAIN_TRIGGERS).map(sql => db.prepare(sql.replace('CREATE TRIGGER ', 'CREATE TRIGGER IF NOT EXISTS '))),
	];
}
