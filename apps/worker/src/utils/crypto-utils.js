const encoder = new TextEncoder();

const PBKDF2_ALGORITHM = 'pbkdf2-sha256';
// Cloudflare Workers production rejects PBKDF2 iteration counts above 100,000.
const PBKDF2_ITERATIONS = 100000;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

function toBase64(bytes) {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

function toBase64Url(bytes) {
	return toBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64(value) {
	return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index++) {
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return difference === 0;
}

const saltHashUtils = {
	toBase64Url,

	async hashSecret(value) {
		const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
		return toBase64Url(new Uint8Array(digest));
	},
	passwordLength(password) {
		return typeof password === 'string' ? Array.from(password).length : 0;
	},

	passwordPolicyError(password) {
		const length = this.passwordLength(password);
		if (length < MIN_PASSWORD_LENGTH) {
			return `密码长度至少为 ${MIN_PASSWORD_LENGTH} 个字符`;
		}
		if (length > MAX_PASSWORD_LENGTH) {
			return `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 个字符`;
		}
		return null;
	},

	generateSalt(length = 16) {
		const array = new Uint8Array(length);
		crypto.getRandomValues(array);
		return toBase64(array);
	},

	async hashPassword(password) {
		const salt = this.generateSalt();
		const hash = await this.genPbkdf2Password(password, salt, PBKDF2_ITERATIONS);
		return {
			salt: `${PBKDF2_ALGORITHM}$${PBKDF2_ITERATIONS}$${salt}`,
			hash,
		};
	},

	async genHashPassword(password, salt) {
		const data = encoder.encode(salt + password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return toBase64(new Uint8Array(hashArray));
	},

	async genPbkdf2Password(password, salt, iterations) {
		const key = await crypto.subtle.importKey(
			'raw',
			encoder.encode(password),
			'PBKDF2',
			false,
			['deriveBits'],
		);
		const bits = await crypto.subtle.deriveBits({
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: fromBase64(salt),
			iterations,
		}, key, 256);
		return toBase64(new Uint8Array(bits));
	},

	async verifyPasswordDetailed(inputPassword, salt, storedHash) {
		if (typeof salt === 'string' && salt.startsWith(`${PBKDF2_ALGORITHM}$`)) {
			const [, iterationsText, rawSalt] = salt.split('$');
			const iterations = Number(iterationsText);
			if (!Number.isInteger(iterations) || iterations < 1 || !rawSalt) {
				return { valid: false, needsUpgrade: false };
			}
			const hash = await this.genPbkdf2Password(inputPassword, rawSalt, iterations);
			return {
				valid: constantTimeEqual(hash, storedHash),
				needsUpgrade: iterations < PBKDF2_ITERATIONS,
			};
		}

		const legacyHash = await this.genHashPassword(inputPassword, salt);
		return {
			valid: constantTimeEqual(legacyHash, storedHash),
			needsUpgrade: true,
		};
	},

	async verifyPassword(inputPassword, salt, storedHash) {
		return (await this.verifyPasswordDetailed(inputPassword, salt, storedHash)).valid;
	},

	genRandomPwd(length = 8) {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		for (let i = 0; i < length; i++) {
			result += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return result;
	}
};

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PBKDF2_ITERATIONS };

export default saltHashUtils;
