export const inboundMailLimits = Object.freeze({
	maxRawBytes: 25 * 1024 * 1024,
	maxAttachments: 50,
	maxDecodedAttachmentBytes: 18 * 1024 * 1024,
});

function attachmentSize(attachment) {
	const size = attachment?.content?.byteLength ?? attachment?.content?.length;
	return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

export function inboundRawLimitReason(rawSize) {
	return Number.isFinite(rawSize) && rawSize > inboundMailLimits.maxRawBytes
		? 'Message rejected: raw message exceeds the 25 MiB limit.'
		: '';
}

export function inboundAttachmentLimitReason(attachments = []) {
	if (attachments.length > inboundMailLimits.maxAttachments) {
		return 'Message rejected: attachment count exceeds the limit of 50.';
	}
	let total = 0;
	for (const attachment of attachments) {
		total += attachmentSize(attachment);
		if (total > inboundMailLimits.maxDecodedAttachmentBytes) {
			return 'Message rejected: decoded attachments exceed the 18 MiB total limit.';
		}
	}
	return '';
}
