import { UAParser } from 'ua-parser-js';
import BizError from '../error/biz-error';

function contentLength(c) {
	const raw = c.req.header('Content-Length');
	if (!raw || !/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

export async function readLimitedBytes(c, maxBytes, tooLargeMessage = 'Request body is too large.') {
	const declaredLength = contentLength(c);
	if (declaredLength !== null && declaredLength > maxBytes) {
		throw new BizError(tooLargeMessage, 413);
	}

	const stream = c.req.raw.body;
	if (!stream) return new Uint8Array();

	const reader = stream.getReader();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
			total += chunk.byteLength;
			if (total > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// The size decision is authoritative even if cancellation is unavailable.
				}
				throw new BizError(tooLargeMessage, 413);
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function readLimitedJson(c, maxBytes, {
	tooLargeMessage = 'Request body is too large.',
	invalidMessage = 'Invalid request body.',
	invalidCode = 400,
} = {}) {
	let value;
	try {
		const bytes = await readLimitedBytes(c, maxBytes, tooLargeMessage);
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch (error) {
		if (error instanceof BizError) throw error;
		throw new BizError(invalidMessage, invalidCode);
	}
	return value;
}
const reqUtils = {
	getIp(c) {
		return  c.req.header('CF-Connecting-IP') ||
			c.req.header('X-Forwarded-For') ||
			'Unknown';
	},

	getUserAgent(c) {
		const ua = c.req.header('user-agent') || '';

		const parser = new UAParser(ua);
		const { browser, device, os } = parser.getResult();

		let browserInfo = null;
		let osInfo = null;

		if (browser.name) {
			browserInfo = browser.name + ' ' + browser.version;
		}

		if (os.name) {
			osInfo = os.name + os.version;
		}

		let deviceInfo = 'Desktop';

		const hasVendor = !!device?.vendor;
		const hasModel = !!device?.model;

		if (hasVendor || hasModel) {
			const vendor = device.vendor || '';
			const model = device.model || '';
			const type = device.type || '';

			const namePart = [vendor, model].filter(Boolean).join(' ');
			const typePart = type ? ` (${type})` : '';
			deviceInfo = (namePart + typePart).trim();
		}

		return {browser: browserInfo || '', device: deviceInfo || '', os: osInfo || ''}
	}
}

export default reqUtils
