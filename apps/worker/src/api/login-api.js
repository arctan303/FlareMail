import app from '../hono/hono';
import loginService from '../service/login-service';
import result from '../model/result';
import securityService from '../service/security-service';
import oauthService from '../service/oauth-service';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { readLimitedJson } from '../utils/req-utils';

const MAX_LOGIN_BODY_BYTES = 16 * 1024;

app.post('/login', async (c) => {
	await securityService.rateLimit(c, 'LOGIN_RATE_LIMITER', 'login', 15);
	const params = await readLimitedJson(c, MAX_LOGIN_BODY_BYTES, {
		tooLargeMessage: 'Login request body is too large.',
		invalidMessage: 'Invalid login request body.',
	});

	if (await securityService.loginTurnstileRequired(c)) {
		await securityService.verifyTurnstile(c, params.turnstileToken);
	}

	try {
		await loginService.login(c, params);
		await securityService.clearLoginFailures(c);
		return c.json(result.ok());
	} catch (error) {
		if (error instanceof BizError && error.code === 401) {
			const failureCount = await securityService.recordLoginFailure(c);
			if (failureCount >= 3 && await securityService.loginTurnstileRequired(c)) {
				throw new BizError(t('turnstileTriggerHint') || '账号或密码错误，请完成人机验证后再试', 428);
			}
		}
		throw error;
	}
});

app.get('/login/security', async (c) => {
	const { siteKey } = await securityService.getTurnstileConfig(c);
	return c.json(result.ok({
		turnstileRequired: await securityService.loginTurnstileRequired(c),
		siteKey,
		oauthEnabled: await oauthService.enabled(c)
	}));
});

app.delete('/logout', async (c) => {
	await loginService.logout(c);
	return c.json(result.ok());
});

