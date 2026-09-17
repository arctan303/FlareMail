import app from '../hono/hono';
import emailService from '../service/email-service';
import result from '../model/result';
import userContext from '../security/user-context';
import securityService from '../service/security-service';

app.get('/email/list', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'email-list', 60);
	const data = await emailService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/email/latest', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'email-latest', 60);
	const list = await emailService.latest(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.delete('/email/delete', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'email-delete', 30);
	await emailService.delete(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.post('/email/send', async (c) => {
	await securityService.rateLimit(c, 'SEND_RATE_LIMITER', 'email-send', 10);
	const email = await emailService.send(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(email));
});

app.put('/email/read', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'email-read', 30);
	await emailService.read(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
})

