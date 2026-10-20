import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import { DOMAIN_TRIGGERS } from '../src/init/domain-schema';
import managedDomainService from '../src/service/managed-domain-service';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';
import emailSendService from '../src/service/email-send-service';
import emailService from '../src/service/email-service';
import settingService from '../src/service/setting-service';

const PASSWORD='domain-management-fixture-password';
const runtime={...env,LOGIN_RATE_LIMITER:{limit:async()=>({success:true})},EMAIL_RATE_LIMITER:{limit:async()=>({success:true})}};
function context(userId) { const values=new Map([['user',{userId}]]); return {env:runtime,get:key=>values.get(key),set:(key,value)=>values.set(key,value)}; }
async function request(path,{method='GET',cookie,body,origin='http://localhost',token}={}) {
	const execution=createExecutionContext();
	const response=await worker.fetch(new Request('http://localhost/api'+path,{
		method,headers:{'Content-Type':'application/json','Accept-Language':'en',...(origin ? {Origin:origin}:{}),...(cookie ? {Cookie:cookie}:{}),...(token ? {Authorization:'Bearer '+token}:{})},
		...(body===undefined ? {}:{body:JSON.stringify(body)}),
	}),runtime,execution); await waitOnExecutionContext(execution); return response;
}
async function identity(email,admin=false) {
	const material=await cryptoUtils.hashPassword(PASSWORD);
	const user=await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS id').bind(email,material.hash,material.salt,+admin).first();
	const account=await env.db.prepare('INSERT INTO account(email,user_id,name) VALUES (?,?,?) RETURNING account_id AS id').bind(email,user.id,'fixture').first();
	return {userId:user.id,accountId:account.id};
}
async function login(email) {
	const response=await request('/login',{method:'POST',body:{email,password:PASSWORD}});
	expect(response.status).toBe(200); return response.headers.get('set-cookie').split(';')[0];
}
let admin,member,adminCookie,memberCookie;
beforeAll(async()=>{await dbInit.migrate(context());});
afterEach(()=>vi.restoreAllMocks());
beforeEach(async()=>{
	for(const table of ['webhook_delivery','webhook_config','oauth_authorization_code','attachments','star','email','send_request','account','user']) await env.db.prepare(`DELETE FROM ${table}`).run();
	await markInstalled(env,['example.com','old.test','new.test'],[]);
	await env.kv.delete(KvConst.SETTING);
	await env.db.prepare("UPDATE setting SET resend_tokens='{}'").run();
	await env.db.prepare('UPDATE admin_confirmation SET enabled=1,revision=0 WHERE id=1').run();
	admin=await identity('admin@example.com',true); member=await identity('person@old.test');
	adminCookie=await login('admin@example.com'); memberCookie=await login('person@old.test');
});
async function operation(action,extra={}) {return {action,domain:'old.test',...extra,revision:(await managedDomainService.get(context())).revision};}
async function preview(input,cookie=adminCookie) {
	const response=await request('/admin/domains/preview',{method:'POST',cookie,body:input});
	expect(response.status).toBe(200); return (await response.json()).data;
}
async function apply(input,plan,cookie=adminCookie) {return request('/admin/domains/apply',{method:'POST',cookie,body:{...input,fingerprint:plan.fingerprint}});}
async function perform(action,extra={}) {const input=await operation(action,extra);const plan=await preview(input);expect(plan.canApply).toBe(true);const response=await apply(input,plan);expect(response.status).toBe(200);return (await response.json()).data;}

describe.sequential('domain lifecycle and identity migration',()=>{
	it('rejects a send whose address snapshot predates a migration before claiming the send',async()=>{
		await env.db.prepare(`UPDATE setting SET send=0,resend_tokens='{"old.test":"old-private-key"}'`).run();
		const provider=vi.spyOn(emailSendService,'sendByResend').mockResolvedValue({data:{id:'never-sent'}});
		const original=emailSendService.claimSendRequest.bind(emailSendService);
		vi.spyOn(emailSendService,'claimSendRequest').mockImplementationOnce(async(...args)=>{await perform('migrate',{targetDomain:'new.test'});return original(...args);});
		const response=await request('/email/send',{method:'POST',cookie:memberCookie,body:{
			accountId:member.accountId,receiveEmail:['outside@external.test'],subject:'stale sender',text:'body',content:'<p>body</p>',attachments:[],requestId:crypto.randomUUID(),sendType:'new',
		}});
		expect(response.status).toBe(403);expect(provider).not.toHaveBeenCalled();
		expect(await env.db.prepare('SELECT COUNT(*) AS n FROM email').first()).toEqual({n:0});
		expect(await env.db.prepare('SELECT COUNT(*) AS n FROM send_request').first()).toEqual({n:0});
	});
	it('rejects an inbound address snapshot if migration commits immediately before persistence',async()=>{
		await env.db.prepare('UPDATE setting SET receive=0').run();
		const original=emailService.receive.bind(emailService);
		vi.spyOn(emailService,'receive').mockImplementationOnce(async(...args)=>{await perform('migrate',{targetDomain:'new.test'});return original(...args);});
		const raw=new TextEncoder().encode('From: outside@external.test\r\nTo: person@old.test\r\nSubject: race\r\n\r\nfixture body');
		const message={from:'outside@external.test',to:'person@old.test',rawSize:raw.byteLength,raw:new ReadableStream({start(controller){controller.enqueue(raw);controller.close();}}),setReject:vi.fn(),forward:vi.fn()};
		const execution=createExecutionContext();await worker.email(message,runtime,execution);await waitOnExecutionContext(execution);
		expect(message.setReject).toHaveBeenCalled();expect(message.forward).not.toHaveBeenCalled();
		expect(await env.db.prepare('SELECT COUNT(*) AS n FROM email').first()).toEqual({n:0});
	});
	it('does not resurrect a removed Resend credential when a settings save races a rename',async()=>{
		await env.db.prepare(`UPDATE setting SET resend_tokens='{"old.test":"old-private-key","new.test":"target-private-key"}'`).run();
		const original=env.db.batch.bind(env.db);let injected=false;
		vi.spyOn(env.db,'batch').mockImplementation(async statements=>{if(!injected){injected=true;await perform('rename',{targetDomain:'renamed.test'});}return original(statements);});
		await expect(settingService.set(context(admin.userId),{resendTokens:{'new.test':'replacement-key'}})).rejects.toMatchObject({code:409});
		expect(JSON.parse((await env.db.prepare('SELECT resend_tokens FROM setting').first()).resend_tokens)).toEqual({'new.test':'target-private-key'});
	});
	it('requires administrator, strict origin, recent authentication and a matching preview receipt',async()=>{
		const input=await operation('setEnabled',{enabled:false});
		for(const path of ['/admin/domains/preview','/admin/domains/apply']) {
			expect((await request(path,{method:'POST',cookie:memberCookie,body:input})).status).toBe(403);
			expect((await request(path,{method:'POST',cookie:adminCookie,origin:null,body:input})).status).toBe(403);
			expect((await request(path,{method:'POST',cookie:adminCookie,origin:'https://outside.test',body:input})).status).toBe(403);
		}
		expect((await apply(input,{fingerprint:crypto.randomUUID()})).status).toBe(409);
		const plan=await preview(input);
		expect((await apply({...input,enabled:true},plan)).status).toBe(409);
		await env.db.prepare('UPDATE admin_confirmation SET revision=revision+1').run();
		expect((await apply(input,plan)).status).toBe(428);
		expect((await managedDomainService.get(context())).entries.find(row=>row.domain==='old.test').enabled).toBe(true);
	});
	it('expires preview on alias creation and rejects reusing a completed confirmation',async()=>{
		let input=await operation('rename',{targetDomain:'renamed.test'});let plan=await preview(input);
		await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind('new-alias@old.test',member.userId).run();
		expect((await apply(input,plan)).status).toBe(409);
		input=await operation('setEnabled',{enabled:false});plan=await preview(input);
		expect((await apply(input,plan)).status).toBe(200);
		expect((await apply(input,plan)).status).toBe(409);
	});
	it('migrates members, soft-deleted aliases, historical mail and attachments without changing ownership or mail headers',async()=>{
		const alias=await env.db.prepare("INSERT INTO account(email,user_id,is_del) VALUES (?,?,1) RETURNING account_id AS id").bind('archived@old.test',member.userId).first();
		const mail=await env.db.prepare("INSERT INTO email(user_id,account_id,to_email,send_email,subject,content,text) VALUES (?,?,'person@old.test','outside@outside.test','original','<p>old.test</p>','old.test') RETURNING email_id AS id").bind(member.userId,member.accountId).first();
		await env.db.prepare("INSERT INTO attachments(user_id,account_id,email_id,key,filename) VALUES (?,?,?,'fixture-object','saved.txt')").bind(member.userId,member.accountId,mail.id).run();
		await env.db.prepare('INSERT INTO star(user_id,email_id) VALUES (?,?)').bind(member.userId,mail.id).run();
		const cli='fixture-domain-token';await env.db.prepare('UPDATE user SET cli_token=? WHERE user_id=?').bind('sha256$'+await cryptoUtils.hashSecret(cli),member.userId).run();
		await env.db.prepare(`INSERT INTO webhook_config(account_id,user_id,url,secret,enabled,mode,updated_at) VALUES (?,?,'https://callback.test/hook','secret-value',1,'all',1)`).bind(member.accountId,member.userId).run();
		await env.db.prepare(`INSERT INTO webhook_delivery(event_id,account_id,user_id,email_id,mailbox,event_type,revision,next_at,created_at,updated_at) VALUES ('event',?,?,?,'person@old.test','email.received',1,1,1,1)`).bind(member.accountId,member.userId,mail.id).run();
		await env.db.prepare(`UPDATE setting SET resend_tokens='{"old.test":"old-private-key","new.test":"target-private-key"}'`).run();
		const result=await perform('rename',{targetDomain:'Renamed.TEST'});
		expect(result).toMatchObject({migratedAccountCount:2,migratedUserCount:1,reauthRequired:false});
		expect(await env.db.prepare('SELECT email,cli_token AS token FROM user WHERE user_id=?').bind(member.userId).first()).toEqual({email:'person@renamed.test',token:''});
		expect(await env.db.prepare('SELECT email,is_del FROM account WHERE account_id=?').bind(alias.id).first()).toEqual({email:'archived@renamed.test',is_del:1});
		expect(await env.db.prepare('SELECT user_id,account_id,to_email,content FROM email WHERE email_id=?').bind(mail.id).first()).toEqual({user_id:member.userId,account_id:member.accountId,to_email:'person@old.test',content:'<p>old.test</p>'});
		expect(await env.db.prepare("SELECT key FROM attachments WHERE user_id=? AND account_id=? AND email_id=?").bind(member.userId,member.accountId,mail.id).first()).toEqual({key:'fixture-object'});
		expect(await env.db.prepare('SELECT COUNT(*) AS n FROM star WHERE email_id=?').bind(mail.id).first()).toEqual({n:1});
		expect(await env.db.prepare('SELECT revision FROM webhook_config WHERE account_id=?').bind(member.accountId).first()).toEqual({revision:2});
		expect(await env.db.prepare("SELECT status,mailbox FROM webhook_delivery WHERE event_id='event'").first()).toEqual({status:'cancelled',mailbox:'person@old.test'});
		expect(JSON.parse((await env.db.prepare('SELECT resend_tokens FROM setting').first()).resend_tokens)).toEqual({'new.test':'target-private-key'});
		expect((await request('/my/loginUserInfo',{cookie:memberCookie})).status).toBe(401);
		expect((await request('/cli/accounts',{token:cli})).status).toBe(401);
		expect((await request('/login',{method:'POST',body:{email:'person@old.test',password:PASSWORD}})).status).toBe(401);
		await login('person@renamed.test');
	});
	it('preserves alias-only users sessions and the destination key when moving into an existing domain',async()=>{
		await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind('admin-alias@old.test',admin.userId).run();
		await env.db.prepare(`UPDATE setting SET resend_tokens='{"new.test":"target-private-key"}'`).run();
		const result=await perform('migrate',{targetDomain:'new.test'});
		expect(result.state.entries).toContainEqual({domain:'old.test',enabled:false});
		expect((await request('/my/loginUserInfo',{cookie:adminCookie})).status).toBe(200);
		expect(JSON.parse((await env.db.prepare('SELECT resend_tokens FROM setting').first()).resend_tokens)['new.test']).toBe('target-private-key');
		expect((await env.db.prepare('SELECT email FROM account WHERE user_id=? AND email=?').bind(admin.userId,'admin-alias@new.test').first()).email).toBe('admin-alias@new.test');
	});
	it('blocks case-insensitive occupied and soft-deleted targets without partial changes',async()=>{
		await env.db.prepare("INSERT INTO account(email,user_id,is_del) VALUES ('PERSON@new.test',?,1)").bind(admin.userId).run();
		const input=await operation('migrate',{targetDomain:'new.test'});const plan=await preview(input);
		expect(plan.canApply).toBe(false);expect(plan.blockers).toContain('address_conflict');
		expect((await apply(input,plan)).status).toBe(409);
		expect((await env.db.prepare('SELECT email FROM user WHERE user_id=?').bind(member.userId).first()).email).toBe('person@old.test');
	});
	it('rolls back every identity/domain/key change when a later database write fails',async()=>{
		await env.db.prepare("CREATE TRIGGER reject_test_move BEFORE UPDATE OF email ON account WHEN NEW.email LIKE '%@rollback.test' BEGIN SELECT RAISE(ABORT,'fixture rollback constraint'); END").run();
		try {
			const input=await operation('rename',{targetDomain:'rollback.test'});const plan=await preview(input);
			expect((await apply(input,plan)).status).toBe(409);
			expect((await env.db.prepare('SELECT email,session_epoch FROM user WHERE user_id=?').bind(member.userId).first())).toEqual({email:'person@old.test',session_epoch:0});
			expect((await managedDomainService.get(context())).domains).not.toContain('rollback.test');
			expect((await request('/my/loginUserInfo',{cookie:memberCookie})).status).toBe(200);
		} finally {await env.db.prepare('DROP TRIGGER reject_test_move').run();}
	});
	it('refuses migrations while sending or saving mail',async()=>{
		await env.db.prepare("INSERT INTO send_request(user_id,request_id) VALUES (?,'in-flight')").bind(member.userId).run();
		const plan=await preview(await operation('migrate',{targetDomain:'new.test'}));expect(plan.blockers).toContain('mail_in_progress');
	});
	it('renames disabled domains without silently re-enabling mail',async()=>{
		await perform('setEnabled',{enabled:false});
		const result=await perform('rename',{targetDomain:'renamed.test'});
		expect(result.state.entries).toContainEqual({domain:'renamed.test',enabled:false});
		expect(await managedDomainService.containsEmail(context(),'person@renamed.test')).toBe(false);
		await login('person@renamed.test');
	});
	it('only deletes empty domains, clears their key and retains a registered domain',async()=>{
		const blocked=await preview(await operation('delete'));expect(blocked.blockers).toContain('domain_in_use');
		await perform('migrate',{targetDomain:'new.test'});
		await env.db.prepare(`UPDATE setting SET resend_tokens='{"old.test":"old-private-key"}'`).run();
		const deleted=await perform('delete');expect(deleted.state.domains).not.toContain('old.test');
		expect(JSON.parse((await env.db.prepare('SELECT resend_tokens FROM setting').first()).resend_tokens)).toEqual({});
		await env.db.prepare("DELETE FROM managed_domain WHERE domain<>'example.com'").run();
		const last=await preview(await operation('delete',{domain:'example.com'}));expect(last.blockers).toContain('last_domain');
	});
	it('revokes the current administrator session and returns reauthentication on self migration',async()=>{
		const result=await perform('rename',{domain:'example.com',targetDomain:'admin-new.test'});
		expect(result.reauthRequired).toBe(true);
		expect((await request('/my/loginUserInfo',{cookie:adminCookie})).status).toBe(401);
		await login('admin@admin-new.test');
	});
	it('upgrades intact 327 additively, remains compatible beforehand, and refuses forged migration structure',async()=>{
		for(const name of Object.keys(DOMAIN_TRIGGERS)) await env.db.prepare(`DROP TRIGGER ${name}`).run();
		await env.db.prepare('ALTER TABLE managed_domain DROP COLUMN enabled').run();
		await env.db.prepare('DELETE FROM schema_migrations WHERE version=328').run();
		expect((await dbInit.setupStatus(context())).upgradeBlocking).toBe(false);
		expect((await managedDomainService.get(context())).managementReady).toBe(false);
		await expect(managedDomainService.preview(context(admin.userId),await operation('delete'))).rejects.toMatchObject({code:503});
		await dbInit.migrate(context());await dbInit.migrate(context());
		expect(await dbInit.v3_28Applied(context())).toBe(true);
		expect((await managedDomainService.get(context())).entries.every(row=>row.enabled)).toBe(true);
		expect((await env.db.prepare('SELECT email FROM user WHERE user_id=?').bind(member.userId).first()).email).toBe('person@old.test');
		await env.db.prepare('DROP TRIGGER domain_account_insert').run();
		await env.db.prepare('CREATE TRIGGER domain_account_insert BEFORE INSERT ON account BEGIN SELECT 1; END').run();
		expect(await dbInit.v3_28Applied(context())).toBe(false);
		await expect(dbInit.v3_28DB(context())).rejects.toThrow('manual recovery');
		await env.db.prepare('DROP TRIGGER domain_account_insert').run();await env.db.prepare(DOMAIN_TRIGGERS.domain_account_insert).run();
	});
});
