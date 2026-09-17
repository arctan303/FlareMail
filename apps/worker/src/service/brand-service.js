import managedDomainService from './managed-domain-service';
import runtimeConfigService from './runtime-config-service';
import BizError from '../error/biz-error';
import setting from '../entity/setting';
import orm from '../entity/orm';

// The built-in sign-in copy is English by design: it is the deployer's voice, and only
// the deployer's own overrides are meant to reach visitors. cardTitle / cardSubtitle were
// Chinese by accident, which put Chinese text on an otherwise English card for every
// deployment that never customised it, so those two follow the visitor's language.
const LOGIN_COPY_BASE = Object.freeze({
	subtitle: 'Private mailbox',
	slogan: 'Your mail,\nunder your control.',
	quoteLead: 'A private mailbox for your domain.',
	quoteBody: 'Use your own Cloudflare account and domain for a mailbox you control.',
	sealText: 'FM',
	footerText: 'FlareMail',
	stampText: 'Private mailbox',
});

const LOGIN_COPY_LOCALIZED = Object.freeze({
	zh: Object.freeze({
		cardTitle: '登录服务',
		cardSubtitle: '轻启一扇窗，静候每封来信',
	}),
	en: Object.freeze({
		cardTitle: 'Sign in',
		cardSubtitle: 'A quiet window, awaiting every letter',
	}),
});

const FALLBACK_LOCALE = 'zh';

const LOGIN_COPY_KEYS = Object.freeze([
	...Object.keys(LOGIN_COPY_BASE),
	...Object.keys(LOGIN_COPY_LOCALIZED[FALLBACK_LOCALE]),
]);

function loginCopyDefaults(locale) {
	return { ...LOGIN_COPY_BASE, ...(LOGIN_COPY_LOCALIZED[locale] || LOGIN_COPY_LOCALIZED[FALLBACK_LOCALE]) };
}

const DEFAULT_LOGIN_COPY = Object.freeze(loginCopyDefaults(FALLBACK_LOCALE));

// Read from the context the i18n middleware publishes, rather than importing that module
// (it imports the Hono app, so importing it back here would close a cycle).
function requestLocale(c) {
	return c?.get?.('locale') || '';
}

const DEFAULTS = Object.freeze({
	title: 'FlareMail',
	siteDescription: 'A private mailbox for your domain.',
	logoUrl: '/mail-logo.svg',
	faviconUrl: '/favicon.svg',
	loginCopy: DEFAULT_LOGIN_COPY,
	manifestUrl: '/manifest.webmanifest',
});

const DEFAULT_PWA_ICONS = Object.freeze([
	Object.freeze({ src: '/mail-pwa-192.png', sizes: '192x192', type: 'image/png' }),
	Object.freeze({ src: '/mail-pwa-512.png', sizes: '512x512', type: 'image/png' }),
]);

const LOGIN_LIMITS = Object.freeze({
	subtitle: 80,
	slogan: 160,
	quoteLead: 160,
	quoteBody: 500,
	sealText: 16,
	footerText: 80,
	stampText: 80,
	cardTitle: 40,
	cardSubtitle: 80,
});

const BRAND_FIELDS = Object.freeze([
	'title',
	'siteDescription',
	'siteLogo',
	'siteFavicon',
	'sitePwaIcons',
	'loginCopy',
]);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const BRAND_ASSET_PATTERN = new RegExp(`^/api/site-assets/brand/(${UUID})/(logo\\.(?:png|jpe?g|webp)|favicon-(?:192|512)\\.png)$`);

function codePointLength(value) {
	return Array.from(value).length;
}

function requireString(value, name, max, { allowEmpty = true } = {}) {
	if (typeof value !== 'string') throw new BizError(`Invalid ${name}.`);
	const normalized = value.trim();
	if (!allowEmpty && !normalized) throw new BizError(`Invalid ${name}.`);
	if (codePointLength(normalized) > max) throw new BizError(`${name} is too long.`);
	return normalized;
}

function validateHttpsUrl(value, name, { imageExtension = false } = {}) {
	const normalized = requireString(value, name, 2048, { allowEmpty: false });
	if (normalized !== value || /\s/.test(normalized)) throw new BizError(`Invalid ${name}.`);
	let parsed;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new BizError(`Invalid ${name}.`);
	}
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !parsed.hostname) {
		throw new BizError(`Invalid ${name}.`);
	}
	if (imageExtension && !/\.(?:png|jpe?g|webp)$/i.test(parsed.pathname)) {
		throw new BizError(`Invalid ${name} image extension.`);
	}
	return normalized;
}

function validateLoginCopy(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BizError('Invalid loginCopy.');
	if (Object.keys(value).some(key => !(key in LOGIN_LIMITS))) throw new BizError('Invalid loginCopy key.');
	const normalized = {};
	for (const [key, raw] of Object.entries(value)) {
		const text = requireString(raw, `loginCopy.${key}`, LOGIN_LIMITS[key]).replace(/\r\n?/g, '\n');
		if (key === 'slogan' && (text.match(/\n/g) || []).length > 1) {
			throw new BizError('loginCopy.slogan may contain at most one line break.');
		}
		normalized[key] = text;
	}
	return normalized;
}

function validateUrlPwaIcons(value, faviconUrl) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).length !== 1 || !value.url || typeof value.url !== 'object'
		|| Array.isArray(value.url) || Object.keys(value.url).some(key => !['src', 'width', 'height'].includes(key))) {
		throw new BizError('Invalid sitePwaIcons.');
	}
	const src = validateHttpsUrl(value.url.src, 'PWA icon URL', { imageExtension: true });
	const width = Number(value.url.width);
	const height = Number(value.url.height);
	if (!Number.isInteger(width) || !Number.isInteger(height) || width !== height || width < 192 || width > 2048) {
		throw new BizError('Invalid PWA icon dimensions.');
	}
	if (src !== faviconUrl) throw new BizError('PWA icon URL must match siteFavicon.');
	return { url: { src, width, height } };
}

function safeParse(value, fallback, field) {
	try {
		return typeof value === 'string' ? JSON.parse(value) : value;
	} catch {
		console.warn(`Invalid stored ${field}; using the public default.`);
		return fallback;
	}
}

function storedLoginCopy(value, locale = '') {
	const defaults = loginCopyDefaults(locale);
	try {
		const parsed = safeParse(value || '{}', {}, 'login_copy');
		const validated = validateLoginCopy(parsed);
		return Object.fromEntries(LOGIN_COPY_KEYS.map(key => [
			key,
			validated[key] || defaults[key],
		]));
	} catch {
		console.warn('Invalid stored login_copy structure; using the public default.');
		return { ...defaults };
	}
}

function internalAsset(value, expected) {
	const match = BRAND_ASSET_PATTERN.exec(value || '');
	if (!match) return null;
	if (expected === 'logo' && !match[2].startsWith('logo.')) return null;
	if (expected === 'favicon192' && match[2] !== 'favicon-192.png') return null;
	if (expected === 'favicon512' && match[2] !== 'favicon-512.png') return null;
	return { id: match[1], name: match[2] };
}

function effectiveAssets(row) {
	let logoUrl = DEFAULTS.logoUrl;
	const storedLogo = String(row?.siteLogo || '').trim();
	if (internalAsset(storedLogo, 'logo')) {
		logoUrl = storedLogo;
	} else if (storedLogo) {
		try { logoUrl = validateHttpsUrl(storedLogo, 'stored site logo'); } catch { /* default */ }
	}

	const storedFavicon = String(row?.siteFavicon || '').trim();
	const rawPwa = safeParse(row?.sitePwaIcons || '{}', {}, 'site_pwa_icons');
	if (!storedFavicon) {
		return { logoUrl, faviconUrl: DEFAULTS.faviconUrl, manifestIcons: DEFAULT_PWA_ICONS.map(item => ({ ...item })) };
	}

	const internal192 = internalAsset(storedFavicon, 'favicon192');
	if (internal192 && rawPwa && typeof rawPwa === 'object') {
		const icon192 = internalAsset(rawPwa.icon192, 'favicon192');
		const icon512 = internalAsset(rawPwa.icon512, 'favicon512');
		if (icon192?.id === internal192.id && icon512?.id === internal192.id && rawPwa.icon192 === storedFavicon) {
			return {
				logoUrl,
				faviconUrl: storedFavicon,
				manifestIcons: [
					{ src: rawPwa.icon192, sizes: '192x192', type: 'image/png' },
					{ src: rawPwa.icon512, sizes: '512x512', type: 'image/png' },
				],
			};
		}
	}

	try {
		const metadata = validateUrlPwaIcons(rawPwa, storedFavicon);
		const extension = new URL(metadata.url.src).pathname.toLowerCase().split('.').pop();
		const type = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
		return {
			logoUrl,
			faviconUrl: storedFavicon,
			manifestIcons: [{
				src: metadata.url.src,
				sizes: `${metadata.url.width}x${metadata.url.height}`,
				type,
			}],
		};
	} catch {
		return { logoUrl, faviconUrl: DEFAULTS.faviconUrl, manifestIcons: DEFAULT_PWA_ICONS.map(item => ({ ...item })) };
	}
}

function effectiveBrand(row, locale = '') {
	const title = typeof row?.title === 'string' && row.title.trim() ? row.title.trim() : DEFAULTS.title;
	const siteDescription = typeof row?.siteDescription === 'string' && row.siteDescription.trim()
		? row.siteDescription.trim()
		: DEFAULTS.siteDescription;
	return {
		title,
		siteDescription,
		loginCopy: storedLoginCopy(row?.loginCopy, locale),
		...effectiveAssets(row),
	};
}

async function requireSingleSetting(c) {
	const count = await c.env.db.prepare('SELECT COUNT(*) AS total FROM setting').first();
	if (Number(count?.total) !== 1) throw new BizError('Brand settings require exactly one setting row.', 409);
	const row = await orm(c).select().from(setting).get();
	if (!row) throw new BizError('Database not initialized.', 503);
	return row;
}

function adminFields(row) {
	return {
		siteDescription: row?.siteDescription || '',
		siteLogo: row?.siteLogo || '',
		siteFavicon: row?.siteFavicon || '',
		sitePwaIcons: safeParse(row?.sitePwaIcons || '{}', {}, 'site_pwa_icons'),
		loginCopy: safeParse(row?.loginCopy || '{}', {}, 'login_copy'),
	};
}

const brandService = {
	BRAND_FIELDS,
	DEFAULTS,
	DEFAULT_LOGIN_COPY,
	BRAND_ASSET_PATTERN,

	async raw(c) {
		return requireSingleSetting(c);
	},

	adminFields,

	async publicConfig(c, row = null) {
		const settingRow = row || await requireSingleSetting(c);
		const brand = effectiveBrand(settingRow, requestLocale(c));
		const runtime = await runtimeConfigService.private(c);
		const domainList = settingRow.loginDomain !== 1 ? await managedDomainService.suffixes(c) : [];
		return {
			title: brand.title,
			autoRefresh: settingRow.autoRefresh,
			send: settingRow.send,
			siteKey: runtime.turnstile.siteKey || null,
			domainList,
			loginDomain: settingRow.loginDomain,
			siteDescription: brand.siteDescription,
			logoUrl: brand.logoUrl,
			faviconUrl: brand.faviconUrl,
			loginCopy: brand.loginCopy,
			manifestUrl: DEFAULTS.manifestUrl,
		};
	},

	async manifest(c) {
		let row = null;
		try {
			row = await requireSingleSetting(c);
		} catch (error) {
			if (!/no such table/i.test(String(error?.message || '')) && error?.code !== 503) throw error;
		}
		const brand = effectiveBrand(row, requestLocale(c));
		return {
			id: '/',
			start_url: '/',
			scope: '/',
			name: brand.title,
			short_name: brand.title,
			description: brand.siteDescription,
			display: 'standalone',
			icons: brand.manifestIcons,
		};
	},

	async update(c, params) {
		const current = await requireSingleSetting(c);
		const update = {};
		if (Object.hasOwn(params, 'title')) update.title = requireString(params.title, 'title', 80);
		if (Object.hasOwn(params, 'siteDescription')) {
			update.siteDescription = requireString(params.siteDescription, 'siteDescription', 240);
		}
		if (Object.hasOwn(params, 'loginCopy')) update.loginCopy = JSON.stringify(validateLoginCopy(params.loginCopy));
		if (Object.hasOwn(params, 'siteLogo')) {
			const logo = requireString(params.siteLogo, 'siteLogo', 2048);
			if (logo.startsWith('/')) throw new BizError('Uploaded logo references can only be created by the upload endpoint.');
			update.siteLogo = logo ? validateHttpsUrl(logo, 'siteLogo') : '';
		}

		const changesFavicon = Object.hasOwn(params, 'siteFavicon');
		const changesIcons = Object.hasOwn(params, 'sitePwaIcons');
		if (changesFavicon || changesIcons) {
			const favicon = changesFavicon
				? requireString(params.siteFavicon, 'siteFavicon', 2048)
				: String(current.siteFavicon || '');
			if (favicon.startsWith('/')) throw new BizError('Uploaded favicon references can only be created by the upload endpoint.');
			if (!favicon) {
				if (changesIcons && Object.keys(params.sitePwaIcons || {}).length > 0) {
					throw new BizError('PWA icon metadata requires siteFavicon.');
				}
				update.siteFavicon = '';
				update.sitePwaIcons = '{}';
			} else {
				const checkedFavicon = validateHttpsUrl(favicon, 'siteFavicon', { imageExtension: true });
				if (!changesIcons) throw new BizError('URL favicon requires sitePwaIcons metadata.');
				update.siteFavicon = checkedFavicon;
				update.sitePwaIcons = JSON.stringify(validateUrlPwaIcons(params.sitePwaIcons, checkedFavicon));
			}
		}

		const row = Object.keys(update).length
			? await orm(c).update(setting).set(update).returning().get()
			: current;
		return { previous: current, row, publicConfig: await this.publicConfig(c, row) };
	},

	async setUploadedLogo(c, path) {
		if (!internalAsset(path, 'logo')) throw new BizError('Invalid uploaded logo reference.');
		await requireSingleSetting(c);
		const row = await orm(c).update(setting).set({ siteLogo: path }).returning().get();
		return { row, publicConfig: await this.publicConfig(c, row) };
	},

	async setUploadedFavicon(c, icon192, icon512) {
		const parsed192 = internalAsset(icon192, 'favicon192');
		const parsed512 = internalAsset(icon512, 'favicon512');
		if (!parsed192 || parsed192.id !== parsed512?.id) throw new BizError('Invalid uploaded favicon references.');
		await requireSingleSetting(c);
		const row = await orm(c).update(setting).set({
			siteFavicon: icon192,
			sitePwaIcons: JSON.stringify({ icon192, icon512 }),
		}).returning().get();
		return { row, publicConfig: await this.publicConfig(c, row) };
	},
};

export { BRAND_FIELDS, DEFAULTS, DEFAULT_LOGIN_COPY, DEFAULT_PWA_ICONS };
export default brandService;
