import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import securityService from '../service/security-service';
import { ownedMailIdentities } from '../utils/mail-recipients';

app.get('/mail/identities', async c => {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'mail-identities', 60);
	const userId = userContext.getUserId(c);
	c.header('Cache-Control', 'no-store');
	return c.json(result.ok({ userId, addresses: await ownedMailIdentities(c, userId) }));
});
