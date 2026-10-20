import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import '../src/api/mail-recovery-api';
import { dbInit } from '../src/init/init';
import service from '../src/service/mail-recovery-service';
import attService from '../src/service/att-service';
import r2Service from '../src/service/r2-service';
import cryptoUtils from '../src/utils/crypto-utils';
import accountService from '../src/service/account-service';
import managedDomainService from '../src/service/managed-domain-service';
import { markInstalled } from './installed-instance';
import KvConst from '../src/const/kv-const';

const password = 'mail-recovery-fixture-password';
const runtime = { ...env, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) } };
const context = (userId, hash = 'fixture-session') => { const values = new Map([['session', { hash }], ['user', { userId }]]); return { env: runtime, get: key => values.get(key), set: (key, value) => values.set(key, value) }; };
async function request(path, { method = 'GET', cookie, body, origin = 'http://localhost' } = {}) {
  const execution = createExecutionContext();
  const response = await worker.fetch(new Request('http://localhost/api' + path, { method,
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en', ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), runtime, execution);
  await waitOnExecutionContext(execution);
  return response;
}
async function identity(address, admin = false) {
  const material = await cryptoUtils.hashPassword(password);
  const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS id').bind(address, material.hash, material.salt, +admin).first();
  const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id').bind(address, user.id).first();
  return { userId: user.id, accountId: account.id, email: address };
}
async function login(address) {
  const response = await request('/login', { method: 'POST', body: { email: address, password } });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie').split(';')[0];
}
async function mail(owner, options = {}) {
  const row = await env.db.prepare(`INSERT INTO email(user_id,account_id,send_email,to_email,subject,text,content,status,is_del,unread)
    VALUES (?,?,?,?,'recovery fixture','retained text','<p>retained HTML</p>',?,0,?) RETURNING email_id AS id`)
    .bind(owner.userId, owner.accountId, 'sender@outside.test', owner.email || 'person@example.com', options.status ?? 0, options.unread ?? 0).first();
  if (options.deleted !== false) await env.db.prepare('UPDATE email SET is_del=1 WHERE email_id=?').bind(row.id).run();
  if (options.age) await env.db.prepare(`UPDATE email SET deleted_at=datetime('now',?) WHERE email_id=?`).bind(options.age, row.id).run();
  return row.id;
}
async function attachment(owner, id, key = 'fixture-private-object') {
  await env.db.prepare('INSERT INTO attachments(user_id,account_id,email_id,key,filename) VALUES (?,?,?,?,?)').bind(owner.userId, owner.accountId, id, key, 'retained.txt').run();
}
let member, other, admin, cookie, otherCookie;
beforeAll(async () => { await dbInit.migrate(context()); });
beforeEach(async () => {
  for (const table of ['webhook_delivery', 'webhook_config', 'attachments', 'star', 'email', 'send_request', 'account', 'user', 'object_delete_queue']) await env.db.prepare(`DELETE FROM ${table}`).run();
  await markInstalled(env, ['example.com', 'inactive.test'], []);
  await env.db.prepare("UPDATE managed_domain SET enabled=0 WHERE domain='inactive.test'").run();
  await env.kv.delete(KvConst.SETTING);
  member = await identity('person@example.com'); other = await identity('other@example.com'); admin = await identity('admin@example.com', true);
  cookie = await login(member.email); otherCookie = await login(other.email);
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('mail Trash and independent alias recovery', () => {
  it('lists and reads only owned deleted complete messages, with sanitized HTML and owned attachments', async () => {
    const id = await mail(member); await attachment(member, id);
    await env.db.prepare("UPDATE email SET content='<script>alert(1)</script><p>safe</p><img src=\"https://tracker.invalid/pixel\">' WHERE email_id=?").bind(id).run();
    await mail(member, { deleted: false }); await mail(member, { status: 6 }); await mail(other);
    await env.db.prepare('INSERT INTO email(user_id,account_id,is_del) VALUES (?,?,1)').bind(member.userId, other.accountId).run();
    const result = await request('/mail-recovery/list', { cookie }); expect(result.status).toBe(200);
    const list = (await result.json()).data; expect(list.total).toBe(1); expect(list.list[0]).toMatchObject({ emailId: id, canRestore: true, hasAttachments: 1 });
    expect(list.list[0].deletedAt).toBeTruthy(); expect(list.list[0].expiresAt).toBeTruthy();
    const detail = await service.detail(context(), id, member.userId);
    expect(detail.text).toBe('retained text'); expect(detail.content).toContain('safe'); expect(detail.content).not.toContain('<script'); expect(detail.content).not.toMatch(/\ssrc="https:\/\/tracker\.invalid/);
    expect(detail.attachments).toHaveLength(1);
    await expect(service.detail(context(), id, other.userId)).rejects.toMatchObject({ code: 404 });
  });

  it('restores original mail state and attachment/star ownership and rejects mixed foreign IDs atomically', async () => {
    const id = await mail(member), foreign = await mail(other); await attachment(member, id);
    await env.db.prepare('INSERT INTO star(user_id,email_id) VALUES (?,?)').bind(member.userId, id).run();
    expect((await request('/mail-recovery/restore', { cookie, method: 'POST', body: { emailIds: [id, foreign] } })).status).toBe(409);
    expect((await env.db.prepare('SELECT is_del FROM email WHERE email_id=?').bind(id).first()).is_del).toBe(1);
    const restored = await request('/mail-recovery/restore', { cookie, method: 'POST', body: { emailIds: [id] } });
    expect(restored.status).toBe(200); expect((await restored.json()).data).toMatchObject({ restoredCount: 1, emailIds: [id] });
    expect(await env.db.prepare('SELECT is_del,deleted_at,unread,user_id,account_id FROM email WHERE email_id=?').bind(id).first()).toEqual({ is_del: 0, deleted_at: null, unread: 0, user_id: member.userId, account_id: member.accountId });
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE email_id=?').bind(id).first()).n).toBe(1);
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM star WHERE email_id=?').bind(id).first()).n).toBe(1);
  });

  it('never restores a deleted alias implicitly, but restores the same alias independently', async () => {
    const alias = await env.db.prepare("INSERT INTO account(user_id,email,is_del) VALUES (?,'archived@example.com',1) RETURNING account_id AS id").bind(member.userId).first();
    const owner = { userId: member.userId, accountId: alias.id, email: 'archived@example.com' }; const id = await mail(owner);
    expect((await service.list(context(), {}, member.userId)).list[0].canRestore).toBe(false);
    await expect(service.restore(context(), { emailIds: [id] }, member.userId)).rejects.toMatchObject({ code: 409 });
    await expect(service.restoreAlias(context(), { accountId: alias.id }, other.userId)).rejects.toMatchObject({ code: 404 });
    const restored = await service.restoreAlias(context(member.userId), { accountId: alias.id }, member.userId);
    expect(restored).toMatchObject({ accountId: alias.id, email: 'archived@example.com', accountCount: 2 });
    await service.restore(context(), { emailIds: [id] }, member.userId);
    expect((await env.db.prepare('SELECT is_del FROM email WHERE email_id=?').bind(id).first()).is_del).toBe(0);
  });

  it('enforces alias quotas, inactive domains and active-user boundaries, including a domain race', async () => {
    const alias = await env.db.prepare("INSERT INTO account(user_id,email,is_del) VALUES (?,'quota@example.com',1) RETURNING account_id AS id").bind(member.userId).first();
    await env.db.prepare('UPDATE user SET account_limit=1 WHERE user_id=?').bind(member.userId).run();
    await expect(service.restoreAlias(context(), { accountId: alias.id }, member.userId)).rejects.toMatchObject({ code: 409 });
    await env.db.prepare('UPDATE user SET account_limit=10 WHERE user_id=?').bind(member.userId).run();
    const prepare = env.db.prepare.bind(env.db); let injected = false;
    vi.spyOn(env.db, 'prepare').mockImplementation(sql => {
      if (!injected && sql.startsWith('UPDATE account SET is_del=0')) {
        injected = true;
        const statement = prepare(sql);
        const bind = statement.bind.bind(statement);
        statement.bind = (...bindings) => {
          const bound = bind(...bindings); const first = bound.first.bind(bound);
          bound.first = async (...args) => { await prepare("UPDATE managed_domain SET enabled=0 WHERE domain='example.com'").run(); await prepare('UPDATE installation_state SET revision=revision+1 WHERE id=1').run(); return first(...args); };
          return bound;
        };
        return statement;
      }
      return prepare(sql);
    });
    await expect(service.restoreAlias(context(), { accountId: alias.id }, member.userId)).rejects.toMatchObject({ code: 409 });
    vi.restoreAllMocks();
    await expect(service.restoreAlias(context(), { accountId: alias.id }, member.userId)).rejects.toMatchObject({ code: 403 });
    await env.db.prepare('UPDATE user SET status=1 WHERE user_id=?').bind(member.userId).run();
    await expect(service.aliases(context(), {}, member.userId)).rejects.toMatchObject({ code: 401 });
    await expect(service.restoreAlias(context(), { accountId: alias.id }, member.userId)).rejects.toMatchObject({ code: 401 });
  });

  it('queues permanent attachment cleanup atomically and keeps shared objects referenced by another message', async () => {
    const id = await mail(member), retained = await mail(other, { deleted: false });
    await attachment(member, id, 'shared-fixture-key'); await attachment(other, retained, 'shared-fixture-key');
    await env.db.prepare('INSERT INTO star(user_id,email_id) VALUES (?,?)').bind(member.userId, id).run();
    await expect(service.purge(context(), { emailIds: [id, retained] }, member.userId)).rejects.toMatchObject({ code: 409 });
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM object_delete_queue').first()).n).toBe(0);
    expect(await service.purge(context(), { emailIds: [id] }, member.userId)).toMatchObject({ deletedCount: 1 });
    expect(await env.db.prepare('SELECT email_id FROM email WHERE email_id=?').bind(id).first()).toBeNull();
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM star WHERE email_id=?').bind(id).first()).n).toBe(0);
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE email_id=?').bind(retained).first()).n).toBe(1);
    await env.db.prepare("UPDATE object_delete_queue SET create_time=datetime('now','-8 days')").run();
    const remove = vi.spyOn(r2Service, 'delete').mockResolvedValue();
    await attService.cleanupDeleteQueue(context()); expect(remove).not.toHaveBeenCalled();
    await env.db.prepare('DELETE FROM attachments WHERE email_id=?').bind(retained).run();
    await attService.cleanupDeleteQueue(context()); expect(remove).toHaveBeenCalledWith(expect.anything(), 'shared-fixture-key');
  });

  it('rolls back queued keys and all metadata if the final delete fails', async () => {
    const id = await mail(member); await attachment(member, id);
    await env.db.prepare(`CREATE TRIGGER reject_recovery_delete BEFORE DELETE ON email WHEN OLD.email_id=${id} BEGIN SELECT RAISE(ABORT,'fixture delete failure'); END`).run();
    try {
      await expect(service.purge(context(), { emailIds: [id] }, member.userId)).rejects.toThrow('fixture delete failure');
      expect((await env.db.prepare('SELECT COUNT(*) AS n FROM object_delete_queue').first()).n).toBe(0);
      expect((await env.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE email_id=?').bind(id).first()).n).toBe(1);
      expect((await env.db.prepare('SELECT is_del FROM email WHERE email_id=?').bind(id).first()).is_del).toBe(1);
    } finally { await env.db.prepare('DROP TRIGGER reject_recovery_delete').run(); }
  });

  it('expires after 30 days and cleans at most 90 records per run without touching SAVING or live mail', async () => {
    const recent = await mail(member, { age: '-29 days' }), saving = await mail(member, { status: 6 }), live = await mail(member, { deleted: false });
    const expired = [];
    for (let i = 0; i < 92; i++) expired.push(await mail(member, { age: '-31 days' }));
    expect((await service.list(context(), {}, member.userId)).list.map(row => row.emailId)).toEqual([recent]);
    await expect(service.restore(context(), { emailIds: [expired[0]] }, member.userId)).rejects.toMatchObject({ code: 409 });
    await expect(service.detail(context(), expired[0], member.userId)).rejects.toMatchObject({ code: 404 });
    expect((await service.cleanup(context())).deletedCount).toBe(90);
    expect((await service.cleanup(context())).deletedCount).toBe(2);
    for (const id of [recent, saving, live]) expect(await env.db.prepare('SELECT email_id FROM email WHERE email_id=?').bind(id).first()).not.toBeNull();
  });

  it('empties only a confirmed session-bound snapshot, preserves newly deleted mail and supports safe retries', async () => {
    const first = await mail(member), restored = await mail(member), active = await mail(member, { deleted: false });
    for (let i = 0; i < 39; i++) await mail(member);
    const ownerContext = context(member.userId);
    const plan = await service.previewEmpty(ownerContext, member.userId); expect(plan.count).toBe(41);
    await service.restore(ownerContext, { emailIds: [restored] }, member.userId);
    await env.db.prepare('UPDATE email SET is_del=1 WHERE email_id=?').bind(active).run();
    await expect(service.emptyTrash(context(other.userId), { token: plan.token }, other.userId)).rejects.toMatchObject({ code: 409 });
    await expect(service.emptyTrash(context(member.userId, 'another-session'), { token: plan.token }, member.userId)).rejects.toMatchObject({ code: 409 });
    expect(await service.emptyTrash(ownerContext, { token: plan.token }, member.userId)).toMatchObject({ deletedCount: 39, emailIds: expect.arrayContaining([first]), nextOffset: 40 });
    expect(await service.emptyTrash(ownerContext, { token: plan.token }, member.userId)).toMatchObject({ deletedCount: 0, nextOffset: 40 });
    expect(await service.emptyTrash(ownerContext, { token: plan.token, offset: 40 }, member.userId)).toMatchObject({ deletedCount: 1, nextOffset: null });
    expect((await env.db.prepare('SELECT is_del FROM email WHERE email_id=?').bind(active).first()).is_del).toBe(1);
    expect((await env.db.prepare('SELECT is_del FROM email WHERE email_id=?').bind(restored).first()).is_del).toBe(0);
    await env.kv.delete('trash-empty:' + plan.token);
    await expect(service.emptyTrash(ownerContext, { token: plan.token }, member.userId)).rejects.toMatchObject({ code: 409 });
  });

  it('never deletes a restored and re-deleted generation with a same-second snapshot or its replay', async () => {
    const id = await mail(member), later = await mail(member, { deleted: false });
    const ownerContext = context(member.userId);
    const first = await env.db.prepare('SELECT deleted_at,trash_revision FROM email WHERE email_id=?').bind(id).first();
    const plan = await service.previewEmpty(ownerContext, member.userId);
    await service.restore(ownerContext, { emailIds: [id] }, member.userId);
    await env.db.prepare('UPDATE email SET is_del=1 WHERE email_id=?').bind(id).run();
    // Force the timestamp collision deterministically even if the test straddles
    // a wall-clock second. Only the generation distinguishes these deletions.
    await env.db.prepare('UPDATE email SET deleted_at=? WHERE email_id=?').bind(first.deleted_at, id).run();
    await env.db.prepare('UPDATE email SET is_del=1 WHERE email_id=?').bind(later).run();
    expect(await env.db.prepare('SELECT deleted_at,trash_revision FROM email WHERE email_id=?').bind(id).first()).toEqual({ deleted_at: first.deleted_at, trash_revision: first.trash_revision + 1 });
    for (let attempt = 0; attempt < 2; attempt++) expect(await service.emptyTrash(ownerContext, { token: plan.token }, member.userId)).toMatchObject({ deletedCount: 0, nextOffset: null });
    expect((await service.list(ownerContext, {}, member.userId)).list.map(row => row.emailId).sort()).toEqual([id, later].sort());
    expect((await env.db.prepare('SELECT COUNT(*) AS n FROM object_delete_queue').first()).n).toBe(0);
    const legacyToken = crypto.randomUUID();
    await env.kv.put('trash-empty:' + legacyToken, JSON.stringify({ userId: member.userId, sessionHash: 'fixture-session', items: [{ id, deletedAt: first.deleted_at }] }), { expirationTtl: 300 });
    await expect(service.emptyTrash(ownerContext, { token: legacyToken }, member.userId)).rejects.toMatchObject({ code: 409 });
    const current = await service.previewEmpty(ownerContext, member.userId);
    expect((await service.emptyTrash(ownerContext, { token: current.token }, member.userId)).deletedCount).toBe(2);
  });

  it('redacts historical received Bcc in the Trash API, preserves the owner sent copy and rejects other readers', async () => {
    const incoming = await mail(member), sent = await mail(member);
    const bcc = JSON.stringify([{ address: 'private@hidden.test' }]);
    await env.db.prepare('UPDATE email SET bcc=? WHERE email_id=?').bind(bcc, incoming).run();
    await env.db.prepare('UPDATE email SET type=1,send_email=?,bcc=? WHERE email_id=?').bind(member.email, bcc, sent).run();
    const receivedResponse = await request('/mail-recovery/detail?emailId=' + incoming, { cookie });
    expect(receivedResponse.status).toBe(200); expect((await receivedResponse.json()).data.bcc).toBe('[]');
    const sentResponse = await request('/mail-recovery/detail?emailId=' + sent, { cookie });
    expect(sentResponse.status).toBe(200); expect((await sentResponse.json()).data.bcc).toBe(bcc);
    expect((await request('/mail-recovery/detail?emailId=' + sent, { cookie: otherCookie })).status).toBe(404);
  });

  it('rejects unauthenticated/cross-site/oversized mutations and requires upgrade 329 without disrupting legacy cleanup', async () => {
    const id = await mail(member);
    expect((await request('/mail-recovery/list')).status).toBe(401);
    expect((await request('/mail-recovery/purge', { cookie, method: 'POST', origin: 'https://outside.test', body: { emailIds: [id] } })).status).toBe(403);
    expect((await request('/mail-recovery/restore', { cookie, method: 'POST', body: { emailIds: [id], padding: 'x'.repeat(9000) } })).status).toBe(413);
    await env.db.prepare('DELETE FROM schema_migrations WHERE version=329').run();
    try {
      expect((await request('/mail-recovery/list', { cookie })).status).toBe(503);
      expect(await service.cleanup(context())).toMatchObject({ deletedCount: 0, upgradeRequired: true });
      expect((await service.aliases(context(), {}, member.userId)).total).toBe(0);
    } finally { await env.db.prepare('INSERT INTO schema_migrations(version) VALUES (329)').run(); }
  });

  it('sets only an owned enabled default sender and falls back safely after deleting or disabling it', async () => {
    const alias = await env.db.prepare("INSERT INTO account(user_id,email) VALUES (?,'sender@example.com') RETURNING account_id AS id").bind(member.userId).first();
    await accountService.setDefaultSend(context(), { accountId: alias.id }, member.userId);
    expect((await accountService.getDefaultSendAccount(context(), member.userId)).accountId).toBe(alias.id);
    await expect(accountService.setDefaultSend(context(), { accountId: other.accountId }, member.userId)).rejects.toMatchObject({ code: 404 });
    await env.db.prepare('UPDATE account SET is_del=1 WHERE account_id=?').bind(alias.id).run();
    expect((await accountService.getDefaultSendAccount(context(), member.userId)).accountId).toBe(member.accountId);
    await env.db.prepare("UPDATE managed_domain SET enabled=0 WHERE domain='example.com'").run();
    await expect(accountService.setDefaultSend(context(), { accountId: member.accountId }, member.userId)).rejects.toMatchObject({ code: 403 });
    expect(await accountService.getDefaultSendAccount(context(), member.userId)).toBeNull();
  });

  it('keeps the old default when a domain is disabled immediately before the atomic default update', async () => {
    const alias = await env.db.prepare("INSERT INTO account(user_id,email) VALUES (?,'new-sender@example.com') RETURNING account_id AS id").bind(member.userId).first();
    await env.db.prepare('UPDATE account SET is_default_send=1 WHERE account_id=?').bind(member.accountId).run();
    const get = managedDomainService.get.bind(managedDomainService);
    vi.spyOn(managedDomainService, 'get').mockImplementationOnce(async (...args) => {
      const snapshot = await get(...args);
      await env.db.prepare("UPDATE managed_domain SET enabled=0 WHERE domain='example.com'").run();
      await env.db.prepare('UPDATE installation_state SET revision=revision+1 WHERE id=1').run();
      return snapshot;
    });
    await expect(accountService.setDefaultSend(context(), { accountId: alias.id }, member.userId)).rejects.toMatchObject({ code: 409 });
    expect(await env.db.prepare('SELECT is_default_send FROM account WHERE account_id=?').bind(member.accountId).first()).toEqual({ is_default_send: 1 });
    expect(await env.db.prepare('SELECT is_default_send FROM account WHERE account_id=?').bind(alias.id).first()).toEqual({ is_default_send: 0 });
  });
});
