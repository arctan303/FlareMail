import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import cryptoUtils from '../src/utils/crypto-utils';
import KvConst from '../src/const/kv-const';
import { markInstalled } from './installed-instance';

const ADMIN_PASSWORD = 'brand-admin-password';
const MEMBER_PASSWORD = 'brand-member-password';

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
}

async function login(email, password, runtimeEnv = env) {
	const response = await request('/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
		body: JSON.stringify({ email, password }),
	}, { ...runtimeEnv, LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) } });
	const cookie = (response.headers.get('set-cookie') || '').match(/mail_session_dev=([^;,]+)/)?.[1];
	expect(response.status).toBe(200);
	return `mail_session_dev=${cookie}`;
}

function pngFile(name, width, height, { type = 'image/png', signature = true } = {}) {
	const bytes = new Uint8Array(32);
	if (signature) bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return new File([bytes], name, { type });
}

async function saveBrand(cookie, body) {
	return request('/api/setting/set', {
		method: 'PUT',
		headers: { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

beforeAll(async () => {
	await dbInit.migrate(context());
	await markInstalled(env);
	await createUser(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD, true);
	await createUser('brand-member@example.com', MEMBER_PASSWORD);
});

describe.sequential('site branding backend', () => {
	it('registers marker 319 and serves the supported default brand projection', async () => {
		expect(await dbInit.v3_19Applied(context())).toBe(true);
		expect((await env.db.prepare('SELECT version FROM schema_migrations WHERE version = 319').first()).version).toBe(319);

		const response = await request('/api/setting/websiteConfig');
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const data = (await response.json()).data;
		expect(data).toMatchObject({
			title: 'FlareMail',
			autoRefresh: 0,
			send: 0,
			domainList: ['@example.com'],
			loginDomain: 0,
			siteDescription: 'A private mailbox for your domain.',
			logoUrl: '/mail-logo.svg',
			faviconUrl: '/favicon.svg',
			manifestUrl: '/manifest.webmanifest',
		});
		expect(data.loginCopy).toMatchObject({ subtitle: 'Private mailbox', footerText: 'FlareMail' });
		for (const privateField of ['secretKey', 'resendTokens', 'googleClientSecret', 'sitePwaIcons', 'storageType', 'projectLink', 'siteLinks', 'links']) {
			expect(data).not.toHaveProperty(privateField);
		}
	});

	it('reads public branding from D1 instead of a stale general-setting cache', async () => {
		const cached = JSON.parse(await env.kv.get(KvConst.SETTING));
		await env.kv.put(KvConst.SETTING, JSON.stringify({ ...cached, title: 'Stale cache title' }));
		await env.db.prepare("UPDATE setting SET title = 'D1 brand title'").run();
		const data = (await (await request('/api/setting/websiteConfig')).json()).data;
		expect(data.title).toBe('D1 brand title');
	});

	it('overlays administrator setting reads with current D1 brand values', async () => {
		const cached = JSON.parse(await env.kv.get(KvConst.SETTING));
		await env.kv.put(KvConst.SETTING, JSON.stringify({
			...cached,
			title: 'Stale admin title',
			siteDescription: 'Stale admin description',
			siteLinks: [{ label: 'Stale', url: 'https://stale.example/' }],
			projectLink: true,
			links: [{ label: 'Stale public', url: 'https://stale.example/public' }],
		}));
		await env.db.prepare(`
			UPDATE setting SET title = ?, site_description = ?, site_links = ?
		`).bind('Current admin title', 'Current admin description', '[{"label":"Current","url":"https://current.example/"}]').run();

		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const response = await request('/api/setting/query', { headers: { Cookie: cookie } }, {
			...env,
			FLAREMAIL_DOMAINS: ['example.com'],
		});
		expect(response.status, await response.clone().text()).toBe(200);
		const data = (await response.json()).data;
		expect(data.title).toBe('Current admin title');
		expect(data.siteDescription).toBe('Current admin description');
		const publicData = (await (await request('/api/setting/websiteConfig')).json()).data;
		for (const field of ['siteLinks', 'projectLink', 'links']) {
			expect(data).not.toHaveProperty(field);
			expect(publicData).not.toHaveProperty(field);
		}
		expect((await env.db.prepare('SELECT site_links FROM setting').first()).site_links)
			.toBe('[{"label":"Current","url":"https://current.example/"}]');
	});
	it('allows only the administrator to save validated brand fields', async () => {
		const memberCookie = await login('brand-member@example.com', MEMBER_PASSWORD);
		expect((await saveBrand(memberCookie, { title: 'Member brand' })).status).toBe(403);

		const adminCookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const response = await saveBrand(adminCookie, {
			title: 'Personal Mail',
			siteDescription: 'Mail for my domain',
			siteLogo: 'https://assets.example.com/logo.webp',
			siteFavicon: 'https://assets.example.com/icon.png',
			sitePwaIcons: { url: { src: 'https://assets.example.com/icon.png', width: 384, height: 384 } },
			loginCopy: { subtitle: 'My mailbox', slogan: 'Mail,\nunder my control.' },
		});
		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({
			title: 'Personal Mail',
			logoUrl: 'https://assets.example.com/logo.webp',
			faviconUrl: 'https://assets.example.com/icon.png',
		});
		const row = await env.db.prepare('SELECT site_pwa_icons AS icons, login_copy AS loginCopy FROM setting').first();
		expect(JSON.parse(row.icons).url.width).toBe(384);
		expect(JSON.parse(row.loginCopy).subtitle).toBe('My mailbox');
	});

	it('rejects invalid URLs, forged upload paths and partial favicon metadata without changing D1', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const before = await env.db.prepare('SELECT title, site_logo AS logo, site_favicon AS favicon, site_links AS links FROM setting').first();
		for (const body of [
			{ siteLogo: 'javascript:alert(1)' },
			{ siteLogo: '/api/site-assets/brand/00000000-0000-4000-8000-000000000000/logo.png' },
			{ siteFavicon: 'https://assets.example.com/icon.png' },
			{ siteFavicon: 'https://assets.example.com/icon.png', sitePwaIcons: { url: { src: 'https://other.example/icon.png', width: 192, height: 192 } } },
			{ siteLinks: [{ label: 'Previously valid', url: 'https://example.com/' }] },
			{ projectLink: true },
			{ links: [] },
			{ title: 'Must not save partial brand', siteLinks: [] },
			{ loginCopy: { unknown: 'field' } },
		]) {
			expect((await saveBrand(cookie, body)).status).toBe(400);
		}
		expect(await env.db.prepare('SELECT title, site_logo AS logo, site_favicon AS favicon, site_links AS links FROM setting').first()).toEqual(before);
	});

	it('serves a stable dynamic manifest with real URL-icon dimensions and ETag revalidation', async () => {
		const first = await request('/manifest.webmanifest');
		expect(first.status).toBe(200);
		expect(first.headers.get('content-type')).toContain('application/manifest+json');
		expect(first.headers.get('cache-control')).toBe('no-cache');
		const etag = first.headers.get('etag');
		const manifest = await first.json();
		expect(manifest).toMatchObject({
			id: '/', start_url: '/', scope: '/', name: 'Personal Mail', short_name: 'Personal Mail',
			description: 'Mail for my domain', display: 'standalone',
		});
		expect(manifest.icons).toEqual([{
			src: 'https://assets.example.com/icon.png', sizes: '384x384', type: 'image/png',
		}]);
		const unchanged = await request('/manifest.webmanifest', { headers: { 'If-None-Match': etag } });
		expect(unchanged.status).toBe(304);
	});

	it('uploads and anonymously serves logo assets without exposing attachment keys', async () => {
		const memberCookie = await login('brand-member@example.com', MEMBER_PASSWORD);
		const memberForm = new FormData();
		memberForm.set('type', 'logo');
		memberForm.set('file', pngFile('logo.png', 200, 100));
		expect((await request('/api/setting/brand-assets', {
			method: 'POST', headers: { Cookie: memberCookie, Origin: 'http://localhost' }, body: memberForm,
		})).status).toBe(403);

		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const form = new FormData();
		form.set('type', 'logo');
		form.set('file', pngFile('logo.png', 200, 100));
		const upload = await request('/api/setting/brand-assets', {
			method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' }, body: form,
		}, { ...env, BRAND_ASSET_RATE_LIMITER: { limit: async () => ({ success: true }) } });
		expect(upload.status).toBe(200);
		const path = (await upload.json()).data.logoUrl;
		expect(path).toMatch(/^\/api\/site-assets\/brand\/[0-9a-f-]+\/logo\.png$/);
		const image = await request(path);
		expect(image.status).toBe(200);
		expect(image.headers.get('content-type')).toBe('image/png');
		expect(image.headers.get('cache-control')).toContain('immutable');
		expect((await request('/api/site-assets/brand/not-a-uuid/logo.png')).status).toBe(404);
		expect((await request('/api/site-assets/brand/00000000-0000-4000-8000-000000000000/attachments')).status).toBe(404);
	});

	it('keeps the previous logo when uploaded bytes fail validation', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const before = (await env.db.prepare('SELECT site_logo AS logo FROM setting').first()).logo;
		const form = new FormData();
		form.set('type', 'logo');
		form.set('file', pngFile('logo.png', 200, 100, { signature: false }));
		const response = await request('/api/setting/brand-assets', {
			method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' }, body: form,
		}, { ...env, BRAND_ASSET_RATE_LIMITER: { limit: async () => ({ success: true }) } });
		expect(response.status).toBe(400);
		expect((await env.db.prepare('SELECT site_logo AS logo FROM setting').first()).logo).toBe(before);
	});

	it('removes newly written objects when the setting update fails', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const before = (await env.r2.list({ prefix: 'site-assets/brand/' })).objects.map(item => item.key).sort();
		await env.db.prepare(`
			CREATE TRIGGER fail_brand_setting_update
			BEFORE UPDATE OF site_logo ON setting
			BEGIN
				SELECT RAISE(ABORT, 'injected brand setting failure');
			END
		`).run();
		try {
			const form = new FormData();
			form.set('type', 'logo');
			form.set('file', pngFile('logo.png', 80, 40));
			const response = await request('/api/setting/brand-assets', {
				method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' }, body: form,
			}, {
				...env,
				BRAND_ASSET_RATE_LIMITER: { limit: async () => ({ success: true }) },
			});
			expect(response.status).toBe(500);
			const after = (await env.r2.list({ prefix: 'site-assets/brand/' })).objects.map(item => item.key).sort();
			expect(after).toEqual(before);
		} finally {
			await env.db.prepare('DROP TRIGGER IF EXISTS fail_brand_setting_update').run();
		}
	});
	it('deletes a replaced uploaded logo without touching other brand objects', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const oldPath = (await env.db.prepare('SELECT site_logo AS logo FROM setting').first()).logo;
		expect(oldPath).toMatch(/^\/api\/site-assets\/brand\//);
		const oldKey = oldPath.replace('/api/', '');
		expect(await env.r2.get(oldKey)).not.toBeNull();

		const response = await saveBrand(cookie, { siteLogo: 'https://assets.example.com/replacement.webp' });
		expect(response.status).toBe(200);
		expect((await response.json()).data.logoUrl).toBe('https://assets.example.com/replacement.webp');
		expect(await env.r2.get(oldKey)).toBeNull();
	});
	it('stores uploaded favicon variants and returns only their real manifest sizes', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const form = new FormData();
		form.set('type', 'favicon');
		form.set('icon192', pngFile('favicon-192.png', 192, 192));
		form.set('icon512', pngFile('favicon-512.png', 512, 512));
		const response = await request('/api/setting/brand-assets', {
			method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' }, body: form,
		}, { ...env, BRAND_ASSET_RATE_LIMITER: { limit: async () => ({ success: true }) } });
		expect(response.status).toBe(200);
		const favicon = (await response.json()).data.faviconUrl;
		expect(favicon).toContain('/favicon-192.png');
		const manifest = await (await request('/manifest.webmanifest')).json();
		expect(manifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512']);
		expect(manifest.icons.every(icon => icon.src.startsWith('/api/site-assets/brand/'))).toBe(true);
	});

	it('switches uploaded favicon metadata to URL mode and cleans both old variants', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const before = await env.db.prepare('SELECT site_pwa_icons AS icons FROM setting').first();
		const oldIcons = JSON.parse(before.icons);
		expect(await env.r2.get(oldIcons.icon192.replace('/api/', ''))).not.toBeNull();
		expect(await env.r2.get(oldIcons.icon512.replace('/api/', ''))).not.toBeNull();

		const response = await saveBrand(cookie, {
			siteFavicon: 'https://assets.example.com/new-icon.webp',
			sitePwaIcons: {
				url: { src: 'https://assets.example.com/new-icon.webp', width: 640, height: 640 },
			},
		});
		expect(response.status).toBe(200);
		const saved = await env.db.prepare('SELECT site_favicon AS favicon, site_pwa_icons AS icons FROM setting').first();
		expect(saved.favicon).toBe('https://assets.example.com/new-icon.webp');
		expect(JSON.parse(saved.icons)).toEqual({
			url: { src: 'https://assets.example.com/new-icon.webp', width: 640, height: 640 },
		});
		expect(await env.r2.get(oldIcons.icon192.replace('/api/', ''))).toBeNull();
		expect(await env.r2.get(oldIcons.icon512.replace('/api/', ''))).toBeNull();
		const manifest = await (await request('/manifest.webmanifest')).json();
		expect(manifest.icons).toEqual([{
			src: 'https://assets.example.com/new-icon.webp', sizes: '640x640', type: 'image/webp',
		}]);
	});
	it('supports the existing KV object fallback for public brand assets', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		const runtimeEnv = {
			...env,
			r2: undefined,
			BRAND_ASSET_RATE_LIMITER: { limit: async () => ({ success: true }) },
		};
		const form = new FormData();
		form.set('type', 'logo');
		form.set('file', pngFile('logo.png', 64, 64));
		const response = await request('/api/setting/brand-assets', {
			method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' }, body: form,
		}, runtimeEnv);
		expect(response.status).toBe(200);
		const path = (await response.json()).data.logoUrl;
		expect((await request(path, {}, runtimeEnv)).status).toBe(200);
		const key = path.replace('/api/', '');
		expect((await env.kv.get(key, { type: 'arrayBuffer' })).byteLength).toBeGreaterThan(0);
	});

	it('serves the built-in sign-in card copy in the visitor language', async () => {
		// cardTitle / cardSubtitle are the only built-in defaults that follow the language.
		// The rest stay English on purpose: the built-in copy is the deployer's voice, and
		// only the deployer's own overrides are meant to reach visitors.
		await env.db.prepare("UPDATE setting SET login_copy = '{}'").run();

		const english = (await (await request('/api/setting/websiteConfig', {
			headers: { 'Accept-Language': 'en-US,en;q=0.9' },
		})).json()).data.loginCopy;
		expect(english).toMatchObject({ cardTitle: 'Sign in', subtitle: 'Private mailbox' });
		expect(english.cardSubtitle).not.toMatch(/[\u4e00-\u9fff]/);

		const chinese = (await (await request('/api/setting/websiteConfig', {
			headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
		})).json()).data.loginCopy;
		expect(chinese).toMatchObject({ cardTitle: '登录服务', cardSubtitle: '轻启一扇窗，静候每封来信' });
		// Only those two fields differ between the two responses.
		for (const key of Object.keys(english)) {
			if (!['cardTitle', 'cardSubtitle'].includes(key)) expect(chinese[key]).toBe(english[key]);
		}
	});

	it('never overrides copy the deployer saved, whatever the visitor language is', async () => {
		const cookie = await login(env.FLAREMAIL_ADMIN_EMAIL, ADMIN_PASSWORD);
		expect((await saveBrand(cookie, { loginCopy: { cardTitle: 'Acme sign in' } })).status).toBe(200);
		for (const accept of ['en-US', 'zh-CN']) {
			const data = (await (await request('/api/setting/websiteConfig', { headers: { 'Accept-Language': accept } })).json()).data;
			expect(data.loginCopy.cardTitle).toBe('Acme sign in');
			expect(data.loginCopy.subtitle).toBe('Private mailbox');
		}
		await env.db.prepare("UPDATE setting SET login_copy = '{}'").run();
	});

});
