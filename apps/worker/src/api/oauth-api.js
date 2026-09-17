import app from '../hono/hono';
import oauthService from '../service/oauth-service';
import result from '../model/result';
import userContext from '../security/user-context';
import securityService from '../service/security-service';
import BizError from '../error/biz-error';
import recentAuthService from '../service/recent-auth-service';

function assertUser(c) {
	const userRow = userContext.getUser(c);
	if (!userRow?.userId) {
		throw new BizError('Authentication required', 401);
	}
	return userRow;
}

app.get('/login/oauth/start', async (c) => {
	await securityService.rateLimit(c, 'OAUTH_START_RATE_LIMITER', 'oauth_start', 10);
	if (!(await oauthService.enabled(c))) {
		throw new BizError('Google login is not configured', 404);
	}
	const returnTo = oauthService.safeAuthorizationReturn(c, c.req.query('return_to'));
	const { state, nonce } = await oauthService.issueState(c, '/login/oauth/callback', null, null, returnTo);
	const url = await oauthService.buildAuthUrl(c, state, nonce, '/login/oauth/callback');
	return c.redirect(url);
});

app.get('/login/oauth/callback', async (c) => {
	await securityService.rateLimit(c, 'OAUTH_CALLBACK_RATE_LIMITER', 'oauth_callback', 10);
	if (!(await oauthService.enabled(c))) {
		return c.redirect('/login');
	}
	const queryError = c.req.query('error');
	if (queryError) {
		const errTag = queryError === 'access_denied' ? 'access_denied' : 'failed';
		return c.redirect(`/login?oauth_err=${errTag}`);
	}
	try {
		const code = c.req.query('code');
		const state = c.req.query('state');
		const { sub, returnTo } = await oauthService.verifyCallback(c, code, state, '/login/oauth/callback');
		const userId = await oauthService.loginByGoogleSub(c, sub);
		if (!userId) {
			return c.redirect('/login?oauth_err=unbound');
		}
		return c.redirect(returnTo || '/inbox?oauth=1');
	} catch (error) {
		if (error instanceof BizError) {
			const msg = String(error.message || '').toLowerCase();
			const errTag = msg.includes('expired') ? 'expired' : 'failed';
			return c.redirect(`/login?oauth_err=${errTag}`);
		}
		throw error;
	}
});

app.get('/oauth/bind/start', async (c) => {
	await securityService.rateLimit(c, 'OAUTH_BIND_RATE_LIMITER', 'oauth_bind_start', 10);
	if (!(await oauthService.configured(c))) {
		throw new BizError('Google login is not configured', 404);
	}
	assertUser(c);
	await recentAuthService.require(c);
	const { state, nonce } = await oauthService.issueState(
		c,
		'/oauth/bind/callback',
		userContext.getUserId(c),
		c.get('session').hash,
	);
	const url = await oauthService.buildAuthUrl(c, state, nonce, '/oauth/bind/callback');
	c.header('Cache-Control', 'no-store');
	if (c.req.query('response') === 'json') {
		return c.json(result.ok({ url }));
	}
	return c.redirect(url);
});

app.get('/oauth/bind/callback', async (c) => {
	await securityService.rateLimit(c, 'OAUTH_BIND_RATE_LIMITER', 'oauth_bind_callback', 10);
	if (!(await oauthService.configured(c))) {
		return c.redirect('/settings');
	}
	const queryError = c.req.query('error');
	if (queryError) {
		const errTag = queryError === 'access_denied' ? 'access_denied' : 'failed';
		return c.redirect(`/settings?oauth_err=${errTag}`);
	}
	try {
		const code = c.req.query('code');
		const state = c.req.query('state');
		const { sub, email, userId, sessionHash } = await oauthService.verifyCallback(c, code, state, '/oauth/bind/callback');
		if (!userId || !sessionHash) {
			throw new BizError('OAuth request is invalid or expired', 400);
		}
		await recentAuthService.requireByHash(c, sessionHash, userId);
		await oauthService.bind(c, userId, sub, email);
		return c.redirect('/settings?oauth=bound');
	} catch (error) {
		if (error instanceof BizError) {
			let errTag = 'failed';
			if (error.code === 409) {
				errTag = 'already_bound';
			} else if (error.code === 428) {
				errTag = 'reauth_required';
			} else if (String(error.message || '').toLowerCase().includes('expired')) {
				errTag = 'expired';
			}
			return c.redirect(`/settings?oauth_err=${errTag}`);
		}
		throw error;
	}
});

app.post('/oauth/unbind', async (c) => {
	await securityService.rateLimit(c, 'OAUTH_BIND_RATE_LIMITER', 'oauth_unbind', 10);
	if (!(await oauthService.configured(c))) {
		throw new BizError('Google login is not configured', 404);
	}
	const userRow = assertUser(c);
	await recentAuthService.require(c);
	await oauthService.unbind(c, userRow.userId);
	return c.json(result.ok());
});
