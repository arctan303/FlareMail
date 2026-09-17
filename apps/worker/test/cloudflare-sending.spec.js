import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import emailSendService from '../src/service/email-send-service';
import mailProviderService from '../src/service/mail-provider-service';
import { estimateCloudflareMessageBytes, CLOUDFLARE_MAX_MESSAGE_BYTES } from '../src/utils/cloudflare-mail';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const PASSWORD = 'cf-provider-fixture-password';
const ADMIN = 'cf-admin@example.com';
const MEMBER = 'cf-member@example.com';
const runtime = { ...env, SETUP_SECRET: undefined, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) }, SEND_RATE_LIMITER: { limit: async () => ({ success: true }) }, EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const context = (e = runtime) => { const values = new Map(); return { env: e, get: key => values.get(key), set: (key, value) => values.set(key, value) }; };
async function api(path, { method = 'GET', cookie, body, origin = 'http://localhost', token } = {}, e = runtime) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('http://localhost/api' + path, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), Origin: origin, 'Content-Type': 'application/json', 'Accept-Language': 'en' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), e, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
async function login(email = ADMIN) {
  const r = await api('/login', { method: 'POST', body: { email, password: PASSWORD } });
  expect(r.status).toBe(200); return r.headers.get('set-cookie').split(';')[0];
}
const cf = send => ({ ...runtime, email: { send: vi.fn(send || (async () => ({ messageId: 'cf-fixture-id' }))) } });
async function select(provider) { await env.db.prepare('UPDATE mail_provider_config SET provider = ? WHERE id = 1').bind(provider).run(); }
async function pending324() { await env.db.batch([env.db.prepare('DROP TABLE mail_provider_config'), env.db.prepare('DELETE FROM schema_migrations WHERE version = 324')]); }
let memberId, accountId, adminCookie, memberCookie;
const body = extra => ({ accountId, receiveEmail: ['friend@outside.test'], subject: 'provider fixture', text: 'plain body', content: '<p>HTML body</p>', ...extra });
const send = (payload, e = runtime) => api('/email/send', { method: 'POST', cookie: memberCookie, body: body(payload) }, e);
async function count(table) { return (await env.db.prepare('SELECT COUNT(*) AS n FROM ' + table).first()).n; }
async function quota() { return (await env.db.prepare('SELECT send_count AS n FROM user WHERE user_id = ?').bind(memberId).first()).n; }

beforeAll(async () => {
  // Even a fresh installation with a binding defaults to Resend.
  await dbInit.migrate(context(cf()));
  expect((await mailProviderService.read(context(cf()))).mailProvider).toBe('resend');
  await markInstalled(env, ['example.com'], []);
  for (const [email, admin] of [[ADMIN, 1], [MEMBER, 0]]) {
    const m = await cryptoUtils.hashPassword(PASSWORD);
    const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin,send_count) VALUES (?,?,?,?,0) RETURNING user_id AS id').bind(email, m.hash, m.salt, admin).first();
    const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id').bind(email, user.id).first();
    if (!admin) { memberId = user.id; accountId = account.id; }
  }
  adminCookie = await login(); memberCookie = await login(MEMBER);
});
beforeEach(async () => {
  await select('resend');
  await env.db.prepare("UPDATE setting SET resend_tokens = '{\"example.com\":\"fixture-resend-token\"}'").run();
  await env.db.prepare('UPDATE admin_confirmation SET enabled = 0').run();
  await env.kv.delete(KvConst.SETTING);
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('selectable Cloudflare sending', () => {
  it('saves the selected provider with tokens atomically and preserves tokens on switching', async () => {
    const e = cf();
    expect((await api('/setting/set', { method:'PUT', cookie:adminCookie, body:{mailProvider:'cloudflare',resendTokens:{'example.com':'replacement-token'}} },e)).status).toBe(200);
    expect((await mailProviderService.read(context(e))).mailProvider).toBe('cloudflare');
    expect((await api('/setting/set', { method:'PUT', cookie:adminCookie, body:{mailProvider:'resend'} },e)).status).toBe(200);
    expect((await env.db.prepare('SELECT resend_tokens AS tokens FROM setting').first()).tokens).toContain('replacement-token');
    const result = await api('/setting/query',{cookie:adminCookie},e);
    expect((await result.json()).data).toMatchObject({mailProvider:'resend',hasCfEmail:true,mailProviderUpgradeRequired:false});
    expect((await api('/setting/websiteConfig')).status).toBe(200);
  });
  it('rejects unbound/invalid selection before changing tokens and enforces admin, origin and confirmation', async () => {
    const e = cf();
    const change = (cookie, origin, provider = 'cloudflare', target = e) => api('/setting/set',{method:'PUT',cookie,origin,body:{mailProvider:provider,resendTokens:{'example.com':'must-not-change'}}},target);
    expect((await change(null,'http://localhost')).status).toBe(401);
    expect((await change(memberCookie,'http://localhost')).status).toBe(403);
    expect((await change(adminCookie,'https://evil.example')).status).toBe(403);
    expect((await change(adminCookie,'http://localhost','bogus')).status).toBe(503);
    expect((await change(adminCookie,'http://localhost','cloudflare',runtime)).status).toBe(503);
    expect((await env.db.prepare('SELECT resend_tokens AS tokens FROM setting').first()).tokens).not.toContain('must-not-change');
    await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, revision = revision + 1').run();
    const key = KvConst.RECENT_AUTH + await cryptoUtils.hashSecret(adminCookie.slice(adminCookie.indexOf('=')+1));
    await env.kv.delete(key);
    expect((await change(adminCookie,'http://localhost')).status).toBe(428);
    expect((await mailProviderService.read(context())).mailProvider).toBe('resend');
  });
  it('uses Resend even when Cloudflare is bound', async () => {
    const e = cf(); const resend = vi.spyOn(emailSendService,'sendByResend').mockResolvedValue({data:{id:'resend-id'}});
    const r = await send({}, e); expect(r.status).toBe(200);
    expect(resend).toHaveBeenCalledOnce(); expect(e.email.send).not.toHaveBeenCalled();
    expect((await r.json()).data[0]).toMatchObject({status:1,resendEmailId:'resend-id'});
  });
  it('sends Cloudflare HTML/text/base64/CID/reply headers and replays without sending twice', async () => {
    await select('cloudflare'); const e = cf();
    const resend = vi.spyOn(emailSendService,'sendByResend');
    const original = await env.db.prepare("INSERT INTO email(user_id,account_id,type,status,message_id,subject,text) VALUES (?,?,0,0,'<original@outside.test>','original','old body') RETURNING email_id AS id").bind(memberId,accountId).first();
    const payload = {sendType:'reply',emailId:original.id,requestId:'cf_replay_fixture_0001',content:'<p>body<img src="data:image/png;base64,aGVsbG8=" /></p>',attachments:[{filename:'note.txt',type:'text/plain',content:'aGVsbG8='}]};
    const before = await quota(); const first = await send(payload,e); expect(first.status).toBe(200);
    expect((await first.json()).data[0].status).toBe(1);
    const form=e.email.send.mock.calls[0][0];
    expect(form).toMatchObject({to:['friend@outside.test'],text:'plain body',headers:{'in-reply-to':'<original@outside.test>',references:'<original@outside.test>'}});
    expect(form.html).toContain('cid:'); expect(form.attachments).toHaveLength(2);
    expect(form.attachments.find(a=>a.filename==='note.txt')).toMatchObject({content:'aGVsbG8=',type:'text/plain',disposition:'attachment'});
    expect(form.attachments.find(a=>a.disposition==='inline').contentId).not.toMatch(/[<>]/);
    const replay=await send(payload,e); expect(replay.status).toBe(200); expect((await replay.json()).data[0].idempotentReplay).toBe(true);
    expect(e.email.send).toHaveBeenCalledOnce(); expect(resend).not.toHaveBeenCalled(); expect(await quota()).toBe(before+1);
  });
  it('rejects an encoded oversized message before any provider call, email row, request or quota', async () => {
    await select('cloudflare'); const e=cf(); const before=[await quota(),await count('email'),await count('send_request')];
    // 4 MiB decoded becomes more than 5 MiB after base64 encoding.
    const content=btoa('x'.repeat(4*1024*1024));
    const r=await send({attachments:[{filename:'large.bin',type:'application/octet-stream',content}]},e);
    expect(r.status).toBe(400); expect(await r.text()).toContain('5 MiB'); expect(e.email.send).not.toHaveBeenCalled();
    expect([await quota(),await count('email'),await count('send_request')]).toEqual(before);
    expect(estimateCloudflareMessageBytes({text:'好'.repeat(2*1024*1024)})).toBeGreaterThan(CLOUDFLARE_MAX_MESSAGE_BYTES);
  });
  it('releases quota on definite rejection, allows an explicit retry and never falls back', async () => {
    await select('cloudflare'); const e=cf(async()=>{throw Object.assign(new Error('sensitive upstream detail'),{code:'E_SENDER_NOT_VERIFIED'})});
    const resend=vi.spyOn(emailSendService,'sendByResend'); const before=await quota(); const payload={requestId:'cf_rejected_fixture_01'};
    const rejected=await send(payload,e); expect(rejected.status).toBe(502); expect(await rejected.text()).not.toContain('sensitive upstream detail');
    expect(await quota()).toBe(before); expect(resend).not.toHaveBeenCalled();
    e.email.send.mockResolvedValue({messageId:'retry-id'}); expect((await send(payload,e)).status).toBe(200);
    expect(e.email.send).toHaveBeenCalledTimes(2); expect(await quota()).toBe(before+1);
  });
  it.each([['transport',()=>{throw new Error('timeout detail')}],['internal',()=>{throw Object.assign(new Error('internal detail'),{code:'E_INTERNAL_SERVER_ERROR'})}],['missing ID',()=>({})]])('retains idempotency and quota for %s unknown outcomes', async (label,operation) => {
    await select('cloudflare'); const e=cf(async()=>operation()); const before=await quota(); const payload={requestId:'cf_unknown_fixture_'+label.replace(/ /g,'_')};
    const first=await send(payload,e); expect(first.status).toBe(200); expect((await first.json()).data[0]).toMatchObject({status:5});
    expect((await send(payload,e)).status).toBe(200); expect(e.email.send).toHaveBeenCalledOnce(); expect(await quota()).toBe(before+1);
  });
  it('keeps internal delivery independent and splits mixed recipients', async () => {
    await select('cloudflare'); expect((await send({receiveEmail:[ADMIN]},runtime)).status).toBe(200);
    const e=cf(); expect((await send({receiveEmail:[ADMIN,'friend@outside.test']},e)).status).toBe(200);
    expect(e.email.send.mock.calls[0][0].to).toEqual(['friend@outside.test']);
  });
  it('applies the same provider selection to CLI sending', async () => {
    const token='cf-cli-fixture-token'; await env.db.prepare('UPDATE user SET cli_token = ? WHERE user_id = ?').bind('sha256$' + await cryptoUtils.hashSecret(token),memberId).run();
    await select('cloudflare'); const e=cf();
    const r=await api('/cli/emails/send',{method:'POST',token,body:{accountId,to:'friend@outside.test',subject:'CLI provider',body:'CLI body',requestId:'cf_cli_fixture_send01'}},e);
    expect(r.status).toBe(200); expect(e.email.send).toHaveBeenCalledOnce();
  });
  it('keeps 323 login available, upgrades through the administrator and preserves the previous route and mail', async () => {
    await pending324(); const e=cf();
    try {
      expect((await (await api('/setup/status',{},e)).json()).data).toMatchObject({setupRequired:false,upgradeRequired:true,upgradeBlocking:false});
      expect((await api('/login',{method:'POST',body:{email:ADMIN,password:PASSWORD}},e)).status).toBe(200);
      expect(await dbInit.hasTable(context(),'mail_provider_config')).toBe(false);
      expect(await mailProviderService.read(context(e))).toMatchObject({mailProvider:'cloudflare',mailProviderUpgradeRequired:true});
      expect((await api('/setting/set',{method:'PUT',cookie:adminCookie,body:{mailProvider:'resend'}},e)).status).toBe(503);
      const before=[await count('user'),await count('account'),await count('email')];
      expect((await api('/admin/upgrade',{method:'POST',cookie:adminCookie},e)).status).toBe(200);
      expect([await count('user'),await count('account'),await count('email')]).toEqual(before);
      expect((await mailProviderService.read(context(e))).mailProvider).toBe('cloudflare');
      await select('resend'); await dbInit.migrate(context(e)); expect((await mailProviderService.read(context(e))).mailProvider).toBe('resend');
    } finally { await dbInit.migrate(context()); }
  });
  it('keeps 322 with both additive patches pending compatible and imports Resend without a binding', async () => {
    await pending324();
    await env.db.batch([env.db.prepare('DROP TABLE admin_confirmation'),env.db.prepare('DELETE FROM schema_migrations WHERE version = 323')]);
    try {
      const status=(await (await api('/setup/status')).json()).data;
      expect(status).toMatchObject({setupRequired:false,upgradeRequired:true,upgradeBlocking:false});
      expect((await api('/login',{method:'POST',body:{email:ADMIN,password:PASSWORD}})).status).toBe(200);
      expect((await api('/admin/upgrade',{method:'POST',cookie:adminCookie})).status).toBe(200);
      expect((await mailProviderService.read(context())).mailProvider).toBe('resend');
      expect(await dbInit.v3_23Applied(context())).toBe(true); expect(await dbInit.v3_24Applied(context())).toBe(true);
    } finally { await dbInit.migrate(context()); }
  });
  it('rejects missing bindings before spending quota and treats quota rejections as definite failures', async () => {
    await select('cloudflare'); const before=await quota();
    expect((await send({},runtime)).status).toBe(503); expect(await quota()).toBe(before);
    const e=cf(async()=>{throw Object.assign(new Error('quota detail'),{code:'E_DAILY_LIMIT_EXCEEDED'})});
    const r=await send({},e); expect(r.status).toBe(429); expect(await quota()).toBe(before);
  });
  it('does not treat a missing applied table or invalid row as a compatible pending patch', async () => {
    await env.db.prepare('DROP TABLE mail_provider_config').run();
    try { expect((await (await api('/setup/status')).json()).data.upgradeBlocking).toBe(true); await expect(mailProviderService.read(context())).rejects.toThrow(); }
    finally { await dbInit.migrate(context()); }
    await env.db.prepare('DELETE FROM mail_provider_config').run();
    try { expect((await (await api('/setup/status')).json()).data.upgradeBlocking).toBe(true); await expect(mailProviderService.read(context())).rejects.toThrow(); }
    finally { await dbInit.migrate(context()); }
  });
});
