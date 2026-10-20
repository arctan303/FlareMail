import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Resend } from 'resend';
import worker from '../src';
import { dbInit } from '../src/init/init';
import { markInstalled } from './installed-instance';
import { normalizeSendParams } from '../src/utils/send-validator';
import { normalizeRecipients, replyRecipientLists, sendPayloadHash } from '../src/utils/mail-recipients';
import emailSendService from '../src/service/email-send-service';
import emailService from '../src/service/email-service';
import userService from '../src/service/user-service';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import internalForwardService from '../src/service/internal-forward-service';
import r2Service from '../src/service/r2-service';
import { sendLimits } from '../src/utils/send-validator';

const runtime = { ...env, SETUP_SECRET: undefined, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SEND_RATE_LIMITER: { limit: async () => ({ success: true }) }, EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const context = userId => ({ env: runtime, get: key => key === 'user' ? { userId } : undefined, set() {} });
const PASSWORD = 'recipient-fixture-password';
const addresses = ['recipient-sender@example.com', 'recipient-to@example.com', 'recipient-cc@example.com', 'recipient-bcc@example.com'];
const boxes = [];
let cookie, token, recipientToken;

async function api(path, body, credential = cookie, target = runtime) {
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request('http://localhost/api' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json',
      ...(credential?.includes('=') ? { Cookie: credential } : credential ? { Authorization: `Bearer ${credential}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), target, ctx);
  await waitOnExecutionContext(ctx); return r;
}
const payload = extra => ({ accountId: boxes[0]?.accountId || 1, receiveEmail: [addresses[1]], subject: 'recipient fixture',
  text: 'hello', content: '<p>hello</p>', requestId: crypto.randomUUID(), ...extra });

beforeAll(async () => {
  await dbInit.migrate(context()); await markInstalled(env, ['example.com'], []);
  for (const address of addresses) {
    const m = await cryptoUtils.hashPassword(PASSWORD);
    const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS userId')
      .bind(address, m.hash, m.salt, boxes.length === 0 ? 1 : 0).first();
    const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS accountId').bind(address, user.userId).first();
    boxes.push({ ...user, ...account });
  }
  await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind('recipient-alias@example.com', boxes[0].userId).run();
  const login = await api('/login', { email: addresses[0], password: PASSWORD }, null);
  expect(login.status).toBe(200); cookie = login.headers.get('set-cookie').split(';')[0];
  token = await userService.genCliToken({ env }, boxes[0].userId);
  recipientToken = await userService.genCliToken({ env }, boxes[1].userId);
  await env.db.prepare("UPDATE setting SET resend_tokens = '{\"example.com\":\"recipient-fixture-token\"}'").run();
  await env.kv.delete(KvConst.SETTING);
});

describe.sequential('automatic forwarding of complete internal copies', () => {
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/tNQAAAAASUVORK5CYII=';
  beforeEach(async()=>{
    await env.db.prepare('UPDATE user SET forward_status=1,main_forward_status=0,forward_email=\'\',status=0').run();
    await env.db.prepare('UPDATE account SET forward_status=0').run();
    await env.db.prepare("UPDATE managed_domain SET enabled=1 WHERE domain='example.com'").run();
    await env.db.prepare("UPDATE mail_provider_config SET provider='resend' WHERE id=1").run();
    await env.db.prepare("UPDATE setting SET resend_tokens='{\"example.com\":\"forward-fixture-token\"}'").run();
    await env.kv.delete(KvConst.SETTING);
  });
  afterEach(async()=>{
    await env.db.prepare('UPDATE user SET forward_status=1,forward_email=\'\'').run();
    await env.db.prepare("UPDATE mail_provider_config SET provider='resend' WHERE id=1").run();
    await env.db.prepare("UPDATE setting SET resend_tokens='{\"example.com\":\"recipient-fixture-token\"}'").run();
    await env.kv.delete(KvConst.SETTING);
  });
  async function enable(target='archive@outside.test') {
    await env.db.prepare('UPDATE user SET forward_status=0,forward_email=? WHERE user_id=?').bind(target,boxes[1].userId).run();
  }
  async function copy(subject) {
    const row=await env.db.prepare('SELECT email_id AS id FROM email WHERE subject=? AND type=0 AND user_id=?').bind(subject,boxes[1].userId).first();
    return row&&emailService.selectById(context(boxes[1].userId),row.id,boxes[1].userId);
  }
  it('forwards after local persistence using recipient identity/quota and preserves attachments without Bcc',async()=>{
    await enable();
    const before=await env.db.prepare('SELECT send_count AS n FROM user WHERE user_id=?').bind(boxes[1].userId).first();
    const provider=vi.spyOn(emailSendService,'sendByResend').mockImplementation(async(_key,params)=>{
      expect(await copy('internal forwarding complete')).toMatchObject({status:0,bcc:'[]'});
      expect(params).toMatchObject({accountEmail:addresses[1],receiveEmail:['archive@outside.test'],cc:[],bcc:[],replyTo:[addresses[0]],headers:{'X-FlareMail-Forwarded':'1','Auto-Submitted':'auto-generated'}});
      expect(params.attachments.some(item=>item.filename==='note.bin'&&item.content==='AP+AQUI=')).toBe(true);
      return {data:{id:'forward-complete',messageId:'<forward-complete@provider.test>'}};
    });
    const p=payload({subject:'internal forwarding complete',bcc:[addresses[3]],attachments:[{filename:'note.bin',type:'application/octet-stream',content:'AP+AQUI='}]});
    const response=await api('/email/send',p);expect(response.status).toBe(200);expect((await response.json()).data[0].status).toBe(2);
    expect(provider).toHaveBeenCalledOnce();
    const original=await copy(p.subject);expect(original.message||'').not.toContain('INTERNAL_FORWARD_FAILED');
    const forwarded=await env.db.prepare('SELECT email_id AS id,send_email AS sender,recipient,bcc,delivery_provider AS provider FROM email WHERE type=1 AND user_id=? AND subject=?').bind(boxes[1].userId,p.subject).first();
    expect(forwarded).toMatchObject({sender:addresses[1],bcc:'[]',provider:'resend'});
    expect((await env.db.prepare('SELECT send_count AS n FROM user WHERE user_id=?').bind(boxes[1].userId).first()).n).toBe(before.n+1);
    await internalForwardService.forward(context(boxes[1].userId),original,p.attachments);
    expect(provider).toHaveBeenCalledOnce();
  });
  it('restores received private inline images as CID MIME bytes without private URLs, Bcc or duplicate attachments',async()=>{
    await enable();
    const post=vi.spyOn(Resend.prototype,'post').mockResolvedValue({data:{id:'forward-inline-provider'},error:null});
    vi.spyOn(Resend.prototype,'get').mockResolvedValue({data:{message_id:'<forward-inline@provider.test>'},error:null});
    const p=payload({subject:'forward inline image',content:`<p>Inline screenshot<img src="data:image/png;base64,${png}"></p>`,
      bcc:[addresses[3]],attachments:[{filename:'ordinary.bin',type:'application/octet-stream',content:'AP+AQUI='}]});
    const r=await api('/email/send',p);expect(r.status).toBe(200);expect((await r.json()).data[0].status).toBe(2);
    const original=await copy(p.subject);expect(original.content).toContain('{{domain}}attachments/');
    expect(original.bcc).toBe('[]');expect(original.message||'').not.toContain('INTERNAL_FORWARD_FAILED');
    expect(post).toHaveBeenCalledOnce();
    const form=post.mock.calls[0][1];expect(form.to).toEqual(['archive@outside.test']);expect(form.bcc).toBeUndefined();
    expect(form.html).not.toMatch(/\{\{domain\}\}|\/api\/attachment\/|attachments\//);
    const cid=form.html.match(/src="cid:([^"]+)"/)?.[1];expect(cid).toBeTruthy();
    expect(form.attachments).toHaveLength(2);
    const inline=form.attachments.find(item=>String(item.content_id||'').replace(/^<|>$/g,'')===cid);
    expect(inline).toMatchObject({content_type:'image/png',content:png});
    expect(Array.from(Uint8Array.from(atob(inline.content),char=>char.charCodeAt(0))))
      .toEqual(Array.from(Uint8Array.from(atob(png),char=>char.charCodeAt(0))));
    expect(form.attachments.filter(item=>item.filename==='ordinary.bin')).toHaveLength(1);
    await internalForwardService.forward(context(boxes[1].userId),original,p.attachments);
    expect(post).toHaveBeenCalledOnce();
  });
  it('preserves the original and shows only the recipient failure notice when its inline object is missing',async()=>{
    await enable();
    const provider=vi.spyOn(emailSendService,'sendByResend');
    const prepare=internalForwardService.inlineContent.bind(internalForwardService);
    let missingKey;
    vi.spyOn(internalForwardService,'inlineContent').mockImplementation(async(c,source,attachments)=>{
      missingKey=source.content.match(/\{\{domain\}\}(attachments\/[^"\s<>]+)/)?.[1];
      expect(missingKey).toBeTruthy();
      await env.r2.delete(missingKey);
      return prepare(c,source,attachments);
    });
    const p=payload({subject:'forward missing inline object',content:`<p>Keep original<img src="data:image/png;base64,${png}"></p>`});
    const r=await api('/email/send',p);expect(r.status).toBe(200);
    const sender=(await r.json()).data[0];expect(sender.status).toBe(2);expect(sender.deliveryWarning).toBeUndefined();
    const original=await copy(p.subject);expect(original).toMatchObject({status:0,isDel:0});
    expect(JSON.parse(original.message)).toMatchObject({code:'INTERNAL_FORWARD_FAILED'});
    expect(original.message).not.toContain(missingKey);expect(provider).not.toHaveBeenCalled();
    expect(await env.r2.get(missingKey)).toBeNull();
  });
  it('checks inline ownership and count/size budgets before reading objects and rejects oversized actual objects',async()=>{
    const key='attachments/forward-owned-budget.png';
    await env.db.prepare('INSERT INTO attachments(user_id,email_id,account_id,key,filename,mime_type,size,type) VALUES (?,?,?,?,?,?,?,1)')
      .bind(boxes[1].userId,1,boxes[1].accountId,key,'budget.png','image/png',1).run();
    const html=`<img src="{{domain}}${key}">`;
    const read=vi.spyOn(r2Service,'getObj');
    const source={userId:boxes[1].userId,emailId:1,accountId:boxes[1].accountId,content:html};
    await expect(internalForwardService.inlineContent(context(boxes[2].userId),{...source,userId:boxes[2].userId,accountId:boxes[2].accountId},[])).rejects.toThrow(/owned/);
    expect(read).not.toHaveBeenCalled();
    await expect(internalForwardService.inlineContent(context(boxes[1].userId),{...source,emailId:2},[])).rejects.toThrow(/owned/);
    expect(read).not.toHaveBeenCalled();
    await expect(internalForwardService.inlineContent(context(boxes[1].userId),{...source,content:html.repeat(11)},[])).rejects.toThrow(/at most 10 attachments/);
    expect(read).not.toHaveBeenCalled();
    await env.db.prepare('UPDATE attachments SET size=? WHERE key=?').bind(sendLimits.maxSingleAttachmentBytes+1,key).run();
    await expect(internalForwardService.inlineContent(context(boxes[1].userId),source,[])).rejects.toThrow(/10 MB/);
    expect(read).not.toHaveBeenCalled();
    await env.db.prepare('UPDATE attachments SET size=1 WHERE key=?').bind(key).run();
    const body={getReader:vi.fn()};read.mockResolvedValue({size:sendLimits.maxSingleAttachmentBytes+1,body});
    await expect(internalForwardService.inlineContent(context(boxes[1].userId),source,[])).rejects.toThrow(/unavailable/);
    expect(body.getReader).not.toHaveBeenCalled();
  });
  it.each(['rejected','unknown'])('keeps the original received mail and a fixed notice when forwarding is %s',async(outcome)=>{
    await enable();
    const provider=vi.spyOn(emailSendService,'sendByResend');
    if(outcome==='rejected')provider.mockResolvedValue({error:{message:'private-provider-fixture-error'}});
    else provider.mockRejectedValue(new Error('private-provider-fixture-error'));
    const p=payload({subject:'forward '+outcome});
    const r=await api('/email/send',p);expect(r.status).toBe(200);expect((await r.json()).data[0].status).toBe(2);
    const original=await copy(p.subject);expect(original).toMatchObject({status:0,isDel:0});
    expect(JSON.parse(original.message).code).toBe('INTERNAL_FORWARD_FAILED');
    expect(original.message).not.toContain('private-provider-fixture-error');
    if(outcome==='unknown')await internalForwardService.forward(context(boxes[1].userId),original,[]);
    expect(provider).toHaveBeenCalledOnce();
  });
  it('retains received mail with a fixed notice when its recipient has no provider credentials',async()=>{
    await enable();await env.db.prepare("UPDATE setting SET resend_tokens='{}'").run();await env.kv.delete(KvConst.SETTING);
    const provider=vi.spyOn(emailSendService,'sendByResend');
    const p=payload({subject:'forward missing credentials'});expect((await api('/email/send',p)).status).toBe(200);
    const original=await copy(p.subject);expect(original.status).toBe(0);expect(JSON.parse(original.message).code).toBe('INTERNAL_FORWARD_FAILED');
    expect(provider).not.toHaveBeenCalled();
  });
  it('honors current user/mailbox switches, disabled domains and managed-domain loop prevention',async()=>{
    await enable();
    const provider=vi.spyOn(emailSendService,'sendByResend').mockResolvedValue({data:{id:'not-expected'}});
    await env.db.prepare('UPDATE user SET main_forward_status=1 WHERE user_id=?').bind(boxes[1].userId).run();
    const p=payload({subject:'forward disabled switch'});expect((await api('/email/send',p)).status).toBe(200);
    const original=await copy(p.subject);expect(provider).not.toHaveBeenCalled();
    await env.db.prepare('UPDATE user SET main_forward_status=0 WHERE user_id=?').bind(boxes[1].userId).run();
    await enable(addresses[2]);await internalForwardService.forward(context(boxes[1].userId),original,[]);expect(provider).not.toHaveBeenCalled();
    await enable();await env.db.prepare("UPDATE managed_domain SET enabled=0 WHERE domain='example.com'").run();
    try {await internalForwardService.forward(context(boxes[1].userId),original,[]);expect(provider).not.toHaveBeenCalled();}
    finally {await env.db.prepare("UPDATE managed_domain SET enabled=1 WHERE domain='example.com'").run();}
    await env.db.prepare('UPDATE user SET forward_status=1 WHERE user_id=?').bind(boxes[1].userId).run();
    await internalForwardService.forward(context(boxes[1].userId),original,[]);expect(provider).not.toHaveBeenCalled();
  });
  it('uses Cloudflare for a recipient-selected forwarding channel and keeps RFC IDs separate',async()=>{
    await enable();await env.db.prepare("UPDATE mail_provider_config SET provider='cloudflare' WHERE id=1").run();
    const target={...runtime,email:{send:vi.fn(async()=>({messageId:'<forward-cloudflare@provider.test>'}))}};
    const p=payload({subject:'forward Cloudflare channel'});expect((await api('/email/send',p,cookie,target)).status).toBe(200);
    expect(target.email.send).toHaveBeenCalledOnce();
    expect(target.email.send.mock.calls[0][0]).toMatchObject({from:{email:addresses[1]},to:['archive@outside.test'],replyTo:addresses[0],headers:{'X-FlareMail-Forwarded':'1'}});
    const row=await env.db.prepare('SELECT delivery_provider AS provider,resend_email_id AS resendId FROM email WHERE type=1 AND user_id=? AND subject=?').bind(boxes[1].userId,p.subject).first();
    expect(row).toEqual({provider:'cloudflare',resendId:null});
  });
  it('uses the primary-mailbox switch and each alias switch independently',async()=>{
    await enable();
    await env.db.prepare('UPDATE account SET forward_status=1 WHERE account_id=?').bind(boxes[1].accountId).run();
    const provider=vi.spyOn(emailSendService,'sendByResend').mockResolvedValue({data:{id:'forward-switch-id'}});
    expect((await api('/email/send',payload({subject:'primary switch independent'}))).status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();provider.mockClear();
    const alias='recipient-forward-alias@example.com';
    const mailbox=await env.db.prepare('INSERT INTO account(email,user_id,forward_status) VALUES (?,?,0) RETURNING account_id AS id').bind(alias,boxes[1].userId).first();
    await env.db.prepare('UPDATE user SET main_forward_status=1 WHERE user_id=?').bind(boxes[1].userId).run();
    expect((await api('/email/send',payload({receiveEmail:[alias],subject:'alias switch independent'}))).status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();provider.mockClear();
    await env.db.prepare('UPDATE account SET forward_status=1 WHERE account_id=?').bind(mailbox.id).run();
    expect((await api('/email/send',payload({receiveEmail:[alias],subject:'alias switch disabled'}))).status).toBe(200);
    expect(provider).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('To/Cc/Bcc validation, delivery and privacy', () => {
  it('deduplicates case-insensitively with To then Cc then Bcc priority', () => {
    expect(normalizeRecipients([' A@example.net ', 'a@example.net'], ['a@example.net', 'B@example.net'], ['b@example.net', 'C@example.net']))
      .toEqual({ receiveEmail: ['a@example.net'], cc: ['b@example.net'], bcc: ['c@example.net'], allRecipients: ['a@example.net', 'b@example.net', 'c@example.net'] });
  });
  it('rejects invalid field types, addresses, injection and combined recipient counts', () => {
    for (const cc of ['one@example.net', {}, [null], ['a@example.net\r\nBcc: secret@example.net'], ['a'.repeat(250) + '@example.net']]) {
      expect(() => normalizeRecipients(['to@example.net'], cc)).toThrow();
    }
    expect(() => normalizeRecipients(['to@example.net'], Array.from({ length: 20 }, (_, i) => `cc${i}@example.net`))).toThrow(/at most 20/);
    expect(() => normalizeRecipients(['to@example.net'], [], Array(21).fill('dup@example.net'))).toThrow(/at most 20/);
    expect(() => normalizeRecipients([], ['cc@example.net'])).toThrow(/To recipient/);
  });
  it('keeps body and attachment limits when Cc and Bcc are present', () => {
    expect(() => normalizeSendParams(payload({ cc: ['cc@example.net'], attachments: [{ filename: 'huge', type: 'text/plain', content: new Uint8Array(10 * 1024 * 1024 + 1) }] }))).toThrow(/10 MB/);
    expect(() => normalizeSendParams(payload({ bcc: ['hidden@example.net'], text: 'x'.repeat(2 * 1024 * 1024 + 1) }))).toThrow(/too large/);
  });
  it('binds all recipient roles and content to the send payload fingerprint', async () => {
    const base = normalizeSendParams(payload());
    const hash = await sendPayloadHash(base);
    expect(hash).toHaveLength(64);
    expect(await sendPayloadHash({ ...base, bcc: ['secret@example.net'] })).not.toBe(hash);
    expect(await sendPayloadHash({ ...base, cc: ['public@example.net'] })).not.toBe(hash);
    expect(await sendPayloadHash({ ...base, text: 'changed' })).not.toBe(hash);
  });
  it('persists Bcc only in the sender copy and delivers each internal role exactly once', async () => {
    const p = payload({ subject: 'internal privacy', cc: [addresses[2], addresses[1]], bcc: [addresses[3], addresses[2]] });
    const first = await api('/email/send', p); expect(first.status).toBe(200);
    const sent = (await first.json()).data[0];
    expect(JSON.parse(sent.bcc).map(x => x.address)).toEqual([addresses[3]]);
    const rows = (await env.db.prepare('SELECT * FROM email WHERE subject = ?').bind(p.subject).all()).results;
    expect(rows).toHaveLength(4);
    expect(rows.filter(row => row.type === 0).map(row => row.to_email).sort()).toEqual(addresses.slice(1).sort());
    for (const row of rows.filter(row => row.type === 0)) {
      expect(row.bcc).toBe('[]'); expect(row.recipient).not.toContain(addresses[3]);
      expect(row.cc).not.toContain(addresses[3]);
    }
    const copy = rows.find(row => row.to_email === addresses[1]);
    const detail = await api(`/cli/emails/${copy.email_id}`, undefined, recipientToken);
    expect((await detail.json()).data.bcc).toBe('[]');
    const senderDetail = await api(`/cli/emails/${sent.emailId}`, undefined, token);
    expect((await senderDetail.json()).data.bcc).toContain(addresses[3]);
    const replay = await api('/email/send', p); expect((await replay.json()).data[0].idempotentReplay).toBe(true);
    expect((await api('/email/send', { ...p, bcc: [addresses[2]] })).status).toBe(409);
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM email WHERE subject = ?').bind(p.subject).first()).n).toBe(4);
  });
  it('strips historical or inbound Bcc before non-sender reads and persistence', async () => {
    const row = await env.db.prepare("INSERT INTO email(user_id,account_id,type,status,subject,bcc) VALUES (?,?,0,0,'historical bcc',?) RETURNING email_id AS id")
      .bind(boxes[1].userId, boxes[1].accountId, JSON.stringify([{ address: 'legacy-secret@example.net' }])).first();
    expect((await (await api(`/cli/emails/${row.id}`, undefined, recipientToken)).json()).data.bcc).toBe('[]');
    const received = await emailService.receive(context(boxes[1].userId), {
      userId: boxes[1].userId, accountId: boxes[1].accountId, toEmail: addresses[1], sendEmail: 'sender@outside.test',
      recipient: JSON.stringify([{ address: addresses[1] }]),
      subject: 'received privacy', text: 'body', content: '<p>body</p>', bcc: '[{"address":"hidden@outside.test"}]',
    }, [], '');
    expect(received.bcc).toBe('[]');
    const foreignSent = [{ emailId: 123, userId: boxes[0].userId, type: 1, bcc: '[{"address":"admin-secret@example.net"}]' }];
    await emailService.emailAddReplyTo(context(boxes[1].userId), foreignSent);
    expect(foreignSent[0].bcc).toBe('[]');
  });
  it('builds native Resend and Cloudflare cc/bcc fields without adding Bcc headers', async () => {
    const post = vi.spyOn(Resend.prototype, 'post').mockResolvedValue({ data: { id: 'recipient-provider-id' }, error: null });
    vi.spyOn(Resend.prototype, 'get').mockResolvedValue({ data: { message_id: '<recipient@provider.test>' }, error: null });
    const params = { accountEmail: addresses[0], name: 'Sender', receiveEmail: ['to@outside.test'], cc: ['cc@outside.test'], bcc: ['secret@outside.test'], subject: 'native provider', text: 'body', html: '<p>body</p>' };
    await emailSendService.sendByResend('fixture', params);
    expect(post.mock.calls[0][1]).toMatchObject({ to: params.receiveEmail, cc: params.cc, bcc: params.bcc });
    const cloudflare = await emailSendService.prepareCloudflareEmail(params);
    expect(cloudflare).toMatchObject({ to: params.receiveEmail, cc: params.cc, bcc: params.bcc });
    expect(cloudflare.headers?.Bcc).toBeUndefined(); expect(cloudflare.headers?.bcc).toBeUndefined();
  });
  it('routes external Cc/Bcc without promoting a hidden address or duplicating internal recipients', async () => {
    const resend = vi.spyOn(emailSendService, 'sendByResend').mockResolvedValue({ data: { id: 'mixed-role-id', messageId: '<mixed@provider.test>' } });
    const p = payload({ subject: 'mixed external role', cc: ['copy@outside.test'], bcc: ['hidden@outside.test'] });
    const r = await api('/email/send', p); expect(r.status).toBe(200);
    expect(resend).toHaveBeenCalledOnce();
    expect(resend.mock.calls[0][1]).toMatchObject({ receiveEmail: [addresses[1]], cc: ['copy@outside.test'], bcc: ['hidden@outside.test'] });
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM email WHERE subject = ?').bind(p.subject).first()).n).toBe(1);
  });
  it('routes every mixed recipient through one provider envelope with complete public roles', async () => {
    const resend = vi.spyOn(emailSendService, 'sendByResend').mockResolvedValue({ data: { id: 'mixed-split-id', messageId: '<mixed-split@provider.test>' } });
    const p = payload({ receiveEmail: ['to@outside.test'], cc: [addresses[2]], bcc: [addresses[3], 'secret@outside.test'], subject: 'mixed split privacy' });
    expect((await api('/email/send', p)).status).toBe(200);
    expect(resend.mock.calls[0][1]).toMatchObject({ receiveEmail: ['to@outside.test'], cc: [addresses[2]], bcc: [addresses[3], 'secret@outside.test'] });
    const rows = (await env.db.prepare('SELECT type,bcc,recipient,cc FROM email WHERE subject = ?').bind(p.subject).all()).results;
    expect(rows).toHaveLength(1);
    for (const row of rows.filter(row => row.type === 0)) expect(row.bcc).toBe('[]');
  });
  it('persists the actual Resend envelope and leaves no duplicate local copies on rejection or unknown outcomes', async () => {
    const recipients=[addresses[1],'to@outside.test',addresses[2],addresses[3]];
    for(const outcome of ['accepted','rejected','unknown']) {
      const send=vi.spyOn(emailSendService,'sendByResend');
      if(outcome==='accepted')send.mockResolvedValue({data:{id:'provider-role-'+outcome,messageId:'<role@provider.test>'}});
      if(outcome==='rejected')send.mockResolvedValue({error:{message:'fixture rejection'}});
      if(outcome==='unknown')send.mockRejectedValue(new Error('fixture transport failure'));
      const p=payload({receiveEmail:recipients.slice(0,2),cc:[addresses[2]],bcc:[addresses[3]],subject:'role outcome '+outcome});
      const r=await api('/email/send',p);expect(r.status).toBe(outcome==='rejected'?502:200);
      const rows=(await env.db.prepare('SELECT type,status,delivery_provider AS provider,delivery_recipients AS recipients,resend_email_id AS providerId FROM email WHERE subject=?').bind(p.subject).all()).results;
      expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({type:1,provider:'resend'});
      expect(JSON.parse(rows[0].recipients)).toEqual(recipients);
      if(outcome==='accepted')expect(rows[0].providerId).toBe('provider-role-accepted');
      if(outcome==='unknown')expect(rows[0].status).toBe(5);
      send.mockRestore();
    }
  });
  it('separates Cloudflare RFC IDs from Resend IDs including accepted-send recovery', async () => {
    await env.db.prepare("UPDATE mail_provider_config SET provider='cloudflare' WHERE id=1").run();
    try {
      const target={...runtime,email:{send:vi.fn(async()=>({messageId:'<actual-cloudflare@provider.test>'}))}};
      vi.spyOn(emailSendService,'completeSendRequest').mockRejectedValueOnce(new Error('fixture receipt failure'));
      const p=payload({receiveEmail:['external@outside.test'],cc:[addresses[2]],bcc:[addresses[3]],subject:'actual Cloudflare provider'});
      const r=await api('/email/send',p,cookie,target);expect(r.status).toBe(200);
      const sent=(await r.json()).data[0];expect(sent.resendEmailId).toBeNull();
      const row=await env.db.prepare('SELECT delivery_provider AS provider,delivery_recipients AS recipients,resend_email_id AS resendId,message_id AS messageId FROM email WHERE email_id=?').bind(sent.emailId).first();
      expect(row).toMatchObject({provider:'cloudflare',resendId:null,messageId:'<actual-cloudflare@provider.test>'});
      expect(JSON.parse(row.recipients)).toEqual(['external@outside.test',addresses[2],addresses[3]]);
      expect((await (await api('/email/delivery?emailId='+sent.emailId)).json()).data.provider).toBe('unavailable');
    } finally {await env.db.prepare("UPDATE mail_provider_config SET provider='resend' WHERE id=1").run();}
  });
  it('marks pure internal sends local and treats unclassified historical provider IDs conservatively', async () => {
    const r=await api('/email/send',payload({subject:'local provider metadata'}));expect(r.status).toBe(200);
    const id=(await r.json()).data[0].emailId;
    expect(await env.db.prepare('SELECT delivery_provider AS provider,delivery_recipients AS recipients,resend_email_id AS resendId FROM email WHERE email_id=?').bind(id).first())
      .toEqual({provider:'local',recipients:'[]',resendId:null});
    const old=await env.db.prepare("INSERT INTO email(user_id,account_id,type,status,subject,resend_email_id) VALUES (?,?,1,1,'legacy provider','opaque-historical-id') RETURNING email_id AS id")
      .bind(boxes[0].userId,boxes[0].accountId).first();
    expect((await (await api('/email/delivery?emailId='+old.id)).json()).data).toMatchObject({provider:'unavailable',events:[]});
  });
  it('keeps CLI single-To compatibility and accepts To arrays with Cc/Bcc', async () => {
    for (const to of [addresses[1], [addresses[1]]]) {
      const r = await api('/cli/emails/send', { to, cc: [addresses[2]], bcc: [addresses[3]], subject: 'CLI recipient roles', body: 'body', requestId: crypto.randomUUID() }, token);
      expect(r.status).toBe(200);
    }
    expect((await api('/cli/emails/send', { to: addresses[1], cc: 'not-an-array', subject: 'invalid', body: 'body', requestId: crypto.randomUUID() }, token)).status).toBe(400);
  });
  it('returns every retained owned identity including soft-deleted aliases without exposing another user', async () => {
    const alias='recipient-deleted-alias@example.com';
    await env.db.prepare('INSERT INTO account(email,user_id,is_del) VALUES (?,?,1)').bind(alias,boxes[0].userId).run();
    const r=await api('/mail/identities');
    expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect((await r.json()).data).toEqual({userId:boxes[0].userId,addresses:expect.arrayContaining([addresses[0],'recipient-alias@example.com',alias])});
    const read=await api('/mail/identities');
    expect((await read.json()).data.addresses).not.toContain(addresses[1]);
    expect((await api('/mail/identities',undefined,null)).status).toBe(401);
  });
  it('uses Reply-To, To and Cc for reply all and excludes every owned mailbox and all Bcc', async () => {
    const original = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,send_email,to_email,recipient,cc,bcc,reply_to,subject,text,message_id)
      VALUES (?,?,0,0,?,?,?,?,?,?,'reply all source','old body','<reply-all@source.test>') RETURNING email_id AS id`)
      .bind(boxes[0].userId, boxes[0].accountId, addresses[3], addresses[0],
        JSON.stringify([{ address: addresses[0] }, { address: 'recipient-alias@example.com' }, { address: 'recipient-deleted-alias@example.com' }, { address: addresses[2] }]),
        JSON.stringify([{ address: addresses[1] }, { address: addresses[2].toUpperCase() }]),
        '[{"address":"never-reply@outside.test"}]', JSON.stringify([{ address: addresses[3] }])).first();
    const r = await api(`/cli/emails/${original.id}/reply`, { replyAll: true, body: 'new reply', requestId: crypto.randomUUID() }, token);
    expect(r.status).toBe(200);
    const sent = await env.db.prepare('SELECT recipient,cc,bcc FROM email WHERE email_id = ?').bind((await r.json()).data.id).first();
    expect(JSON.parse(sent.recipient).map(x => x.address)).toEqual([addresses[3]]);
    expect(JSON.parse(sent.cc).map(x => x.address)).toEqual([addresses[2], addresses[1]]);
    expect(sent.bcc).toBe('[]');
    expect((await api(`/cli/emails/${original.id}/reply`, { replyAll: 'yes', body: 'invalid', requestId: crypto.randomUUID() }, token)).status).toBe(400);
    expect(replyRecipientLists({ type: 1, recipient: '[{"address":"peer@example.net"}]', cc: '[{"address":"copy@example.net"}]', bcc: '[{"address":"secret@example.net"}]' }, [], true))
      .toEqual({ receiveEmail: ['peer@example.net'], cc: ['copy@example.net'] });
  });
  it('rejects Cc/Bcc on a legacy send_request table while allowing To-only compatibility', async () => {
    await env.db.prepare('ALTER TABLE send_request DROP COLUMN payload_hash').run();
    try {
      expect((await api('/email/send', payload({ cc: [addresses[2]] }))).status).toBe(503);
      expect((await api('/email/send', payload())).status).toBe(200);
    } finally {
      await env.db.prepare("ALTER TABLE send_request ADD COLUMN payload_hash TEXT NOT NULL DEFAULT ''").run();
    }
  });
});
