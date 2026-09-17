import BizError from '../error/biz-error';
import KvConst from '../const/kv-const';

// Short codes only: the web client, the Accept-Language header and the editor
// all agree on 'zh' / 'en'. Keep this list in sync with apps/web/src/utils/locale.js.
export const SUPPORTED_LOCALES = ['zh', 'en'];
export const DEFAULT_LOCALE = 'zh';

// 'zh-CN' / 'zh-Hans-CN' / 'EN-us' all reduce to their base subtag.
export function normalizeLocale(value) {
	const tag = String(value || '').trim().toLowerCase();
	if (!tag) return '';
	const base = tag.split('-')[0];
	return SUPPORTED_LOCALES.includes(base) ? base : '';
}

function localeKey(userId) {
	return KvConst.USER_LOCALE + userId;
}

const localeService = {
	async get(c, userId) {
		const stored = normalizeLocale(await c.env.kv.get(localeKey(userId)));
		return stored || '';
	},

	async set(c, userId, locale) {
		const normalized = normalizeLocale(locale);
		if (!normalized) {
			throw new BizError('Unsupported locale', 400);
		}
		await c.env.kv.put(localeKey(userId), normalized);
		return normalized;
	},
};

export default localeService;
