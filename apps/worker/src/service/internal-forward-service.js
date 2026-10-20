import accountService from './account-service';
import userService from './user-service';
import emailService from './email-service';
import emailSendService from './email-send-service';
import managedDomains from './managed-domain-service';
import verifyUtils from '../utils/verify-utils';
import emailUtils from '../utils/email-utils';
import { isDel, settingConst, emailConst } from '../const/entity-const';
import r2Service from './r2-service';
import { parseHTML } from 'linkedom';
import { sendLimits, validatePreparedAttachments } from '../utils/send-validator';

export const INTERNAL_FORWARD_FAILED = 'INTERNAL_FORWARD_FAILED';
const failure = JSON.stringify({ code: INTERNAL_FORWARD_FAILED, message: 'Automatic forwarding failed. The original message is kept in this mailbox.' });

async function readInlineObject(object) {
	const limit = sendLimits.maxSingleAttachmentBytes;
	if (!object || Number(object.size) > limit) throw new Error('Inline attachment unavailable');
	if (object instanceof ArrayBuffer) {
		if (object.byteLength > limit) throw new Error('Inline attachment too large');
		return object;
	}
	const reader = object.body?.getReader();
	if (!reader) throw new Error('Inline attachment stream unavailable');
	const chunks = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new Error('Inline attachment too large');
			}
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes.buffer;
}

const internalForwardService = {
	async inlineContent(c, source, attachments) {
		const content = source.content || '';
		const { document } = parseHTML(content);
		const references = Array.from(document.querySelectorAll('img')).flatMap(image => {
			const src = image.getAttribute('src') || '';
			if (!src.startsWith('{{domain}}')) return [];
			const key = src.slice('{{domain}}'.length);
			if (!key.startsWith('attachments/') || key.length > 1024 || /[\r\n\0]/.test(key)) throw new Error('Invalid inline attachment reference');
			return [{ image, key }];
		});
		if (!references.length) return content;
		if (![source.userId, source.emailId, source.accountId].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Inline attachment owner unavailable');
		validatePreparedAttachments(attachments, references.map(() => ({ size: 0 })));
		// These metadata rows belong to the received copy's user, never merely
		// to the original sender or to a matching global storage key.
		const keys = [...new Set(references.map(item => item.key))];
		const owned = (await c.env.db.prepare(`SELECT key, mime_type AS mimeType, size FROM attachments
			WHERE user_id = ? AND email_id = ? AND account_id = ? AND status = 0 AND key IN (${keys.map(() => '?').join(',')})`)
			.bind(source.userId, source.emailId, source.accountId, ...keys).all()).results || [];
		const byKey = new Map(owned.map(item => [item.key, item]));
		for (const { key } of references) {
			const image = byKey.get(key);
			if (!image || !/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(image.mimeType)) throw new Error('Inline attachment is not owned or available');
		}
		validatePreparedAttachments(attachments, references.map(({ key }) => byKey.get(key)));
		const copies = new Map();
		// Bound each object read and the aggregate MIME size before generating
		// temporary data URLs. Repeated references still count as MIME parts.
		for (const { key } of references) if (!copies.has(key)) {
			const bytes = await readInlineObject(await r2Service.getObj(c, key));
			copies.set(key, { content: bytes });
			validatePreparedAttachments([...attachments, ...references.filter(item => copies.has(item.key)).map(item => copies.get(item.key))]);
		}
		const encoded = new Map();
		for (const { image, key } of references) {
			if (!encoded.has(key)) encoded.set(key, `data:${byKey.get(key).mimeType};base64,${await emailSendService.toAttachmentBase64(copies.get(key))}`);
			image.setAttribute('src', encoded.get(key));
		}
		return document.toString();
	},
	async target(c, source) {
		const mailbox = await accountService.selectById(c, source.accountId);
		if (!mailbox || mailbox.userId !== source.userId || mailbox.email.toLowerCase() !== source.toEmail.toLowerCase()) return null;
		const owner = await userService.selectByIdIncludeDel(c, source.userId);
		if (!owner || owner.isDel !== isDel.NORMAL || owner.status !== 0 || owner.forwardStatus !== settingConst.forwardStatus.OPEN) return null;
		const mailboxForwardStatus = mailbox.email.toLowerCase() === owner.email.toLowerCase() ? owner.mainForwardStatus : mailbox.forwardStatus;
		if (mailboxForwardStatus !== settingConst.forwardStatus.OPEN) return null;
		const target = String(owner.forwardEmail || '').trim().toLowerCase();
		const domains = await managedDomains.get(c);
		if (!target || target.length > 254 || !verifyUtils.isEmail(target) || domains.domains.includes(emailUtils.getDomain(target))) return null;
		if (!await managedDomains.containsEmail(c, mailbox.email)) return null;
		return { mailbox, target };
	},
	async forward(c, source, attachments = []) {
		try {
			let destination = await this.target(c, source);
			if (!destination) return { skipped: true };
			const safeAttachments = await Promise.all(attachments.map(async item => ({ filename: item.filename,
				type: item.type || item.contentType || item.mimeType || 'application/octet-stream', contentId: item.contentId,
				content: await emailSendService.toAttachmentBase64(item) })));
			const content = await this.inlineContent(c, source, safeAttachments);
			// Recheck current settings after any attachment preparation.
			destination = await this.target(c, source);
			if (!destination) return { skipped: true };
			const sent = await emailService.send(c, {
				accountId: destination.mailbox.accountId, receiveEmail: [destination.target], cc: [], bcc: [],
				subject: source.subject || '(no subject)', text: source.text || '', content,
				attachments: safeAttachments, sendType: 'new', requestId: `internal_forward_${source.emailId}`,
			}, source.userId, { forwardSource: source });
			if (![emailConst.status.SENT, emailConst.status.DELIVERED].includes(sent?.[0]?.status)) throw new Error('Forward delivery not confirmed');
			await c.env.db.prepare(`UPDATE email SET message = '' WHERE email_id = ? AND user_id = ? AND type = 0
				AND json_valid(message) AND json_extract(message, '$.code') = ?`)
				.bind(source.emailId, source.userId, INTERNAL_FORWARD_FAILED).run();
			return { accepted: true };
		} catch {
			// Fixed local status only: no provider error body, content or credentials.
			try { await c.env.db.prepare('UPDATE email SET message = ? WHERE email_id = ? AND user_id = ? AND type = 0')
				.bind(failure, source.emailId, source.userId).run(); }
			catch { console.warn('Could not save the automatic forwarding failure notice'); }
			return { accepted: false };
		}
	},
};
export default internalForwardService;
