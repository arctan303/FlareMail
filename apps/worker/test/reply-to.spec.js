import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import emailService from '../src/service/email-service';
import cryptoUtils from '../src/utils/crypto-utils';
import userService from '../src/service/user-service';
import { markInstalled } from './installed-instance';

const runtime = {
	...env,
	SETUP_SECRET: undefined,
	LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	SEND_RATE_LIMITER: { limit: async () => ({ success: true }) },
	EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const context = () => { const values = new Map(); return { env, get: key => values.get(key), set: (key, value) => values.set(key, value) }; };

async function createMailbox(address, admin = 0) {
	const password = await cryptoUtils.hashPassword(`reply-to-${address}`);
	const user = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,?) RETURNING user_id AS id')
		.bind(address, password.hash, password.salt, admin).first();
	const account = await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id')
		.bind(address, user.id).first();
	return { userId: user.id, accountId: account.id };
}

async function api(path, token, options = {}) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`http://localhost/api${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			Origin: 'http://localhost',
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
	}), runtime, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe.sequential('Reply-To compatibility and reply recipients', () => {
	let owner;
	let token;
	let foreignToken;
	const ownerAddress = 'reply-owner@example.com';
	const firstReply = 'reply-team-a@example.com';
	const secondReply = 'reply-team-b@example.com';

	beforeAll(async () => {
		await dbInit.migrate(context());
		await markInstalled(env, ['example.com'], []);
		expect(await emailService.hasReplyToColumn(context())).toBe(true);
		owner = await createMailbox(ownerAddress, 1);
		const foreign = await createMailbox(firstReply);
		await createMailbox(secondReply);
		token = await userService.genCliToken({ env }, owner.userId);
		foreignToken = await userService.genCliToken({ env }, foreign.userId);
	});

	it('persists all valid inbound Reply-To addresses and exposes them through normal and CLI reads', async () => {
		const raw = [
			'From: Original Sender <sender@outside.test>',
			`To: ${ownerAddress}`,
			`Reply-To: Team A <${firstReply}>, Team B <${secondReply}>`,
			'Message-ID: <reply-to-source@outside.test>',
			'Subject: Reply-To fixture',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'hello',
		].join('\r\n');
		const bytes = new TextEncoder().encode(raw);
		const message = {
			from: 'sender@outside.test',
			to: ownerAddress,
			rawSize: bytes.byteLength,
			raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
			setReject: vi.fn(),
			forward: vi.fn(),
		};
		await worker.email(message, runtime, createExecutionContext());
		expect(message.setReject).not.toHaveBeenCalled();

		const stored = await env.db.prepare("SELECT email_id AS emailId, reply_to AS replyTo FROM email WHERE user_id = ? AND subject = 'Reply-To fixture'")
			.bind(owner.userId).first();
		expect(JSON.parse(stored.replyTo)).toEqual([
			{ name: 'Team A', address: firstReply },
			{ name: 'Team B', address: secondReply },
		]);
		const listed = await emailService.list(context(), { accountId: owner.accountId, type: 0, size: 20 }, owner.userId);
		expect(listed.list.find(row => row.emailId === stored.emailId).replyTo).toEqual(JSON.parse(stored.replyTo));

		const detailResponse = await api(`/cli/emails/${stored.emailId}`, token);
		expect(detailResponse.status).toBe(200);
		expect((await detailResponse.json()).data.replyTo).toEqual(JSON.parse(stored.replyTo));
		expect((await api(`/cli/emails/${stored.emailId}`, foreignToken)).status).toBe(404);
		expect((await api(`/cli/emails/${stored.emailId}/reply`, foreignToken, {
			method: 'POST', body: JSON.stringify({ body: 'forbidden', requestId: 'reply_to_foreign_0001' }),
		})).status).toBe(404);
		const foreignList = await api('/cli/emails?type=0', foreignToken);
		expect((await foreignList.json()).data.list.some(row => row.id === stored.emailId)).toBe(false);
	});

	it('replies to every Reply-To address, replays idempotently, and falls back to From for legacy rows', async () => {
		const original = await env.db.prepare("SELECT email_id AS emailId FROM email WHERE user_id = ? AND subject = 'Reply-To fixture'")
			.bind(owner.userId).first();
		const payload = { body: 'reply body', requestId: 'reply_to_cli_fixture_01' };
		const response = await api(`/cli/emails/${original.emailId}/reply`, token, { method: 'POST', body: JSON.stringify(payload) });
		expect(response.status).toBe(200);
		const responseBody = await response.json();
		const sent = await env.db.prepare('SELECT recipient FROM email WHERE email_id = ?').bind(responseBody.data.id).first();
		expect(JSON.parse(sent.recipient).map(item => item.address)).toEqual([firstReply, secondReply]);
		const replay = await api(`/cli/emails/${original.emailId}/reply`, token, { method: 'POST', body: JSON.stringify(payload) });
		expect(replay.status).toBe(200);
		expect((await replay.json()).data.id).toBe(responseBody.data.id);

		const legacy = await env.db.prepare(`
			INSERT INTO email(user_id,account_id,type,status,send_email,subject,reply_to)
			VALUES (?,?,0,0,'legacy-sender@example.com','legacy reply','[]') RETURNING email_id AS emailId
		`).bind(owner.userId, owner.accountId).first();
		const fallback = await api(`/cli/emails/${legacy.emailId}/reply`, token, { method: 'POST', body: JSON.stringify({ body: 'fallback', requestId: 'reply_to_cli_fixture_02' }) });
		expect(fallback.status).toBe(200);
		const fallbackSent = await env.db.prepare('SELECT recipient FROM email WHERE email_id = ?').bind((await fallback.json()).data.id).first();
		expect(JSON.parse(fallbackSent.recipient).map(item => item.address)).toEqual(['legacy-sender@example.com']);
	});

	it('rolls back the saving row when Reply-To persistence fails', async () => {
		const subject = 'reply-to atomic failure';
		const failingDb = new Proxy(env.db, {
			get(target, property) {
				if (property === 'prepare') {
					return sql => /^UPDATE email SET reply_to/i.test(sql)
						? target.prepare('UPDATE email SET missing_reply_to_column = ? WHERE email_id = last_insert_rowid()')
						: target.prepare(sql);
				}
				const value = target[property];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		await expect(emailService.receive({ env: { ...env, db: failingDb } }, {
			toEmail: ownerAddress,
			sendEmail: 'sender@outside.test',
			subject,
			content: '<p>body</p>',
			text: 'body',
			replyTo: [{ name: 'Team', address: firstReply }],
			userId: owner.userId,
			accountId: owner.accountId,
			isDel: 1,
			status: 6,
		}, [], '')).rejects.toThrow();
		const count = await env.db.prepare('SELECT COUNT(*) AS total FROM email WHERE subject = ?').bind(subject).first();
		expect(count.total).toBe(0);
	});

	it('keeps real schema 324 inbound and reads compatible while projecting an empty Reply-To', async () => {
		await env.db.batch([
			env.db.prepare('DELETE FROM schema_migrations WHERE version = 325'),
			env.db.prepare('ALTER TABLE email DROP COLUMN reply_to'),
		]);
		try {
			const raw = [
				'From: Legacy Sender <legacy-inbound@outside.test>',
				`To: ${ownerAddress}`,
				`Reply-To: Team A <${firstReply}>`,
				'Message-ID: <reply-to-324@outside.test>',
				'Subject: Reply-To schema 324 fixture',
				'Content-Type: text/plain; charset=utf-8',
				'',
				'legacy body remains readable',
			].join('\r\n');
			const bytes = new TextEncoder().encode(raw);
			const message = {
				from: 'legacy-inbound@outside.test',
				to: ownerAddress,
				rawSize: bytes.byteLength,
				raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
				setReject: vi.fn(),
				forward: vi.fn(),
			};
			await worker.email(message, runtime, createExecutionContext());
			expect(message.setReject).not.toHaveBeenCalled();
			const list = await emailService.list(context(), { accountId: owner.accountId, type: 0, size: 20 }, owner.userId);
			const row = list.list.find(item => item.subject === 'Reply-To schema 324 fixture');
			expect(row.replyTo).toEqual([]);
			expect(row.text).toContain('legacy body remains readable');
			const detail = await api(`/cli/emails/${row.emailId}`, token);
			expect(detail.status).toBe(200);
			const detailBody = (await detail.json()).data;
			expect(detailBody.replyTo).toEqual([]);
			expect(detailBody.body).toContain('legacy body remains readable');
		} finally {
			await dbInit.migrate(context());
		}
		expect(await emailService.hasReplyToColumn(context())).toBe(true);
	});
});
