import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import oauthService from '../src/service/oauth-service';
import { markInstalled } from './installed-instance';

const runtimeEnv = {
	...env,
	FLAREMAIL_CLIENT_SECRET: 'flaremail-first-party-test-secret',
	FLAREMAIL_OAUTH_ISSUER: 'https://mail.example.com',
	OAUTH_AUTHORIZE_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_USERINFO_RATE_LIMITER: { limit: async () => ({ success: true }) },
	LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const DEFAULT_CLIENT_ID = 'main';
const DEFAULT_REDIRECT_URI = 'https://app.example.com/auth/callback';
const DEFAULT_CLIENTS = [
	{
		clientId: 'main',
		displayName: 'Example App',
		enabled: true,
		redirects: [
			{ redirectUri: DEFAULT_REDIRECT_URI, silentFrameAncestor: null },
			{ redirectUri: 'https://www.app.example.com/auth/callback', silentFrameAncestor: null },
			{ redirectUri: 'http://127.0.0.1:8790/auth/callback', silentFrameAncestor: null },
		],
	},
	{
		clientId: 'blog',
		displayName: 'Example Blog',
		enabled: true,
		redirects: [
			{ redirectUri: 'https://blog-api.example.com/auth/callback', silentFrameAncestor: 'https://blog.example.com' },
			{ redirectUri: 'http://127.0.0.1:8787/auth/callback', silentFrameAncestor: 'http://127.0.0.1:4321' },
		],
	},
	{
		clientId: 'music',
		displayName: 'Example Music',
		enabled: true,
		redirects: [
			{ redirectUri: 'https://music-api.example.com/auth/callback', silentFrameAncestor: null },
			{ redirectUri: 'http://127.0.0.1:8789/auth/callback', silentFrameAncestor: null },
		],
	},
];

function context() {
	const values = new Map();
	return { env, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, options = {}, requestEnv = runtimeEnv) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request(`https://mail.example.com${path}`, options), requestEnv, execution);
	await waitOnExecutionContext(execution);
	return response;
}

async function issueCode(cookie, state = crypto.randomUUID().replace(/-/g, '')) {
	const response = await authorizeWithCookie(cookie, state);
	const callback = new URL(response.headers.get('location'));
	return { response, code: callback.searchParams.get('code'), verifier: 'v'.repeat(43), state };
}

async function authorizeWithCookie(cookie, state = crypto.randomUUID().replace(/-/g, '')) {
	const verifier = 'v'.repeat(43);
	const authorize = new URL('https://mail.example.com/oauth/authorize');
	authorize.search = new URLSearchParams({
		response_type: 'code',
		client_id: DEFAULT_CLIENT_ID,
		redirect_uri: DEFAULT_REDIRECT_URI,
		scope: 'email',
		state,
		code_challenge: await cryptoUtils.hashSecret(verifier),
		code_challenge_method: 'S256',
	}).toString();
	return request(`${authorize.pathname}${authorize.search}`, { headers: { Cookie: cookie } });
}

function tokenForm(code, verifier) {
	return new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: DEFAULT_CLIENT_ID,
		client_secret: 'flaremail-first-party-test-secret',
		redirect_uri: DEFAULT_REDIRECT_URI,
		code,
		code_verifier: verifier,
	});
}

async function createUserAndLogin(customName = '测试昵称') {
	const email = `oauth-provider-${crypto.randomUUID()}@example.com`;
	const password = 'oauth provider test password';
	const material = await cryptoUtils.hashPassword(password);
	const userRow = await env.db.prepare('INSERT INTO user(email, password, salt) VALUES (?, ?, ?) RETURNING user_id')
		.bind(email, material.hash, material.salt).first();
	if (customName) {
		await env.db.prepare('INSERT INTO account(user_id, email, name) VALUES (?, ?, ?)')
			.bind(userRow.user_id, email, customName).run();
	}
	const response = await request('/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://mail.example.com' },
		body: JSON.stringify({ email, password }),
	});
	expect(response.status).toBe(200);
	const setCookie = response.headers.get('set-cookie') || '';
	const token = setCookie.match(/__Host-mail_oauth_session=([^;,]+)/)?.[1];
	const legacyToken = setCookie.match(/__Host-mail_session=([^;,]+)/)?.[1];
	expect(token).toBeTruthy();
	expect(legacyToken).toBeTruthy();
	return {
		email,
		userId: userRow.user_id,
		cookie: `__Host-mail_oauth_session=${token}`,
		legacyCookie: `__Host-mail_session=${legacyToken}`,
		legacyToken,
	};
}

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env);
	await env.db.prepare(`
		UPDATE runtime_config SET oauth_issuer = ?, oauth_secret = ? WHERE id = 1
	`).bind('https://mail.example.com', 'flaremail-first-party-test-secret').run();
	await env.db.prepare(`
		UPDATE setting
		SET oauth_provider_enabled = 1, oauth_provider_clients = ?, oauth_provider_revision = 0
	`).bind(JSON.stringify(DEFAULT_CLIENTS)).run();
});

describe('邮件 OAuth Provider', () => {
	it('迁移只增加授权码表，不增加第二套用户身份字段', async () => {
		const table = await env.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'oauth_authorization_code'").first();
		const authSubject = await env.db.prepare("SELECT name FROM pragma_table_info('user') WHERE name = 'auth_subject'").first();
		expect(table?.name).toBe('oauth_authorization_code');
		expect(authSubject).toBeNull();
	});

	it('使用现有邮件会话完成 PKCE 授权、userinfo，并拒绝授权码重放', async () => {
		const { email, cookie } = await createUserAndLogin('示例发件人');
		const verifier = 'v'.repeat(43);
		const state = 's'.repeat(43);
		const authorize = new URL('https://mail.example.com/oauth/authorize');
		authorize.search = new URLSearchParams({
			response_type: 'code',
			client_id: DEFAULT_CLIENT_ID,
			redirect_uri: DEFAULT_REDIRECT_URI,
			scope: 'email',
			state,
			code_challenge: await cryptoUtils.hashSecret(verifier),
			code_challenge_method: 'S256',
		}).toString();
		const authorizationResponse = await request(`${authorize.pathname}${authorize.search}`, { headers: { Cookie: cookie } });
		const callback = new URL(authorizationResponse.headers.get('location'));
		expect(authorizationResponse.status).toBe(302);
		expect(authorizationResponse.headers.get('Cache-Control')).toBe('no-store');
		expect(authorizationResponse.headers.get('Pragma')).toBe('no-cache');
		expect(callback.origin + callback.pathname).toBe(DEFAULT_REDIRECT_URI);
		expect(callback.searchParams.get('state')).toBe(state);

		const code = callback.searchParams.get('code');
		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: DEFAULT_CLIENT_ID,
			client_secret: 'flaremail-first-party-test-secret',
			redirect_uri: DEFAULT_REDIRECT_URI,
			code,
			code_verifier: verifier,
		});
		const wrongSecret = new URLSearchParams(body);
		wrongSecret.set('client_secret', 'wrong-client-secret');
		const wrongSecretResponse = await request('/oauth/token', { method: 'POST', body: wrongSecret });
		expect(wrongSecretResponse.status).toBe(401);

		const wrongVerifier = new URLSearchParams(body);
		wrongVerifier.set('code_verifier', 'x'.repeat(43));
		const wrongVerifierResponse = await request('/oauth/token', { method: 'POST', body: wrongVerifier });
		expect(wrongVerifierResponse.status).toBe(400);
		expect((await wrongVerifierResponse.json()).error).toBe('invalid_grant');

		const tokenResponse = await request('/oauth/token', { method: 'POST', body });
		const token = await tokenResponse.json();
		expect(tokenResponse.status).toBe(200);
		expect(token.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);

		const replay = await request('/oauth/token', { method: 'POST', body });
		expect(replay.status).toBe(400);
		expect((await replay.json()).error).toBe('invalid_grant');

		const userinfo = await request('/oauth/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
		const identity = await userinfo.json();
		expect(userinfo.status).toBe(200);
		expect(identity.email).toBe(email);
		expect(identity.name).toBe('示例发件人');
		expect(identity.sub).toMatch(/^\d+$/);
		expect(identity.role).toBe('member');
		const withoutConfiguredAdmin = await request('/oauth/userinfo', {
			headers: { Authorization: `Bearer ${token.access_token}` },
		}, { ...runtimeEnv, FLAREMAIL_ADMIN_EMAIL: '' });
		expect(withoutConfiguredAdmin.status).toBe(200);
		expect((await withoutConfiguredAdmin.json()).role).toBe('member');

		await env.db.prepare(`UPDATE user SET password = 'changed-password-material' WHERE user_id = ?`).bind(Number(identity.sub)).run();
		const afterPasswordChange = await request('/oauth/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
		expect(afterPasswordChange.status).toBe(401);
	});

	it('userinfo 只按邮件端管理员配置签发 admin/member 角色', async () => {
		const password = runtimeEnv.FLAREMAIL_ADMIN_PASSWORD;
		let admin = await env.db.prepare('SELECT user_id FROM user WHERE email = ? COLLATE NOCASE').bind(runtimeEnv.FLAREMAIL_ADMIN_EMAIL).first();
		if (!admin) {
			const material = await cryptoUtils.hashPassword(password);
			await env.db.prepare('INSERT INTO user(email, password, salt, is_admin) VALUES (?, ?, ?, 1)')
				.bind(runtimeEnv.FLAREMAIL_ADMIN_EMAIL, material.hash, material.salt).run();
			admin = await env.db.prepare('SELECT user_id FROM user WHERE email = ? COLLATE NOCASE').bind(runtimeEnv.FLAREMAIL_ADMIN_EMAIL).first();
		}
		await env.db.prepare('UPDATE user SET is_admin = 1 WHERE user_id = ?').bind(admin.user_id).run();
		const login = await request('/api/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: 'https://mail.example.com' },
			body: JSON.stringify({ email: runtimeEnv.FLAREMAIL_ADMIN_EMAIL, password }),
		});
		expect(login.status).toBe(200);
		const oauthToken = (login.headers.get('set-cookie') || '').match(/__Host-mail_oauth_session=([^;,]+)/)?.[1];
		expect(oauthToken).toBeTruthy();

		const authorization = await issueCode(`__Host-mail_oauth_session=${oauthToken}`);
		const tokenResponse = await request('/oauth/token', {
			method: 'POST',
			body: tokenForm(authorization.code, authorization.verifier),
		});
		const token = await tokenResponse.json();
		expect(tokenResponse.status).toBe(200);

		const userinfo = await request('/oauth/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
		const identity = await userinfo.json();
		expect(identity.sub).toBe(String(admin.user_id));
		expect(identity.email).toBe(runtimeEnv.FLAREMAIL_ADMIN_EMAIL.toLowerCase());
		expect(identity.role).toBe('admin');

		const migratedEmail = 'oauth-provider-admin-new@example.com';
		await env.db.prepare('UPDATE user SET email = ? WHERE user_id = ?').bind(migratedEmail, admin.user_id).run();
		const afterMigration = await request('/oauth/userinfo', {
			headers: { Authorization: `Bearer ${token.access_token}` },
		}, { ...runtimeEnv, FLAREMAIL_ADMIN_EMAIL: 'member@example.com' });
		expect(afterMigration.status).toBe(200);
		expect(await afterMigration.json()).toMatchObject({
			sub: String(admin.user_id),
			email: migratedEmail,
			role: 'admin',
		});
	});

	it('OAuth 上线前创建的邮件会话可升级并继续原授权请求', async () => {
		const { legacyCookie } = await createUserAndLogin();
		const authorization = await issueCode(legacyCookie);

		expect(authorization.response.status).toBe(302);
		expect(authorization.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(authorization.response.headers.get('set-cookie') || '')
			.toContain('__Host-mail_oauth_session=');
	});

	it('禁用、删除、改密或过期的旧会话不会获得 OAuth Cookie', async () => {
		for (const invalidate of [
			async user => env.db.prepare('UPDATE user SET status = 1 WHERE email = ?').bind(user.email).run(),
			async user => env.db.prepare('UPDATE user SET is_del = 1 WHERE email = ?').bind(user.email).run(),
			async user => env.db.prepare("UPDATE user SET password = 'changed-password-material' WHERE email = ?").bind(user.email).run(),
		]) {
			const user = await createUserAndLogin();
			await invalidate(user);
			const response = await authorizeWithCookie(user.legacyCookie);
			expect(response.status).toBe(302);
			expect(response.headers.get('location')).toContain('/login?redirect=');
			expect(response.headers.get('set-cookie') || '').not.toContain('mail_oauth_session');
		}

		const missing = await authorizeWithCookie(`__Host-mail_session=${'x'.repeat(43)}`);
		expect(missing.status).toBe(302);
		expect(missing.headers.get('location')).toContain('/login?redirect=');
		expect(missing.headers.get('set-cookie') || '').not.toContain('mail_oauth_session');
	});

	it('无邮件会话时 prompt=none 只向已登记客户端回调返回错误', async () => {
		const valid = new URLSearchParams({
			response_type: 'code', client_id: DEFAULT_CLIENT_ID,
			redirect_uri: DEFAULT_REDIRECT_URI,
			state: 'state-value', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', prompt: 'none',
		});
		const anonymous = await request(`/oauth/authorize?${valid}`);
		const callback = new URL(anonymous.headers.get('location'));
		expect(callback.searchParams.get('error')).toBe('login_required');
		expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
		expect(anonymous.headers.get('X-Frame-Options')).toBe('DENY');
		const interactive = new URLSearchParams(valid);
		interactive.delete('prompt');
		const loginRedirect = await request(`/oauth/authorize?${interactive}`);
		expect(loginRedirect.status).toBe(302);
		expect(loginRedirect.headers.get('location')).toContain('/login?redirect=');
		expect(loginRedirect.headers.get('Cache-Control')).toBe('no-store');
		expect(callback.searchParams.get('state')).toBe('state-value');

		// 未登记回调必须在邮件站本地失败，不能形成开放重定向。
		valid.set('redirect_uri', 'https://any-external-domain.com/callback');
		const externalRejected = await request(`/oauth/authorize?${valid}`);
		expect(externalRejected.status).toBe(400);
		expect(externalRejected.headers.get('location')).toBeNull();
		expect((await externalRejected.json()).error).toBe('invalid_client_or_redirect');

		// 非法协议或畸形地址同样在邮件端直接拒绝。
		valid.set('redirect_uri', 'javascript:alert(1)');
		const invalidScheme = await request(`/oauth/authorize?${valid}`);
		expect(invalidScheme.status).toBe(400);
		expect((await invalidScheme.json()).error).toBe('invalid_client_or_redirect');
	});

	it('允许博客精确 callback 使用现有邮件会话完成 prompt=none PKCE 授权', async () => {
		const { cookie } = await createUserAndLogin('博客用户');
		const verifier = 'b'.repeat(43);
		const state = 'blog-discovery-state';
		const redirectUri = 'https://blog-api.example.com/auth/callback';
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: 'blog',
			redirect_uri: redirectUri,
			scope: 'email',
			state,
			code_challenge: await cryptoUtils.hashSecret(verifier),
			code_challenge_method: 'S256',
			prompt: 'none',
		});
		const authorization = await request(`/oauth/authorize?${params}`, { headers: { Cookie: cookie } });
		const callback = new URL(authorization.headers.get('location'));
		expect(authorization.status).toBe(302);
		expect(authorization.headers.get('X-Frame-Options')).toBeNull();
		expect(authorization.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors https://blog.example.com");
		expect(authorization.headers.get('X-OAuth-Silent-Frame-Ancestor')).toBeNull();
		expect(callback.origin + callback.pathname).toBe(redirectUri);
		expect(callback.searchParams.get('state')).toBe(state);

		const token = await request('/oauth/token', {
			method: 'POST',
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: 'blog',
				client_secret: 'flaremail-first-party-test-secret',
				redirect_uri: redirectUri,
				code: callback.searchParams.get('code'),
				code_verifier: verifier,
			}),
		});
		expect(token.status).toBe(200);
		expect((await token.json()).access_token).toBeTruthy();
	});

	it('只为精确登记的博客静默回调放行对应父页面，交互授权仍禁止嵌入', async () => {
		const base = {
			response_type: 'code',
			client_id: 'blog',
			scope: 'email',
			state: 'frame-policy-state',
			code_challenge: 'c'.repeat(43),
			code_challenge_method: 'S256',
		};
		for (const [redirectUri, ancestor] of [
			['http://127.0.0.1:8787/auth/callback', 'http://127.0.0.1:4321'],
		]) {
			const params = new URLSearchParams({ ...base, redirect_uri: redirectUri, prompt: 'none' });
			const response = await request(`/oauth/authorize?${params}`);
			expect(response.status).toBe(302);
			expect(response.headers.get('X-Frame-Options')).toBeNull();
			expect(response.headers.get('Content-Security-Policy')).toBe(`default-src 'none'; frame-ancestors ${ancestor}`);
			expect(response.headers.get('X-OAuth-Silent-Frame-Ancestor')).toBeNull();
		}

		const interactive = new URLSearchParams({
			...base,
			redirect_uri: 'https://blog-api.example.com/auth/callback',
		});
		const response = await request(`/oauth/authorize?${interactive}`);
		expect(response.status).toBe(302);
		expect(response.headers.get('X-Frame-Options')).toBe('DENY');
		expect(response.headers.get('Content-Security-Policy')).toBeNull();
	});

	it('拒绝过期授权码、禁用/删除用户，并限制 userinfo', async () => {
		const expiredUser = await createUserAndLogin();
		const expired = await issueCode(expiredUser.cookie);
		await env.db.prepare('UPDATE oauth_authorization_code SET expires_at = 0 WHERE code_hash = ?')
			.bind(await cryptoUtils.hashSecret(expired.code)).run();
		const expiredResponse = await request('/oauth/token', { method: 'POST', body: tokenForm(expired.code, expired.verifier) });
		expect(expiredResponse.status).toBe(400);
		expect((await expiredResponse.json()).error).toBe('invalid_grant');

		const bannedUser = await createUserAndLogin();
		const banned = await issueCode(bannedUser.cookie);
		await env.db.prepare('UPDATE user SET status = 1 WHERE email = ?').bind(bannedUser.email).run();
		const bannedResponse = await request('/oauth/token', { method: 'POST', body: tokenForm(banned.code, banned.verifier) });
		expect(bannedResponse.status).toBe(400);
		expect((await bannedResponse.json()).error).toBe('invalid_grant');

		const deletedUser = await createUserAndLogin();
		const deleted = await issueCode(deletedUser.cookie);
		const tokenResponse = await request('/oauth/token', { method: 'POST', body: tokenForm(deleted.code, deleted.verifier) });
		const token = await tokenResponse.json();
		expect(tokenResponse.status).toBe(200);
		await env.db.prepare('UPDATE user SET is_del = 1 WHERE email = ?').bind(deletedUser.email).run();
		const deletedInfo = await request('/oauth/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
		expect(deletedInfo.status).toBe(401);

		const limited = await request('/oauth/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } }, {
			...runtimeEnv,
			OAUTH_USERINFO_RATE_LIMITER: { limit: async () => ({ success: false }) },
		});
		expect(limited.status).toBe(429);
	});

	it('元数据只声明实际实现的 OAuth 能力，Google 回流只接受本站授权端点', async () => {
		const metadata = await request('/.well-known/oauth-authorization-server');
		const body = await metadata.json();
		expect(body.issuer).toBe('https://mail.example.com');
		expect(body.response_types_supported).toEqual(['code']);
		expect(body).not.toHaveProperty('id_token_signing_alg_values_supported');

		const c = { req: { url: 'https://mail.example.com/login/oauth/start' } };
		expect(oauthService.safeAuthorizationReturn(c, '/oauth/authorize?client_id=ai')).toBe('/oauth/authorize?client_id=ai');
		expect(oauthService.safeAuthorizationReturn(c, 'https://evil.example/oauth/authorize')).toBe('');
		expect(oauthService.safeAuthorizationReturn(c, '/inbox')).toBe('');
	});

	it('已登记客户端支持 JSON 请求体换取 Token', async () => {
		const { cookie } = await createUserAndLogin();
		const verifier = 'v'.repeat(43);
		const state = 'custom-state-123';
		const redirectUri = 'https://music-api.example.com/auth/callback';
		const authorize = new URL('https://mail.example.com/oauth/authorize');
		authorize.search = new URLSearchParams({
			response_type: 'code',
			client_id: 'music',
			redirect_uri: redirectUri,
			scope: 'email',
			state,
			code_challenge: await cryptoUtils.hashSecret(verifier),
			code_challenge_method: 'S256',
		}).toString();

		const authResp = await request(`${authorize.pathname}${authorize.search}`, { headers: { Cookie: cookie } });
		expect(authResp.status).toBe(302);
		const callback = new URL(authResp.headers.get('location'));
		expect(callback.origin + callback.pathname).toBe(redirectUri);
		const code = callback.searchParams.get('code');

		// 测试以 application/json 格式发送换 Token 请求
		const jsonBody = {
			grant_type: 'authorization_code',
			client_id: 'music',
			client_secret: 'flaremail-first-party-test-secret',
			redirect_uri: redirectUri,
			code,
			code_verifier: verifier,
		};
		const tokenResp = await request('/oauth/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(jsonBody),
		});

		expect(tokenResp.status).toBe(200);
		const token = await tokenResp.json();
		expect(token.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('固定客户端表支持三个站点的七个精确回调完成授权与换 Token', async () => {
		const clients = [
			['main', 'https://app.example.com/auth/callback'],
			['main', 'https://www.app.example.com/auth/callback'],
			['main', 'http://127.0.0.1:8790/auth/callback'],
			['blog', 'https://blog-api.example.com/auth/callback'],
			['blog', 'http://127.0.0.1:8787/auth/callback'],
			['music', 'https://music-api.example.com/auth/callback'],
			['music', 'http://127.0.0.1:8789/auth/callback'],
		];
		const { cookie, email } = await createUserAndLogin('七回调用户');

		for (const [index, [clientId, redirectUri]] of clients.entries()) {
			const verifier = `${'v'.repeat(42)}${index}`;
			const params = new URLSearchParams({
				response_type: 'code',
				client_id: clientId,
				redirect_uri: redirectUri,
				scope: 'email',
				state: `default-callback-${index}`,
				code_challenge: await cryptoUtils.hashSecret(verifier),
				code_challenge_method: 'S256',
			});
			const response = await request(`/oauth/authorize?${params}`, { headers: { Cookie: cookie } });
			expect(response.status).toBe(302);
			const callback = new URL(response.headers.get('location'));
			expect(callback.origin + callback.pathname).toBe(redirectUri);
			const tokenResponse = await request('/oauth/token', {
				method: 'POST',
				body: new URLSearchParams({
					grant_type: 'authorization_code', client_id: clientId,
					client_secret: 'flaremail-first-party-test-secret', redirect_uri: redirectUri,
					code: callback.searchParams.get('code'), code_verifier: verifier,
				}),
			});
			expect(tokenResponse.status).toBe(200);
			const token = await tokenResponse.json();
			const userinfo = await request('/oauth/userinfo', {
				headers: { Authorization: `Bearer ${token.access_token}` },
			});
			expect(userinfo.status).toBe(200);
			expect((await userinfo.json()).email).toBe(email);
		}
	});

	it('共享密钥不能跨客户端或回调兑换已签发授权码', async () => {
		const { cookie } = await createUserAndLogin('客户端绑定用户');
		const issued = await issueCode(cookie);
		for (const [clientId, redirectUri, expectedError, expectedStatus] of [
			['blog', 'https://blog-api.example.com/auth/callback', 'invalid_grant', 400],
			['main', 'https://www.app.example.com/auth/callback', 'invalid_grant', 400],
			['main', 'https://blog-api.example.com/auth/callback', 'invalid_client', 401],
		]) {
			const response = await request('/oauth/token', {
				method: 'POST',
				body: new URLSearchParams({
					grant_type: 'authorization_code', client_id: clientId,
					client_secret: 'flaremail-first-party-test-secret', redirect_uri: redirectUri,
					code: issued.code, code_verifier: issued.verifier,
				}),
			});
			expect(response.status).toBe(expectedStatus);
			expect((await response.json()).error).toBe(expectedError);
		}

		const valid = await request('/oauth/token', {
			method: 'POST',
			body: tokenForm(issued.code, issued.verifier),
		});
		expect(valid.status).toBe(200);
	});

	it('主站本地 8790 端口继续支持完整回调登录', async () => {
		const { cookie } = await createUserAndLogin();
		const verifier = 'v'.repeat(43);
		const state = 'state-8790';
		const authorize = new URL('https://mail.example.com/oauth/authorize');
		authorize.search = new URLSearchParams({
			response_type: 'code',
			client_id: 'main',
			redirect_uri: 'http://127.0.0.1:8790/auth/callback',
			scope: 'email',
			state,
			code_challenge: await cryptoUtils.hashSecret(verifier),
			code_challenge_method: 'S256',
		}).toString();

		const authResp = await request(`${authorize.pathname}${authorize.search}`, { headers: { Cookie: cookie } });
		expect(authResp.status).toBe(302);
		const callback = new URL(authResp.headers.get('location'));
		expect(callback.origin + callback.pathname).toBe('http://127.0.0.1:8790/auth/callback');
		const code = callback.searchParams.get('code');
		expect(code).toBeTruthy();

		const tokenResp = await request('/oauth/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'authorization_code',
				client_id: 'main',
				client_secret: 'flaremail-first-party-test-secret',
				redirect_uri: 'http://127.0.0.1:8790/auth/callback',
				code,
				code_verifier: verifier,
			}),
		});
		expect(tokenResp.status).toBe(200);
		const token = await tokenResp.json();
		expect(token.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('拒绝未知客户端、跨客户端回调错配和近似回调地址', async () => {
		for (const [clientId, redirectUri] of [
			['custom-service', 'https://custom-service.example.com/auth/callback'],
			['main', 'https://blog-api.example.com/auth/callback'],
			['blog', 'https://blog-api.example.com/auth/callback/extra'],
			['music', 'https://music-api.example.com:444/auth/callback'],
			['main', 'https://evil.example/callback'],
		]) {
			const params = new URLSearchParams({
				response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
				scope: 'email', state: 'rejected-client', code_challenge: 'v'.repeat(43),
				code_challenge_method: 'S256', prompt: 'none',
			});
			const response = await request(`/oauth/authorize?${params}`);
			expect(response.status).toBe(400);
			expect(response.headers.get('location')).toBeNull();
			expect((await response.json()).error).toBe('invalid_client_or_redirect');
		}
	});

	it('D1 未配置共享 Secret 时直接拒绝授权并忽略旧环境值', async () => {
		await env.db.prepare(`UPDATE runtime_config SET oauth_issuer = '', oauth_secret = '' WHERE id = 1`).run();
		const unconfiguredEnv = {
			...runtimeEnv,
			FLAREMAIL_CLIENT_SECRET: 'obsolete-environment-secret',
		};
		const { cookie } = await createUserAndLogin('未配置密钥测试用户');
		const verifier = 'v'.repeat(43);
		const state = 'no-secret-state';
		const authorize = new URL('https://mail.example.com/oauth/authorize');
		authorize.search = new URLSearchParams({
			response_type: 'code',
			client_id: 'blog',
			redirect_uri: 'https://blog-api.example.com/auth/callback',
			scope: 'email',
			state,
			code_challenge: await cryptoUtils.hashSecret(verifier),
			code_challenge_method: 'S256',
		}).toString();

		const authResp = await request(`${authorize.pathname}${authorize.search}`, { headers: { Cookie: cookie } }, unconfiguredEnv);
		expect(authResp.status).toBe(503);
		expect((await authResp.json()).error).toBe('provider_not_ready');
	});
});
