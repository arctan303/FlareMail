import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

export const CLOUDFLARE_MAX_MESSAGE_BYTES = 5 * 1024 * 1024;

const bytes = value => new TextEncoder().encode(String(value || '')).byteLength;
const encodedSize = size => {
	const base64 = 4 * Math.ceil(size / 3);
	return base64 + 2 * Math.ceil(base64 / 76);
};

// The provider constructs MIME internally. Allow for encoded bodies, attachment
// folding, boundaries and headers rather than comparing only decoded file sizes.
export function estimateCloudflareMessageBytes(form) {
	let size = 16 * 1024 + bytes(JSON.stringify({ ...form, html: undefined, text: undefined, attachments: undefined }));
	for (const body of [form.text, form.html]) size += Math.max(bytes(body), encodedSize(bytes(body)));
	for (const attachment of form.attachments || []) {
		const contentSize = bytes(attachment.content);
		size += contentSize + 2 * Math.ceil(contentSize / 76) + 1024 + bytes(attachment.filename);
	}
	return size;
}

export function validateCloudflareMessage(form) {
	if (estimateCloudflareMessageBytes(form) > CLOUDFLARE_MAX_MESSAGE_BYTES) {
		throw new BizError(t('cloudflareEmailTooLarge'), 400);
	}
}

// Only documented, definite rejection codes permit a retry. Transport failures
// and internal errors retain the existing unknown-outcome/idempotency handling.
const REJECTION_KEYS = {
	E_SENDER_NOT_VERIFIED: 'cloudflareSenderNotVerified',
	E_SENDER_DOMAIN_NOT_AVAILABLE: 'cloudflareSenderNotVerified',
	E_RECIPIENT_NOT_ALLOWED: 'cloudflareRecipientNotAllowed',
	E_RECIPIENT_SUPPRESSED: 'cloudflareRecipientSuppressed',
	E_CONTENT_TOO_LARGE: 'cloudflareEmailTooLarge',
	E_RATE_LIMIT_EXCEEDED: 'cloudflareEmailRateLimited',
	E_DAILY_LIMIT_EXCEEDED: 'cloudflareEmailRateLimited',
	E_VALIDATION_ERROR: 'cloudflareEmailRejected',
	E_FIELD_MISSING: 'cloudflareEmailRejected',
	E_TOO_MANY_RECIPIENTS: 'cloudflareEmailRejected',
	E_TOO_MANY_ATTACHMENTS: 'cloudflareEmailRejected',
	E_HEADER_NOT_ALLOWED: 'cloudflareEmailRejected',
	E_HEADER_USE_API_FIELD: 'cloudflareEmailRejected',
	E_HEADER_VALUE_INVALID: 'cloudflareEmailRejected',
	E_HEADER_VALUE_TOO_LONG: 'cloudflareEmailRejected',
	E_HEADER_NAME_INVALID: 'cloudflareEmailRejected',
	E_HEADERS_TOO_LARGE: 'cloudflareEmailRejected',
	E_HEADERS_TOO_MANY: 'cloudflareEmailRejected',
};

export function cloudflareRejection(error) {
	const key = REJECTION_KEYS[error?.code];
	if (!key) return null;
	return new BizError(t(key), ['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED'].includes(error.code) ? 429 : 502);
}
