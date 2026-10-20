import {env} from 'cloudflare:workers';
import {createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {beforeAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import worker from '../src';
import {dbInit} from '../src/init/init';
import {migrations} from '../src/init/migrations';
import {CAPABILITY_TRIGGERS} from '../src/init/capability-schema';
import {markInstalled} from './installed-instance';
import cryptoUtils from '../src/utils/crypto-utils';
import delivery from '../src/service/mail-delivery-service';
import diagnostics from '../src/service/mail-diagnostics-service';
import emailService from '../src/service/email-service';
import {contactTimeline} from '../src/api/contact-timeline-api';
import {email as externalEmail} from '../src/email/email';

const password='operations-fixture-password';
const secret='whsec_'+btoa('delivery-fixture-signing-material');
const runtime={...env,LOGIN_RATE_LIMITER:{limit:async()=>({success:true})},EMAIL_RATE_LIMITER:{limit:async()=>({success:true})},SEND_RATE_LIMITER:{limit:async()=>({success:true})}};
let admin,member,cookie,memberCookie,material;
function context(userId=admin.userId){return {env:runtime,get:key=>key==='user'?{userId}:undefined,set:()=>{}};}
async function request(path,{method='GET',body,raw,cookie:session=cookie,headers={}}={}){
  const execution=createExecutionContext();
  const response=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{'Content-Type':'application/json',Origin:'http://localhost',...(session?{Cookie:session}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:raw!==undefined?{body:raw}:{})}),runtime,execution);await waitOnExecutionContext(execution);return response;
}
async function identity(email,isAdmin=false){const user=await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS userId').bind(email,material.hash,material.salt,+isAdmin).first();const account=await env.db.prepare('INSERT INTO account(email,user_id,name) VALUES (?,?,?) RETURNING account_id AS accountId').bind(email,user.userId,'fixture').first();return {...user,...account};}
async function login(email){const response=await request('/login',{method:'POST',body:{email,password},cookie:null});expect(response.status).toBe(200);return response.headers.get('set-cookie').split(';')[0];}
async function message({owner=admin,type=1,to='receiver@outside.test',from='admin@example.com',recipient,cc='[]',bcc='[]',provider='provider-fixture',deliveryProvider='resend',subject='fixture'}={}) {
  const toList=recipient||JSON.stringify([{address:to}]);
  const addresses=[...JSON.parse(toList),...JSON.parse(cc),...JSON.parse(bcc)].map(item=>typeof item==='string'?item:item.address);
  return env.db.prepare('INSERT INTO email(user_id,account_id,type,status,send_email,to_email,recipient,cc,bcc,resend_email_id,subject,content,delivery_provider,delivery_recipients) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING email_id AS id')
    .bind(owner.userId,owner.accountId,type,1,from,to,toList,cc,bcc,provider,subject,'<p>fixture</p>',deliveryProvider,JSON.stringify(addresses)).first();
}
async function signed(event,id=crypto.randomUUID(),age=0){const raw=JSON.stringify(event);const stamp=String(Math.floor(Date.now()/1000)+age);const key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id+'.'+stamp+'.'+raw)))));return {raw,headers:{'svix-id':id,'svix-timestamp':stamp,'svix-signature':'v1,'+signature},cookie:null};}
const event=(type,to=['receiver@outside.test'],time=Date.now())=>({type,created_at:new Date(time).toISOString(),data:{email_id:'provider-fixture',to}});
beforeAll(async()=>{await dbInit.migrate(context(0));material=await cryptoUtils.hashPassword(password);});
beforeEach(async()=>{
  await dbInit.migrate(context(0));
  for(const table of ['mail_delivery_event','webhook_delivery','webhook_config','oauth_authorization_code','attachments','star','email','send_request','account','user'])await env.db.prepare(`DELETE FROM ${table}`).run();
  await markInstalled(env,['example.com','disabled.test'],[]);
  await env.db.prepare("UPDATE mail_delivery_config SET secret='',revision=0 WHERE id=1").run();
  admin=await identity('admin@example.com',true);member=await identity('member@example.com');cookie=await login('admin@example.com');memberCookie=await login('member@example.com');
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe.sequential('mail operations and capability upgrade',()=>{
  it('requires admin, same origin and revision for signing secret changes without returning it',async()=>{
    expect((await request('/admin/mail-delivery',{cookie:memberCookie})).status).toBe(403);
    expect((await request('/admin/mail-delivery',{method:'PUT',headers:{Origin:'https://foreign.test'},body:{revision:0,secretAction:'replace',secret}})).status).toBe(403);
    const saved=await request('/admin/mail-delivery',{method:'PUT',body:{revision:0,secretAction:'replace',secret}});expect(saved.status).toBe(200);const json=await saved.json();expect(json.data.secretConfigured).toBe(true);expect(JSON.stringify(json)).not.toContain(secret);
    expect((await request('/admin/mail-delivery',{method:'PUT',body:{revision:0,secretAction:'clear'}})).status).toBe(409);
    const clear=await request('/admin/mail-delivery',{method:'PUT',body:{revision:1,secretAction:'clear'}});expect((await clear.json()).data.secretConfigured).toBe(false);
  });
  it('verifies exact payload signatures, rejects replay timestamps and unknown signatures',async()=>{
    await env.db.prepare('UPDATE mail_delivery_config SET secret=?').bind(secret).run();
    const payload=await signed(event('email.delivered'));
    expect((await request('/delivery/resend',{method:'POST',...payload,raw:payload.raw+' '})).status).toBe(403);
    expect((await request('/delivery/resend',{method:'POST',...(await signed(event('email.delivered'),'old',-400))})).status).toBe(403);
    const good=await request('/delivery/resend',{method:'POST',...payload});expect(good.status).toBe(200);
    const duplicate=await request('/delivery/resend',{method:'POST',...payload});expect((await duplicate.json()).data.duplicate).toBe(true);
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM mail_delivery_event').first()).n).toBe(1);
  });
  it('retains terminal per-recipient failures across late successes and isolates sender history',async()=>{
    await env.db.prepare('UPDATE mail_delivery_config SET secret=?').bind(secret).run();
    const mail=await message({recipient:JSON.stringify([{address:'receiver@outside.test'},{address:'second@outside.test'}])});
    for(const payload of [event('email.delivered'),event('email.bounced',['second@outside.test'],Date.now()+1),event('email.delivered',['second@outside.test'],Date.now()+2),event('email.sent',['receiver@outside.test'],Date.now()-1000)])expect((await request('/delivery/resend',{method:'POST',...(await signed(payload))})).status).toBe(200);
    expect((await env.db.prepare('SELECT status FROM email WHERE email_id=?').bind(mail.id).first()).status).toBe(3);
    expect((await request('/email/delivery?emailId='+mail.id,{cookie:memberCookie})).status).toBe(404);
    const response=await request('/email/delivery?emailId='+mail.id);expect((await response.json()).data.events).toHaveLength(4);
  });
  it('does not claim all recipients delivered after a partial event, and applies early events later',async()=>{
    await env.db.prepare('UPDATE mail_delivery_config SET secret=?').bind(secret).run();
    await request('/delivery/resend',{method:'POST',...(await signed(event('email.delivered')))});
    const mail=await message({bcc:JSON.stringify([{address:'hidden@outside.test'}])});
    await delivery.reconcile(context(),mail.id);expect((await env.db.prepare('SELECT status FROM email WHERE email_id=?').bind(mail.id).first()).status).toBe(1);
    await request('/delivery/resend',{method:'POST',...(await signed(event('email.delivered',['hidden@outside.test'])))});
    expect((await env.db.prepare('SELECT status FROM email WHERE email_id=?').bind(mail.id).first()).status).toBe(2);
  });
  it('queries only registered DNS names and reports unavailable checks without claiming routing',async()=>{
    const fetcher=vi.fn(async url=>Response.json({Status:0,Answer:[{type:new URL(url).searchParams.get('type')==='MX'?15:16,data:new URL(url).searchParams.get('type')==='MX'?'10 route.mx.cloudflare.net.':'"v=spf1 include:_spf.mx.cloudflare.net ~all"'}]}));vi.stubGlobal('fetch',fetcher);
    const response=await request('/admin/mail-diagnostics?domain=example.com&selector=resend');expect(response.status).toBe(200);const data=(await response.json()).data;expect(data.routingVerified).toBe(false);expect(data.checks.mx.status).toBe('found');expect(fetcher).toHaveBeenCalledTimes(4);
    expect((await request('/admin/mail-diagnostics?domain=127.0.0.1')).status).toBe(400);expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockRejectedValue(new Error('timeout'));expect((await diagnostics.inspect(context(),'example.com')).checks.mx.status).toBe('unavailable');
  });
  it('requires explicit owned sender for send tests and never treats acceptance as delivery',async()=>{
    const send=vi.spyOn(emailService,'send').mockResolvedValue({emailId:42,status:1});
    expect((await request('/admin/mail-diagnostics/send',{method:'POST',body:{accountId:member.accountId,to:'outside@outside.test',requestId:crypto.randomUUID()}})).status).toBe(404);expect(send).not.toHaveBeenCalled();
    const response=await request('/admin/mail-diagnostics/send',{method:'POST',body:{accountId:admin.accountId,to:'outside@outside.test',requestId:crypto.randomUUID()}});expect(response.status).toBe(200);expect((await response.json()).data).toMatchObject({accepted:true,delivered:false});expect(send).toHaveBeenCalledTimes(1);
  });
  it('receive tests require current owned mailbox and match only newly arrived exact-subject mail',async()=>{
    const probe=await diagnostics.startReceive(context(),{accountId:admin.accountId},admin.userId);
    expect((await diagnostics.checkReceive(context(),probe.id,admin.userId)).received).toBe(false);
    await message({type:0,from:'external@outside.test',to:'admin@example.com',subject:probe.subject});
    expect((await diagnostics.checkReceive(context(),probe.id,admin.userId)).received).toBe(false);
    const raw=new TextEncoder().encode(`From: External <external@outside.test>\r\nTo: admin@example.com\r\nSubject: ${probe.subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nExternal test body`);
    const execution=createExecutionContext();
    const inbound={to:'admin@example.com',from:'external@outside.test',raw:new Response(raw).body,rawSize:raw.length,setReject:vi.fn(),forward:vi.fn()};
    await externalEmail(inbound,runtime,execution);await waitOnExecutionContext(execution);expect(inbound.setReject).not.toHaveBeenCalled();
    expect((await diagnostics.checkReceive(context(),probe.id,admin.userId)).received).toBe(true);
    await expect(diagnostics.checkReceive(context(member.userId),probe.id,member.userId)).rejects.toMatchObject({code:404});
  });
  it('pages contact history beyond 100 messages, excludes unrelated text and isolates users',async()=>{
    const statements=[];for(let i=0;i<115;i++)statements.push(env.db.prepare('INSERT INTO email(user_id,account_id,type,send_email,to_email,recipient,status,subject) VALUES (?,?,?,?,?,?,?,?)').bind(admin.userId,admin.accountId,i%2,i%2?'admin@example.com':'person+tag@contact.test',i%2?'person@contact.test':'admin@example.com','[]',i%2,`mail ${i}`));await env.db.batch(statements);
    await message({subject:'person@contact.test is unrelated text',to:'unrelated@outside.test'});await message({owner:member,to:'person@contact.test'});
    const ids=[];let beforeId;do{const page=await contactTimeline(context(),{email:'person@contact.test',size:50,...(beforeId?{beforeId}:{})},admin.userId);ids.push(...page.list.map(item=>item.emailId));beforeId=page.hasMore?page.nextBeforeId:null;}while(beforeId);
    expect(ids).toHaveLength(115);expect(new Set(ids).size).toBe(115);expect(ids).toEqual([...ids].sort((a,b)=>b-a));
  });
  it('contact history includes Cc and owned sent Bcc but strips historical received Bcc',async()=>{
    await message({cc:JSON.stringify([{address:'person@contact.test'}])});await message({bcc:JSON.stringify([{address:'person@contact.test'}])});
    await message({type:0,from:'person@contact.test',bcc:JSON.stringify([{address:'private@hidden.test'}])});
    const page=await contactTimeline(context(),{email:'person@contact.test'},admin.userId);expect(page.list).toHaveLength(3);expect(page.list.find(row=>row.type===0).bcc).toBe('[]');
  });
  it('a stale reconciliation cannot overwrite a newer bounce during the final UPDATE',async()=>{
    const mail=await message();
    await env.db.prepare('INSERT INTO mail_delivery_event(event_id,provider_id,event_type,occurred_at,recipients) VALUES (?,?,?,?,?)').bind('first','provider-fixture','email.sent','2026-10-20T00:00:00.000Z','["receiver@outside.test"]').run();
    let injected=false;
    const wrapped={...runtime,db:{prepare(sql){const statement=env.db.prepare(sql);if(!sql.startsWith('UPDATE email SET status='))return statement;return{bind(...values){return{async run(){if(!injected){injected=true;await env.db.prepare('INSERT INTO mail_delivery_event(event_id,provider_id,event_type,occurred_at,recipients) VALUES (?,?,?,?,?)').bind('new-bounce','provider-fixture','email.bounced','2026-10-20T00:00:01.000Z','["receiver@outside.test"]').run();await delivery.reconcile(context(),mail.id);}return statement.bind(...values).run();}}}};}}};
    const stale=context();stale.env=wrapped;await delivery.reconcile(stale,mail.id);
    expect(injected).toBe(true);expect((await env.db.prepare('SELECT status FROM email WHERE email_id=?').bind(mail.id).first()).status).toBe(3);
    await delivery.list(context(),mail.id,admin.userId);expect((await env.db.prepare('SELECT status FROM email WHERE email_id=?').bind(mail.id).first()).status).toBe(3);
  });
  it('does not identify Cloudflare, local or unknown legacy IDs as Resend tracking',async()=>{
    for(const deliveryProvider of ['cloudflare','local','']){const mail=await message({deliveryProvider,provider:'<rfc-id@fixture.test>'});expect((await delivery.list(context(),mail.id,admin.userId))).toMatchObject({provider:'unavailable',events:[]});}
    const resend=await message();expect((await delivery.list(context(),resend.id,admin.userId)).provider).toBe('resend');
  });
  it('external forwarding respects the primary switch, alias switch and loop marker',async()=>{
    await env.db.prepare("UPDATE user SET forward_status=0,main_forward_status=1,forward_email='verified@outside.test' WHERE user_id=?").bind(admin.userId).run();
    await env.db.prepare("INSERT INTO account(email,user_id,forward_status) VALUES ('alias@example.com',?,0)").bind(admin.userId).run();
    async function inbound(to,loop=false){const raw=new TextEncoder().encode(`From: External <external@outside.test>\r\nTo: ${to}\r\nSubject: external forward check\r\n${loop?'X-FlareMail-Forwarded: 1\r\n':''}MIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nbody`);const message={from:'external@outside.test',to,raw:new Response(raw).body,rawSize:raw.length,setReject:vi.fn(),forward:vi.fn(async()=>{})};const execution=createExecutionContext();await externalEmail(message,runtime,execution);await waitOnExecutionContext(execution);expect(message.setReject).not.toHaveBeenCalled();return message;}
    expect((await inbound('admin@example.com')).forward).not.toHaveBeenCalled();
    expect((await inbound('alias@example.com')).forward).toHaveBeenCalledWith('verified@outside.test');
    expect((await inbound('alias@example.com',true)).forward).not.toHaveBeenCalled();
    await env.db.prepare('UPDATE user SET main_forward_status=0 WHERE user_id=?').bind(admin.userId).run();
    expect((await inbound('admin@example.com')).forward).toHaveBeenCalledWith('verified@outside.test');
  });
  it('upgrades 328 with a 30 day grace period and records future trash transitions',async()=>{
    const mail=await message();await env.db.prepare('UPDATE email SET is_del=1 WHERE email_id=?').bind(mail.id).run();
    for(const name of Object.keys(CAPABILITY_TRIGGERS))await env.db.prepare('DROP TRIGGER '+name).run();
    await env.db.prepare('ALTER TABLE email DROP COLUMN deleted_at').run();await env.db.prepare('ALTER TABLE send_request DROP COLUMN payload_hash').run();await env.db.prepare('DROP TABLE mail_delivery_event').run();await env.db.prepare('DROP TABLE mail_delivery_config').run();await env.db.prepare('DELETE FROM schema_migrations WHERE version=329').run();
    expect(await migrations.v3_29UpgradePending(context())).toBe(true);await migrations.v3_29DB(context());await migrations.v3_29DB(context());expect(await migrations.v3_29Applied(context())).toBe(true);
    const row=await env.db.prepare('SELECT deleted_at FROM email WHERE email_id=?').bind(mail.id).first();expect(Date.parse(row.deleted_at+'Z')).toBeGreaterThan(Date.now()-10000);
    await env.db.prepare('UPDATE email SET is_del=0 WHERE email_id=?').bind(mail.id).run();expect((await env.db.prepare('SELECT deleted_at FROM email WHERE email_id=?').bind(mail.id).first()).deleted_at).toBe(null);
  });
});
