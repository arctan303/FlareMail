import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import { isAdmin } from '../security/admin-identity';
import userContext from '../security/user-context';
import recentAuthService from '../service/recent-auth-service';
import securityService from '../service/security-service';
import { requireSameOrigin, requireSameOriginRead } from '../service/oauth-provider-config-service';
import { readLimitedJson } from '../utils/req-utils';
import diagnostics from '../service/mail-diagnostics-service';
function admin(c){if(!isAdmin(c.get('user')))throw new BizError('Administrator access required.',403);c.header('Cache-Control','no-store');}
app.get('/admin/mail-diagnostics',async c=>{admin(c);requireSameOriginRead(c);await securityService.rateLimit(c,'EMAIL_RATE_LIMITER','mail-diagnostics',10);return c.json(result.ok(await diagnostics.inspect(c,c.req.query('domain'),c.req.query('selector')||'resend')));});
app.post('/admin/mail-diagnostics/send',async c=>{admin(c);requireSameOrigin(c);await recentAuthService.requireSettings(c);await securityService.rateLimit(c,'SEND_RATE_LIMITER','mail-diagnostics-send',3);return c.json(result.ok(await diagnostics.send(c,await readLimitedJson(c,2048),userContext.getUserId(c))));});
app.post('/admin/mail-diagnostics/receive',async c=>{admin(c);requireSameOrigin(c);return c.json(result.ok(await diagnostics.startReceive(c,await readLimitedJson(c,2048),userContext.getUserId(c))));});
app.get('/admin/mail-diagnostics/receive/:id',async c=>{admin(c);requireSameOriginRead(c);return c.json(result.ok(await diagnostics.checkReceive(c,c.req.param('id'),userContext.getUserId(c))));});
