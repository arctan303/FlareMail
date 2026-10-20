import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import { isAdmin } from '../security/admin-identity';
import managedDomainService from '../service/managed-domain-service';
import { requireSameOrigin, requireSameOriginRead } from '../service/oauth-provider-config-service';
import recentAuthService from '../service/recent-auth-service';
import { readLimitedJson } from '../utils/req-utils';

function requireAdministrator(c) {
	if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
}

app.get('/admin/domains', async c => {
	requireAdministrator(c);
	requireSameOriginRead(c);
	c.header('Cache-Control', 'no-store');
	return c.json(result.ok(await managedDomainService.get(c,true)));
});

app.post('/admin/domains', async c => {
	requireSameOrigin(c);
	requireAdministrator(c);
	c.header('Cache-Control', 'no-store');
	return c.json(result.ok(await managedDomainService.add(c, await readLimitedJson(c,16384))));
});

app.post('/admin/domains/preview', async c => {
	requireSameOrigin(c);
	requireAdministrator(c);
	c.header('Cache-Control','no-store');
	return c.json(result.ok(await managedDomainService.preview(c, await readLimitedJson(c,16384))));
});

app.post('/admin/domains/apply', async c => {
	requireSameOrigin(c);
	requireAdministrator(c);
	await recentAuthService.requireSettings(c);
	c.header('Cache-Control','no-store');
	return c.json(result.ok(await managedDomainService.apply(c, await readLimitedJson(c,16384))));
});
