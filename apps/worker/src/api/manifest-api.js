import app from '../hono/hono';
import brandService from '../service/brand-service';

function toHex(bytes) {
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

app.get('/manifest.webmanifest', async c => {
	const body = JSON.stringify(await brandService.manifest(c));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
	const etag = `"${toHex(new Uint8Array(digest))}"`;
	const headers = {
		'Content-Type': 'application/manifest+json; charset=utf-8',
		'Cache-Control': 'no-cache',
		ETag: etag,
	};
	if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
	return new Response(body, { headers });
});
