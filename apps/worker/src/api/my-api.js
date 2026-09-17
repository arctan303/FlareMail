import app from '../hono/hono';
import userService from '../service/user-service';
import result from '../model/result';
import userContext from '../security/user-context';
import sessionService from '../service/session-service';
import recentAuthService from '../service/recent-auth-service';
import securityService from '../service/security-service';
import cryptoUtils, { MAX_PASSWORD_LENGTH } from '../utils/crypto-utils';
import BizError from '../error/biz-error';
import localeService from '../service/locale-service';

app.get('/my/loginUserInfo', async (c) => {
	const user = await userService.loginUserInfo(c, userContext.getUserId(c));
	return c.json(result.ok(user));
});

app.get('/my/reauth/status', async (c) => {
	c.header('Cache-Control', 'no-store');
	return c.json(result.ok(await recentAuthService.status(c)));
});

app.post('/my/reauth/password', async (c) => {
	c.header('Cache-Control', 'no-store');
	await securityService.rateLimit(c, 'LOGIN_RATE_LIMITER', 'reauth_password', 15);
	let params;
	try {
		params = await c.req.json();
	} catch {
		throw new BizError('Current password is incorrect', 403);
	}
	const password = params?.password;
	const userRow = userContext.getUser(c);
	if (typeof password !== 'string' || cryptoUtils.passwordLength(password) === 0
		|| cryptoUtils.passwordLength(password) > MAX_PASSWORD_LENGTH) {
		throw new BizError('Current password is incorrect', 403);
	}
	const verification = await cryptoUtils.verifyPasswordDetailed(password, userRow.salt, userRow.password);
	if (!verification.valid) {
		throw new BizError('Current password is incorrect', 403);
	}
	return c.json(result.ok(await recentAuthService.grant(c)));
});

app.put('/my/resetPassword', async (c) => {
	await recentAuthService.require(c);
	await userService.resetPassword(c, await c.req.json(), userContext.getUserId(c));
	sessionService.clearCookie(c);
	return c.json(result.ok());
});

app.put('/my/forward', async (c) => {
	await userService.setForward(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/my/locale', async (c) => {
	// The locale is always written for the session user; no user id is accepted from the client.
	const params = await c.req.json().catch(() => null);
	return c.json(result.ok({
		locale: await localeService.set(c, userContext.getUserId(c), params?.locale),
	}));
});

app.post('/my/genCliToken', async (c) => {
	await recentAuthService.require(c);
	const token = await userService.genCliToken(c, userContext.getUserId(c));
	return c.json(result.ok({ token }));
});

app.post('/my/revokeCliToken', async (c) => {
	await userService.revokeCliToken(c, userContext.getUserId(c));
	return c.json(result.ok());
});
