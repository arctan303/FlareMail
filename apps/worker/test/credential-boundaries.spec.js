import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import constant from '../src/const/constant';
import userService from '../src/service/user-service';
import oauthService from '../src/service/oauth-service';
import sessionService from '../src/service/session-service';
import loginService from '../src/service/login-service';
import { markInstalled } from './installed-instance';

const PASSWORD = 'credential boundary original password';
const REDIRECT = 'https://app.example.com/auth/callback';
const SECRET = 'credential-boundary-provider-secret';
const runtime = {
	...env,
	LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_AUTHORIZE_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_TOKEN_RATE_LIMITER: { limit: async () => ({ success: true }) },
	OAUTH_USERINFO_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

function context(requestEnv = env) {
	const values = new Map();
	return { env: requestEnv, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, options = {}, requestEnv = runtime) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request(`https://mail.example.com${path}`, options), requestEnv, execution);
	await waitOnExecutionContext(execution);
	return response;
}

async function login(email) {
	const response = await request('/api/login', {
		method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://mail.example.com' },
		body: JSON.stringify({ email, password: PASSWORD }),
	});
	expect(response.status).toBe(200);
	const token = response.headers.get('set-cookie').match(/__Host-mail_session=([^;,]+)/)[1];
	return { cookie: `__Host-mail_session=${token}`, oauthCookie: `__Host-mail_oauth_session=${token}`, hash: await cryptoUtils.hashSecret(token) };
}

async function fixture({ googleSub = '', legacy = false } = {}) {
	const email = `credential-boundary-${crypto.randomUUID()}@example.com`;
	const material = legacy
		? { salt: 'boundary-legacy-salt', hash: await cryptoUtils.genHashPassword(PASSWORD, 'boundary-legacy-salt') }
		: await cryptoUtils.hashPassword(PASSWORD);
	const inserted = await env.db.prepare('INSERT INTO user(email,password,salt,google_sub) VALUES (?,?,?,?) RETURNING user_id AS userId')
		.bind(email, material.hash, material.salt, googleSub).first();
	await env.db.prepare('INSERT INTO account(email,user_id) VALUES (?,?)').bind(email, inserted.userId).run();
	return { ...inserted, email, googleSub, material };
}

async function resolved(login) {
	return sessionService.resolveByHash({ env }, login.hash);
}

async function bind(f, login, sub, requestEnv = env, snapshot = null) {
	const session = await resolved(login);
	return oauthService.bind({ env: requestEnv }, f.userId, sub, `${sub}@gmail.com`, session, snapshot);
}

async function serviceRequest(handler, requestEnv = env) {
	const app = new Hono();
	app.onError(error => { throw error; });
	app.get('/', async c => { await handler(c); return c.json({ ok: true }); });
	return app.fetch(new Request('https://mail.example.com/'), requestEnv);
}

function interceptDatabase(predicate, action, after = false) {
	return {
		prepare(sql) {
			const statement = env.db.prepare(sql);
			return {
				bind(...values) {
					const bound = statement.bind(...values);
					return new Proxy(bound, {
						get(target, name) {
							if (typeof target[name] !== 'function') return target[name];
							return async (...args) => {
								const inject = predicate(sql, values, name);
								if (inject && !after) await action();
								const result = await target[name](...args);
								if (inject && after) await action();
								return result;
							};
						},
					});
				},
				all: (...args) => statement.all(...args),
				first: (...args) => statement.first(...args),
				run: (...args) => statement.run(...args),
			};
		},
		batch: (...args) => env.db.batch(...args),
	};
}

async function issue(login, requestEnv = runtime) {
	const query = new URLSearchParams({ response_type: 'code', client_id: 'boundary', redirect_uri: REDIRECT,
		state: crypto.randomUUID(), code_challenge: await cryptoUtils.hashSecret('v'.repeat(43)), code_challenge_method: 'S256' });
	const response = await request(`/oauth/authorize?${query}`, { headers: { Cookie: login.oauthCookie } }, requestEnv);
	return new URL(response.headers.get('location'));
}

async function redeem(code, requestEnv = runtime) {
	return request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'boundary', redirect_uri: REDIRECT,
			client_secret: SECRET, code, code_verifier: 'v'.repeat(43) }) }, requestEnv);
}

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env);
	await env.db.prepare('UPDATE runtime_config SET oauth_issuer = ?, oauth_secret = ? WHERE id = 1').bind('https://mail.example.com', SECRET).run();
	await env.db.prepare('UPDATE setting SET oauth_provider_enabled = 1, oauth_provider_clients = ?')
		.bind(JSON.stringify([{ clientId: 'boundary', enabled: true, displayName: 'Boundary', redirects: [{ redirectUri: REDIRECT, silentFrameAncestor: null }] }])).run();
});

describe.sequential('Google replacement browser session boundary', () => {
	it('preserves all sessions on first bind and identical rebind, then only the initiating old session on replacement', async () => {
		const f = await fixture(); const initiator = await login(f.email); const passwordSession = await login(f.email);
		await bind(f, initiator, `google-a-${f.userId}`);
		expect(await resolved(passwordSession)).not.toBeNull();
		await bind(f, initiator, `google-a-${f.userId}`);
		expect(await resolved(passwordSession)).not.toBeNull();
		let googleLogin;
		await serviceRequest(async c => { googleLogin = await oauthService.loginByGoogleSub(c, `google-a-${f.userId}`); });
		expect(googleLogin).toBe(f.userId);
		const before = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		const googleHash = before.sessions.at(-1).hash;
		await bind(f, initiator, `google-b-${f.userId}`);
		expect(await resolved(initiator)).not.toBeNull();
		expect(await resolved(passwordSession)).toBeNull();
		expect(await sessionService.resolveByHash({ env }, googleHash)).toBeNull();
		expect((await request('/api/my/loginUserInfo', { headers: { Cookie: initiator.cookie } })).status).toBe(200);
		expect((await request('/api/my/loginUserInfo', { headers: { Cookie: passwordSession.cookie } })).status).toBe(401);
		expect(await resolved(await login(f.email))).not.toBeNull();
	});

	it('does not write the index during replacement and rejects old sessions when individual KV cleanup fails', async () => {
		for (const failure of ['index', 'records']) {
			const f = await fixture({ googleSub: `cleanup-a-${failure}` });
			const initiator = await login(f.email); const other = await login(f.email);
			const requestEnv = { ...env, kv: {
				get: (...args) => env.kv.get(...args),
				put: async (key, ...args) => { if (failure === 'index' && key === KvConst.AUTH_INFO + f.userId) throw new Error('index write interrupted'); return env.kv.put(key, ...args); },
				delete: async key => { if (failure === 'records' && key.startsWith(KvConst.SESSION)) throw new Error('cleanup interrupted'); return env.kv.delete(key); },
			} };
			if (failure === 'index') await bind(f, initiator, `cleanup-b-${failure}`, requestEnv);
			else await expect(bind(f, initiator, `cleanup-b-${failure}`, requestEnv)).rejects.toThrow('interrupted');
			expect(await resolved(initiator)).not.toBeNull();
			expect(await resolved(other)).toBeNull();
		}
	});

	it('rejects a stale Google authentication snapshot even after A to B to A', async () => {
		const f = await fixture({ googleSub: 'aba-original' }); const initiator = await login(f.email);
		const update = userService.updateUserInfo.bind(userService);
		const hook = vi.spyOn(userService, 'updateUserInfo').mockImplementationOnce(async (c, userId) => {
			await bind(f, initiator, 'aba-replacement'); await bind(f, initiator, 'aba-original');
			return update(c, userId);
		});
		try {
			await expect(serviceRequest(c => oauthService.loginByGoogleSub(c, 'aba-original'))).rejects.toMatchObject({ code: 401 });
			expect(await resolved(initiator)).not.toBeNull();
		} finally { hook.mockRestore(); }
	});

	it('rejects late session KV writes after replacement instead of upgrading their epoch', async () => {
		const f = await fixture({ googleSub: 'late-write-a' }); const initiator = await login(f.email);
		const snapshot = await userService.selectByIdIncludeDel({ env }, f.userId);
		let injected = false;
		const requestEnv = { ...env, kv: { get: (...args) => env.kv.get(...args), delete: (...args) => env.kv.delete(...args),
			put: async (key, ...args) => {
				if (!injected && key.startsWith(KvConst.SESSION)) { injected = true; await bind(f, initiator, 'late-write-b'); }
				return env.kv.put(key, ...args);
			} } };
		let created;
		await serviceRequest(async c => { created = await sessionService.create(c, f.userId, await cryptoUtils.hashSecret(snapshot.password), snapshot); }, requestEnv);
		expect(injected).toBe(true);
		expect(await sessionService.resolveByHash({ env }, created.hash)).toBeNull();
		expect(await resolved(initiator)).not.toBeNull();
	});

	it('rejects a second transaction made before a replacement and a delayed unbound transaction', async () => {
		for (const startingSub of ['', 'two-states-a']) {
			const f = await fixture({ googleSub: startingSub }); const initiator = await login(f.email);
			let state;
			await serviceRequest(async c => { state = await oauthService.issueState(c, '/oauth/bind/callback', f.userId, initiator.hash); });
			const record = await env.kv.get(KvConst.OAUTH_STATE + state.state, { type: 'json' });
			await bind(f, initiator, `two-states-b-${f.userId}`);
			await expect(bind(f, initiator, `two-states-c-${f.userId}`, env, record)).rejects.toMatchObject({ code: 428 });
			expect((await userService.selectByIdIncludeDel({ env }, f.userId)).googleSub).toBe(`two-states-b-${f.userId}`);
		}
	});

	it('keeps a session legitimately created after replacement while pruning the old index', async () => {
		const f = await fixture({ googleSub: 'new-session-a' }); const initiator = await login(f.email); const old = await login(f.email);
		const prune = sessionService.revokeOthers.bind(sessionService); let newSession;
		const hook = vi.spyOn(sessionService, 'revokeOthers').mockImplementationOnce(async (c, userId, hash) => {
			newSession = await login(f.email); return prune(c, userId, hash);
		});
		try { await bind(f, initiator, 'new-session-b'); }
		finally { hook.mockRestore(); }
		expect(await resolved(initiator)).not.toBeNull(); expect(await resolved(old)).toBeNull(); expect(await resolved(newSession)).not.toBeNull();
	});

	it('uses binding CAS to reject another replacement after the validated user snapshot', async () => {
		const f = await fixture({ googleSub: 'cas-original' }); const initiator = await login(f.email);
		const original = userService.selectByGoogleSubIncludeDel.bind(userService);
		const hook = vi.spyOn(userService, 'selectByGoogleSubIncludeDel').mockImplementationOnce(async (c, sub) => {
			const snapshot = await userService.selectByIdIncludeDel({ env }, f.userId);
			await userService.updateGoogleBinding({ env }, f.userId, 'cas-winner', 'winner@gmail.com', snapshot.password, snapshot, initiator.hash);
			return original(c, sub);
		});
		try { await expect(bind(f, initiator, 'cas-loser')).rejects.toMatchObject({ code: 428 }); }
		finally { hook.mockRestore(); }
		expect((await userService.selectByIdIncludeDel({ env }, f.userId)).googleSub).toBe('cas-winner');
		expect(await resolved(initiator)).not.toBeNull();
	});

	it('accepts epoch-less legacy sessions before replacement and revokes the others afterward', async () => {
		const f = await fixture({ googleSub: 'legacy-session-a' }); const initiator = await login(f.email); const old = await login(f.email);
		for (const session of [initiator, old]) {
			const row = await env.kv.get(KvConst.SESSION + session.hash, { type: 'json' }); delete row.sessionEpoch;
			await env.kv.put(KvConst.SESSION + session.hash, JSON.stringify(row));
		}
		const index = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		for (const entry of index.sessions) delete entry.sessionEpoch;
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify(index));
		expect(await resolved(old)).not.toBeNull(); await bind(f, initiator, 'legacy-session-b');
		expect(await resolved(old)).toBeNull(); expect(await resolved(initiator)).not.toBeNull();
	});

	it('rejects an in-flight old Google login that writes its session after unlink revocation', async () => {
		const f = await fixture({ googleSub: 'unlink-race-before' }); const initiator = await login(f.email);
		const snapshot = await userService.selectByIdIncludeDel({ env }, f.userId); let injected = false; let created;
		const requestEnv = { ...env, kv: { get: (...args) => env.kv.get(...args), delete: (...args) => env.kv.delete(...args),
			put: async (key, ...args) => {
				if (!injected && key.startsWith(KvConst.SESSION)) { injected = true; await oauthService.unbind({ env }, f.userId); }
				return env.kv.put(key, ...args);
			} } };
		await serviceRequest(async c => { created = await sessionService.create(c, f.userId, await cryptoUtils.hashSecret(snapshot.password), { ...snapshot, googleLoginSub: snapshot.googleSub }); }, requestEnv);
		expect(await sessionService.resolveByHash({ env }, created.hash)).toBeNull();
		expect(await resolved(initiator)).toBeNull(); expect((await userService.selectByIdIncludeDel({ env }, f.userId)).googleSub).toBe('');
	});

	it('keeps a new login appended after cleanup reads the index but before its D1 read finishes', async () => {
		const f = await fixture({ googleSub: 'inside-prune-a' }); const initiator = await login(f.email); const old = await login(f.email);
		const prune = sessionService.revokeOthers.bind(sessionService); let fresh; let injected = false;
		const db = interceptDatabase(sql => !injected && sql === 'SELECT * FROM user WHERE user_id = ?', async () => {
			injected = true; fresh = await login(f.email);
		});
		const hook = vi.spyOn(sessionService, 'revokeOthers').mockImplementationOnce((c, userId, hash) => prune({ env: { ...env, db } }, userId, hash));
		try { await bind(f, initiator, 'inside-prune-b'); }
		finally { hook.mockRestore(); }
		expect(injected).toBe(true); expect(await resolved(fresh)).not.toBeNull(); expect(await resolved(initiator)).not.toBeNull(); expect(await resolved(old)).toBeNull();
		expect((await request('/api/my/loginUserInfo', { headers: { Cookie: fresh.cookie } })).status).toBe(200);
	});

	it('preserves the oldest of five sessions when a stale creation crosses replacement and cap eviction', async () => {
		const f = await fixture({ googleSub: 'oldest-cap-a' }); const initiator = await login(f.email);
		const old = [];
		for (let i = 0; i < 4; i++) old.push(await login(f.email));
		const snapshot = await userService.selectByIdIncludeDel({ env }, f.userId); let injected = false; let late;
		const requestEnv = { ...env, kv: { put: (...args) => env.kv.put(...args), delete: (...args) => env.kv.delete(...args),
			get: async (key, ...args) => {
				const value = await env.kv.get(key, ...args);
				if (!injected && key === KvConst.AUTH_INFO + f.userId) { injected = true; await bind(f, initiator, 'oldest-cap-b'); }
				return value;
			} } };
		await serviceRequest(async c => { late = await sessionService.create(c, f.userId, await cryptoUtils.hashSecret(snapshot.password), snapshot); }, requestEnv);
		expect((await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' })).sessions.some(item => item.hash === initiator.hash)).toBe(true);
		expect(await env.kv.get(KvConst.SESSION + initiator.hash)).not.toBeNull(); expect(await resolved(initiator)).not.toBeNull();
		expect(await sessionService.resolveByHash({ env }, late.hash)).toBeNull();
		for (const session of old) expect(await resolved(session)).toBeNull();
		const fresh = [];
		for (let i = 0; i < 6; i++) fresh.push(await login(f.email));
		const index = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		expect(index.sessions).toHaveLength(5); expect(index.sessions.some(item => item.hash === initiator.hash)).toBe(true);
		expect(await resolved(initiator)).not.toBeNull();
		expect((await Promise.all(fresh.map(resolved))).filter(Boolean)).toHaveLength(4);
	});

	it('logs out a retained session missing from the index before record cleanup and stale index restoration', async () => {
		const f = await fixture({ googleSub: 'lost-index-logout-a' }); const initiator = await login(f.email);
		await bind(f, initiator, 'lost-index-logout-b'); const fresh = await login(f.email);
		const stale = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify({ ...stale, sessions: stale.sessions.filter(item => item.hash !== initiator.hash) }));
		expect(await resolved(initiator)).not.toBeNull();
		const requestEnv = { ...runtime, kv: { get: (...args) => env.kv.get(...args), put: (...args) => env.kv.put(...args),
			delete: async key => { if (key === KvConst.SESSION + initiator.hash) throw new Error('retained record cleanup interrupted'); return env.kv.delete(key); } } };
		const response = await request('/api/logout', { method: 'DELETE', headers: { Cookie: initiator.cookie, Origin: 'https://mail.example.com' } }, requestEnv);
		expect(response.status).toBe(500); expect(await env.kv.get(KvConst.SESSION + initiator.hash)).not.toBeNull();
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify(stale));
		expect(await resolved(initiator)).toBeNull(); expect(await resolved(fresh)).not.toBeNull();
		expect((await userService.selectByIdIncludeDel({ env }, f.userId)).preservedSessionHash).toBe('');
	});

	it('counts only authorized current-epoch entries when late old writers leave a mixed five-entry index', async () => {
		const f = await fixture({ googleSub: 'mixed-index-a' }); const initiator = await login(f.email);
		const staleRows = [];
		for (let i = 0; i < 3; i++) staleRows.push(await login(f.email));
		const oldIndex = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		await bind(f, initiator, 'mixed-index-b'); const valid = await login(f.email);
		const currentIndex = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify({ version: 2, sessions: [
			oldIndex.sessions.find(item => item.hash === initiator.hash),
			currentIndex.sessions.find(item => item.hash === valid.hash),
			...staleRows.map(session => oldIndex.sessions.find(item => item.hash === session.hash)),
		] }));
		const fresh = await login(f.email); const finalIndex = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		expect(finalIndex.sessions).toHaveLength(3); expect(await resolved(valid)).not.toBeNull(); expect(await resolved(fresh)).not.toBeNull(); expect(await resolved(initiator)).not.toBeNull();
		for (const old of staleRows) expect(await resolved(old)).toBeNull();
	});

	it('does not let logged-out current-epoch metadata in a restored index evict a legitimate session early', async () => {
		const f = await fixture({ googleSub: 'denied-cap-a' }); const initiator = await login(f.email);
		await bind(f, initiator, 'denied-cap-b'); const valid = await login(f.email); const deniedRows = [];
		for (let i = 0; i < 3; i++) {
			const doomed = await login(f.email);
			deniedRows.push((await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' })).sessions.find(item => item.hash === doomed.hash));
			expect((await request('/api/logout', { method: 'DELETE', headers: { Cookie: doomed.cookie, Origin: 'https://mail.example.com' } })).status).toBe(200);
		}
		const current = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify({ version: 2, sessions: [
			current.sessions.find(item => item.hash === initiator.hash), current.sessions.find(item => item.hash === valid.hash), ...deniedRows,
		] }));
		const fresh = await login(f.email);
		expect((await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' })).sessions).toHaveLength(3);
		expect(await resolved(initiator)).not.toBeNull(); expect(await resolved(valid)).not.toBeNull(); expect(await resolved(fresh)).not.toBeNull();
		for (const row of deniedRows) expect(await sessionService.resolveByHash({ env }, row.hash)).toBeNull();
	});

	it.each(['index', 'records'])('all-session revocation clears retained D1 authority before %s cleanup fails', async failure => {
		const f = await fixture({ googleSub: `all-clear-a-${failure}` }); const initiator = await login(f.email);
		await bind(f, initiator, `all-clear-b-${failure}`);
		const stale = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify({ ...stale, sessions: [] }));
		const requestEnv = { ...env, kv: { get: (...args) => env.kv.get(...args), put: (...args) => env.kv.put(...args),
			delete: async key => {
				if ((failure === 'index' && key === KvConst.AUTH_INFO + f.userId) || (failure === 'records' && key === KvConst.SESSION + initiator.hash)) throw new Error('all-session cleanup interrupted');
				return env.kv.delete(key);
			} } };
		await expect(sessionService.revokeAll({ env: requestEnv }, f.userId)).rejects.toThrow('interrupted');
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify(stale));
		expect(await resolved(initiator)).toBeNull(); expect((await userService.selectByIdIncludeDel({ env }, f.userId)).preservedSessionHash).toBe('');
	});

	it.each([false, true])('rejects a validated %s retained binding callback when logout finishes D1 revocation but KV record cleanup fails', async alreadyRetained => {
		const f = await fixture({ googleSub: `logout-cas-a-${alreadyRetained}` }); const initiator = await login(f.email);
		if (alreadyRetained) await bind(f, initiator, `logout-cas-b-${alreadyRetained}`);
		const another = await login(f.email); const before = await userService.selectByIdIncludeDel({ env }, f.userId);
		const update = userService.updateGoogleBinding.bind(userService);
		const hook = vi.spyOn(userService, 'updateGoogleBinding').mockImplementationOnce(async (...args) => {
			const requestEnv = { ...runtime, kv: { get: (...values) => env.kv.get(...values), put: (...values) => env.kv.put(...values),
				delete: async key => { if (key === KvConst.SESSION + initiator.hash) throw new Error('logout record interrupted'); return env.kv.delete(key); } } };
			expect((await request('/api/logout', { method: 'DELETE', headers: { Cookie: initiator.cookie, Origin: 'https://mail.example.com' } }, requestEnv)).status).toBe(500);
			return update(...args);
		});
		try { await expect(bind(f, initiator, `logout-cas-c-${alreadyRetained}`)).rejects.toMatchObject({ code: 428 }); }
		finally { hook.mockRestore(); }
		const after = await userService.selectByIdIncludeDel({ env }, f.userId);
		expect(after.googleSub).toBe(before.googleSub); expect(after.preservedSessionHash).toBe('');
		expect(await env.db.prepare('SELECT session_hash FROM session_revocation WHERE session_hash = ?').bind(initiator.hash).first()).not.toBeNull();
		expect(await resolved(initiator)).toBeNull(); expect(await resolved(another)).not.toBeNull();
	});

	it.each(['', 'pending-same-sub'])('keeps another browser pending first-bind/same-sub transaction valid after unrelated logout (%s)', async googleSub => {
		const f = await fixture({ googleSub }); const initiator = await login(f.email); const another = await login(f.email); let state;
		await serviceRequest(async c => { state = await oauthService.issueState(c, '/oauth/bind/callback', f.userId, initiator.hash); });
		const record = await env.kv.get(KvConst.OAUTH_STATE + state.state, { type: 'json' });
		expect((await request('/api/logout', { method: 'DELETE', headers: { Cookie: another.cookie, Origin: 'https://mail.example.com' } })).status).toBe(200);
		await bind(f, initiator, googleSub || 'pending-first-new', env, record);
		expect(await resolved(initiator)).not.toBeNull(); expect(await resolved(another)).toBeNull();
	});

	it('blocks an ordinary logged-out session after cleanup failure and stale index restoration, including atomic keeper promotion', async () => {
		const f = await fixture({ googleSub: 'ordinary-deny-a' }); const initiator = await login(f.email); const another = await login(f.email);
		const captured = await userService.selectByIdIncludeDel({ env }, f.userId); const session = await resolved(initiator);
		const stale = await env.kv.get(KvConst.AUTH_INFO + f.userId, { type: 'json' });
		const requestEnv = { ...runtime, kv: { get: (...args) => env.kv.get(...args), put: (...args) => env.kv.put(...args),
			delete: async key => { if (key === KvConst.SESSION + initiator.hash) throw new Error('ordinary logout cleanup failed'); return env.kv.delete(key); } } };
		expect((await request('/api/logout', { method: 'DELETE', headers: { Cookie: initiator.cookie, Origin: 'https://mail.example.com' } }, requestEnv)).status).toBe(500);
		await env.kv.put(KvConst.AUTH_INFO + f.userId, JSON.stringify(stale));
		expect(await env.kv.get(KvConst.SESSION + initiator.hash)).not.toBeNull(); expect(await resolved(initiator)).toBeNull(); expect(await resolved(another)).not.toBeNull();
		await expect(oauthService.bind({ env }, f.userId, 'ordinary-deny-b', 'new@gmail.com', session)).rejects.toMatchObject({ code: 428 });
		await expect(userService.updateGoogleBinding({ env }, f.userId, 'ordinary-deny-b', 'new@gmail.com', captured.password, captured, initiator.hash, session.sessionEpoch)).rejects.toMatchObject({ code: 428 });
		expect((await userService.selectByIdIncludeDel({ env }, f.userId)).preservedSessionHash).toBe('');
	});

	it('expires deny markers independently while enforcing the original session lifetime even if KV records linger', async () => {
		const f = await fixture(); const ordinary = await login(f.email); const another = await login(f.email);
		await env.db.prepare('INSERT INTO session_revocation(session_hash,user_id,expires_at) VALUES (?,?,?)').bind(ordinary.hash, f.userId, Date.now() - 1).run();
		expect(await resolved(ordinary)).not.toBeNull();
		const row = await env.kv.get(KvConst.SESSION + ordinary.hash, { type: 'json' });
		row.createdAt = Date.now() - constant.TOKEN_EXPIRE * 1000 - 1;
		await env.kv.put(KvConst.SESSION + ordinary.hash, JSON.stringify(row), { expirationTtl: constant.TOKEN_EXPIRE });
		expect(await env.kv.get(KvConst.SESSION + ordinary.hash)).not.toBeNull(); expect(await resolved(ordinary)).toBeNull();
		const before = Date.now();
		expect((await request('/api/logout', { method: 'DELETE', headers: { Cookie: another.cookie, Origin: 'https://mail.example.com' } })).status).toBe(200);
		const deny = await env.db.prepare('SELECT expires_at FROM session_revocation WHERE session_hash = ?').bind(another.hash).first();
		expect(deny.expires_at).toBeGreaterThanOrEqual(before + constant.TOKEN_EXPIRE * 1000);
		expect(deny.expires_at).toBeLessThanOrEqual(Date.now() + constant.TOKEN_EXPIRE * 1000);
		expect(await env.db.prepare('SELECT session_hash FROM session_revocation WHERE session_hash = ?').bind(ordinary.hash).first()).toBeNull();
	});
});

describe.sequential('password changes invalidate unused OAuth grants', () => {
	it('deletes an unused code on password reset while leaving another user code redeemable', async () => {
		const f = await fixture(); const own = await login(f.email); const another = await fixture(); const other = await login(another.email);
		const oldCode = (await issue(own)).searchParams.get('code'); const otherCode = (await issue(other)).searchParams.get('code');
		await userService.resetPassword({ env }, { password: 'credential boundary replacement password' }, f.userId);
		const response = await redeem(oldCode); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'invalid_grant' });
		expect((await redeem(otherCode)).status).toBe(200);
	});

	it('does not insert a code after the password changes between session validation and INSERT', async () => {
		const f = await fixture(); const own = await login(f.email);
		const db = interceptDatabase(sql => sql.includes('INSERT INTO oauth_authorization_code'), () => userService.resetPassword({ env }, { password: 'issue race replacement password' }, f.userId));
		const callback = await issue(own, { ...runtime, db });
		expect(callback.searchParams.get('code')).toBeNull(); expect(callback.searchParams.get('error')).toBe('login_required');
		expect((await env.db.prepare('SELECT COUNT(*) AS total FROM oauth_authorization_code WHERE user_id = ?').bind(f.userId).first()).total).toBe(0);
	});

	it('rejects reset between grant validation and atomic consumption', async () => {
		const f = await fixture(); const own = await login(f.email); const code = (await issue(own)).searchParams.get('code');
		const db = interceptDatabase(sql => sql.includes('UPDATE oauth_authorization_code SET used_at'), () => userService.resetPassword({ env }, { password: 'consume race replacement password' }, f.userId));
		const response = await redeem(code, { ...runtime, db }); expect(response.status).toBe(400); expect((await response.json()).error).toBe('invalid_grant');
	});

	it('never gives a consumed grant the new password fingerprint when reset races token creation', async () => {
		const f = await fixture(); const own = await login(f.email); const code = (await issue(own)).searchParams.get('code');
		const db = interceptDatabase(sql => sql.includes('UPDATE oauth_authorization_code SET used_at'), () => userService.resetPassword({ env }, { password: 'post consume replacement password' }, f.userId), true);
		const response = await redeem(code, { ...runtime, db }); expect(response.status).toBe(200);
		const token = (await response.json()).access_token;
		expect((await request('/oauth/userinfo', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
	});

	it('invalidates unused grants atomically during legacy password hash upgrade, and preserves them if CAS loses', async () => {
		const f = await fixture({ legacy: true });
		const response = await serviceRequest(c => loginService.createLoginSession(c, { ...f, password: f.material.hash, isDel: 0, status: 0, sessionEpoch: 0 }));
		const legacy = { oauthCookie: `__Host-mail_oauth_session=${response.headers.get('set-cookie').match(/__Host-mail_session=([^;,]+)/)[1]}` };
		const code = (await issue(legacy)).searchParams.get('code');
		expect(await userService.upgradePasswordHash({ env }, f.userId, PASSWORD, 'wrong-old-hash', f.material.salt)).toBeNull();
		expect(await env.db.prepare('SELECT code_hash FROM oauth_authorization_code WHERE code_hash = ?').bind(await cryptoUtils.hashSecret(code)).first()).not.toBeNull();
		expect(await userService.upgradePasswordHash({ env }, f.userId, PASSWORD, f.material.hash, f.material.salt)).toBeTruthy();
		expect((await redeem(code)).status).toBe(400);
	});

	it('does not revoke codes just because the Provider is disabled', async () => {
		const f = await fixture(); const own = await login(f.email); const code = (await issue(own)).searchParams.get('code');
		await env.db.prepare('UPDATE setting SET oauth_provider_enabled = 0').run();
		try { expect((await redeem(code)).status).toBe(200); }
		finally { await env.db.prepare('UPDATE setting SET oauth_provider_enabled = 1').run(); }
	});

	it('rolls back password and code state together when grant invalidation fails', async () => {
		const f = await fixture(); const own = await login(f.email); const code = (await issue(own)).searchParams.get('code');
		const before = await userService.selectByIdIncludeDel({ env }, f.userId);
		const failing = { ...env, db: {
			prepare: (...args) => env.db.prepare(...args),
			batch: statements => env.db.batch([statements[0], env.db.prepare('DELETE FROM injected_nonexistent_grant_table')]),
		} };
		await expect(userService.resetPassword({ env: failing }, { password: 'failed atomic replacement password' }, f.userId)).rejects.toThrow();
		expect((await userService.selectByIdIncludeDel({ env }, f.userId)).password).toBe(before.password);
		expect(await resolved(own)).not.toBeNull(); expect((await redeem(code)).status).toBe(200);
	});

	it('rechecks grant expiry at the atomic consumption boundary', async () => {
		const f = await fixture(); const own = await login(f.email); const code = (await issue(own)).searchParams.get('code');
		const codeHash = await cryptoUtils.hashSecret(code);
		const expiryDb = interceptDatabase(sql => sql.includes('UPDATE oauth_authorization_code SET used_at'),
			() => env.db.prepare('UPDATE oauth_authorization_code SET expires_at = 0 WHERE code_hash = ?').bind(codeHash).run());
		expect((await redeem(code, { ...runtime, db: expiryDb })).status).toBe(400);
	});
});
