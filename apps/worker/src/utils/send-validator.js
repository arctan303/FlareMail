import { parseHTML } from 'linkedom';
import BizError from '../error/biz-error';
import verifyUtils from './verify-utils';

export const sendLimits = Object.freeze({
	maxRecipients: 20,
	maxAttachments: 10,
	maxSingleAttachmentBytes: 10 * 1024 * 1024,
	maxTotalAttachmentBytes: 20 * 1024 * 1024,
	maxSubjectChars: 998,
	maxTextChars: 2 * 1024 * 1024,
	maxHtmlChars: 30 * 1024 * 1024,
});

function fail(message) {
	throw new BizError(message, 400);
}

function normalizedBase64(value) {
	if (typeof value !== 'string') fail('Attachment content must be base64 encoded.');
	const comma = value.startsWith('data:') ? value.indexOf(',') : -1;
	if (value.startsWith('data:') && comma < 0) fail('Attachment data URL is invalid.');
	const payload = (comma >= 0 ? value.slice(comma + 1) : value).replace(/\s+/g, '');
	if (!payload || payload.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
		fail('Attachment content is not valid base64.');
	}
	return payload;
}

function base64Size(value) {
	const payload = normalizedBase64(value);
	const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
	return Math.floor(payload.length * 3 / 4) - padding;
}

function binarySize(content) {
	if (typeof content === 'string') return base64Size(content);
	if (content instanceof ArrayBuffer) return content.byteLength;
	if (ArrayBuffer.isView(content)) return content.byteLength;
	fail('Attachment content type is unsupported.');
}

function inlineImageDataUrls(html) {
	if (!html) return [];
	let document;
	try {
		({ document } = parseHTML(html));
	} catch {
		fail('Email HTML is invalid.');
	}
	const sources = Array.from(document.querySelectorAll('img'))
		.map(image => image.getAttribute('src') || '')
		.filter(src => src.toLowerCase().startsWith('data:image/'));
	for (const source of sources) {
		if (!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(source)) {
			fail('Inline images must be base64-encoded PNG, JPEG, GIF, WebP, or BMP files.');
		}
	}
	return sources;
}

export function normalizeSendParams(params = {}) {
	const accountId = Number(params.accountId);
	if (!Number.isInteger(accountId) || accountId <= 0) fail('A valid sender account is required.');

	if (!Array.isArray(params.receiveEmail)) fail('Recipients must be an array.');
	const receiveEmail = [...new Set(params.receiveEmail.map(value => String(value || '').trim().toLowerCase()))];
	if (receiveEmail.length === 0) fail('At least one recipient is required.');
	if (receiveEmail.length > sendLimits.maxRecipients) fail(`A message can have at most ${sendLimits.maxRecipients} recipients.`);
	if (receiveEmail.some(address => !verifyUtils.isEmail(address))) fail('One or more recipient addresses are invalid.');

	const subject = String(params.subject || '').trim();
	if (!subject) fail('Subject is required.');
	if (Array.from(subject).length > sendLimits.maxSubjectChars) fail('Subject is too long.');

	const text = typeof params.text === 'string' ? params.text : '';
	const content = typeof params.content === 'string' ? params.content : '';
	if (!text && !content) fail('Message content is required.');
	if (text.length > sendLimits.maxTextChars) fail('Plain-text message body is too large.');
	if (content.length > sendLimits.maxHtmlChars) fail('HTML message body is too large.');

	const rawAttachments = params.attachments ?? [];
	if (!Array.isArray(rawAttachments)) fail('Attachments must be an array.');
	const attachments = rawAttachments.map(attachment => ({
		...attachment,
		filename: String(attachment?.filename || '').trim(),
		type: String(attachment?.type || attachment?.contentType || 'application/octet-stream').slice(0, 255),
		content: typeof attachment?.content === 'string'
			? normalizedBase64(attachment.content)
			: attachment?.content,
	}));
	for (const attachment of attachments) {
		if (!attachment || typeof attachment !== 'object') fail('Attachment is invalid.');
		const filename = String(attachment.filename || '').trim();
		if (!filename) fail('Attachment filename is required.');
		if (filename.length > 255 || /[\r\n\0]/.test(filename)) fail('Attachment filename is invalid.');
		if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(attachment.type)) fail('Attachment MIME type is invalid.');
		if (!attachment.content) fail('Attachment content is required.');
	}

	const inlineImages = inlineImageDataUrls(content);
	validateSizes([
		...attachments.map(attachment => ({ size: binarySize(attachment.content) })),
		...inlineImages.map(src => ({ size: base64Size(src) })),
	]);

	const sendType = params.sendType || 'new';
	if (!['new', 'reply', 'forward'].includes(sendType)) fail('Send type is invalid.');
	const emailId = Number(params.emailId || 0);
	if (sendType === 'reply' && (!Number.isInteger(emailId) || emailId <= 0)) fail('Reply message is invalid.');
	const requestId = params.requestId
		? String(params.requestId).trim()
		: crypto.randomUUID();
	if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) fail('Send request ID is invalid.');

	return {
		...params,
		accountId,
		receiveEmail,
		subject,
		text,
		content,
		attachments,
		sendType,
		emailId,
		requestId,
		name: typeof params.name === 'string' ? params.name.trim().slice(0, 100) : '',
	};
}

export function validatePreparedAttachments(attachments = []) {
	validateSizes(attachments.map(attachment => ({ size: binarySize(attachment.content) })));
}

function validateSizes(attachments) {
	if (attachments.length > sendLimits.maxAttachments) {
		fail(`A message can have at most ${sendLimits.maxAttachments} attachments, including inline images.`);
	}
	let total = 0;
	for (const attachment of attachments) {
		const size = Number(attachment.size);
		if (!Number.isFinite(size) || size < 0) fail('Attachment size is invalid.');
		if (size > sendLimits.maxSingleAttachmentBytes) fail('Each attachment must be 10 MB or smaller.');
		total += size;
	}
	if (total > sendLimits.maxTotalAttachmentBytes) fail('Total attachment size must be 20 MB or smaller.');
}
