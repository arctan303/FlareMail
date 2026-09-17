import app from '../hono/hono';
import unmatchedService from '../service/unmatched-service';
import result from '../model/result';
import userContext from '../security/user-context';

app.get('/unmatched/list', async (c) => {
	const res = await unmatchedService.list(c, c.req.query());
	return c.json(result.ok(res));
});

app.get('/unmatched/detail', async (c) => {
	const emailId = c.req.query('emailId');
	const detail = await unmatchedService.getDetail(c, emailId);
	return c.json(result.ok(detail));
});

app.delete('/unmatched/delete', async (c) => {
	const emailId = c.req.query('emailId');
	await unmatchedService.delete(c, emailId);
	return c.json(result.ok());
});

app.get('/unmatched/policy', async (c) => {
	const policy = await unmatchedService.getPolicy(c, userContext.getUserId(c));
	return c.json(result.ok({ policy }));
});

app.put('/unmatched/policy', async (c) => {
	const body = await c.req.json();
	const res = await unmatchedService.setPolicy(c, body?.policy, userContext.getUserId(c));
	return c.json(result.ok(res));
});

app.get('/setting/unmatched-policy', async (c) => {
	const policy = await unmatchedService.getPolicy(c, userContext.getUserId(c));
	return c.json(result.ok({ policy }));
});

app.put('/setting/unmatched-policy', async (c) => {
	const body = await c.req.json();
	const res = await unmatchedService.setPolicy(c, body?.policy, userContext.getUserId(c));
	return c.json(result.ok(res));
});

