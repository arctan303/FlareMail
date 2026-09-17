import app from '../hono/hono';
import contactService from '../service/contact-service';
import userContext from '../security/user-context';
import result from '../model/result';
import securityService from '../service/security-service';

app.get('/contact/list', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'contact-list', 60);
	const data = await contactService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/contact/groups', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'contact-groups', 60);
	const data = await contactService.groups(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/contact/detail', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'contact-detail', 60);
	const query = c.req.query();
	const data = await contactService.getById(c, query.contactId || query.contact_id, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/contact/add', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'contact-add', 30);
	const data = await contactService.add(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.put('/contact/update', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'contact-update', 30);
	const data = await contactService.update(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.delete('/contact/delete', async (c) => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'contact-delete', 30);
	let body = {};
	try {
		body = await c.req.json();
	} catch (_) {
		body = c.req.query();
	}
	const data = await contactService.delete(c, { ...c.req.query(), ...body }, userContext.getUserId(c));
	return c.json(result.ok(data));
});
