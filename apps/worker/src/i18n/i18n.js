import i18next from 'i18next';
import zh from './zh.js'
import en from './en.js'
import app from '../hono/hono';

export const SUPPORTED_LOCALES = ['zh', 'en'];
export const FALLBACK_LOCALE = 'zh';

const resources = {
	zh: {
		translation: zh,
	},
	en: {
		translation: en,
	},
};

// 'zh-CN' / 'zh-Hans-CN' / 'EN-us' all reduce to their base subtag.
export function normalizeLocale(value) {
	const tag = String(value || '').trim().toLowerCase();
	if (!tag) return '';
	const base = tag.split('-')[0];
	return SUPPORTED_LOCALES.includes(base) ? base : '';
}

// Accept-Language is a weighted, comma-separated list; take the first supported entry.
export function pickLocale(header) {
	for (const entry of String(header || '').split(',')) {
		const locale = normalizeLocale(entry.split(';')[0]);
		if (locale) return locale;
	}
	return FALLBACK_LOCALE;
}

i18next.init({
	fallbackLng: FALLBACK_LOCALE,
	supportedLngs: SUPPORTED_LOCALES,
	resources,
});

// Per-request language scope.
//
// i18next keeps the active language on the instance, and one Workers isolate serves
// concurrent requests, so a shared instance would let two overlapping requests read
// each other's language. AsyncLocalStorage gives every request its own scope instead.
//
// node:async_hooks requires the `nodejs_compat` compatibility flag, which every
// wrangler config in this repo declares. An installation that kept an older
// configuration would otherwise fail to boot with `No such module "node:async_hooks"`,
// so the module is resolved at runtime and a failure falls back to the shared instance
// — the previous behaviour — rather than taking the worker down. The fallback is
// announced on startup and the isolation test in test/i18n-locale.spec.js asserts that
// the real path is active.
const ASYNC_HOOKS_MODULE = 'node:async_hooks';

let localeStore = null;
try {
	const { AsyncLocalStorage } = await import(ASYNC_HOOKS_MODULE);
	localeStore = new AsyncLocalStorage();
} catch {
	console.warn(`Per-request locale isolation is disabled: add "nodejs_compat" to compatibility_flags to enable ${ASYNC_HOOKS_MODULE}.`);
}

// Fixed translators are cached per locale; getFixedT keeps fallbackLng for missing keys.
const translators = new Map();
function translatorFor(locale) {
	let translate = translators.get(locale);
	if (!translate) {
		translate = i18next.getFixedT(locale);
		translators.set(locale, translate);
	}
	return translate;
}

// Exported so tests can prove the isolation without going through HTTP.
export function runWithLocale(locale, fn) {
	if (!localeStore) return fn();
	return localeStore.run({ locale }, fn);
}

export function currentLocale() {
	return localeStore?.getStore()?.locale || '';
}

// Registered while this module is evaluated, which happens before security.js (it
// imports `t` from here), so the scope also covers the auth middleware's own errors.
app.use('*', async (c, next) => {
	const locale = pickLocale(c.req.header('accept-language'));
	// Also published on the context under 'locale'. Services that need it read it from
	// there instead of importing this module, because this module imports the Hono app
	// and importing it back would close an import cycle.
	c.set('locale', locale);
	return runWithLocale(locale, () => next());
});

export const t = (key, values) => {
	const locale = currentLocale();
	if (!locale) return i18next.t(key, values);
	return translatorFor(locale)(key, values);
}

export default i18next;
