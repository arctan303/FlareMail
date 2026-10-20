import { Resend } from 'resend';
import BizError from '../error/biz-error';
import { emailConst } from '../const/entity-const';

const statusFor = {'email.sent':1,'email.delivered':2,'email.bounced':3,'email.complained':4,'email.delivery_delayed':5,'email.failed':8,'email.suppressed':8};
const asAddresses = value => {
  try { return (Array.isArray(value)?value:JSON.parse(value||'[]')).map(item=>String(typeof item==='string'?item:item?.address||'').trim().toLowerCase()).filter(Boolean); }
  catch { return []; }
};
async function config(c) {
  try {
    const row=await c.env.db.prepare('SELECT revision,secret FROM mail_delivery_config WHERE id=1').first();
    if(row) return row;
  } catch(error) { if(!/no such table/i.test(String(error.message))) throw error; }
  throw new BizError('Database patch 329 is required for delivery tracking.',503);
}
function publicConfig(c,row) {return {revision:row.revision,secretConfigured:!!row.secret,webhookUrl:new URL('/api/delivery/resend',c.req.url).href};}

const mailDeliveryService = {
  async getConfig(c) {return publicConfig(c,await config(c));},
  async setConfig(c,body) {
    if(!body || Array.isArray(body) || Object.keys(body).some(key=>!['revision','secretAction','secret'].includes(key)) || !Number.isSafeInteger(body.revision) || !['keep','replace','clear'].includes(body.secretAction)) throw new BizError('Invalid delivery configuration.',400);
    const current=await config(c);
    if(body.secretAction!=='replace' && Object.hasOwn(body,'secret')) throw new BizError('Invalid signing secret action.',400);
    let secret=current.secret;
    if(body.secretAction==='clear') secret='';
    if(body.secretAction==='replace') {
      secret=body.secret;
      if(typeof secret!=='string'||secret.length>512||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw new BizError('Enter the Resend webhook signing secret.',400);
      try {if(atob(secret.slice(6)).length<16) throw new Error();} catch {throw new BizError('Invalid signing secret.',400);}
    }
    const row=await c.env.db.prepare('UPDATE mail_delivery_config SET secret=?,revision=revision+1 WHERE id=1 AND revision=? RETURNING revision,secret').bind(secret,body.revision).first();
    if(!row) throw new BizError('Delivery configuration changed. Reload and try again.',409);
    return publicConfig(c,row);
  },
  async receive(c,payload) {
    const current=await config(c);
    if(!current.secret) throw new BizError('Delivery tracking is not configured.',503);
    const id=c.req.header('svix-id');
    const timestamp=c.req.header('svix-timestamp');
    const signature=c.req.header('svix-signature');
    if(!id||id.length>200||!/^\d{1,12}$/.test(timestamp||'')||!signature||signature.length>2048) throw new BizError('Invalid delivery signature.',403);
    let event;
    try {event=new Resend('re_verify_only').webhooks.verify({payload,headers:{id,timestamp,signature},webhookSecret:current.secret});}
    catch {throw new BizError('Invalid delivery signature.',403);}
    if(!Object.hasOwn(statusFor,event?.type)) return {accepted:true,ignored:true};
    const providerId=event.data?.email_id;
    const occurred=Date.parse(event.created_at);
    if(typeof providerId!=='string'||providerId.length>200||!providerId||!Number.isFinite(occurred)||occurred>Date.now()+300000) throw new BizError('Invalid delivery event.',400);
    const recipients=asAddresses(event.data?.to);
    if(!recipients.length||recipients.length>100||recipients.some(address=>address.length>320||/[\r\n]/.test(address))) throw new BizError('Invalid delivery recipients.',400);
    // Only keep bounded operational details, never the full event/body or credentials.
    const detail=String(event.data?.bounce?.message || event.data?.failed?.reason || event.data?.suppressed?.message || '').slice(0,1000);
    const inserted=await c.env.db.prepare('INSERT OR IGNORE INTO mail_delivery_event(event_id,provider_id,event_type,occurred_at,recipients,detail) VALUES (?,?,?,?,?,?) RETURNING event_id').bind(id,providerId,event.type,new Date(occurred).toISOString(),JSON.stringify(recipients),detail).first();
    const rows=(await c.env.db.prepare("SELECT email_id FROM email WHERE resend_email_id=? AND delivery_provider='resend' AND type=1 LIMIT 100").bind(providerId).all()).results||[];
    for(const row of rows) await this.reconcile(c,row.email_id);
    return {accepted:true,duplicate:!inserted};
  },
  async reconcile(c,emailId) {
    let row;
    try {
      if(!await c.env.db.prepare('SELECT 1 FROM mail_delivery_config LIMIT 1').first()) return;
      row=await c.env.db.prepare("SELECT email_id,resend_email_id,delivery_provider,delivery_recipients,status FROM email WHERE email_id=? AND type=1").bind(emailId).first();
    } catch(error) {if(/no such table/i.test(String(error.message))) return;throw error;}
    if(!row?.resend_email_id || row.delivery_provider!=='resend' || row.status===emailConst.status.SAVING) return;
    const events=(await c.env.db.prepare('SELECT event_type,occurred_at,recipients FROM mail_delivery_event WHERE provider_id=? ORDER BY occurred_at,event_id LIMIT 2001').bind(row.resend_email_id).all()).results||[];
    if(!events.length||events.length>2000) return;
    const states=new Map();
    for(const event of events) for(const recipient of asAddresses(event.recipients)) {
      const previous=states.get(recipient);
      // Terminal failures and complaints must not be erased by a late success.
      const status=statusFor[event.event_type];
      if(previous===4) continue;
      if(status===4 || !previous || previous===1 || previous===5 || (status===3 && previous!==3) || (status===8 && ![3,4].includes(previous))) states.set(recipient,status);
    }
    const all=[...new Set(asAddresses(row.delivery_recipients))];
    const values=[...states.values()];
    const status=values.includes(4)?4:values.includes(3)?3:values.includes(8)?8:values.includes(5)?5:all.length&&all.every(address=>states.get(address)===2)?2:1;
    const updated=await c.env.db.prepare("UPDATE email SET status=? WHERE email_id=? AND resend_email_id=? AND delivery_provider='resend' AND type=1 AND status<>6 AND (SELECT COUNT(*) FROM mail_delivery_event WHERE provider_id=?)=?").bind(status,emailId,row.resend_email_id,row.resend_email_id,events.length).run();
    // A newer callback won the race. Its own projection remains authoritative;
    // a later read reconciles any incomplete projection without an old write.
    return updated;
  },
  async list(c,emailId,userId) {
    if(!Number.isSafeInteger(emailId)||emailId<=0) throw new BizError('Invalid message ID.',400);
    await config(c);
    const row=await c.env.db.prepare('SELECT e.email_id,e.resend_email_id,e.delivery_provider FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id WHERE e.email_id=? AND e.user_id=? AND e.type=1 AND e.is_del=0 AND a.is_del=0').bind(emailId,userId).first();
    if(!row) throw new BizError('Sent message not found.',404);
    await this.reconcile(c,emailId);
    const resend=row.delivery_provider==='resend' && !!row.resend_email_id;
    const events=resend?(await c.env.db.prepare('SELECT event_id AS eventId,event_type AS type,occurred_at AS occurredAt,recipients,detail FROM mail_delivery_event WHERE provider_id=? ORDER BY occurred_at DESC,event_id DESC LIMIT 101').bind(row.resend_email_id).all()).results:[];
    return {provider:resend?'resend':'unavailable',hasMore:(events||[]).length>100,events:(events||[]).slice(0,100).map(event=>({...event,recipients:asAddresses(event.recipients)}))};
  },
};
export default mailDeliveryService;
