import r2Service from '../service/r2-service';
import app from '../hono/hono';
import attService from '../service/att-service';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
import securityService from '../service/security-service';

app.get('/attachment/*', serveAttachment);
app.get('/cli/attachments/*', serveAttachment);

async function serveAttachment(c) {
	await securityService.rateLimit(c, 'EMAIL_RATE_LIMITER', 'attachment-download', 60);
	const prefix = c.req.path.startsWith('/cli/') ? '/cli/attachments/' : '/attachment/';
	let key;
	try {
		key = decodeURIComponent(c.req.path.slice(prefix.length));
	} catch {
		throw new BizError('Attachment not found', 404);
	}
	if (!key.startsWith('attachments/') || key.includes('..') || key.includes('\\')) {
		throw new BizError('Attachment not found', 404);
	}

	const attachment = await attService.selectOwnedByKey(c, key, userContext.getUserId(c));
	if (!attachment) throw new BizError('Attachment not found', 404);

	const obj = await r2Service.getObj(c, key);
	if (!obj) throw new BizError('Attachment not found', 404);

	const safeInlineTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);
	const mimeType = String(attachment.mimeType || 'application/octet-stream').toLowerCase();
	const inline = safeInlineTypes.has(mimeType);
	const filename = attachment.filename || 'attachment';
	const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');

	return new Response(obj.body, {
		headers: {
			'Content-Type': inline ? mimeType : 'application/octet-stream',
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedFilename}`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		}
	});
}


