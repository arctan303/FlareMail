import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import { migrations } from '../src/init/migrations';
import { webhookSchemaStatements } from '../src/init/webhook-schema';
import webhookService, { normalizeWebhookUrl } from '../src/service/webhook-service';
import emailSendService from '../src/service/email-send-service';
import emailService from '../src/service/email-service';
import cryptoUtils from '../src/utils/crypto-utils';
import userService from '../src/service/user-service';
import { readableMailBody } from '../src/utils/mail-text';
import { markInstalled } from './installed-instance';

const runtime = { ...env, SETUP_SECRET: undefined,
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SEND_RATE_LIMITER: { limit: async () => ({ success: true }) }, EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const context = () => { const values = new Map(); return { env: runtime, get: key => values.get(key), set: (key, value) => values.set(key, value) }; };
let owner, foreign, token, foreignToken, mockFetch, sequence = 0;
async function mailbox(admin = 0) {
  const address = `webhook-${++sequence}@example.com`, material = await cryptoUtils.hashPassword('webhook-test-password');
  const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS id').bind(address, material.hash, material.salt, admin).first();
  const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id').bind(address, user.id).first();
  return { userId: user.id, accountId: account.id, email: address };
}
async function api(path, { method = 'GET', body, auth = token, cookie, origin = 'http://localhost' } = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`http://localhost/api${path}`, { method,
    headers: { ...(cookie ? { Cookie: cookie } : { Authorization: `Bearer ${auth}` }), Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), runtime, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, headers: response.headers, ...await response.json() };
}
const configBody = (extra = {}) => ({ revision: 0, url: 'https://hooks.example.com/inbox', enabled: true, mode: 'all', allowlist: [], ...extra });
const configure = extra => webhookService.save(context(), owner.userId, owner.accountId, configBody(extra));
async function saving(sender = 'sender@outside.test', extra = {}) {
  const row = await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,is_del,send_email,subject,text,content,unread,to_email)
    VALUES (?,?,0,6,1,?,'fixture','plain','<p>HTML body</p>',0,?) RETURNING email_id AS id`).bind(owner.userId, owner.accountId, sender,owner.email).first();
  if (Object.keys(extra).length) await env.db.prepare(`UPDATE email SET ${Object.keys(extra).map(key => `${key}=?`).join(',')} WHERE email_id=?`).bind(...Object.values(extra), row.id).run();
  return row.id;
}
const complete = id => webhookService.completeReceive(context(), 0, id);
const delivery = id => env.db.prepare('SELECT * FROM webhook_delivery WHERE email_id=?').bind(id).first();

beforeAll(async () => { await dbInit.migrate(context()); await markInstalled(env, ['example.com'], []); });
beforeEach(async () => {
  await env.db.batch([env.db.prepare('DELETE FROM webhook_delivery'), env.db.prepare('DELETE FROM webhook_config'), env.db.prepare('UPDATE user SET is_admin=0 WHERE is_admin=1')]);
  owner = await mailbox(); foreign = await mailbox(1);
  token = await userService.genCliToken(context(), owner.userId); foreignToken = await userService.genCliToken(context(), foreign.userId);
  mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('mail webhook lifecycle and owner boundaries', () => {
  it('shares CLI/Web configuration, masks secrets and rejects foreign owners, stale revisions and cross-origin writes', async () => {
    const base = `/cli/webhooks/${owner.accountId}`;
    expect((await api(base, { auth: 'invalid' })).status).toBe(401);
    expect((await api(base, { auth: foreignToken })).status).toBe(404);
    const saved = await api(base, { method: 'PUT', body: configBody() });
    expect(saved.status).toBe(200); expect(saved.data.secret).toMatch(/^[a-f0-9]{64}$/);
    const read = await api(base); expect(read.data.secret).toBeUndefined(); expect(read.headers.get('cache-control')).toBe('no-store');
    expect((await api(base, { method: 'PUT', body: configBody() })).status).toBe(409);
    const login = await api('/login', { method: 'POST', body: { email: owner.email, password: 'webhook-test-password' } });
    expect(login.status).toBe(200); const cookie = login.headers.get('set-cookie').split(';')[0];
    const webPath = `/my/webhooks/${owner.accountId}`;
    expect((await api(webPath, { cookie })).data).toEqual(read.data);
    expect((await api(webPath, { method: 'PUT', cookie, origin: 'https://evil.example', body: configBody({ revision: 1 }) })).status).toBe(403);
    const updated = await api(webPath, { method: 'PUT', cookie, body: configBody({ revision: 1, enabled: false, mode: 'allowlist', allowlist: [' Owner@EXAMPLE.com ', 'owner@example.com'] }) });
    expect(updated.data.allowlist).toEqual(['owner@example.com']); expect(updated.data.secret).toBeUndefined();
    expect((await api(base)).data.enabled).toBe(false);
    for (const [method, suffix, body] of [['PUT', '', configBody()], ['DELETE', '?revision=2'], ['POST', '/secret', { revision: 2 }], ['POST', '/test'], ['GET', '/deliveries'], ['POST', '/deliveries/foreign/retry']]) {
      expect((await api(base + suffix, { method, body, auth: foreignToken })).status).toBe(404);
    }
  });

  it('requires an explicit neutral sender mode and constrains outbound targets and secrets', async () => {
    for (const url of ['http://hooks.example.com', 'https://127.0.0.1', 'https://[::1]', 'https://x.local/', 'https://x.internal/', 'https://a:b@hooks.example.com', 'https://hooks.example.com:8443', 'https://hooks.example.com/#x']) expect(() => normalizeWebhookUrl(url)).toThrow();
    expect(normalizeWebhookUrl('https://ipv6.example.com')).toBe('https://ipv6.example.com/');
    for (const extra of [{ mode: undefined }, { mode: 'strict' }, { secret: 'short' }, { allowlist: ['Owner <owner@example.com>'] }, { allowlist: Array(101).fill('a@b.com') }]) {
      expect((await api(`/cli/webhooks/${owner.accountId}`, { method: 'PUT', body: configBody(extra) })).status).toBe(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('enqueues atomically only when a receive row becomes readable; no historical, failed or sent events', async () => {
    const historical = await saving(); await complete(historical); await configure();
    expect(await delivery(historical)).toBeNull();
    const id = await saving(); expect(await delivery(id)).toBeNull(); await complete(id);
    const first = await delivery(id); expect(first.event_type).toBe('email.received');
    await complete(id); expect((await delivery(id)).event_id).toBe(first.event_id);
    const failed = await saving(); await env.db.prepare('UPDATE email SET status=8,is_del=0 WHERE email_id=?').bind(failed).run(); expect(await delivery(failed)).toBeNull();
    const sent = await saving('sender@outside.test', { type: 1 }); await complete(sent); expect(await delivery(sent)).toBeNull();
    await webhookService.deliver(context(), first.event_id);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/inbox'); expect(options.redirect).toBe('error');
    expect(Object.keys(options.headers)).toEqual(['Content-Type', 'X-FlareMail-Webhook-Secret']);
    expect(JSON.parse(options.body)).toEqual({ event: 'email.received', eventId: first.event_id, emailId: id, mailbox: owner.email });
    expect((await delivery(id)).status).toBe('delivered');
  });

  it('filters full sender addresses, leaves unmatched mail readable and handles empty/disabled lists', async () => {
    const config = await configure({ mode: 'allowlist', allowlist: ['Sender@Outside.Test'] });
    const allowed = await saving(' SENDER@outside.test '); await complete(allowed); expect(await delivery(allowed)).not.toBeNull();
    const denied = await saving('evil@outside.test', { name: 'sender@outside.test' }); await complete(denied); expect(await delivery(denied)).toBeNull();
    expect((await api(`/cli/emails/${denied}`)).status).toBe(200);
    await webhookService.save(context(), owner.userId, owner.accountId, configBody({ revision: config.revision, mode: 'allowlist', allowlist: [] }));
    const empty = await saving(); await complete(empty); expect(await delivery(empty)).toBeNull();
    await webhookService.save(context(), owner.userId, owner.accountId, configBody({ revision: config.revision + 1, enabled: false }));
    const disabled = await saving(); await complete(disabled); expect(await delivery(disabled)).toBeNull();
  });

  it('delivers external MIME and internal copies after attachment metadata exists', async () => {
    await configure();
    const raw = ['From: Sender <sender@outside.test>', `To: ${owner.email}`, 'Subject: webhook MIME', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="boundary"', '', '--boundary', 'Content-Type: text/html; charset=utf-8', '', '<p>Article</p><p><a href="https://news.example.com/item">Read more</a></p>', '--boundary', 'Content-Type: text/plain; name="note.txt"', 'Content-Disposition: attachment; filename="note.txt"', '', 'note', '--boundary--'].join('\r\n');
    const bytes = new TextEncoder().encode(raw), ctx = createExecutionContext();
    let observedAttachments = 0;
    mockFetch.mockImplementation(async (_url, options) => {
      const payload = JSON.parse(options.body);
      observedAttachments = (await env.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE email_id=?').bind(payload.emailId).first()).n;
      expect((await api(`/cli/emails/${payload.emailId}`)).status).toBe(200);
      return new Response(null, { status: 204 });
    });
    const message = { from: 'sender@outside.test', to: owner.email, rawSize: bytes.length, raw: new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }), setReject: vi.fn(), forward: vi.fn() };
    await worker.email(message, runtime, ctx); await waitOnExecutionContext(ctx);
    expect(message.setReject).not.toHaveBeenCalled(); expect(observedAttachments).toBe(1); expect(mockFetch).toHaveBeenCalledOnce();
    const internalCtx = createExecutionContext();
    const result = await emailSendService.HandleOnSiteEmail({ ...context(), executionCtx: internalCtx }, [owner.email], { sendEmail: foreign.email, name: 'Sender', recipient: '[]', subject: 'internal webhook', text: 'hello', content: '<p>hello</p>' }, []);
    await waitOnExecutionContext(internalCtx);
    expect(result.deliveredCount).toBe(1); expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps IDs stable across finite retries and concurrent drains; never logs target bodies', async () => {
    await configure(); const id = await saving(); await complete(id); const event = await delivery(id);
    mockFetch.mockImplementation(async () => new Response('secret response body', { status: 500 }));
    for (let attempt = 1; attempt <= 5; attempt++) {
      await env.db.prepare('UPDATE webhook_delivery SET next_at=0 WHERE event_id=?').bind(event.event_id).run();
      await Promise.all([webhookService.deliver(context(), event.event_id), webhookService.deliver(context(), event.event_id)]);
      const row = await delivery(id); expect(row.attempts).toBe(attempt); expect(row.status).toBe(attempt === 5 ? 'failed' : 'pending');
      expect(row.error).toBe('http_error'); expect(row.http_status).toBe(500);
    }
    expect(mockFetch).toHaveBeenCalledTimes(5); expect(new Set(mockFetch.mock.calls.map(call => JSON.parse(call[1].body).eventId))).toEqual(new Set([event.event_id]));
    mockFetch.mockImplementation(async () => new Response(null, { status: 204 }));
    expect((await api(`/cli/webhooks/${owner.accountId}/deliveries/${event.event_id}/retry`, { method: 'POST' })).status).toBe(200);
    expect((await delivery(id)).status).toBe('delivered');
  });

  it('cancels queued work on rotation/delete, prevents revival after recreation and does not send deleted mail', async () => {
    const config = await configure(); const id = await saving(); await complete(id);
    const rotated = await webhookService.rotate(context(), owner.userId, owner.accountId, config.revision);
    expect(rotated.secret).not.toBe(config.secret); expect((await delivery(id)).status).toBe('cancelled');
    const old = await saving(); await complete(old); const oldEvent = await delivery(old);
    await env.db.prepare("UPDATE webhook_delivery SET status='failed' WHERE email_id=?").bind(old).run();
    await webhookService.remove(context(), owner.userId, owner.accountId, rotated.revision);
    const removed = await webhookService.get(context(), owner.userId, owner.accountId); expect(removed.hasSecret).toBe(false);
    const recreated = await configure({ revision: removed.revision }); expect(recreated.secret).toBeDefined(); expect(recreated.revision).toBeGreaterThan(rotated.revision);
    expect((await api(`/cli/webhooks/${owner.accountId}/deliveries/${oldEvent.event_id}/retry`, { method: 'POST' })).status).toBe(409);
    const deleted = await saving(); await complete(deleted); await env.db.prepare('UPDATE email SET is_del=1 WHERE email_id=?').bind(deleted).run();
    await webhookService.deliver(context(), (await delivery(deleted)).event_id); expect(mockFetch).not.toHaveBeenCalled();
  });

  it('tests even a disabled configuration without creating fake mail or changing unread state', async () => {
    const config = await configure({ enabled: false });
    const result = await api(`/cli/webhooks/${owner.accountId}/test`, { method: 'POST' });
    expect(result.status).toBe(200); expect(result.data.status).toBe('delivered'); expect(result.data.emailId).toBeNull();
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).event).toBe('webhook.test');
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM email WHERE user_id=?').bind(owner.userId).first()).n).toBe(0);
    expect((await webhookService.get(context(), owner.userId, owner.accountId)).revision).toBe(config.revision);
  });

  it('paginates delivery records without skipping events created in the same millisecond', async () => {
    const config = await configure(), now = Date.now();
    await env.db.batch(Array.from({ length: 51 }, (_, i) => env.db.prepare(`INSERT INTO webhook_delivery(event_id,account_id,user_id,mailbox,event_type,revision,status,next_at,created_at,updated_at) VALUES (?,?,?,?,'webhook.test',?,'delivered',?,?,?)`).bind(`page-${String(i).padStart(2, '0')}`, owner.accountId, owner.userId, owner.email, config.revision, now, now, now)));
    const first = (await api(`/cli/webhooks/${owner.accountId}/deliveries`)).data;
    const second = (await api(`/cli/webhooks/${owner.accountId}/deliveries?before=${encodeURIComponent(first.nextBefore)}`)).data;
    expect(first.list).toHaveLength(50); expect(second.list).toHaveLength(1);
    expect(new Set([...first.list, ...second.list].map(row => row.eventId)).size).toBe(51);
  });

  it('supports unread and lossless incremental scans, and searches HTML/body content', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) { const id = await saving('sender@outside.test', { unread: i === 1 ? 1 : 0, content: '<p>needle-in-html</p>' }); await complete(id); ids.push(id); }
    const first = (await api(`/cli/emails?afterId=0&size=2&accountId=${owner.accountId}`)).data;
    const second = (await api(`/cli/emails?afterId=${first.nextAfterId}&size=2&accountId=${owner.accountId}`)).data;
    expect([...first.list, ...second.list].map(row => row.id)).toEqual(ids);
    const unread = (await api(`/cli/emails?accountId=${owner.accountId}&unread=true&q=needle-in-html`)).data;
    expect(unread.list.map(row => row.id)).toEqual([ids[3], ids[2], ids[0]]);
    expect((await api('/cli/emails?unread=maybe')).status).toBe(400); expect((await api('/cli/emails?afterId=-1')).status).toBe(400);
    const detail = (await api(`/cli/emails/${ids[0]}`)).data;
    expect(detail.body).toBe('needle-in-html'); expect(detail.bodySource).toBe('html'); expect(detail.text).toBe('plain');
  });

  it('does not advance incremental cursors past an earlier mail still saving attachments', async () => {
    const slow = await saving(), fast = await saving(); await complete(fast);
    const first = (await api(`/cli/emails?accountId=${owner.accountId}&afterId=0`)).data;
    expect(first.list.map(row => row.id)).toEqual([fast]); expect(first.nextAfterId).toBe(slow - 1); expect(first.scanPending).toBe(true);
    const waiting = (await api(`/cli/emails?accountId=${owner.accountId}&afterId=${first.nextAfterId}`)).data;
    expect(waiting.nextAfterId).toBe(first.nextAfterId);
    await complete(slow);
    const ready = (await api(`/cli/emails?accountId=${owner.accountId}&afterId=${first.nextAfterId}`)).data;
    expect(ready.list.map(row => row.id)).toEqual([slow, fast]); expect(ready.nextAfterId).toBe(fast); expect(ready.scanPending).toBe(false);
    expect((await api('/cli/emails?afterId=0&page=2')).status).toBe(400);
  });

  it('returns the exact written revision with its generated secret when another writer changes it immediately', async () => {
    const competingSecret = 'competing-secret-01234567890123456789';
    let generated;
    const racingDb = new Proxy(env.db, { get(target, property) {
      if (property === 'batch') return async statements => {
        const results = await target.batch(statements);
        generated = await target.prepare('SELECT secret FROM webhook_config WHERE account_id=?').bind(owner.accountId).first();
        await target.prepare('UPDATE webhook_config SET revision=revision+1,secret=?,enabled=0 WHERE account_id=?').bind(competingSecret, owner.accountId).run();
        return results;
      };
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const response = await webhookService.save({ ...context(), env: { ...runtime, db: racingDb } }, owner.userId, owner.accountId, configBody());
    expect(response.revision).toBe(1); expect(response.enabled).toBe(true); expect(response.secret).toBe(generated.secret);
    expect(await env.db.prepare('SELECT revision,secret FROM webhook_config WHERE account_id=?').bind(owner.accountId).first()).toEqual({ revision: 2, secret: competingSecret });
  });

  it('rejects incompatible delivery defaults before migration or marker writes', async () => {
    await env.db.prepare('DROP TABLE webhook_delivery').run();
    await env.db.batch(webhookSchemaStatements({ prepare: sql => env.db.prepare(sql.replace("status TEXT NOT NULL DEFAULT 'pending'", "status TEXT NOT NULL DEFAULT 'delivered'")) }));
    try {
      expect(await migrations.v3_27Applied(context())).toBe(false);
      await env.db.prepare('DELETE FROM schema_migrations WHERE version=327').run();
      expect(await migrations.v3_27UpgradePending(context())).toBe(false);
      const before = (await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results;
      await expect(migrations.v3_27DB(context())).rejects.toThrow('requires manual recovery');
      expect((await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results).toEqual(before);
      expect(await env.db.prepare('SELECT 1 FROM schema_migrations WHERE version=327').first()).toBeNull();
    } finally {
      await env.db.prepare('DROP TABLE webhook_delivery').run();
      await env.db.batch([...webhookSchemaStatements(env.db), env.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (327)')]);
    }
  });

  it('upgrades schema 326 idempotently while preserving existing mail', async () => {
    const id = await saving(); await complete(id);
    await env.db.batch([env.db.prepare('DROP TABLE webhook_delivery'), env.db.prepare('DROP TABLE webhook_config'), env.db.prepare('DELETE FROM schema_migrations WHERE version=327')]);
    expect((await api(`/cli/webhooks/${owner.accountId}`)).status).toBe(503);
    await migrations.v3_27DB(context()); await migrations.v3_27DB(context());
    expect(await migrations.v3_27Applied(context())).toBe(true);
    expect((await api(`/cli/emails/${id}`)).status).toBe(200);
    expect(await delivery(id)).toBeNull();
  });

  it('never emits notifications for legacy recovery or incomplete attachment copies', async () => {
    await configure(); const stalled = await saving();
    await emailService.completeReceiveAll(context()); expect(await delivery(stalled)).toBeNull();
    const ctx = createExecutionContext();
    const outcome = await emailSendService.HandleOnSiteEmail({ ...context(), executionCtx: ctx }, [owner.email],
      { sendEmail: foreign.email, name: 'Sender', recipient: '[]', subject: 'incomplete internal', text: 'body' }, [{ key: null }]);
    await waitOnExecutionContext(ctx);
    expect(outcome.failedCount).toBe(1); expect(mockFetch).not.toHaveBeenCalled();
    const partial = await env.db.prepare("SELECT email_id AS id,status FROM email WHERE subject='incomplete internal'").first();
    expect(partial.status).toBe(8); expect(await delivery(partial.id)).toBeNull();
  });

  it('recovers abandoned leases, bounds network failures and expires old events', async () => {
    await configure(); const id = await saving(); await complete(id); const event = await delivery(id);
    await env.db.prepare("UPDATE webhook_delivery SET status='sending',lease_until=0,next_at=0,attempts=1 WHERE event_id=?").bind(event.event_id).run();
    mockFetch.mockRejectedValue(new Error('sensitive target message'));
    await webhookService.deliver(context(), event.event_id);
    expect(await delivery(id)).toMatchObject({ status: 'pending', attempts: 2, error: 'network_or_target_error' });
    await env.db.prepare('UPDATE webhook_delivery SET created_at=?,next_at=0 WHERE event_id=?').bind(Date.now() - 86400001, event.event_id).run();
    await webhookService.deliver(context(), event.event_id);
    expect(await delivery(id)).toMatchObject({ status: 'failed', error: 'expired' }); expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('refuses forged schema markers and wrong indexes without migration mutation', async () => {
    await env.db.batch([env.db.prepare('DROP INDEX idx_webhook_due'), env.db.prepare('CREATE INDEX idx_webhook_due ON webhook_delivery(user_id)')]);
    try {
      expect(await migrations.v3_27Applied(context())).toBe(false);
      const before = (await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results;
      await expect(migrations.v3_27DB(context())).rejects.toThrow('requires manual recovery');
      expect((await env.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).results).toEqual(before);
    } finally {
      await env.db.batch([env.db.prepare('DROP INDEX idx_webhook_due'), env.db.prepare('CREATE INDEX idx_webhook_due ON webhook_delivery(status,next_at)')]);
    }
  });
});

describe('readable HTML alternatives', () => {
  it('preserves paragraphs, lists and links without executing or fetching HTML', () => {
    const result = readableMailBody({ text: 'View this email in your browser', content: '<style>.x{}</style><script>bad()</script><p>Hello &amp; welcome</p><ul><li>One</li><li>Two</li></ul><p><a href="https://example.com/article">Article</a></p><p hidden>hidden</p>' });
    expect(result.body).toBe('Hello & welcome\n\n- One\n\n- Two\n\nArticle (https://example.com/article)');
    expect(result.text).toBe('View this email in your browser'); expect(result.bodySource).toBe('html');
    expect(readableMailBody({ text: ' Plain ', content: '<script>bad()</script>' }).body).toBe('Plain');
    expect(readableMailBody({ text: '   ', content: '<p>HTML only</p>' }).body).toBe('HTML only');
  });
});
