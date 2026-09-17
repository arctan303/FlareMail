import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import settingService from '../service/setting-service';
import { isAdmin } from '../security/admin-identity';
import recentAuthService from '../service/recent-auth-service';
import confirmationPolicyService from '../service/confirmation-policy-service';
import { readLimitedJsonObject, requireSameOriginRead, requireSameOrigin } from '../service/oauth-provider-config-service';

app.get('/setting/confirmation', async c => {
	c.header('Cache-Control', 'no-store');
	if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
	requireSameOriginRead(c);
	return c.json(result.ok(await confirmationPolicyService.read(c)));
});

app.get('/setting/confirmation/status', async c => {
	c.header('Cache-Control', 'no-store');
	if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
	requireSameOriginRead(c);
	return c.json(result.ok(await recentAuthService.status(c)));
});

app.put('/setting/confirmation', async c => {
	c.header('Cache-Control', 'no-store');
	if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
	requireSameOrigin(c);
	await recentAuthService.requireSettings(c);
	return c.json(result.ok(await confirmationPolicyService.update(c, await readLimitedJsonObject(c))));
});

const SENSITIVE_SETTING_FIELDS = new Set([
	'googleOauthEnabled', 'googleClientId', 'googleClientSecret', 'resendTokens', 'mailProvider',
]);

app.put('/setting/set', async (c) => {
	const params = await c.req.json();
	if (Object.keys(params || {}).some(field => SENSITIVE_SETTING_FIELDS.has(field))) {
		if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
		requireSameOrigin(c);
		await recentAuthService.requireSettings(c);
	}
	const publicConfig = await settingService.set(c, params);
	return c.json(result.ok(publicConfig));
});

app.get('/setting/query', async (c) => {
	const setting = await settingService.get(c);
	return c.json(result.ok(setting));
});

app.get('/setting/websiteConfig', async (c) => {
	const setting = await settingService.websiteConfig(c);
	c.header('Cache-Control', 'no-store');
	return c.json(result.ok(setting));
});
