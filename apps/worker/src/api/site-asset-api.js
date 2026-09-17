import app from '../hono/hono';
import result from '../model/result';
import BizError from '../error/biz-error';
import r2Service from '../service/r2-service';
import settingService from '../service/setting-service';
import brandService from '../service/brand-service';
import securityService from '../service/security-service';
import { readImage } from '../utils/brand-image-utils';

const PUBLIC_PREFIX = '/api/site-assets/brand/';
const OBJECT_PREFIX = 'site-assets/brand/';
const MAX_MULTIPART_BYTES = 1100 * 1024;
const PUBLIC_CACHE = 'public, max-age=31536000, immutable';

const MIME_BY_NAME = Object.freeze({
	'logo.png': 'image/png',
	'logo.jpg': 'image/jpeg',
	'logo.jpeg': 'image/jpeg',
	'logo.webp': 'image/webp',
	'favicon-192.png': 'image/png',
	'favicon-512.png': 'image/png',
});

function objectKey(path) {
	const match = brandService.BRAND_ASSET_PATTERN.exec(path || '');
	return match ? `${OBJECT_PREFIX}${match[1]}/${match[2]}` : null;
}

function publicPath(id, name) {
	return `${PUBLIC_PREFIX}${id}/${name}`;
}

async function removeObjects(c, paths) {
	await Promise.allSettled(paths.map(path => objectKey(path)).filter(Boolean).map(key => r2Service.delete(c, key)));
}

async function refreshCache(c) {
	try {
		await settingService.refresh(c);
	} catch {
		console.warn('Brand settings were saved but the general setting cache could not be refreshed.');
	}
}

async function writeAndVerify(c, entries) {
	const written = [];
	try {
		for (const entry of entries) {
			await r2Service.putObj(c, entry.key, entry.buffer, {
				contentType: entry.mimeType,
				contentDisposition: 'inline',
				cacheControl: PUBLIC_CACHE,
			});
			written.push(entry.key);
		}
		for (const entry of entries) {
			if (!await r2Service.getObj(c, entry.key)) throw new Error('Brand asset write verification failed');
		}
	} catch (error) {
		await Promise.allSettled(written.map(key => r2Service.delete(c, key)));
		throw error;
	}
}

app.post('/setting/brand-assets', async c => {
	await securityService.rateLimit(c, 'BRAND_ASSET_RATE_LIMITER', 'brand-asset-upload', 10);
	const contentLength = Number(c.req.header('content-length') || 0);
	if (contentLength > MAX_MULTIPART_BYTES) throw new BizError('Brand asset upload is too large.', 413);
	const body = await c.req.parseBody({ all: true });
	const type = Array.isArray(body.type) ? body.type[0] : body.type;
	const old = await brandService.raw(c);
	const id = crypto.randomUUID();

	if (type === 'logo') {
		const file = Array.isArray(body.file) ? body.file[0] : body.file;
		const image = await readImage(file, { maxBytes: 512 * 1024 });
		const extension = file.type === 'image/jpeg'
			? (String(file.name).toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'jpg')
			: image.extension;
		const name = `logo.${extension}`;
		const path = publicPath(id, name);
		const key = objectKey(path);
		await writeAndVerify(c, [{ key, buffer: image.buffer, mimeType: image.mimeType }]);
		let saved;
		try {
			saved = await brandService.setUploadedLogo(c, path);
		} catch (error) {
			await removeObjects(c, [path]);
			throw error;
		}
		await refreshCache(c);
		await removeObjects(c, [old.siteLogo]);
		return c.json(result.ok(saved.publicConfig));
	}

	if (type === 'favicon') {
		const file192 = Array.isArray(body.icon192) ? body.icon192[0] : body.icon192;
		const file512 = Array.isArray(body.icon512) ? body.icon512[0] : body.icon512;
		const [icon192, icon512] = await Promise.all([
			readImage(file192, { allowedTypes: ['image/png'], maxBytes: 256 * 1024, exactDimension: 192 }),
			readImage(file512, { allowedTypes: ['image/png'], maxBytes: 256 * 1024, exactDimension: 512 }),
		]);
		const path192 = publicPath(id, 'favicon-192.png');
		const path512 = publicPath(id, 'favicon-512.png');
		await writeAndVerify(c, [
			{ key: objectKey(path192), buffer: icon192.buffer, mimeType: 'image/png' },
			{ key: objectKey(path512), buffer: icon512.buffer, mimeType: 'image/png' },
		]);
		let saved;
		try {
			saved = await brandService.setUploadedFavicon(c, path192, path512);
		} catch (error) {
			await removeObjects(c, [path192, path512]);
			throw error;
		}
		await refreshCache(c);
		const oldIcons = brandService.adminFields(old).sitePwaIcons;
		await removeObjects(c, [old.siteFavicon, oldIcons?.icon192, oldIcons?.icon512]);
		return c.json(result.ok(saved.publicConfig));
	}

	throw new BizError('Invalid brand asset type.');
});

app.get('/site-assets/brand/:id/:name', async c => {
	let id;
	let name;
	try {
		id = decodeURIComponent(c.req.param('id'));
		name = decodeURIComponent(c.req.param('name'));
	} catch {
		throw new BizError('Brand asset not found.', 404);
	}
	const path = publicPath(id, name);
	const key = objectKey(path);
	const mimeType = MIME_BY_NAME[name];
	if (!key || !mimeType) throw new BizError('Brand asset not found.', 404);
	const object = await r2Service.getObj(c, key);
	if (!object) throw new BizError('Brand asset not found.', 404);
	return new Response(object.body, {
		headers: {
			'Content-Type': mimeType,
			'Content-Disposition': 'inline',
			'Cache-Control': PUBLIC_CACHE,
			'X-Content-Type-Options': 'nosniff',
		},
	});
});
