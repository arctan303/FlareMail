import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import { DOMAIN_TRIGGERS } from '../src/init/domain-schema';
import accountService from '../src/service/account-service';
import userService from '../src/service/user-service';
import emailService from '../src/service/email-service';
import emailSendService from '../src/service/email-send-service';
import managedDomainService from '../src/service/managed-domain-service';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const PASSWORD = 'domain-runtime-fixture-password';
const ADMIN = 'runtime-admin@example.com';
const MEMBER = 'runtime-member@retire.test';
const CLI_TOKEN = 'domain-runtime-cli-token';
const runtime = {
	...env,
	LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	SEND_RATE_LIMITER: { limit: async () => ({ success: true }) },
	EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
function context() {
	const values = new Map();
	return { env: runtime, req: { header: () => '' }, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}
async function api(path, { method = 'GET', cookie, body, token } = {}) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request('http://localhost/api' + path, {
		method,
		headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'Accept-Language': 'en',
			...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	}), runtime, execution);
	await waitOnExecutionContext(execution);
	return response;
}
async function login(address) {
	const response = await api('/login', { method: 'POST', body: { email: address, password: PASSWORD } });
	expect(response.status).toBe(200);
	return response.headers.get('set-cookie').split(';')[0];
}
async function createIdentity(address, admin = false) {
	const material = await cryptoUtils.hashPassword(PASSWORD);
	const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS id')
		.bind(address, material.hash, material.salt, admin ? 1 : 0).first();
	const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id')
		.bind(address, user.id).first();
	return { userId: user.id, accountId: account.id };
}
async function setEnabled(enabled) {
	await env.db.prepare('UPDATE managed_domain SET enabled=? WHERE domain=?').bind(enabled ? 1 : 0, 'retire.test').run();
}
async function counts() {
	const tables = ['user', 'account', 'email', 'send_request'];
	return Promise.all(tables.map(async table => (await env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n));
}
async function incoming(address, subject) {
	const raw = new TextEncoder().encode([
		'From: Outside <outside@outside.test>', `To: ${address}`, `Subject: ${subject}`,
		'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'fixture message', '',
	].join('\r\n'));
	const message = { from: 'outside@outside.test', to: address, rawSize: raw.byteLength,
		raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }),
		setReject: vi.fn(), forward: vi.fn() };
	const execution = createExecutionContext();
	await worker.email(message, runtime, execution);
	await waitOnExecutionContext(execution);
	return message;
}
let admin, member, adminCookie, memberCookie, historyId;
beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env, ['example.com', 'retire.test'], []);
	admin = await createIdentity(ADMIN, true);
	member = await createIdentity(MEMBER);
	await env.db.prepare('UPDATE user SET cli_token=? WHERE user_id=?')
		.bind('sha256$' + await cryptoUtils.hashSecret(CLI_TOKEN), member.userId).run();
	historyId = (await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,send_email,to_email,subject,text)
		VALUES (?,?,0,0,'outside@outside.test',?,'history survives domain suspension','saved history') RETURNING email_id AS id`)
		.bind(member.userId, member.accountId, MEMBER).first()).id;
	adminCookie = await login(ADMIN);
	memberCookie = await login(MEMBER);
});
beforeEach(async () => {
	await setEnabled(true);
	await env.db.prepare(`UPDATE setting SET receive=0,send=0,no_recipient=0,resend_tokens=?`)
		.bind(JSON.stringify({ 'example.com': 'fixture-token', 'retire.test': 'fixture-token' })).run();
	await env.db.prepare("UPDATE mail_provider_config SET provider='resend'").run();
	await env.db.prepare('UPDATE admin_confirmation SET enabled=0').run();
	await env.kv.delete(KvConst.SETTING);
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('suspended domain runtime admission', () => {
	it('keeps login, mailbox access and historic mail readable while the domain is disabled', async () => {
		await setEnabled(false);
		const cookie = await login(MEMBER);
		const list = await api(`/email/list?accountId=${member.accountId}&allReceive=0&type=0&size=20`, { cookie });
		expect(list.status).toBe(200);
		expect((await list.json()).data.list).toEqual(expect.arrayContaining([expect.objectContaining({ emailId: historyId })]));
		const cli = await api(`/cli/emails/${historyId}`, { token: CLI_TOKEN });
		expect(cli.status).toBe(200);
		expect((await cli.json()).data.subject).toBe('history survives domain suspension');
		const accounts = await accountService.list(context(), { accountId: 0, size: 30 }, member.userId);
		expect(accounts.some(row => row.accountId === member.accountId)).toBe(true);
	});

	it.each(['web', 'cli'])('blocks %s sending from a disabled domain before provider, quota or persistence', async mode => {
		await setEnabled(false);
		const provider = vi.spyOn(emailSendService, 'sendByResend');
		const before = await counts();
		const quota = (await userService.selectById(context(), member.userId)).sendCount;
		const response = mode === 'web'
			? await api('/email/send', { method: 'POST', cookie: memberCookie, body: { accountId: member.accountId,
				receiveEmail: ['outside@outside.test'], subject: 'disabled sender', text: 'body', requestId: 'disabled_sender_web_01' } })
			: await api('/cli/emails/send', { method: 'POST', token: CLI_TOKEN, body: { accountId: member.accountId,
				to: 'outside@outside.test', subject: 'disabled sender', body: 'body', requestId: 'disabled_sender_cli_01' } });
		expect(response.status).toBe(403);
		expect(await response.text()).toMatch(/domain.*disabled/i);
		expect(provider).not.toHaveBeenCalled();
		expect(await counts()).toEqual(before);
		expect((await userService.selectById(context(), member.userId)).sendCount).toBe(quota);
	});

	it('rejects mixed recipients on a disabled managed domain without routing them externally or trusting cached settings', async () => {
		const c = context();
		c.set('setting', { send: 0, r2Domain: '', domainList: ['@example.com'], resendTokens: { 'example.com': 'fixture-token' } });
		await setEnabled(false);
		const provider = vi.spyOn(emailSendService, 'sendByResend');
		const before = await counts();
		await expect(emailService.send(c, { accountId: admin.accountId, receiveEmail: [MEMBER, 'outside@outside.test'],
			subject: 'disabled recipient', text: 'body', requestId: 'disabled_recipient_01' }, admin.userId)).rejects.toMatchObject({ code: 403 });
		expect(provider).not.toHaveBeenCalled();
		expect(await counts()).toEqual(before);
	});

	it('bounces direct internal delivery on a disabled domain even when unknown recipients may be stored', async () => {
		await setEnabled(false);
		const before = await counts();
		const result = await emailSendService.HandleOnSiteEmail(context(), [MEMBER, 'unknown@retire.test'], {
			sendEmail: ADMIN, subject: 'must not enter suspended domain', text: 'body', userId: admin.userId, accountId: admin.accountId,
		}, []);
		expect(result).toMatchObject({ status: 3, handledCount: 2, deliveredCount: 0, bouncedCount: 2, failedCount: 0 });
		expect(await counts()).toEqual(before);
	});

	it('rejects external mail to existing and unknown disabled addresses and receives again after re-enabling', async () => {
		await env.db.prepare("UPDATE user SET unmatched_policy='quarantine' WHERE user_id=?").bind(admin.userId).run();
		await setEnabled(false);
		const before = await counts();
		for (const recipient of [MEMBER, 'unknown@retire.test']) {
			const message = await incoming(recipient, 'suspended incoming');
			expect(message.setReject).toHaveBeenCalledWith(expect.stringMatching(/domain.*disabled/i));
			expect(message.forward).not.toHaveBeenCalled();
		}
		expect(await counts()).toEqual(before);
		await setEnabled(true);
		const resumed = await incoming(MEMBER, 'resumed incoming');
		expect(resumed.setReject).not.toHaveBeenCalled();
		expect(await env.db.prepare("SELECT subject FROM email WHERE to_email=? AND subject='resumed incoming' AND status=0 AND is_del=0")
			.bind(MEMBER).first()).toEqual({ subject: 'resumed incoming' });
	});

	it('rechecks inbound admission after MIME and recipient processing before starting persistence', async () => {
		const lookup = accountService.selectByEmail;
		vi.spyOn(accountService, 'selectByEmail').mockImplementation(async (c, address) => {
			const result = await lookup.call(accountService, c, address);
			await setEnabled(false);
			return result;
		});
		const before = await counts();
		const message = await incoming(MEMBER, 'domain disabled during MIME processing');
		expect(message.setReject).toHaveBeenCalledWith(expect.stringMatching(/domain.*disabled/i));
		expect(await counts()).toEqual(before);
	});

	it('rejects new users and aliases on a disabled domain and permits them after re-enabling', async () => {
		await setEnabled(false);
		const before = await counts();
		await expect(accountService.add(context(), { email: 'new-alias@retire.test' }, member.userId)).rejects.toThrow();
		await expect(userService.add(context(), { email: 'new-user@retire.test', password: PASSWORD })).rejects.toThrow();
		expect(await counts()).toEqual(before);
		await setEnabled(true);
		await expect(accountService.add(context(), { email: 'new-alias@retire.test' }, member.userId)).resolves.toMatchObject({ email: 'new-alias@retire.test' });
		await userService.add(context(), { email: 'new-user@retire.test', password: PASSWORD });
		const created = await userService.selectByEmailIncludeDel(context(), 'new-user@retire.test');
		expect(await accountService.selectByEmail(context(), created.email)).toMatchObject({ userId: created.userId });
	});

	it('turns a stale alias preflight rejected by the database into a controlled error', async () => {
		await setEnabled(false);
		vi.spyOn(managedDomainService, 'containsEmail').mockResolvedValue(true);
		const before = await counts();
		await expect(accountService.add(context(), { email: 'racing-alias@retire.test' }, member.userId))
			.rejects.toMatchObject({ name: 'BizError', code: 403 });
		expect(await counts()).toEqual(before);
	});

	it('releases the send request and quota when the sender domain is disabled immediately before persistence', async () => {
		const claim = emailSendService.claimSendRequest;
		vi.spyOn(emailSendService, 'claimSendRequest').mockImplementationOnce(async (...args) => {
			const result = await claim.apply(emailSendService, args);
			await setEnabled(false);
			return result;
		});
		const provider = vi.spyOn(emailSendService, 'sendByResend');
		const before = await counts();
		const quota = (await userService.selectById(context(), member.userId)).sendCount;
		const response = await api('/email/send', { method: 'POST', cookie: memberCookie, body: { accountId: member.accountId,
			receiveEmail: ['outside@outside.test'], subject: 'sender persistence race', text: 'body', requestId: 'sender_persistence_race_01' } });
		expect(response.status).toBe(403);
		expect(provider).not.toHaveBeenCalled();
		expect(await counts()).toEqual(before);
		expect((await userService.selectById(context(), member.userId)).sendCount).toBe(quota);
	});

	it('bounces an internal copy if suspension races its final domain check and database insert', async () => {
		vi.spyOn(managedDomainService, 'containsEmail').mockImplementationOnce(async () => {
			await setEnabled(false);
			return true;
		});
		const before = await counts();
		const result = await emailSendService.HandleOnSiteEmail(context(), [MEMBER], {
			sendEmail: ADMIN, subject: 'recipient persistence race', text: 'body', userId: admin.userId, accountId: admin.accountId,
		}, []);
		expect(result).toMatchObject({ status: 3, handledCount: 1, deliveredCount: 0, bouncedCount: 1, failedCount: 0 });
		expect(await counts()).toEqual(before);
	});

	it('rolls back a new user when its primary account insert fails the domain guard', async () => {
		const target = 'atomic-member@retire.test';
		await env.db.prepare(`CREATE TRIGGER runtime_test_account_rejection BEFORE INSERT ON account
			WHEN NEW.email='atomic-member@retire.test' BEGIN SELECT RAISE(ABORT,'Managed domain is inactive.'); END`).run();
		try {
			const before = await counts();
			await expect(userService.add(context(), { email: target, password: PASSWORD })).rejects.toMatchObject({ name: 'BizError', code: 403 });
			expect(await counts()).toEqual(before);
			expect(await userService.selectByEmailIncludeDel(context(), target)).toBeNull();
		} finally {
			await env.db.prepare('DROP TRIGGER runtime_test_account_rejection').run();
		}
	});

	it('resumes both external and internal sending after re-enabling', async () => {
		await setEnabled(false);
		await setEnabled(true);
		const provider = vi.spyOn(emailSendService, 'sendByResend').mockResolvedValue({ data: { id: 'domain-runtime-resumed', messageId: '<resumed@outside.test>' } });
		const response = await api('/email/send', { method: 'POST', cookie: memberCookie, body: { accountId: member.accountId,
			receiveEmail: [ADMIN, 'outside@outside.test'], subject: 'resumed sending', text: 'body', requestId: 'resumed_domain_send_01' } });
		expect(response.status).toBe(200);
		expect(provider).toHaveBeenCalledOnce();
		expect(provider.mock.calls[0][1].receiveEmail).toEqual([ADMIN, 'outside@outside.test']);
		expect(await env.db.prepare("SELECT COUNT(*) AS n FROM email WHERE type=0 AND to_email=? AND subject='resumed sending'").bind(ADMIN).first()).toEqual({ n: 0 });
	});

	it('keeps an unupgraded domain table enabled for legacy login, receive, send and alias creation', async () => {
		await env.db.batch([
			...Object.keys(DOMAIN_TRIGGERS).map(name => env.db.prepare(`DROP TRIGGER IF EXISTS ${name}`)),
			env.db.prepare('ALTER TABLE managed_domain DROP COLUMN enabled'),
			env.db.prepare('DELETE FROM schema_migrations WHERE version=328'),
		]);
		try {
			const cookie = await login(MEMBER);
			await expect(accountService.add(context(), { email: 'legacy-domain@retire.test' }, member.userId)).resolves.toMatchObject({ email: 'legacy-domain@retire.test' });
			expect((await incoming(MEMBER, 'legacy domain receive')).setReject).not.toHaveBeenCalled();
			const provider = vi.spyOn(emailSendService, 'sendByResend').mockResolvedValue({ data: { id: 'legacy-domain-send', messageId: '<legacy@outside.test>' } });
			const response = await api('/email/send', { method: 'POST', cookie, body: { accountId: member.accountId,
				receiveEmail: ['outside@outside.test'], subject: 'legacy domain send', text: 'body', requestId: 'legacy_domain_send_01' } });
			expect(response.status).toBe(200);
			expect(provider).toHaveBeenCalledOnce();
		} finally {
			await dbInit.migrate(context());
		}
	});
});
