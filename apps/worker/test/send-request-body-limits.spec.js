import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import app from '../src/hono/webs';
import { dbInit } from '../src/init/init';
import emailService from '../src/service/email-service';
import emailSendService from '../src/service/email-send-service';
import userService from '../src/service/user-service';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { MAX_SEND_BODY_BYTES } from '../src/api/send-body';
import { normalizeSendParams } from '../src/utils/send-validator';
import en from '../src/i18n/en';
import zh from '../src/i18n/zh';
import { markInstalled } from './installed-instance';

const MiB = 1024 * 1024;
const ADDRESS = 'send-body-owner@example.com';
const PASSWORD = 'send-body-fixture-password';
const runtime = {
	...env,
	SETUP_SECRET: undefined,
	LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	SEND_RATE_LIMITER: { limit: async () => ({ success: true }) },
	EMAIL_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const context = () => {
	const values = new Map();
	return { env, get: key => values.get(key), set: (key, value) => values.set(key, value) };
};
let userId, accountId, originalId, cookie, token;
const routes = [
	{ label: 'Web send', path: () => '/email/send', cli: false },
	{ label: 'CLI send', path: () => '/cli/emails/send', cli: true },
	{ label: 'CLI reply', path: () => `/cli/emails/${originalId}/reply`, cli: true },
];

function payloadFor(route, extra = {}) {
	if (!route.cli) return {
		accountId, receiveEmail: ['friend@outside.test'], subject: 'send body fixture',
		text: 'plain body 文 😀', content: '<p>HTML body 文 😀</p>', requestId: 'send_body_fixture_web_01', ...extra,
	};
	return {
		accountId, to: 'friend@outside.test', subject: 'send body fixture',
		body: 'CLI <literal> body 文 😀', requestId: 'send_body_fixture_cli_01', ...extra,
	};
}

function requestFor(route, body, { headers = {}, authorized = true, prefix = '' } = {}) {
	return new Request(`http://localhost${prefix}${route.path()}`, {
		method: 'POST', body,
		headers: {
			Origin: 'http://localhost', 'Content-Type': 'application/json', 'Accept-Language': 'en',
			...(authorized ? (route.cli ? { Authorization: `Bearer ${token}` } : { Cookie: cookie }) : {}),
			...headers,
		},
	});
}

async function dispatch(request, target = runtime, throughWorker = false) {
	const ctx = createExecutionContext();
	const response = await (throughWorker ? worker.fetch(request, target, ctx) : app.fetch(request, target, ctx));
	await waitOnExecutionContext(ctx);
	return response;
}

// The route consumes a real stream; highWaterMark 0 keeps producer prefetch from
// obscuring whether the reader itself advances past the first excess byte.
function streamedRequest(route, chunks, options) {
	let pulls = 0;
	let eof = 0;
	const cancel = vi.fn();
	const stream = new ReadableStream({
		pull(controller) {
			pulls += 1;
			if (chunks.length) controller.enqueue(chunks.shift());
			else { eof += 1; controller.close(); }
		},
		cancel,
	}, { highWaterMark: 0 });
	const request = requestFor(route, stream, options);
	const rawReader = request.body.getReader.bind(request.body);
	let reader;
	const getReader = vi.spyOn(request.body, 'getReader').mockImplementation(() => {
		const raw = rawReader();
		reader = {
			read: vi.fn(() => raw.read()),
			cancel: vi.fn(() => raw.cancel()),
			releaseLock: vi.fn(() => raw.releaseLock()),
		};
		return reader;
	});
	return { request, getReader, cancel, reader: () => reader, pulls: () => pulls, eof: () => eof };
}

function paddedJsonChunks(value, maxBytes = MAX_SEND_BODY_BYTES) {
	const first = new TextEncoder().encode(JSON.stringify(value));
	const pad = new Uint8Array(MiB).fill(32);
	const chunks = [first];
	let remaining = maxBytes - first.byteLength;
	while (remaining > 0) {
		const length = Math.min(remaining, pad.byteLength);
		chunks.push(pad.subarray(0, length));
		remaining -= length;
	}
	return chunks;
}

async function sendState() {
	return [
		(await env.db.prepare('SELECT COUNT(*) AS n FROM email').first()).n,
		(await env.db.prepare('SELECT COUNT(*) AS n FROM send_request').first()).n,
		(await env.db.prepare('SELECT send_count AS n FROM user WHERE user_id = ?').bind(userId).first()).n,
	];
}

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env, ['example.com'], []);
	const password = await cryptoUtils.hashPassword(PASSWORD);
	const owner = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin,send_count) VALUES (?,?,?,1,0) RETURNING user_id AS id')
		.bind(ADDRESS, password.hash, password.salt).first();
	userId = owner.id;
	accountId = (await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?) RETURNING account_id AS id').bind(ADDRESS, userId).first()).id;
	originalId = (await env.db.prepare(`INSERT INTO email(user_id,account_id,type,status,send_email,subject,text,message_id,reply_to)
		VALUES (?,?,0,0,'friend@outside.test','Original fixture','Original body','<send-body-original@outside.test>','[]') RETURNING email_id AS id`)
		.bind(userId, accountId).first()).id;
	const login = await dispatch(new Request('http://localhost/login', {
		method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: ADDRESS, password: PASSWORD }),
	}));
	expect(login.status).toBe(200);
	cookie = login.headers.get('set-cookie').split(';')[0];
	token = await userService.genCliToken({ env }, userId);
	await env.db.prepare('UPDATE setting SET resend_tokens = ?').bind(JSON.stringify({ 'example.com': 'fixture-token' })).run();
	await env.kv.delete(KvConst.SETTING);
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('32 MiB whole send request boundary', () => {
	it('uses the approved byte ceiling', () => {
		expect(MAX_SEND_BODY_BYTES).toBe(33554432);
	});

	for (const route of routes) {
		describe(route.label, () => {
			it.each(['en', 'zh'])('rejects declared oversize before obtaining a reader or sending (%s)', async locale => {
				const probe = streamedRequest(route, [new Uint8Array(1)], {
					headers: { 'Content-Length': String(MAX_SEND_BODY_BYTES + 1), 'Accept-Language': locale },
				});
				const send = vi.spyOn(emailService, 'send');
				const select = vi.spyOn(emailService, 'selectById');
				const before = await sendState();
				const response = await dispatch(probe.request);
				expect(response.status).toBe(413);
				expect(await response.json()).toMatchObject({ code: 413, message: (locale === 'en' ? en : zh).sendRequestTooLarge });
				expect(probe.getReader).not.toHaveBeenCalled();
				expect(probe.pulls()).toBe(0);
				expect(send).not.toHaveBeenCalled();
				expect(select).not.toHaveBeenCalled();
				expect(await sendState()).toEqual(before);
			});

			it.each([undefined, '1', String(MAX_SEND_BODY_BYTES)])('counts streamed bytes despite declared length %s, cancels at the first excess byte without EOF or JSON decoding', async declared => {
				const chunk = new Uint8Array(MiB);
				const chunks = [...Array(32).fill(chunk), new Uint8Array(1), new Uint8Array(1)];
				const probe = streamedRequest(route, chunks, { headers: declared === undefined ? {} : { 'Content-Length': declared } });
				const send = vi.spyOn(emailService, 'send');
				const decode = vi.spyOn(TextDecoder.prototype, 'decode');
				const before = await sendState();
				const response = await dispatch(probe.request);
				expect(response.status).toBe(413);
				expect(probe.reader().read).toHaveBeenCalledTimes(33);
				expect(probe.pulls()).toBe(33);
				expect(probe.eof()).toBe(0);
				expect(probe.reader().cancel).toHaveBeenCalledOnce();
				expect(probe.cancel).toHaveBeenCalledOnce();
				expect(probe.reader().releaseLock).toHaveBeenCalledOnce();
				expect(decode).not.toHaveBeenCalled();
				expect(send).not.toHaveBeenCalled();
				expect(await sendState()).toEqual(before);
			});

			it('accepts a valid JSON object at exactly 33554432 streamed bytes', async () => {
				const params = payloadFor(route);
				const probe = streamedRequest(route, paddedJsonChunks(params));
				const send = vi.spyOn(emailService, 'send').mockResolvedValue([{ emailId: 99, status: 1, requestId: params.requestId }]);
				const response = await dispatch(probe.request);
				expect(response.status).toBe(200);
				expect(send).toHaveBeenCalledOnce();
				expect(send.mock.calls[0][1]).toMatchObject(route.cli ? { requestId: params.requestId, accountId, text: expect.stringContaining(params.body) } : params);
				expect(send.mock.calls[0][2]).toBe(userId);
				expect(probe.eof()).toBe(1);
				expect(probe.reader().cancel).not.toHaveBeenCalled();
				expect(probe.reader().releaseLock).toHaveBeenCalledOnce();
			});

			it('limits UTF-8 bytes even when the JSON character count is below the ceiling', async () => {
				const json = JSON.stringify(payloadFor(route, { ignored: '文'.repeat(Math.floor(MAX_SEND_BODY_BYTES / 3)) }));
				expect(json.length).toBeLessThan(MAX_SEND_BODY_BYTES);
				const bytes = new TextEncoder().encode(json);
				expect(bytes.byteLength).toBeGreaterThan(MAX_SEND_BODY_BYTES);
				const probe = streamedRequest(route, [bytes.subarray(0, MAX_SEND_BODY_BYTES), bytes.subarray(MAX_SEND_BODY_BYTES), new Uint8Array(1)]);
				const send = vi.spyOn(emailService, 'send');
				const response = await dispatch(probe.request);
				expect(response.status).toBe(413);
				expect(probe.reader().read).toHaveBeenCalledTimes(2);
				expect(probe.eof()).toBe(0);
				expect(probe.cancel).toHaveBeenCalledOnce();
				expect(send).not.toHaveBeenCalled();
			});

			it.each(['{broken', 'null', '[]', 'true', '"text"'])('returns a controlled 400 for malformed/non-object JSON %s', async body => {
				const send = vi.spyOn(emailService, 'send');
				const response = await dispatch(requestFor(route, body));
				expect(response.status).toBe(400);
				expect(await response.json()).toMatchObject({ code: 400, message: en.invalidSendRequest });
				expect(send).not.toHaveBeenCalled();
			});

			it('runs authentication and rate checks before the body reader', async () => {
				const unauthenticated = streamedRequest(route, [new Uint8Array(1)], {
					authorized: false, headers: { 'Content-Length': String(MAX_SEND_BODY_BYTES + 1) },
				});
				const limit = vi.fn(async () => ({ success: false }));
				const target = { ...runtime, SEND_RATE_LIMITER: { limit } };
				expect((await dispatch(unauthenticated.request, target)).status).toBe(401);
				expect(limit).not.toHaveBeenCalled();
				expect(unauthenticated.getReader).not.toHaveBeenCalled();
				const rateLimited = streamedRequest(route, [new Uint8Array(1)], { headers: { 'Content-Length': String(MAX_SEND_BODY_BYTES + 1) } });
				expect((await dispatch(rateLimited.request, target)).status).toBe(429);
				expect(limit).toHaveBeenCalledOnce();
				expect(rateLimited.getReader).not.toHaveBeenCalled();
			});

			it('keeps ordinary /api sending, response fields and idempotency', async () => {
				const provider = vi.spyOn(emailSendService, 'sendByResend').mockResolvedValue({ data: { id: 'send-body-provider-id', messageId: '<send-body-provider@outside.test>' } });
				const params = payloadFor(route, { requestId: `send_body_control_${route.label.replace(/ /g, '_')}_01` });
				const first = await dispatch(requestFor(route, JSON.stringify(params), { prefix: '/api' }), runtime, true);
				expect(first.status).toBe(200);
				const data = (await first.json()).data;
				const sentId = route.cli ? data.id : data[0].emailId;
				expect(route.cli ? data : data[0]).toMatchObject({ status: 1, requestId: params.requestId });
				const stored = await env.db.prepare('SELECT text,content,in_reply_to AS inReplyTo FROM email WHERE email_id = ?').bind(sentId).first();
				expect(stored.text).toContain(route.cli ? params.body : params.text);
				expect(stored.content).toContain(route.cli ? '&lt;literal&gt;' : params.content);
				if (route.label === 'CLI reply') expect(stored.inReplyTo).toBe('<send-body-original@outside.test>');
				const replay = await dispatch(requestFor(route, JSON.stringify(params), { prefix: '/api' }), runtime, true);
				expect(replay.status).toBe(200);
				const replayData = (await replay.json()).data;
				expect(route.cli ? replayData.id : replayData[0].emailId).toBe(sentId);
				expect(provider).toHaveBeenCalledOnce();
			});
		});
	}

	it.each(['new', 'reply', 'forward'])('uses the same Web byte boundary for sendType %s', async sendType => {
		const probe = streamedRequest(routes[0], [new TextEncoder().encode(JSON.stringify(payloadFor(routes[0], { sendType, emailId: originalId })))], {
			headers: { 'Content-Length': String(MAX_SEND_BODY_BYTES + 1) },
		});
		const send = vi.spyOn(emailService, 'send');
		expect((await dispatch(probe.request)).status).toBe(413);
		expect(probe.getReader).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it('admits the existing 20 MiB attachment aggregate as base64 without lowering attachment limits', async () => {
		const attachment = btoa('x'.repeat(10 * MiB));
		const params = payloadFor(routes[0], { attachments: [
			{ filename: 'a.bin', type: 'application/octet-stream', content: attachment },
			{ filename: 'b.bin', type: 'application/octet-stream', content: attachment },
		] });
		const json = JSON.stringify(params);
		expect(json.length).toBeLessThan(MAX_SEND_BODY_BYTES);
		const send = vi.spyOn(emailService, 'send').mockImplementation(async (_c, value) => {
			const normalized = normalizeSendParams(value);
			return [{ emailId: 99, status: 1, requestId: normalized.requestId }];
		});
		expect((await dispatch(requestFor(routes[0], json))).status).toBe(200);
		expect(send).toHaveBeenCalledOnce();
	});
});
