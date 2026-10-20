// Only the Cloudflare Email handler calls this after accepting an external
// envelope. Header content and ordinary type=0 rows are not ingress evidence.
export async function markExternalIngress(c,emailId) {
  const columns=(await c.env.db.prepare("PRAGMA table_info('email')").all()).results||[];
  if(columns.some(column=>column.name==='ingress_source'))await c.env.db.prepare("UPDATE email SET ingress_source='external' WHERE email_id=? AND type=0").bind(emailId).run();
}
