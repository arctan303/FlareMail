import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { currentLocale, normalizeLocale, pickLocale, runWithLocale, t } from '../src/i18n/i18n';
import zh from '../src/i18n/zh.js';
import en from '../src/i18n/en.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('locale negotiation', () => {
	it('reduces a full tag to its supported base subtag', () => {
		expect(normalizeLocale('zh-CN')).toBe('zh');
		expect(normalizeLocale('EN-us')).toBe('en');
		expect(normalizeLocale(' fr ')).toBe('');
		expect(normalizeLocale('')).toBe('');
		expect(normalizeLocale(undefined)).toBe('');
	});

	it('takes the first supported entry from a weighted Accept-Language list', () => {
		expect(pickLocale('fr-FR, en-US;q=0.9, zh;q=0.8')).toBe('en');
		expect(pickLocale('zh-Hans-CN,zh;q=0.9')).toBe('zh');
		expect(pickLocale('de,fr')).toBe('zh');
		expect(pickLocale('')).toBe('zh');
		expect(pickLocale(undefined)).toBe('zh');
	});
});

describe('per-request language isolation', () => {
	// Regression guard: i18next keeps the active language on the instance, and one
	// isolate serves concurrent requests, so a shared instance used to let overlapping
	// requests read each other's language.
	it('keeps overlapping translations in their own language', async () => {
		const results = await Promise.all([
			runWithLocale('en', async () => { await delay(6); return t('IncorrectPwd'); }),
			runWithLocale('zh', async () => { await delay(1); return t('IncorrectPwd'); }),
			runWithLocale('en', async () => { await delay(3); return t('accountLimit'); }),
			runWithLocale('zh', async () => { await delay(4); return t('accountLimit'); }),
		]);
		expect(results).toEqual([
			en.IncorrectPwd,
			zh.IncorrectPwd,
			en.accountLimit,
			zh.accountLimit,
		]);
	});

	it('uses the default locale outside any request scope', () => {
		expect(currentLocale()).toBe('');
		expect(t('IncorrectPwd')).toBe(zh.IncorrectPwd);
	});

	it('localizes the conversation view capacity error', () => {
		expect(runWithLocale('en', () => t('conversationViewLimit'))).toBe(en.conversationViewLimit);
		expect(runWithLocale('zh', () => t('conversationViewLimit'))).toBe(zh.conversationViewLimit);
		expect(en.conversationViewLimit).not.toBe(zh.conversationViewLimit);
	});

	it('keeps the two locale files in key parity', () => {
		const missingFromEn = Object.keys(zh).filter(key => !Object.hasOwn(en, key));
		const missingFromZh = Object.keys(en).filter(key => !Object.hasOwn(zh, key));
		expect(missingFromEn).toEqual([]);
		expect(missingFromZh).toEqual([]);
	});

	it('returns the key itself for an unknown message instead of inventing text', () => {
		expect(runWithLocale('en', () => t('__missing_key__'))).toBe('__missing_key__');
	});

	it('answers each concurrent HTTP request in its own language', async () => {
		const request = lang => SELF.fetch('https://example.com/api/my/loginUserInfo', {
			headers: { 'accept-language': lang },
		});
		const [enResponse, zhResponse] = await Promise.all([request('en'), request('zh')]);

		expect(enResponse.status).toBe(401);
		expect(zhResponse.status).toBe(401);
		const enBody = await enResponse.json();
		const zhBody = await zhResponse.json();

		expect(enBody.message).toBe(en.authExpired);
		expect(zhBody.message).toBe(zh.authExpired);
		expect(enBody.message).not.toBe(zhBody.message);
	});
});
