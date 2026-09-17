import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import { isAdmin } from '../security/admin-identity';
import managedDomainService from '../service/managed-domain-service';
import { requireSameOrigin, requireSameOriginRead } from '../service/oauth-provider-config-service';

function requireAdministrator(c) {
	if (!isAdmin(c.get('user'))) throw new BizError('Administrator access required', 403);
}

app.get('/admin/domains', async c => {
	requireAdministrator(c);
	requireSameOriginRead(c);
	c.header('Cache-Control', 'no-store');
	return c.json(result.ok(await managedDomainService.get(c)));
});

app.post('/admin/domains', async c => {
	requireSameOrigin(c);
	requireAdministrator(c);
	c.header('Cache-Control', 'no-store');
	return c.json(result.ok(await managedDomainService.add(c, await c.req.json())));
});
