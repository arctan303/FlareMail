import BizError from '../error/biz-error';

const IMAGE_TYPES = Object.freeze({
	'image/png': { extension: 'png', signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
	'image/jpeg': { extension: 'jpg', signatures: [[0xff, 0xd8, 0xff]] },
	'image/webp': { extension: 'webp', signatures: [[0x52, 0x49, 0x46, 0x46]] },
});

function startsWith(bytes, signature, offset = 0) {
	return signature.every((value, index) => bytes[offset + index] === value);
}

function readU16BE(bytes, offset) {
	return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU24LE(bytes, offset) {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32BE(bytes, offset) {
	return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function pngDimensions(bytes) {
	if (bytes.length < 24 || !startsWith(bytes, IMAGE_TYPES['image/png'].signatures[0])
		|| String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
	return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

function jpegDimensions(bytes) {
	if (bytes.length < 4 || !startsWith(bytes, IMAGE_TYPES['image/jpeg'].signatures[0])) return null;
	const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
	let offset = 2;
	while (offset + 8 < bytes.length) {
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (offset + 1 >= bytes.length) return null;
		const length = readU16BE(bytes, offset);
		if (length < 2 || offset + length > bytes.length) return null;
		if (sof.has(marker)) {
			return { height: readU16BE(bytes, offset + 3), width: readU16BE(bytes, offset + 5) };
		}
		offset += length;
	}
	return null;
}

function webpDimensions(bytes) {
	if (bytes.length < 30 || !startsWith(bytes, IMAGE_TYPES['image/webp'].signatures[0])
		|| String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') return null;
	const chunk = String.fromCharCode(...bytes.slice(12, 16));
	if (chunk === 'VP8X') {
		return { width: readU24LE(bytes, 24) + 1, height: readU24LE(bytes, 27) + 1 };
	}
	if (chunk === 'VP8L' && bytes[20] === 0x2f) {
		return {
			width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
			height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
		};
	}
	if (chunk === 'VP8 ' && startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
		return {
			width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
			height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
		};
	}
	return null;
}

function dimensions(bytes, mimeType) {
	if (mimeType === 'image/png') return pngDimensions(bytes);
	if (mimeType === 'image/jpeg') return jpegDimensions(bytes);
	if (mimeType === 'image/webp') return webpDimensions(bytes);
	return null;
}

function filenameExtension(name) {
	const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
	return match?.[1] || '';
}

async function readImage(file, {
	allowedTypes = Object.keys(IMAGE_TYPES),
	maxBytes,
	maxDimension = 2048,
	exactDimension = null,
} = {}) {
	if (!(file instanceof File) || !allowedTypes.includes(file.type) || file.size <= 0 || file.size > maxBytes) {
		throw new BizError('Invalid brand image.');
	}
	const expectedExtension = IMAGE_TYPES[file.type]?.extension;
	const actualExtension = filenameExtension(file.name);
	if (!expectedExtension || (file.type === 'image/jpeg'
		? !['jpg', 'jpeg'].includes(actualExtension)
		: actualExtension !== expectedExtension)) {
		throw new BizError('Brand image extension does not match its MIME type.');
	}
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	if (!IMAGE_TYPES[file.type].signatures.some(signature => startsWith(bytes, signature))) {
		throw new BizError('Brand image signature does not match its MIME type.');
	}
	if (file.type === 'image/webp' && String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') {
		throw new BizError('Invalid WebP image.');
	}
	const size = dimensions(bytes, file.type);
	if (!size || size.width < 1 || size.height < 1 || size.width > maxDimension || size.height > maxDimension) {
		throw new BizError('Invalid brand image dimensions.');
	}
	if (exactDimension && (size.width !== exactDimension || size.height !== exactDimension)) {
		throw new BizError(`Brand icon must be ${exactDimension}x${exactDimension}.`);
	}
	return { buffer, bytes, width: size.width, height: size.height, mimeType: file.type, extension: expectedExtension };
}

export { readImage };
