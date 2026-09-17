import { Hono } from 'hono';
import result from '../model/result';
import { isAllowedOrigin } from '../utils/origin-utils';

const app = new Hono();

app.use('*', async (c, next) => {
	try {
		await next();
	} finally {
		const silentFrameAncestor = c.res.headers.get('X-OAuth-Silent-Frame-Ancestor');
		c.res.headers.delete('X-OAuth-Silent-Frame-Ancestor');
		c.header('X-Content-Type-Options', 'nosniff');
		c.header('Referrer-Policy', 'no-referrer');
		if (silentFrameAncestor) {
			c.header('Content-Security-Policy', `default-src 'none'; frame-ancestors ${silentFrameAncestor}`);
		} else {
			c.header('X-Frame-Options', 'DENY');
		}
		c.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
		c.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
	}
});

app.use('*', async (c, next) => {
	const origin = c.req.header('Origin') || '';
	const allowed = await isAllowedOrigin(c, origin);
	const setCorsHeaders = () => {
		c.header('Access-Control-Allow-Origin', origin);
		c.header('Access-Control-Allow-Credentials', 'true');
	};

	if (c.req.method === 'OPTIONS') {
		c.header('Vary', 'Origin');
		if (allowed) {
			setCorsHeaders();
			c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept-Language');
			c.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS');
			c.header('Access-Control-Max-Age', '86400');
		}
		return c.body(null, 204);
	}

	await next();
	if (origin) c.header('Vary', 'Origin', { append: true });
	if (allowed) setCorsHeaders();
});

app.onError((err, c) => {
	if (err.name === 'BizError') {
		const status = err.code >= 400 && err.code <= 599 ? err.code : 400;
		return c.json(result.fail(err.message, status), status);
	}

	console.error(err);
	if (err.message === `Cannot read properties of undefined (reading 'get')`
		|| err.message === `Cannot read properties of undefined (reading 'put')`) {
		return c.json(result.fail('KV database not bound', 502), 502);
	}
	if (err.message === `Cannot read properties of undefined (reading 'prepare')`) {
		return c.json(result.fail('D1 database not bound', 502), 502);
	}

	return c.json(result.fail('Internal server error', 500), 500);
});

export default app;
