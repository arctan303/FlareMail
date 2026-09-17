import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import r2Service from './r2-service';
import mailProviderService, { hasCloudflareEmail } from './mail-provider-service';
import BizError from '../error/biz-error';
import {t} from '../i18n/i18n'
import brandService, { BRAND_FIELDS } from './brand-service';
import managedDomainService from './managed-domain-service';
import runtimeConfigService from './runtime-config-service';

const REMOVED_LINK_FIELDS = ['projectLink', 'siteLinks', 'links'];

const LEGACY_WRITABLE_FIELDS = new Set([
	'receive', 'send', 'loginDomain', 'blackFrom', 'blackSubject', 'blackContent',
	'siteKey', 'r2Domain', 'background', 'googleOauthEnabled', 'googleClientId',
	'googleClientSecret', 'resendTokens', 'mailProvider',
]);

function hydrateSettingRow(settingRow) {
	settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
	delete settingRow.secretKey;
	for (const field of REMOVED_LINK_FIELDS) delete settingRow[field];
	Object.assign(settingRow, brandService.adminFields(settingRow));
	return settingRow;
}

function brandObjectKey(path) {
	const match = brandService.BRAND_ASSET_PATTERN.exec(path || '');
	return match ? `site-assets/brand/${match[1]}/${match[2]}` : null;
}

async function removeReplacedBrandObjects(c, previous, current) {
	const oldIcons = brandService.adminFields(previous).sitePwaIcons;
	const newIcons = brandService.adminFields(current).sitePwaIcons;
	const candidates = [];
	if (previous.siteLogo !== current.siteLogo) candidates.push(previous.siteLogo);
	if (previous.siteFavicon !== current.siteFavicon
		|| JSON.stringify(oldIcons) !== JSON.stringify(newIcons)) {
		candidates.push(previous.siteFavicon, oldIcons?.icon192, oldIcons?.icon512);
	}
	const keys = [...new Set(candidates.map(brandObjectKey).filter(Boolean))];
	const removed = await Promise.allSettled(keys.map(key => r2Service.delete(c, key)));
	if (removed.some(item => item.status === 'rejected')) {
		console.warn('A replaced brand object could not be deleted.');
	}
}

const settingService = {

	async refresh(c) {
		const settingRow = hydrateSettingRow(await orm(c).select().from(setting).get());
		c.set('setting', settingRow);
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {

		if (c.get?.('setting')) {
			return c.get('setting')
		}

		let settingData = await c.env.kv.get(KvConst.SETTING, { type: 'json' });
		if (settingData) settingData = { ...settingData };

		if (!settingData) {
			const settingRow = await orm(c).select().from(setting).get();
			if (settingRow) {
				settingData = hydrateSettingRow(settingRow);
				await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingData));
			}
		}

		if (!settingData) {
			throw new BizError('数据库未初始化 Database not initialized.');
		}

		settingData.domainList = await managedDomainService.suffixes(c);

		c.set?.('setting', settingData);
		return settingData;
	},

	async get(c, showSiteKey = false) {

		const settingRow = { ...await this.query(c) };
		// Old KV cache entries can outlive the removed link features.
		for (const field of REMOVED_LINK_FIELDS) delete settingRow[field];
		const currentBrand = await brandService.raw(c);
		const runtime = await runtimeConfigService.private(c);
		settingRow.title = currentBrand.title;
		Object.assign(settingRow, brandService.adminFields(currentBrand));
		settingRow.siteKey = showSiteKey
			? runtime.turnstile.siteKey || null
			: runtime.turnstile.siteKey ? `${runtime.turnstile.siteKey.slice(0, 6)}******` : null;
		settingRow.hasTurnstileSecret = !!runtime.turnstile.secret;

		settingRow.resendTokens = { ...settingRow.resendTokens };
		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		settingRow.hasR2 = !!c.env.r2
		settingRow.hasCfEmail = hasCloudflareEmail(c)
		Object.assign(settingRow, await mailProviderService.read(c))

		settingRow.googleClientSecret = settingRow.googleClientSecret
			? `${settingRow.googleClientSecret.slice(0, 6)}******`
			: '';

		settingRow.storageType = await r2Service.storageType(c);

		return settingRow;
	},

	async set(c, params) {
		if (REMOVED_LINK_FIELDS.some(field => Object.hasOwn(params || {}, field))) {
			throw new BizError('Project links and custom public links are no longer supported.');
		}
		if (Object.hasOwn(params || {}, 'siteKey') || Object.hasOwn(params || {}, 'secretKey')) {
			throw new BizError('Turnstile configuration must be saved through runtime settings.');
		}
		const changedBrandFields = BRAND_FIELDS.filter(field => Object.hasOwn(params || {}, field));
		if (changedBrandFields.length > 0) {
			if (Object.keys(params).some(field => LEGACY_WRITABLE_FIELDS.has(field))) {
				throw new BizError('Brand settings must be saved separately from other settings.');
			}
			const saved = await brandService.update(c, params);
			try {
				await this.refresh(c);
			} catch {
				console.warn('Brand settings were saved but the general setting cache could not be refreshed.');
			}
			await removeReplacedBrandObjects(c, saved.previous, saved.row);
			return saved.publicConfig;
		}

		const settingData = await this.query(c);
		const update = {};
		const providerUpdate = Object.hasOwn(params, 'mailProvider')
			? await mailProviderService.prepareUpdate(c, params.mailProvider) : null;
		for (const field of ['receive', 'send', 'loginDomain']) {
			if (params[field] !== undefined) {
				const value = Number(params[field]);
				if (![0, 1].includes(value)) throw new BizError(`Invalid ${field} setting.`);
				update[field] = value;
			}
		}
		for (const field of ['blackFrom', 'blackSubject', 'blackContent']) {
			if (params[field] !== undefined) {
				const value = String(params[field]);
				if (value.length > 2000) throw new BizError(`${field} is too long.`);
				update[field] = value;
			}
		}
		if (params.r2Domain !== undefined) {
			const r2Domain = String(params.r2Domain).trim();
			if (r2Domain && (r2Domain.length > 500 || /\s/.test(r2Domain))) throw new BizError('Invalid R2 domain.');
			update.r2Domain = r2Domain;
		}
		if (params.background !== undefined) {
			const background = String(params.background).trim();
			if (background && background.length > 500) throw new BizError('Background URL is too long.');
			update.background = background;
		}
		const googleFieldsSubmitted = params.googleOauthEnabled !== undefined
			|| params.googleClientId !== undefined
			|| params.googleClientSecret !== undefined;
		let googleUpdate;
		if (googleFieldsSubmitted) {
			const storedGoogle = await c.env.db.prepare(`
				SELECT google_oauth_enabled AS enabled, google_client_id AS clientId,
					google_client_secret AS clientSecret
				FROM setting
			`).first();
			if (!storedGoogle) throw new BizError('Database not initialized.', 503);
			const previous = {
				enabled: Number(storedGoogle.enabled || 0),
				clientId: String(storedGoogle.clientId || '').trim(),
				clientSecret: String(storedGoogle.clientSecret || '').trim(),
			};
			if (![0, 1].includes(previous.enabled)) throw new BizError('Google configuration is invalid.', 500);
			let googleEnabled = previous.enabled;
			let googleClientId = previous.clientId;
			let googleClientSecret = previous.clientSecret;
			if (params.googleOauthEnabled !== undefined) {
				const raw = params.googleOauthEnabled;
				if (![0, 1, '0', '1'].includes(raw)) throw new BizError('Invalid googleOauthEnabled setting.');
				googleEnabled = Number(raw);
			}
			if (params.googleClientId !== undefined) {
				googleClientId = String(params.googleClientId).trim();
				if (googleClientId.length > 255 || /\s/.test(googleClientId)) {
					throw new BizError('Invalid googleClientId.');
				}
			}
			if (params.googleClientSecret !== undefined) {
				const submittedSecret = String(params.googleClientSecret).trim();
				const currentMask = googleClientSecret ? `${googleClientSecret.slice(0, 6)}******` : '';
				if (submittedSecret !== currentMask) {
					if (submittedSecret.length > 255 || /\s/.test(submittedSecret)) {
						throw new BizError('Invalid googleClientSecret.');
					}
					googleClientSecret = submittedSecret;
				}
			}
			if (!!googleClientId !== !!googleClientSecret) {
				throw new BizError('Google Client ID and Secret must be configured together.');
			}
			if (googleEnabled === 1 && !googleClientId) {
				throw new BizError('Disable Google login before clearing its credentials.', 409);
			}
			googleUpdate = {
				previous,
				next: { enabled: googleEnabled, clientId: googleClientId, clientSecret: googleClientSecret },
			};
		}

		if (Object.hasOwn(params, 'resendTokens')) {
			const allowedDomains = new Set((await managedDomainService.get(c)).domains);
			const rawChangedTokens = params.resendTokens;
			if (!rawChangedTokens || typeof rawChangedTokens !== 'object' || Array.isArray(rawChangedTokens)) {
				throw new BizError('Invalid Resend token configuration.');
			}
			const changedTokens = {};
			for (const [domain, token] of Object.entries(rawChangedTokens)) {
				const normalizedDomain = domain.toLowerCase();
				if (!allowedDomains.has(normalizedDomain)) throw new BizError('Invalid Resend token domain.');
				if (typeof token !== 'string' || token.length > 255 || /\s/.test(token)) {
					throw new BizError('Invalid Resend token.');
				}
				const current = settingData.resendTokens[normalizedDomain] || '';
				if (current && token === `${current.slice(0, 12)}******`) continue;
				changedTokens[normalizedDomain] = token;
			}
			const resendTokens = { ...settingData.resendTokens, ...changedTokens };
			Object.keys(resendTokens).forEach(domain => {
				if (!resendTokens[domain]) delete resendTokens[domain];
			});
			update.resendTokens = JSON.stringify(resendTokens);
		}

		if (googleUpdate) {
			const saved = await c.env.db.prepare(`
				UPDATE setting
				SET google_oauth_enabled = ?, google_client_id = ?, google_client_secret = ?
				WHERE google_oauth_enabled = ? AND google_client_id = ? AND google_client_secret = ?
			`).bind(
				googleUpdate.next.enabled,
				googleUpdate.next.clientId,
				googleUpdate.next.clientSecret,
				googleUpdate.previous.enabled,
				googleUpdate.previous.clientId,
				googleUpdate.previous.clientSecret,
			).run();
			if (Number(saved.meta?.changes || 0) !== 1) {
				throw new BizError('Google configuration changed; reload and try again.', 409);
			}
		}
		if (providerUpdate) {
			const statements = [providerUpdate];
			if (Object.keys(update).length > 0) {
				const query = orm(c).update(setting).set(update).toSQL();
				statements.push(c.env.db.prepare(query.sql).bind(...query.params));
			}
			await c.env.db.batch(statements);
		} else if (Object.keys(update).length > 0) {
			await orm(c).update(setting).set(update).returning().get();
		}
		await this.refresh(c);
		return this.websiteConfig(c);
	},

	async websiteConfig(c) {
		return brandService.publicConfig(c);
	},

};

export default settingService;
