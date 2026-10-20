import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import { DOMAIN_TRIGGERS } from '../src/init/domain-schema';
import cryptoUtils from '../src/utils/crypto-utils';
import userService from '../src/service/user-service';
import sessionService from '../src/service/session-service';
import oauthService from '../src/service/oauth-service';
import { markInstalled } from './installed-instance';

const PASSWORD = 'domain authentication race password';
const REDIRECT = 'https://app.example.com/domain-auth/callback';
const runtime = { ...env,
	LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_AUTHORIZE_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
function context() {
	const values = new Map();
	return { env: runtime, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}
async function request(path, options = {}, requestEnv = runtime) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request('https://mail.example.com' + path, options), requestEnv, execution);
	await waitOnExecutionContext(execution);
	return response;
}
async function login(email) {
	const response = await request('/api/login', { method: 'POST',
		headers: { Origin: 'https://mail.example.com', 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password: PASSWORD }),
	});
	expect(response.status).toBe(200);
	const token = response.headers.get('set-cookie').match(/__Host-mail_session=([^;,]+)/)[1];
	return { cookie: `__Host-mail_session=${token}`, oauthCookie: `__Host-mail_oauth_session=${token}`,
		hash: await cryptoUtils.hashSecret(token) };
}
async function fixture({ googleSub = '' } = {}) {
	const email = `domain-auth-${crypto.randomUUID()}@example.com`;
	const material = await cryptoUtils.hashPassword(PASSWORD);
	const user = await env.db.prepare('INSERT INTO user(email,password,salt,google_sub) VALUES (?,?,?,?) RETURNING user_id AS userId')
		.bind(email, material.hash, material.salt, googleSub).first();
	await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind(email, user.userId).run();
	const token = await userService.genCliToken(context(), user.userId);
	return { ...user, email, token, session: await login(email), migratedEmail: email.replace('@example.com', '@migrated.test') };
}
// Model the identity part of the administrator's atomic domain migration.
// Its independent lifecycle tests cover preview/CAS and mailbox mapping; these
// tests inject that committed change at precise authentication await points.
async function migrate(f, target = f.migratedEmail) {
	await env.db.batch([
		env.db.prepare(`UPDATE user SET email=?,session_epoch=session_epoch+1,preserved_session_hash='',cli_token=''
			WHERE user_id=?`).bind(target, f.userId),
		env.db.prepare('UPDATE account SET email=? WHERE user_id=? AND email IN (?,?)')
			.bind(target, f.userId, f.email, f.migratedEmail),
		env.db.prepare('DELETE FROM oauth_authorization_code WHERE user_id=?').bind(f.userId),
	]);
}
async function genToken(session) {
	return request('/api/my/genCliToken', { method: 'POST',
		headers: { Cookie: session.cookie, Origin: 'https://mail.example.com' } });
}
async function codeCount(f) {
	return (await env.db.prepare('SELECT COUNT(*) AS n FROM oauth_authorization_code WHERE user_id=?').bind(f.userId).first()).n;
}
async function issue(session, requestEnv = runtime) {
	const query = new URLSearchParams({ client_id: 'domain-auth', redirect_uri: REDIRECT, response_type: 'code',
		state: crypto.randomUUID(), prompt: 'none', code_challenge_method: 'S256', code_challenge: await cryptoUtils.hashSecret('v'.repeat(43)) });
	const response = await request('/oauth/authorize?' + query, { headers: { Cookie: session.oauthCookie } }, requestEnv);
	expect(response.status).toBe(302);
	return new URL(response.headers.get('location'));
}
async function expectOldCredentialsRevoked(f) {
	expect((await request('/api/my/loginUserInfo', { headers: { Cookie: f.session.cookie } })).status).toBe(401);
	expect(await userService.verifyCliToken(context(), f.token)).toBeFalsy();
}
function interceptCodeInsert(action) {
	let injected = false;
	return new Proxy(env.db, { get(target, key) {
		if (key !== 'prepare') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
		return sql => {
			const statement = target.prepare(sql);
			if (!sql.includes('INSERT INTO oauth_authorization_code')) return statement;
			return { bind(...values) {
				const bound = statement.bind(...values);
				return new Proxy(bound, { get(query, method) {
					if (method === 'run') return async () => { if (!injected) { injected = true; await action(); } return query.run(); };
					return typeof query[method] === 'function' ? query[method].bind(query) : query[method];
				} });
			} };
		};
	} });
}
beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env, ['example.com', 'migrated.test']);
	const material = await cryptoUtils.hashPassword(PASSWORD);
	const admin = await env.db.prepare('INSERT INTO user(email,password,salt,is_admin) VALUES (?,?,?,1) RETURNING user_id AS userId')
		.bind('domain-auth-admin@example.com', material.hash, material.salt).first();
	await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind('domain-auth-admin@example.com', admin.userId).run();
	await env.db.prepare('UPDATE runtime_config SET oauth_issuer=?,oauth_secret=?').bind('https://mail.example.com', 'domain-auth-provider-secret').run();
	await env.db.prepare('UPDATE setting SET oauth_provider_enabled=1,oauth_provider_clients=?')
		.bind(JSON.stringify([{ clientId: 'domain-auth', enabled: true, displayName: 'Domain Auth',
			redirects: [{ redirectUri: REDIRECT, silentFrameAncestor: null }] }])).run();
	await env.db.prepare('UPDATE admin_confirmation SET enabled=0').run();
});
afterEach(() => vi.restoreAllMocks());

describe.sequential('domain migration authentication snapshots', () => {
	it('does not mint a CLI token when migration commits after its hash but before its conditional update', async () => {
		const f = await fixture();
		const hash = cryptoUtils.hashSecret;
		let generated;
		vi.spyOn(cryptoUtils, 'hashSecret').mockImplementation(async value => {
			const result = await hash(value);
			if (!generated && String(value).startsWith('cl_')) { generated = value; await migrate(f); }
			return result;
		});
		expect((await genToken(f.session)).status).toBe(401);
		expect(generated).toBeTruthy();
		expect((await userService.selectByIdIncludeDel(context(), f.userId)).cliToken).toBe('');
		expect(await userService.verifyCliToken(context(), generated)).toBeFalsy();
		await expectOldCredentialsRevoked(f);
		const fresh = await login(f.migratedEmail);
		const response = await genToken(fresh);
		expect(response.status).toBe(200);
		expect(await userService.verifyCliToken(context(), (await response.json()).data.token)).toMatchObject({ userId: f.userId, email: f.migratedEmail });
	});

	it('rejects a resolved Web session if migration precedes the middleware user snapshot', async () => {
		const f = await fixture();
		const resolve = sessionService.resolve;
		vi.spyOn(sessionService, 'resolve').mockImplementationOnce(async c => {
			const session = await resolve.call(sessionService, c);
			await migrate(f);
			return session;
		});
		expect((await genToken(f.session)).status).toBe(401);
		expect((await userService.selectByIdIncludeDel(context(), f.userId)).cliToken).toBe('');
		await expectOldCredentialsRevoked(f);
	});

	it('does not upgrade an old OAuth session to the migrated identity during its subsequent user read', async () => {
		const f = await fixture();
		const resolve = sessionService.resolveOAuth;
		vi.spyOn(sessionService, 'resolveOAuth').mockImplementationOnce(async c => {
			const session = await resolve.call(sessionService, c);
			await migrate(f);
			return session;
		});
		const redirect = await issue(f.session);
		expect(redirect.searchParams.get('error')).toBe('login_required');
		expect(redirect.searchParams.has('code')).toBe(false);
		expect(await codeCount(f)).toBe(0);
		await expectOldCredentialsRevoked(f);
		expect((await issue(await login(f.migratedEmail))).searchParams.get('code')).toBeTruthy();
	});

	it('binds authorization code insertion to the validated epoch even if a migration changes the email and back', async () => {
		const f = await fixture();
		const db = interceptCodeInsert(async () => { await migrate(f); await migrate(f, f.email); });
		const redirect = await issue(f.session, { ...runtime, db });
		expect(redirect.searchParams.get('error')).toBe('login_required');
		expect(redirect.searchParams.has('code')).toBe(false);
		expect(await codeCount(f)).toBe(0);
		await expectOldCredentialsRevoked(f);
		expect((await issue(await login(f.email))).searchParams.get('code')).toBeTruthy();
	});

	it('keeps the Google replacement initiator authorized to use Web, mint CLI tokens and issue codes', async () => {
		const f = await fixture({ googleSub: 'domain-auth-google-original' });
		const session = await sessionService.resolveByHash(context(), f.session.hash);
		await oauthService.bind(context(), f.userId, 'domain-auth-google-replacement', 'replacement@gmail.com', session);
		const user = await userService.selectByIdIncludeDel(context(), f.userId);
		expect(user.sessionEpoch).toBeGreaterThan(session.sessionEpoch);
		expect(sessionService.matchesEpoch(session, user)).toBe(true);
		expect((await request('/api/my/loginUserInfo', { headers: { Cookie: f.session.cookie } })).status).toBe(200);
		expect((await genToken(f.session)).status).toBe(200);
		expect((await issue(f.session)).searchParams.get('code')).toBeTruthy();
	});

	it('does not revoke the login identity when only an alias address migrates', async () => {
		const f = await fixture();
		const alias = f.email.replace('domain-auth-', 'domain-alias-');
		await env.db.prepare('INSERT INTO account(user_id,email) VALUES (?,?)').bind(f.userId, alias).run();
		await env.db.prepare('UPDATE account SET email=? WHERE email=?').bind(alias.replace('@example.com', '@migrated.test'), alias).run();
		expect((await request('/api/my/loginUserInfo', { headers: { Cookie: f.session.cookie } })).status).toBe(200);
		expect(await userService.verifyCliToken(context(), f.token)).toMatchObject({ userId: f.userId });
		expect((await issue(f.session)).searchParams.get('code')).toBeTruthy();
	});

	it('keeps CLI issuance and OAuth authorization compatible with an intact pre-326 identity schema', async () => {
		const f = await fixture();
		await env.db.batch([
			...Object.keys(DOMAIN_TRIGGERS).map(name => env.db.prepare(`DROP TRIGGER IF EXISTS ${name}`)),
			env.db.prepare('ALTER TABLE managed_domain DROP COLUMN enabled'),
			env.db.prepare('DROP TABLE webhook_delivery'), env.db.prepare('DROP TABLE webhook_config'),
			env.db.prepare('DELETE FROM schema_migrations WHERE version IN (326,327,328)'),
			env.db.prepare('ALTER TABLE user DROP COLUMN session_epoch'),
			env.db.prepare('ALTER TABLE user DROP COLUMN preserved_session_hash'),
			env.db.prepare('DROP TABLE session_revocation'),
		]);
		try {
			const fresh = await login(f.email);
			expect((await genToken(fresh)).status).toBe(200);
			expect((await issue(fresh)).searchParams.get('code')).toBeTruthy();
		} finally {
			await dbInit.migrate(context());
		}
	});
});
