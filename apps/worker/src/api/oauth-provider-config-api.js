import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import { isAdmin } from '../security/admin-identity';
import recentAuthService from '../service/recent-auth-service';
import oauthProviderConfigService, {
	readLimitedJsonObject,
	requireSameOrigin,
	requireSameOriginRead,
} from '../service/oauth-provider-config-service';

function requireAdministrator(c) {
	if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
}

app.get('/setting/oauth-provider', async c => {
	requireAdministrator(c);
	requireSameOriginRead(c);
	return c.json(result.ok(await oauthProviderConfigService.get(c)));
});

app.put('/setting/oauth-provider/enabled', async c => {
	requireAdministrator(c);
	requireSameOrigin(c);
	await recentAuthService.requireSettings(c);
	const body = await readLimitedJsonObject(c);
	return c.json(result.ok(await oauthProviderConfigService.setEnabled(c, body)));
});

app.put('/setting/oauth-provider/clients', async c => {
	requireAdministrator(c);
	requireSameOrigin(c);
	await recentAuthService.requireSettings(c);
	const body = await readLimitedJsonObject(c);
	return c.json(result.ok(await oauthProviderConfigService.setClients(c, body)));
});
