import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import accountService from '../src/service/account-service';
import { markInstalled } from './installed-instance';

const ADMIN_EMAIL = 'domain-admin@example.com';
const ADMIN_PASSWORD = 'domain-admin-password';
const MEMBER_EMAIL = 'domain-member@example.com';
const MEMBER_PASSWORD = 'domain-member-password';

function context(runtimeEnv = env) {
	const values = new Map();
	return { env: runtimeEnv, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, options = {}, runtimeEnv = env) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request(`http://localhost${path}`, options), runtimeEnv, execution);
	await waitOnExecutionContext(execution);
	return response;
}

async function createUser(email, password, isAdmin = false) {
	const material = await cryptoUtils.hashPassword(password);
	const row = await env.db.prepare(`
		INSERT INTO user(email, password, salt, is_admin)
		VALUES (?, ?, ?, ?) RETURNING user_id AS userId
	`).bind(email, material.hash, material.salt, isAdmin ? 1 : 0).first();
	await env.db.prepare('INSERT INTO account(email, user_id) VALUES (?, ?)').bind(email, row.userId).run();
	return row.userId;
}

async function login(email, password) {
	const response = await request('/api/login', {
		method: 'POST',
		headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	}, { ...env, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) } });
	expect(response.status).toBe(200);
	return response.headers.get('set-cookie').split(';')[0];
}

function add(cookie, body, origin = 'http://localhost') {
	const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
	if (origin !== null) headers.Origin = origin;
	return request('/api/admin/domains', {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});
}

let adminId;
let adminCookie;
let memberCookie;

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env);
	adminId = await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, true);
	await createUser(MEMBER_EMAIL, MEMBER_PASSWORD);
	adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
	memberCookie = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
});

describe.sequential('D1 managed domain authority', () => {
	it('requires administrator authentication and strict same-origin writes', async () => {
		expect((await add(memberCookie, { domains: ['example.net'], revision: 1 })).status).toBe(403);
		expect((await add(adminCookie, { domains: ['example.net'], revision: 1 }, null)).status).toBe(403);
		expect((await add(adminCookie, { domains: ['example.net'], revision: 1 }, 'https://evil.example')).status).toBe(403);
		const crossRead = await request('/api/admin/domains', {
			headers: { Cookie: adminCookie, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
		});
		expect(crossRead.status).toBe(403);
	});

	it('adds normalized domains with CAS and immediately governs mailbox creation', async () => {
		const added = await add(adminCookie, { domains: ['Example.NET'], revision: 1 });
		expect(added.status).toBe(200);
		expect((await added.json()).data).toEqual({
			domains: ['example.com', 'example.net'],
			revision: 2,
		});
		expect((await add(adminCookie, { domains: ['other.example'], revision: 1 })).status).toBe(409);

		const driftEnv = { ...env, FLAREMAIL_DOMAINS: ['wrong.example'] };
		await expect(accountService.adminAdd(
			context(driftEnv),
			{ userId: adminId, email: 'new@example.net' },
		)).resolves.toMatchObject({ email: 'new@example.net' });
		await expect(accountService.adminAdd(
			context(driftEnv),
			{ userId: adminId, email: 'wrong@wrong.example' },
		)).rejects.toThrow();
	});

	it('serializes concurrent additions at one revision without overwriting the winner', async () => {
		const before = (await (await request('/api/admin/domains', { headers: { Cookie: adminCookie } })).json()).data;
		const responses = await Promise.all([
			add(adminCookie, { domains: ['alpha.example'], revision: before.revision }),
			add(adminCookie, { domains: ['beta.example'], revision: before.revision }),
		]);
		expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
		const after = (await (await request('/api/admin/domains', { headers: { Cookie: adminCookie } })).json()).data;
		expect(after.revision).toBe(before.revision + 1);
		expect(after.domains.length).toBe(before.domains.length + 1);
		expect(after.domains.filter(domain => ['alpha.example', 'beta.example'].includes(domain))).toHaveLength(1);
	});
});
