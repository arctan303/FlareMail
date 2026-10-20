import BizError from '../error/biz-error';
import verifyUtils from './verify-utils';

export function normalizeRecipients(to, cc = [], bcc = [], limit = 20) {
	const seen = new Set();
	const list = (values, field) => {
		if (values === undefined || values === null || values === '') values = [];
		if (!Array.isArray(values)) throw new BizError(`${field} recipients must be an array.`, 400);
		// Bound the raw input too; duplicates must not bypass the parsing budget.
		if (values.length > limit) throw new BizError(`A message can have at most ${limit} recipients.`, 400);
		return values.flatMap(value => {
			if (typeof value !== 'string') throw new BizError('Recipient addresses must be strings.', 400);
			const address = value.trim().toLowerCase();
			if (address.length > 254 || !verifyUtils.isEmail(address)) throw new BizError('One or more recipient addresses are invalid.', 400);
			if (seen.has(address)) return [];
			seen.add(address);
			return [address];
		});
	};
	const receiveEmail = list(to, 'To');
	const normalizedCc = list(cc, 'Cc');
	const normalizedBcc = list(bcc, 'Bcc');
	if (!receiveEmail.length) throw new BizError('At least one To recipient is required.', 400);
	if (seen.size > limit) throw new BizError(`A message can have at most ${limit} recipients across To, Cc and Bcc.`, 400);
	return { receiveEmail, cc: normalizedCc, bcc: normalizedBcc, allRecipients: [...seen] };
}

export function addressList(value) {
	if (typeof value === 'string') {
		try { value = JSON.parse(value); } catch { value = [value]; }
	}
	if (!Array.isArray(value)) return [];
	const values = value.flatMap(item => Array.isArray(item?.group) ? addressList(item.group) : [typeof item === 'string' ? item : item?.address]);
	return [...new Set(values.map(item => String(item || '').trim().toLowerCase()).filter(address => address.length <= 254 && verifyUtils.isEmail(address)))];
}

export function replyRecipientLists(original, ownAddresses = [], replyAll = false) {
	const sent = Number(original?.type) === 1;
	let to = sent ? addressList(original.recipient) : addressList(original.replyTo);
	if (!to.length) to = addressList([sent ? original.toEmail : original.sendEmail]);
	if (!replyAll) return { receiveEmail: to, cc: [] };
	const own = new Set(ownAddresses.map(value => String(value || '').trim().toLowerCase()));
	const seen = new Set(own);
	const take = values => values.filter(address => !seen.has(address) && (seen.add(address), true));
	to = take(to);
	const cc = take([...(sent ? [] : addressList(original.recipient)), ...addressList(original.cc)]);
	// The primary reply target can be one of our aliases, e.g. a sent-to-self mail.
	if (!to.length && cc.length) to.push(cc.shift());
	return { receiveEmail: to, cc };
}

export async function ownedMailIdentities(c, userId) {
	const rows = await c.env.db.prepare(`
		SELECT email FROM account WHERE user_id = ?
		UNION SELECT email FROM user WHERE user_id = ?
	`).bind(userId, userId).all();
	return addressList((rows.results || []).map(row => row.email));
}

export async function sendPayloadHash(params, internalContext = {}) {
	const attachments = await Promise.all(params.attachments.map(async item => {
		let content = item.content;
		if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
			const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
			content = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
		}
		// Keep every accepted attachment option in the receipt. MIME metadata
		// changes must not replay a message accepted with different options.
		return Object.fromEntries(Object.keys({ ...item, content }).sort().map(key => [key, key === 'content' ? content : item[key]]));
	}));
	const data = JSON.stringify({ accountId: params.accountId, to: params.receiveEmail, cc: params.cc, bcc: params.bcc,
		subject: params.subject, text: params.text, content: params.content, sendType: params.sendType, emailId: params.emailId, attachments, internalContext });
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))).map(n => n.toString(16).padStart(2, '0')).join('');
}
