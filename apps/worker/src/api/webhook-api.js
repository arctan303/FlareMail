import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import securityService from '../service/security-service';
import webhookService from '../service/webhook-service';
import { readLimitedJson } from '../utils/req-utils';

for (const prefix of ['/cli/webhooks', '/my/webhooks']) {
	app.use(`${prefix}/*`, async (c, next) => {
		c.header('Cache-Control', 'no-store');
		await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'webhook-config', 60);
		await next();
	});
	const identity = c => [userContext.getUserId(c), Number(c.req.param('accountId'))];
	const body = c => readLimitedJson(c, 32768);
	app.get(`${prefix}/:accountId`, async c => c.json(result.ok(await webhookService.get(c, ...identity(c)))));
	app.put(`${prefix}/:accountId`, async c => c.json(result.ok(await webhookService.save(c, ...identity(c), await body(c)))));
	app.delete(`${prefix}/:accountId`, async c => c.json(result.ok(await webhookService.remove(c, ...identity(c), Number(c.req.query('revision'))))));
	app.post(`${prefix}/:accountId/secret`, async c => c.json(result.ok(await webhookService.rotate(c, ...identity(c), (await body(c))?.revision))));
	app.post(`${prefix}/:accountId/test`, async c => {
		await securityService.rateLimit(c, 'SEND_RATE_LIMITER', 'webhook-test', 10);
		return c.json(result.ok(await webhookService.test(c, ...identity(c))));
	});
	app.get(`${prefix}/:accountId/deliveries`, async c => c.json(result.ok(await webhookService.deliveries(c, ...identity(c),
		c.req.query('before')))));
	app.post(`${prefix}/:accountId/deliveries/:eventId/retry`, async c => {
		await securityService.rateLimit(c, 'SEND_RATE_LIMITER', 'webhook-retry', 10);
		return c.json(result.ok(await webhookService.retry(c, ...identity(c), c.req.param('eventId'))));
	});
}
