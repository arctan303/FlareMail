import BizError from '../error/biz-error';
import managedDomains from './managed-domain-service';
import settings from './setting-service';
import accountService from './account-service';
import emailService from './email-service';
import { hasCloudflareEmail } from './mail-provider-service';
import verify from '../utils/verify-utils';

async function dns(name,type) {
  try {
    const url=new URL('https://cloudflare-dns.com/dns-query');url.searchParams.set('name',name);url.searchParams.set('type',type);
    const response=await fetch(url,{headers:{Accept:'application/dns-json'},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok) throw new Error();
    const reader=response.body.getReader();let size=0;const chunks=[];
    while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>65536){await reader.cancel();throw new Error();}chunks.push(chunk.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(body.Status!==0&&body.Status!==3) throw new Error();
    const records=(body.Answer||[]).filter(row=>row.type===(type==='MX'?15:16)).slice(0,32).map(row=>String(row.data).slice(0,2048));
    return {status:records.length?'found':'missing',records};
  }catch{return {status:'unavailable',records:[]};}
}
async function owned(c,accountId,userId) {
  if(!Number.isSafeInteger(accountId)||accountId<=0)throw new BizError('Choose a mailbox you own.',400);
  const account=await accountService.selectOwnedById(c,accountId,userId);
  if(!account)throw new BizError('Mailbox not found.',404);
  if(!await managedDomains.containsEmail(c,account.email))throw new BizError('The mailbox domain is disabled.',403);
  return account;
}
const diagnostics={
  async inspect(c,domain,selector='resend') {
    const state=await managedDomains.get(c);
    if(!state.domains.includes(domain))throw new BizError('Choose a registered domain.',400);
    if(!/^[a-zA-Z0-9_-]{1,63}$/.test(selector))throw new BizError('Invalid DKIM selector.',400);
    const [mx,txt,dmarc,dkim]=await Promise.all([dns(domain,'MX'),dns(domain,'TXT'),dns('_dmarc.'+domain,'TXT'),dns(selector+'._domainkey.'+domain,'TXT')]);
    const config=await settings.query(c);
    const spf=txt.status==='unavailable'?txt:{status:txt.records.some(value=>value.replace(/"/g,'').startsWith('v=spf1 '))?'found':'missing',records:txt.records.filter(value=>value.includes('v=spf1'))};
    return {domain,enabled:state.entries.find(entry=>entry.domain===domain)?.enabled!==false,selector,checks:{mx,spf,dmarc,dkim},provider:config.mailProvider||'resend',credentialsConfigured:!!config.resendTokens?.[domain],cloudflareBound:hasCloudflareEmail(c),routingVerified:false,checkedAt:new Date().toISOString()};
  },
  async send(c,body,userId) {
    await owned(c,body?.accountId,userId);
    if(typeof body.to!=='string'||!verify.isEmail(body.to)||body.to.length>254)throw new BizError('Enter a valid test recipient.',400);
    if(typeof body.requestId!=='string')throw new BizError('A test request ID is required.',400);
    const sent=await emailService.send(c,{accountId:body.accountId,receiveEmail:[body.to],subject:'FlareMail delivery test',text:'This is the delivery test you requested in FlareMail settings.',content:'<p>This is the delivery test you requested in FlareMail settings.</p>',sendType:'new',attachments:[],requestId:body.requestId},userId);
    const row=Array.isArray(sent)?sent[0]:sent;
    return {emailId:row.emailId,status:row.status,accepted:true,delivered:false};
  },
  async startReceive(c,body,userId) {
    const columns=(await c.env.db.prepare("PRAGMA table_info('email')").all()).results||[];
    if(!columns.some(column=>column.name==='ingress_source'))throw new BizError('Apply database patch 329 before testing external receipt.',503);
    const account=await owned(c,body?.accountId,userId);
    const id=crypto.randomUUID();const subject='FlareMail receive test '+id;
    const latest=await c.env.db.prepare('SELECT MAX(email_id) AS id FROM email').first();
    const probe={userId,accountId:account.accountId,email:account.email,subject,afterId:Number(latest?.id||0)};
    await c.env.kv.put('mail-probe:'+id,JSON.stringify(probe),{expirationTtl:900});
    return {id,email:account.email,subject,expiresIn:900};
  },
  async checkReceive(c,id,userId) {
    if(!/^[0-9a-f-]{36}$/.test(id||''))throw new BizError('Invalid receive test.',400);
    const probe=await c.env.kv.get('mail-probe:'+id,'json');
    if(!probe||probe.userId!==userId)throw new BizError('Receive test expired. Start again.',404);
    const account=await owned(c,probe.accountId,userId);
    if(account.email!==probe.email)throw new BizError('Mailbox changed. Start a fresh receive test.',409);
    const row=await c.env.db.prepare("SELECT email_id FROM email WHERE user_id=? AND account_id=? AND email_id>? AND type=0 AND ingress_source='external' AND is_del=0 AND status<>6 AND subject=? LIMIT 1").bind(userId,probe.accountId,probe.afterId,probe.subject).first();
    return {received:!!row,emailId:row?.email_id||null};
  },
};
export default diagnostics;
