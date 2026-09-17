import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import { isAdmin } from '../security/admin-identity';
import recentAuthService from '../service/recent-auth-service';
import securityService from '../service/security-service';
import runtimeConfigService from '../service/runtime-config-service';
import {
	readLimitedJsonObject,
	requireSameOrigin,
	requireSameOriginRead,
} from '../service/oauth-provider-config-service';

function requireAdministrator(c) {
	if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
}

app.get('/setting/runtime', async c => {
	c.header('Cache-Control', 'no-store');
	requireAdministrator(c);
	requireSameOriginRead(c);
	return c.json(result.ok(await runtimeConfigService.get(c)));
});

app.put('/setting/runtime', async c => {
	c.header('Cache-Control', 'no-store');
	requireAdministrator(c);
	requireSameOrigin(c);
	await recentAuthService.requireSettings(c);
	return c.json(result.ok(await runtimeConfigService.update(c, await readLimitedJsonObject(c))));
});

app.post('/setting/runtime/oauth-secret', async c => {
	c.header('Cache-Control', 'no-store');
	requireAdministrator(c);
	requireSameOrigin(c);
	await securityService.rateLimit(c, 'LOGIN_RATE_LIMITER', 'runtime_secret', 5);
	const body = await readLimitedJsonObject(c);
	if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'password')) {
		throw new BizError('Invalid administrator password.', 403);
	}
	return c.json(result.ok(await runtimeConfigService.revealOauthSecret(c, body.password)));
});
