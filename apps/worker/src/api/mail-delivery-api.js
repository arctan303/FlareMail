import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import { isAdmin } from '../security/admin-identity';
import userContext from '../security/user-context';
import recentAuthService from '../service/recent-auth-service';
import securityService from '../service/security-service';
import { requireSameOrigin, requireSameOriginRead } from '../service/oauth-provider-config-service';
import { readLimitedJson, readLimitedBytes } from '../utils/req-utils';
import delivery from '../service/mail-delivery-service';
function administrator(c) {if(!isAdmin(c.get('user'))) throw new BizError('Administrator access required.',403);c.header('Cache-Control','no-store');}
app.get('/admin/mail-delivery',async c=>{administrator(c);requireSameOriginRead(c);return c.json(result.ok(await delivery.getConfig(c)));});
app.put('/admin/mail-delivery',async c=>{administrator(c);requireSameOrigin(c);await recentAuthService.requireSettings(c);return c.json(result.ok(await delivery.setConfig(c,await readLimitedJson(c,4096))));});
app.post('/delivery/resend',async c=>{
  await securityService.rateLimit(c,'EMAIL_RATE_LIMITER','delivery-callback',120);
  const payload=new TextDecoder('utf-8',{fatal:true}).decode(await readLimitedBytes(c,65536));
  return c.json(result.ok(await delivery.receive(c,payload)));
});
app.get('/email/delivery',async c=>{requireSameOriginRead(c);c.header('Cache-Control','no-store');return c.json(result.ok(await delivery.list(c,Number(c.req.query('emailId')),userContext.getUserId(c))));});
