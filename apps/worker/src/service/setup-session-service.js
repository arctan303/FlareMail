import BizError from '../error/biz-error';
import cryptoUtils from '../utils/crypto-utils';

const SESSION_TTL_MS = 10 * 60 * 1000;
const PURPOSE = 'flaremail-setup';

function encode(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decode(value) {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
	const binary = atob(padded);
	return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

async function signature(payload, secret) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const bytes = new Uint8Array(await crypto.subtle.sign(
		'HMAC',
		key,
		new TextEncoder().encode(`${PURPOSE}\n${payload}`),
	));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function equal(left, right) {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
}

function requireSecret(c) {
	const secret = c.env.SETUP_SECRET;
	if (typeof secret !== 'string' || !secret) {
		throw new BizError('Setup is disabled. Configure SETUP_SECRET first.', 503);
	}
	return secret;
}

const setupSessionService = {
	requireSecret,

	async verifySecret(c, setupToken) {
		const secret = requireSecret(c);
		if (typeof setupToken !== 'string' || !setupToken || Array.from(setupToken).length > 512) {
			throw new BizError('Invalid setup token', 403);
		}
		const [actual, expected] = await Promise.all([
			cryptoUtils.hashSecret(setupToken),
			cryptoUtils.hashSecret(secret),
		]);
		if (!equal(actual, expected)) throw new BizError('Invalid setup token', 403);
		return secret;
	},

	async issue(c) {
		const secret = requireSecret(c);
		const issuedAt = Date.now();
		const expiresAt = Date.now() + SESSION_TTL_MS;
		const nonce = crypto.getRandomValues(new Uint8Array(16));
		const payload = encode(JSON.stringify({ purpose: PURPOSE, issuedAt, expiresAt, nonce: Array.from(nonce) }));
		const signed = await signature(payload, secret);
		return {
			setupSession: `${payload}.${signed}`,
			expiresAt: new Date(expiresAt).toISOString(),
		};
	},

	async require(c, token) {
		const secret = requireSecret(c);
		if (typeof token !== 'string' || token.length > 2048) {
			throw new BizError('Invalid setup session', 403);
		}
		const parts = token.split('.');
		if (parts.length !== 2) throw new BizError('Invalid setup session', 403);
		const expected = await signature(parts[0], secret);
		if (!equal(parts[1], expected)) throw new BizError('Invalid setup session', 403);
		let payload;
		try {
			payload = JSON.parse(decode(parts[0]));
		} catch {
			throw new BizError('Invalid setup session', 403);
		}
		if (payload?.purpose !== PURPOSE || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) {
			throw new BizError('Setup session has expired', 403);
		}
		return payload;
	},
};

export default setupSessionService;
