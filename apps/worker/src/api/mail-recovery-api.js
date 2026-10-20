import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import { resolvePermKeys } from '../security/admin-identity';
import BizError from '../error/biz-error';
import { readLimitedJson } from '../utils/req-utils';
import service from '../service/mail-recovery-service';

function requirePermission(c, permission) {
	const keys = resolvePermKeys(c.get('user'));
	if (!keys.includes('*') && !keys.includes(permission)) throw new BizError('Unauthorized.', 403);
	c.header('Cache-Control', 'no-store');
	return userContext.getUserId(c);
}

app.get('/mail-recovery/list', async c => c.json(result.ok(await service.list(c, c.req.query(), requirePermission(c, 'email:delete')))));
app.get('/mail-recovery/detail', async c => c.json(result.ok(await service.detail(c, c.req.query('emailId'), requirePermission(c, 'email:delete')))));
app.post('/mail-recovery/restore', async c => c.json(result.ok(await service.restore(c, await readLimitedJson(c, 8192), requirePermission(c, 'email:delete')))));
app.post('/mail-recovery/purge', async c => c.json(result.ok(await service.purge(c, await readLimitedJson(c, 8192), requirePermission(c, 'email:delete')))));
app.post('/mail-recovery/empty-preview', async c => c.json(result.ok(await service.previewEmpty(c, requirePermission(c, 'email:delete')))));
app.post('/mail-recovery/empty', async c => c.json(result.ok(await service.emptyTrash(c, await readLimitedJson(c, 8192), requirePermission(c, 'email:delete')))));
app.get('/mail-recovery/aliases', async c => c.json(result.ok(await service.aliases(c, c.req.query(), requirePermission(c, 'account:query')))));
app.post('/mail-recovery/restore-alias', async c => c.json(result.ok(await service.restoreAlias(c, await readLimitedJson(c, 8192), requirePermission(c, 'account:add')))));
