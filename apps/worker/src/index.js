import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import emailService from './service/email-service';
import attService from './service/att-service';
import unmatchedService from './service/unmatched-service';
import oauthProviderService from './service/oauth-provider-service';

export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		if (url.pathname.startsWith('/login/oauth/') || url.pathname.startsWith('/oauth/')
			|| url.pathname === '/.well-known/oauth-authorization-server'
			|| url.pathname === '/manifest.webmanifest') {
			return app.fetch(req, env, ctx);
		}

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		await userService.resetDaySendCount({ env })
		await emailService.cleanupSendRequests({ env })
		await emailService.completeReceiveAll({ env })
		await attService.cleanupDeleteQueue({ env })
		await unmatchedService.cleanExpired({ env })
		await oauthProviderService.cleanupExpiredCodes({ env })
	},
};
