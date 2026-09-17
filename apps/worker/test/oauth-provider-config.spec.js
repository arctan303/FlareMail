import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const ADMIN_EMAIL = 'provider-admin@example.com';
const ADMIN_PASSWORD = 'provider-admin-password';
const MEMBER_EMAIL = 'provider-member@example.com';
const MEMBER_PASSWORD = 'provider-member-password';
const CLIENT_SECRET = 'provider-shared-test-secret';
const REDIRECT_URI = 'https://client.example.com/auth/callback';
const runtimeEnv = {
	...env,
	FLAREMAIL_ADMIN_EMAIL: ADMIN_EMAIL,
	FLAREMAIL_OAUTH_ISSUER: 'https://mail.example.com',
	FLAREMAIL_CLIENT_SECRET: CLIENT_SECRET,
	LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_AUTHORIZE_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_USERINFO_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const CLIENTS = [{
	clientId: 'example-client',
	displayName: 'Example Client',
	enabled: true,
	redirects: [{ redirectUri: REDIRECT_URI, silentFrameAncestor: 'https://client.example.com' }],
}];

function context(requestEnv = runtimeEnv) {
	const values = new Map();
	return { env: requestEnv, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, options = {}, requestEnv = runtimeEnv) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request(`http://localhost${path}`, options), requestEnv, execution);
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
}

async function login(email, password) {
	const response = await request('/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
		body: JSON.stringify({ email, password }),
	});
	expect(response.status).toBe(200);
	const setCookie = response.headers.get('set-cookie') || '';
	const sessionToken = setCookie.match(/mail_session_dev=([^;,]+)/)?.[1];
	const oauthToken = setCookie.match(/mail_oauth_session_dev=([^;,]+)/)?.[1];
	expect(sessionToken).toBeTruthy();
	expect(oauthToken).toBeTruthy();
	return {
		cookie: `mail_session_dev=${sessionToken}`,
		oauthCookie: `mail_oauth_session_dev=${oauthToken}`,
		sessionToken,
	};
}

async function getConfig(cookie, requestEnv = runtimeEnv) {
	const response = await request('/api/setting/oauth-provider', { headers: { Cookie: cookie } }, requestEnv);
	return { response, body: await response.json() };
}

async function putConfig(cookie, endpoint, body, { origin = 'http://localhost', requestEnv = runtimeEnv } = {}) {
	return request(`/api/setting/oauth-provider/${endpoint}`, {
		method: 'PUT',
		headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	}, requestEnv);
}

async function issueCode(oauthCookie, redirectUri = REDIRECT_URI) {
	const verifier = 'v'.repeat(43);
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: 'example-client',
		redirect_uri: redirectUri,
		scope: 'email',
		state: crypto.randomUUID(),
		code_challenge: await cryptoUtils.hashSecret(verifier),
		code_challenge_method: 'S256',
	});
	const response = await request(`/oauth/authorize?${params}`, { headers: { Cookie: oauthCookie } });
	const location = response.headers.get('location');
	return { response, code: location ? new URL(location).searchParams.get('code') : null, verifier };
}

async function exchangeCode(code, verifier, redirectUri = REDIRECT_URI) {
	return request('/oauth/token', {
		method: 'POST',
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: 'example-client',
			client_secret: CLIENT_SECRET,
			redirect_uri: redirectUri,
			code,
			code_verifier: verifier,
		}),
	});
}

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env);
	await env.db.prepare('UPDATE admin_confirmation SET enabled = 1, window_minutes = 10 WHERE id = 1').run();
	await env.db.prepare(`
		UPDATE runtime_config SET oauth_issuer = ?, oauth_secret = ? WHERE id = 1
	`).bind('https://mail.example.com', CLIENT_SECRET).run();
	await createUser(ADMIN_EMAIL, ADMIN_PASSWORD, true);
	await createUser(MEMBER_EMAIL, MEMBER_PASSWORD);
});

describe.sequential('OAuth provider D1 configuration', () => {
	it('installs marker 320 disabled with an empty client list and readable metadata readiness', async () => {
		expect(await dbInit.v3_20Applied(context())).toBe(true);
		const row = await env.db.prepare(`
			SELECT oauth_provider_enabled AS enabled,
				oauth_provider_revision AS revision,
				oauth_provider_clients AS clients
			FROM setting
		`).first();
		expect(row).toEqual({ enabled: 0, revision: 0, clients: '[]' });

		const disabled = await request('/oauth/authorize?client_id=unknown&redirect_uri=https%3A%2F%2Fevil.example%2Fcallback');
		expect(disabled.status).toBe(403);
		expect(disabled.headers.get('location')).toBeNull();
		expect(await disabled.json()).toEqual({ error: 'authorization_disabled' });

		const metadata = await request('/.well-known/oauth-authorization-server', {}, {
			...runtimeEnv,
			FLAREMAIL_OAUTH_ISSUER: '',
		});
		expect(metadata.status).toBe(200);
		expect(await metadata.json()).toMatchObject({
			issuer: 'https://mail.example.com',
			provider_enabled: false,
			issuer_ready: true,
			secret_ready: true,
			configuration_ready: true,
		});
		const normalized = await request('/.well-known/oauth-authorization-server', {}, {
			...runtimeEnv,
			FLAREMAIL_OAUTH_ISSUER: 'https://mail.example.com/',
		});
		expect(await normalized.json()).toMatchObject({
			issuer: 'https://mail.example.com',
			authorization_endpoint: 'https://mail.example.com/oauth/authorize',
			token_endpoint: 'https://mail.example.com/oauth/token',
			userinfo_endpoint: 'https://mail.example.com/oauth/userinfo',
			issuer_ready: true,
		});
	});

	it('requires a persisted administrator, same origin and recent password authentication', async () => {
		const member = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
		expect((await getConfig(member.cookie)).response.status).toBe(403);

		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const status = await getConfig(admin.cookie);
		expect(status.response.status).toBe(200);
		expect(status.body.data).toMatchObject({
			enabled: false,
			revision: 0,
			issuerReady: true,
			secretReady: true,
			clients: [],
		});
		const crossSiteRead = await request('/api/setting/oauth-provider', {
			headers: {
				Cookie: admin.cookie,
				Origin: 'https://evil.example',
				'Sec-Fetch-Site': 'cross-site',
			},
		});
		expect(crossSiteRead.status).toBe(403);

		const crossSite = await putConfig(admin.cookie, 'clients', { revision: 0, clients: CLIENTS }, {
			origin: 'https://evil.example',
		});
		expect(crossSite.status).toBe(403);

		await env.kv.delete(KvConst.RECENT_AUTH + await cryptoUtils.hashSecret(admin.sessionToken));
		const withoutRecent = await putConfig(admin.cookie, 'clients', { revision: 0, clients: CLIENTS });
		expect(withoutRecent.status).toBe(428);
	});

	it('validates complete clients and performs independent CAS writes without changing the other field', async () => {
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const invalidBefore = await env.db.prepare(`
			SELECT oauth_provider_enabled AS enabled, oauth_provider_revision AS revision,
				oauth_provider_clients AS clients FROM setting
		`).first();
		for (const clients of [
			[{ ...CLIENTS[0], redirects: [{ redirectUri: 'https://client.example.com/callback*', silentFrameAncestor: null }] }],
			[{ ...CLIENTS[0], redirects: [{ redirectUri: 'http://client.example.com/callback', silentFrameAncestor: null }] }],
			[{ ...CLIENTS[0], redirects: [{ redirectUri: REDIRECT_URI, silentFrameAncestor: 'https://client.example.com/path' }] }],
			[CLIENTS[0], CLIENTS[0]],
			Array.from({ length: 33 }, (_, index) => ({ ...CLIENTS[0], clientId: `client-\${index}` })),
			[{ ...CLIENTS[0], redirects: Array.from({ length: 17 }, (_, index) => ({
				redirectUri: `https://client.example.com/callback-\${index}`,
				silentFrameAncestor: null,
			})) }],
		]) {
			expect((await putConfig(admin.cookie, 'clients', { revision: 0, clients })).status).toBe(400);
		}
		expect(await env.db.prepare(`
			SELECT oauth_provider_enabled AS enabled, oauth_provider_revision AS revision,
				oauth_provider_clients AS clients FROM setting
		`).first()).toEqual(invalidBefore);

		const savedClients = await putConfig(admin.cookie, 'clients', { revision: 0, clients: CLIENTS });
		expect(savedClients.status).toBe(200);
		const first = (await savedClients.json()).data;
		expect(first).toMatchObject({ enabled: false, revision: 1, clients: CLIENTS });

		const stale = await putConfig(admin.cookie, 'enabled', { enabled: true, revision: 0 });
		expect(stale.status).toBe(409);
		const enabled = await putConfig(admin.cookie, 'enabled', { enabled: true, revision: 1 });
		expect(enabled.status).toBe(200);
		const enabledData = (await enabled.json()).data;
		expect(enabledData).toMatchObject({ enabled: true, revision: 2, clients: CLIENTS });

		const emptyWhileEnabled = await putConfig(admin.cookie, 'clients', { revision: 2, clients: [] });
		expect(emptyWhileEnabled.status).toBe(400);

		const off = await putConfig(admin.cookie, 'enabled', { enabled: false, revision: 2 });
		const offData = (await off.json()).data;
		expect(offData).toMatchObject({ enabled: false, revision: 3, clients: CLIENTS });
		const editedClients = [{ ...CLIENTS[0], displayName: 'Renamed Client' }];
		const edited = await putConfig(admin.cookie, 'clients', { revision: 3, clients: editedClients });
		expect(edited.status).toBe(200);
		const onAgain = await putConfig(admin.cookie, 'enabled', { enabled: true, revision: 4 });
		const onAgainData = (await onAgain.json()).data;
		expect(onAgainData).toMatchObject({
			enabled: true,
			revision: 5,
			issuerReady: true,
			secretReady: true,
			clients: editedClients,
		});
		const offAgain = await putConfig(admin.cookie, 'enabled', { enabled: false, revision: 5 });
		expect((await offAgain.json()).data).toMatchObject({
			enabled: false,
			revision: 6,
			clients: editedClients,
		});
	});

	it('keeps old codes and tokens valid across disable, but rechecks the current client and redirect', async () => {
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const user = await login(MEMBER_EMAIL, MEMBER_PASSWORD);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: true, revision: 6 })).status).toBe(200);

		const displayNameCode = await issueCode(user.oauthCookie);
		expect(displayNameCode.response.status).toBe(302);
		const renamedClients = [{ ...CLIENTS[0], displayName: 'Display Name Only' }];
		expect((await putConfig(admin.cookie, 'clients', { revision: 7, clients: renamedClients })).status).toBe(200);
		const afterDisplayRename = await exchangeCode(displayNameCode.code, displayNameCode.verifier);
		expect(afterDisplayRename.status).toBe(200);

		const issued = await issueCode(user.oauthCookie);
		expect(issued.response.status).toBe(302);
		expect(issued.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: false, revision: 8 })).status).toBe(200);

		const disabledAuthorize = await issueCode(user.oauthCookie);
		expect(disabledAuthorize.response.status).toBe(403);
		expect(disabledAuthorize.response.headers.get('location')).toBeNull();
		expect(await disabledAuthorize.response.json()).toEqual({ error: 'authorization_disabled' });

		const tokenResponse = await exchangeCode(issued.code, issued.verifier);
		expect(tokenResponse.status).toBe(200);
		const token = await tokenResponse.json();
		const infoBeforeRemoval = await request('/oauth/userinfo', {
			headers: { Authorization: `Bearer ${token.access_token}` },
		});
		expect(infoBeforeRemoval.status).toBe(200);

		expect((await putConfig(admin.cookie, 'clients', { revision: 9, clients: [] })).status).toBe(200);
		const infoAfterRemoval = await request('/oauth/userinfo', {
			headers: { Authorization: `Bearer ${token.access_token}` },
		});
		expect(infoAfterRemoval.status).toBe(200);

		expect((await putConfig(admin.cookie, 'clients', { revision: 10, clients: CLIENTS })).status).toBe(200);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: true, revision: 11 })).status).toBe(200);
		const removedClientCode = await issueCode(user.oauthCookie);
		expect(removedClientCode.response.status).toBe(302);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: false, revision: 12 })).status).toBe(200);
		expect((await putConfig(admin.cookie, 'clients', { revision: 13, clients: [] })).status).toBe(200);
		const rejectedRemovedClient = await exchangeCode(removedClientCode.code, removedClientCode.verifier);
		expect(rejectedRemovedClient.status).toBe(401);
		expect(await rejectedRemovedClient.json()).toEqual({ error: 'invalid_client' });

		expect((await putConfig(admin.cookie, 'clients', { revision: 14, clients: CLIENTS })).status).toBe(200);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: true, revision: 15 })).status).toBe(200);
		const disabledClientCode = await issueCode(user.oauthCookie);
		expect(disabledClientCode.response.status).toBe(302);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: false, revision: 16 })).status).toBe(200);
		const disabledClients = [{ ...CLIENTS[0], enabled: false }];
		expect((await putConfig(admin.cookie, 'clients', { revision: 17, clients: disabledClients })).status).toBe(200);
		const rejectedDisabledClient = await exchangeCode(disabledClientCode.code, disabledClientCode.verifier);
		expect(rejectedDisabledClient.status).toBe(401);
		expect(await rejectedDisabledClient.json()).toEqual({ error: 'invalid_client' });

		expect((await putConfig(admin.cookie, 'clients', { revision: 18, clients: CLIENTS })).status).toBe(200);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: true, revision: 19 })).status).toBe(200);
		const changedRedirectCode = await issueCode(user.oauthCookie);
		expect(changedRedirectCode.response.status).toBe(302);
		expect((await putConfig(admin.cookie, 'enabled', { enabled: false, revision: 20 })).status).toBe(200);
		const changed = [{
			...CLIENTS[0],
			redirects: [{ redirectUri: 'https://client.example.com/new-callback', silentFrameAncestor: null }],
		}];
		expect((await putConfig(admin.cookie, 'clients', { revision: 21, clients: changed })).status).toBe(200);
		const rejectedChangedRedirect = await exchangeCode(changedRedirectCode.code, changedRedirectCode.verifier);
		expect(rejectedChangedRedirect.status).toBe(401);
		expect(await rejectedChangedRedirect.json()).toEqual({ error: 'invalid_client' });
	});

	it('rejects unready enable and oversized or extra-field bodies without changing D1', async () => {
		const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
		const before = await env.db.prepare(`
			SELECT oauth_provider_enabled AS enabled, oauth_provider_revision AS revision,
				oauth_provider_clients AS clients FROM setting
		`).first();
		const extra = await putConfig(admin.cookie, 'enabled', {
			enabled: true,
			revision: before.revision,
			clients: [],
		});
		expect(extra.status).toBe(400);
		await env.db.prepare(`
			UPDATE runtime_config SET oauth_issuer = '', oauth_secret = '' WHERE id = 1
		`).run();
		const noIssuer = await putConfig(admin.cookie, 'enabled', {
			enabled: true,
			revision: before.revision,
		}, { requestEnv: runtimeEnv });
		expect(noIssuer.status).toBe(400);

		const pathIssuerEnv = { ...runtimeEnv, FLAREMAIL_OAUTH_ISSUER: 'https://mail.example.com/tenant' };
		const pathStatus = await getConfig(admin.cookie, pathIssuerEnv);
		expect(pathStatus.response.status).toBe(200);
		expect(pathStatus.body.data.issuerReady).toBe(false);
		const pathEnable = await putConfig(admin.cookie, 'enabled', {
			enabled: true,
			revision: before.revision,
		}, { requestEnv: pathIssuerEnv });
		expect(pathEnable.status).toBe(400);
		const pathMetadata = await request('/.well-known/oauth-authorization-server', {}, pathIssuerEnv);
		expect(await pathMetadata.json()).toEqual({
			provider_enabled: false,
			issuer_ready: false,
			secret_ready: false,
			configuration_ready: true,
		});

		const huge = await putConfig(admin.cookie, 'clients', {
			revision: before.revision,
			clients: [{ ...CLIENTS[0], displayName: 'x'.repeat(66 * 1024) }],
		});
		expect(huge.status).toBe(413);
		expect(await env.db.prepare(`
			SELECT oauth_provider_enabled AS enabled, oauth_provider_revision AS revision,
				oauth_provider_clients AS clients FROM setting
		`).first()).toEqual(before);
	});
});
