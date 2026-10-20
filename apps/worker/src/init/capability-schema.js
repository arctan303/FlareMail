export const CAPABILITY_TABLES = {
  mail_delivery_config: `CREATE TABLE mail_delivery_config (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), secret TEXT NOT NULL DEFAULT '')`,
  mail_delivery_event: `CREATE TABLE mail_delivery_event (event_id TEXT PRIMARY KEY NOT NULL, provider_id TEXT NOT NULL, event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, recipients TEXT NOT NULL DEFAULT '[]', detail TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
};
export const CAPABILITY_TRIGGERS = {
  mail_trash_mark: `CREATE TRIGGER mail_trash_mark AFTER UPDATE OF is_del ON email WHEN OLD.is_del=0 AND NEW.is_del=1 AND NEW.status<>6 BEGIN UPDATE email SET deleted_at=CURRENT_TIMESTAMP,trash_revision=OLD.trash_revision+1 WHERE email_id=NEW.email_id; END`,
  mail_trash_restore: `CREATE TRIGGER mail_trash_restore AFTER UPDATE OF is_del ON email WHEN OLD.is_del=1 AND NEW.is_del=0 BEGIN UPDATE email SET deleted_at=NULL WHERE email_id=NEW.email_id; END`,
};
const normalize = sql => String(sql).replace(/\s+/g,' ').trim();
export async function capabilitySchemaValid(c, allowMissing=false) {
  for (const [table,name,type,nullable,defaultValue] of [['send_request','payload_hash','TEXT',false,"''"],['email','deleted_at','TEXT',true,null],['email','trash_revision','INTEGER',false,'0'],['email','delivery_provider','TEXT',false,"''"],['email','delivery_recipients','TEXT',false,"'[]'"],['email','ingress_source','TEXT',false,"''"]]) {
    const column=((await c.env.db.prepare(`PRAGMA table_info('${table}')`).all()).results||[]).find(row=>row.name===name);
    if (!column) { if(allowMissing) continue; return false; }
    if(column.type!==type || column.notnull!==+!nullable || column.pk!==0 || column.dflt_value!==defaultValue) return false;
  }
  for(const [name,definition] of Object.entries({...CAPABILITY_TABLES,...CAPABILITY_TRIGGERS})) {
    const row=await c.env.db.prepare('SELECT sql FROM sqlite_master WHERE name=?').bind(name).first();
    if(!row&&allowMissing) continue;
    if(!row || normalize(row.sql)!==normalize(definition)) return false;
  }
  if(!allowMissing) {
    const config=await c.env.db.prepare('SELECT id,revision,secret FROM mail_delivery_config WHERE id=1').first();
    if(!config || !Number.isSafeInteger(config.revision) || config.revision<0 || typeof config.secret!=='string') return false;
  }
  return true;
}
export async function capabilitySchemaStatements(c) {
  const statements=[];
  for(const [table,name,definition] of [['send_request','payload_hash',"TEXT NOT NULL DEFAULT ''"],['email','deleted_at','TEXT'],['email','trash_revision','INTEGER NOT NULL DEFAULT 0 CHECK(trash_revision>=0)'],['email','delivery_provider',"TEXT NOT NULL DEFAULT ''"],['email','delivery_recipients',"TEXT NOT NULL DEFAULT '[]'"],['email','ingress_source',"TEXT NOT NULL DEFAULT ''"]]) {
    const columns=(await c.env.db.prepare(`PRAGMA table_info('${table}')`).all()).results||[];
    if(!columns.some(column=>column.name===name)) statements.push(c.env.db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`));
  }
  statements.push(...Object.values(CAPABILITY_TABLES).map(sql=>c.env.db.prepare(sql.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS '))));
  statements.push(c.env.db.prepare('INSERT OR IGNORE INTO mail_delivery_config(id) VALUES (1)'));
  statements.push(c.env.db.prepare('CREATE INDEX IF NOT EXISTS mail_delivery_provider ON mail_delivery_event(provider_id,occurred_at)'));
  statements.push(...Object.values(CAPABILITY_TRIGGERS).map(sql=>c.env.db.prepare(sql.replace('CREATE TRIGGER ','CREATE TRIGGER IF NOT EXISTS '))));
  statements.push(c.env.db.prepare('UPDATE email SET deleted_at=CURRENT_TIMESTAMP WHERE is_del=1 AND status<>6 AND deleted_at IS NULL'));
  statements.push(c.env.db.prepare('UPDATE email SET trash_revision=1 WHERE is_del=1 AND status<>6 AND trash_revision=0'));
  return statements;
}
