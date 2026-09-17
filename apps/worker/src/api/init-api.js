import app from '../hono/hono';
import { dbInit } from '../init/init';
import result from '../model/result';
import userContext from '../security/user-context';
import securityService from '../service/security-service';
import BizError from '../error/biz-error';
import reqUtils from '../utils/req-utils';
import { isAdmin } from '../security/admin-identity';
import recentAuthService from '../service/recent-auth-service';
import adminIdentityService from '../service/admin-identity-service';
import setupSessionService from '../service/setup-session-service';
import { requireSameOrigin, requireSameOriginRead } from '../service/oauth-provider-config-service';

async function requireSetupStatusRateLimit(c) {
	const binding = c.env.SETUP_STATUS_RATE_LIMITER;
	if (!binding || typeof binding.limit !== 'function') {
		throw new BizError('Setup status rate limiter is not configured.', 503);
	}

	const ip = String(reqUtils.getIp(c) || 'unknown')
		.toLowerCase()
		.replace(/[^a-z0-9:._-]/g, '_')
		.slice(0, 120);
	let attempt;
	try {
		attempt = await binding.limit({ key: `ip:${ip}` });
	} catch {
		throw new BizError('Setup status rate limiter is unavailable.', 503);
	}
	if (!attempt?.success) {
		throw new BizError('Too many setup status requests. Please try again later.', 429);
	}
}

async function readSetupToken(c) {
	let params;
	try {
		params = await c.req.json();
	} catch {
		throw new BizError('Invalid setup token', 403);
	}
	if (!params || typeof params !== 'object' || Array.isArray(params)
		|| Object.keys(params).length !== 1 || !Object.hasOwn(params, 'setupToken')) {
		throw new BizError('Invalid setup token', 403);
	}
	return params.setupToken;
}

app.get('/setup/status', async (c) => {
	c.header('Cache-Control', 'no-store');
	await requireSetupStatusRateLimit(c);
	return c.json(result.ok(await dbInit.setupStatus(c)));
});

app.post('/setup/verify', async (c) => {
	requireSameOrigin(c);
	await securityService.rateLimit(c, 'SETUP_RATE_LIMITER', 'setup', 3);
	c.header('Cache-Control', 'no-store');
	const setupToken = await readSetupToken(c);
	await setupSessionService.verifySecret(c, setupToken);
	const status = await dbInit.setupStatus(c);
	if (!status.setupRequired || !status.upgradeSupported) {
		throw new BizError('System setup is not available in the current state.', 409);
	}
	return c.json(result.ok(await setupSessionService.issue(c)));
});

app.post('/setup', async (c) => {
	requireSameOrigin(c);
	await securityService.rateLimit(c, 'SETUP_RATE_LIMITER', 'setup', 3);
	c.header('Cache-Control', 'no-store');
	const params = await c.req.json();
	return c.json(result.ok(await dbInit.setup(c, params)));
});

app.post('/setup/upgrade', async (c) => {
	requireSameOrigin(c);
	await securityService.rateLimit(c, 'SETUP_RATE_LIMITER', 'setup', 3);
	c.header('Cache-Control', 'no-store');
	await setupSessionService.verifySecret(c, await readSetupToken(c));
	return c.json(result.ok(await dbInit.setupUpgrade(c)));
});

app.post('/admin/upgrade', async (c) => {
	const user = userContext.getUser(c);
	if (!isAdmin(user)) {
		throw new BizError('Administrator access required', 403);
	}
	return c.json(result.ok(await dbInit.upgrade(c)));
});

app.get('/admin/schema', async (c) => {
	c.header('Cache-Control', 'no-store');
	requireSameOriginRead(c);
	const user = userContext.getUser(c);
	if (!isAdmin(user)) {
		throw new BizError('Administrator access required', 403);
	}
	return c.json(result.ok(await dbInit.getSchemaInfo(c)));
});

app.post('/admin/migrate-primary-email', async (c) => {
	const user = userContext.getUser(c);
	if (!isAdmin(user)) throw new BizError('Administrator access required', 403);
	await recentAuthService.require(c);
	const params = await c.req.json();
	return c.json(result.ok(await adminIdentityService.migratePrimaryEmail(c, params?.targetEmail, user.userId)));
});
