import {CAPABILITY_TRIGGERS} from '../src/init/capability-schema';
// Only for tests that deliberately reconstruct an older or damaged database.
// Newer patch state must not survive in an asserted 323/324 fixture.
export async function removeCapabilityPatch(env) {
  for(const name of Object.keys(CAPABILITY_TRIGGERS)) await env.db.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
  for(const table of ['mail_delivery_event','mail_delivery_config']) await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  for(const [table,column] of [['email','deleted_at'],['email','trash_revision'],['email','delivery_provider'],['email','delivery_recipients'],['email','ingress_source'],['send_request','payload_hash']]) {
    const columns=(await env.db.prepare(`PRAGMA table_info('${table}')`).all()).results||[];
    if(columns.some(row=>row.name===column))await env.db.prepare(`ALTER TABLE ${table} DROP COLUMN ${column}`).run();
  }
  const marker=await env.db.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").first();
  if(marker)await env.db.prepare('DELETE FROM schema_migrations WHERE version=329').run();
}
