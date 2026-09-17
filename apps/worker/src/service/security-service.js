import BizError from '../error/biz-error';
import KvConst from '../const/kv-const';
import reqUtils from '../utils/req-utils';
import runtimeConfigService from './runtime-config-service';
import { t } from '../i18n/i18n';

const LOGIN_FAILURE_TTL = 10 * 60;
const LOGIN_TURNSTILE_THRESHOLD = 3;

function normalizeKey(value) {
	return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9:._-]/g, '_').slice(0, 120);
}

async function getTurnstileConfig(c) {
	try {
		const runtime = await runtimeConfigService.private(c);
		return { siteKey: runtime.turnstile.siteKey, secretKey: runtime.turnstile.secret };
	} catch (error) {
		throw new BizError(t('loginSecurityUnavailable') || 'Login security configuration is unavailable.', 503);
	}
}

const securityService = {
	async getTurnstileConfig(c) {
		return await getTurnstileConfig(c);
	},

	async rateLimit(c, bindingName, fallbackPrefix, limit) {
		const ip = normalizeKey(reqUtils.getIp(c));
		const userId = Number(c.get('user')?.userId);
		const identity = Number.isInteger(userId) && userId > 0 ? `user:${userId}` : `ip:${ip}`;
		const binding = c.env[bindingName];

		if (binding?.limit) {
			const result = await binding.limit({ key: identity });
			if (!result.success) {
				throw new BizError(t('rateLimitExceeded') || '请求过于频繁，请稍后再试', 429);
			}
			return;
		}

		const window = Math.floor(Date.now() / 60000);
		const key = `${KvConst.RATE_LIMIT}${fallbackPrefix}:${identity}:${window}`;
		const current = Number(await c.env.kv.get(key) || 0);
		if (current >= limit) {
			throw new BizError(t('rateLimitExceeded') || '请求过于频繁，请稍后再试', 429);
		}
		await c.env.kv.put(key, String(current + 1), { expirationTtl: 120 });
	},

	async loginFailureCount(c) {
		const key = KvConst.LOGIN_FAILURE + normalizeKey(reqUtils.getIp(c));
		return Number(await c.env.kv.get(key) || 0);
	},

	async recordLoginFailure(c) {
		const key = KvConst.LOGIN_FAILURE + normalizeKey(reqUtils.getIp(c));
		const count = await this.loginFailureCount(c) + 1;
		await c.env.kv.put(key, String(count), { expirationTtl: LOGIN_FAILURE_TTL });
		return count;
	},

	async clearLoginFailures(c) {
		const key = KvConst.LOGIN_FAILURE + normalizeKey(reqUtils.getIp(c));
		await c.env.kv.delete(key);
	},

	async loginTurnstileRequired(c) {
		const { siteKey, secretKey } = await getTurnstileConfig(c);
		if (!siteKey && !secretKey) return false;
		if (!siteKey || !secretKey) {
			throw new BizError(t('turnstileIncomplete') || '人机验证配置不完整', 503);
		}
		return await this.loginFailureCount(c) >= LOGIN_TURNSTILE_THRESHOLD;
	},

	async verifyTurnstile(c, token, required = true) {
		const { siteKey, secretKey } = await getTurnstileConfig(c);
		if (!siteKey || !secretKey) {
			if (required) {
				throw new BizError(t('turnstileNotConfigured') || '人机验证未配置', 503);
			}
			return false;
		}
		if (!token) {
			throw new BizError(t('emptyBotToken') || '请完成人机验证', 428);
		}

		// Cloudflare 官方 Dummy 测试 Secret 默认通过
		if (secretKey === '1x0000000000000000000000000000000AA') {
			return true;
		}

		const formData = new FormData();
		formData.append('secret', secretKey);
		formData.append('response', token);
		const ip = reqUtils.getIp(c);
		if (ip && ip !== 'Unknown') formData.append('remoteip', ip);

		const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			body: formData
		});
		const result = await response.json();
		if (!result.success) {
			throw new BizError(t('botVerifyFail') || '人机验证失败，请重试', 428);
		}
		return true;
	}
};

export default securityService;
