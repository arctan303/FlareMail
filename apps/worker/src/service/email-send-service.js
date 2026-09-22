import { Resend } from 'resend';
import { validateCloudflareMessage } from '../utils/cloudflare-mail';
import dayjs from 'dayjs';
import kvConst from '../const/kv-const';
import { emailConst, isDel, settingConst } from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import emailUtils from '../utils/email-utils';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import email from '../entity/email';
import { att } from '../entity/att';
import { and, eq } from 'drizzle-orm';
import attService from './att-service';
import settingService from './setting-service';
import accountService from './account-service';
import userService from './user-service';

const RESEND_MESSAGE_ID_TIMEOUT_MS = 1500;
const MESSAGE_ID_WARNING = 'The provider accepted the message, but its Message-ID could not be retrieved.';

function providerMessageId(value) {
	const id = String(value || '').trim();
	return /^<[^<>\s@\u0000-\u001f\u007f]+@[^<>\s@\u0000-\u001f\u007f]+>$/.test(id) ? id : '';
}

export const emailSendService = {
	buildReplyHeaders(messageId, references) {
		const inReplyTo = String(messageId || '').trim();
		if (!inReplyTo) return undefined;
		const referenceIds = String(references || '')
			.match(/<[^<>\r\n]+>/g) || [];
		if (!referenceIds.includes(inReplyTo)) referenceIds.push(inReplyTo);
		return {
			'in-reply-to': inReplyTo,
			'references': referenceIds.join(' '),
		};
	},

	async claimSendRequest(c, userId, requestId) {
		let inserted;
		try {
			inserted = await c.env.db.prepare(`
				INSERT OR IGNORE INTO send_request(user_id, request_id)
				VALUES (?, ?)
				RETURNING request_id AS requestId
			`).bind(userId, requestId).first();
		} catch (error) {
			if (error.message?.includes('no such table')) {
				throw new BizError('Database upgrade required before sending mail.', 503);
			}
			throw error;
		}
		if (inserted) return null;

		const existing = await c.env.db.prepare(`
			SELECT email_id AS emailId, status, delivery_status AS deliveryStatus, warning,
			       recipient_count AS recipientCount, quota_reserved AS quotaReserved
			FROM send_request
			WHERE user_id = ? AND request_id = ?
		`).bind(userId, requestId).first();
		if (existing?.status === 'pending' && !existing.emailId) {
			const stale = await this.deleteSendRequestAndReleaseQuota(c, userId, requestId, true);
			if (stale) {
				return this.claimSendRequest(c, userId, requestId);
			}
		}
		if (existing?.emailId) {
			const existingEmail = await orm(c).select().from(email).where(and(
				eq(email.emailId, existing.emailId),
				eq(email.userId, userId),
			)).get();
			if (existingEmail) {
				if (existing.status === 'pending' && existingEmail.status === emailConst.status.FAILED) {
					if (await this.deleteSendRequestAndReleaseQuota(c, userId, requestId)) {
						return this.claimSendRequest(c, userId, requestId);
					}
				}
				let warning = existing.warning;
				let deliveryStatus = existing.deliveryStatus;
				if (existing.status === 'pending') {
					warning ||= 'A previous delivery attempt ended without a confirmed response; do not resend automatically.';
					deliveryStatus = existingEmail.status === emailConst.status.SAVING
						? emailConst.status.DELAYED
						: existingEmail.status;
					try {
						await this.completeSendRequest(c, userId, requestId, existingEmail.emailId, deliveryStatus, warning);
						if (existingEmail.status === emailConst.status.SAVING) {
							await orm(c).update(email).set({
								status: deliveryStatus,
								message: JSON.stringify({ message: warning }),
							}).where(eq(email.emailId, existingEmail.emailId)).run();
						}
					} catch (error) {
						console.error('Failed to recover pending send state', error?.message || error?.name || 'unknown error');
					}
				}
				if (Number.isInteger(deliveryStatus)) existingEmail.status = deliveryStatus;
				existingEmail.attList = await attService.selectByEmailIds(c, [existingEmail.emailId]);
				existingEmail.requestId = requestId;
				existingEmail.idempotentReplay = true;
				if (warning) existingEmail.deliveryWarning = warning;
				return existingEmail;
			}
		}
		throw new BizError('This send request is already being processed or has an unknown delivery outcome.', 409);
	},

	async deleteSendRequestAndReleaseQuota(c, userId, requestId, staleOnly = false) {
		const condition = staleOnly
			? `AND status = 'pending' AND email_id IS NULL AND create_time <= datetime('now', '-5 minutes')`
			: '';
		const results = await c.env.db.batch([
			c.env.db.prepare(`
				UPDATE user
				SET send_count = MAX(0, CAST(send_count AS INTEGER) - COALESCE((
					SELECT recipient_count FROM send_request
					WHERE user_id = ? AND request_id = ? AND quota_reserved = 1 ${condition}
				), 0))
				WHERE user_id = ? AND EXISTS (
					SELECT 1 FROM send_request WHERE user_id = ? AND request_id = ? ${condition}
				)
			`).bind(userId, requestId, userId, userId, requestId),
			c.env.db.prepare(`
				DELETE FROM send_request WHERE user_id = ? AND request_id = ? ${condition}
				RETURNING request_id AS requestId
			`).bind(userId, requestId),
		]);
		return results[1]?.results?.[0] || null;
	},

	async completeSendRequest(c, userId, requestId, emailId, deliveryStatus, warning = '') {
		await c.env.db.prepare(`
			UPDATE send_request
			SET email_id = ?, status = 'accepted', delivery_status = ?, warning = ?,
			    completed_time = CURRENT_TIMESTAMP
			WHERE user_id = ? AND request_id = ?
		`).bind(emailId, deliveryStatus, warning, userId, requestId).run();
	},

	async incrementDaySendStat(c, quantity) {
		try {
			const dateStr = dayjs().format('YYYY-MM-DD');
			const key = kvConst.SEND_DAY_COUNT + dateStr;
			const current = Number(await c.env.kv.get(key) || 0);
			await c.env.kv.put(key, String(current + quantity), { expirationTtl: 60 * 60 * 24 });
		} catch (error) {
			console.error('Failed to update aggregate send statistics', error?.message || error?.name || 'unknown error');
		}
	},

	async prepareCloudflareEmail(params) {
		const sendForm = {
			from: { email: params.accountEmail, name: params.name },
			to: [...params.receiveEmail],
			subject: params.subject
		};

		if (params.text) {
			sendForm.text = params.text;
		}

		if (params.html) {
			sendForm.html = params.html;
		}

		const attachments = await this.toCloudflareAttachments(params.attachments);
		if (attachments.length > 0) {
			sendForm.attachments = attachments;
		}

		const replyHeaders = params.sendType === 'reply'
			? this.buildReplyHeaders(params.messageId, params.references)
			: undefined;
		if (replyHeaders) sendForm.headers = replyHeaders;

		validateCloudflareMessage(sendForm);
		return sendForm;
	},

	async sendByCloudflareEmail(c, params, prepared) {
		const sendForm = prepared || await this.prepareCloudflareEmail(params);
		const result = await c.env.email.send(sendForm);
		if (typeof result?.messageId !== 'string' || !result.messageId) throw new Error('Cloudflare returned no message ID.');
		const messageId = providerMessageId(result.messageId);

		return {
			data: {
				id: result.messageId,
				messageId,
				messageIdWarning: messageId ? '' : 'The provider accepted the message, but did not return an RFC Message-ID.',
			}
		};
	},

	async sendByResend(resendToken, params) {
		const resend = new Resend(resendToken);

		const sendForm = {
			from: `${params.name} <${params.accountEmail}>`,
			to: [...params.receiveEmail],
			subject: params.subject,
			text: params.text,
			html: params.html,
			attachments: await this.toResendAttachments(params.attachments)
		};

		const replyHeaders = params.sendType === 'reply'
			? this.buildReplyHeaders(params.messageId, params.references)
			: undefined;
		if (replyHeaders) sendForm.headers = replyHeaders;

		const result = await resend.emails.send(sendForm);
		if (result?.data?.id && !result.error) {
			Object.assign(result.data, await this.retrieveResendMessageId(resend, result.data.id));
		}
		return result;
	},

	async retrieveResendMessageId(resend, id, timeoutMs = RESEND_MESSAGE_ID_TIMEOUT_MS) {
		const controller = new AbortController();
		let timer;
		try {
			const timeout = new Promise(resolve => {
				timer = setTimeout(() => {
					controller.abort();
					resolve(null);
				}, timeoutMs);
			});
			const retrieved = await Promise.race([
				resend.get(`/emails/${encodeURIComponent(id)}`, { signal: controller.signal }),
				timeout,
			]);
			const messageId = providerMessageId(retrieved?.data?.message_id);
			if (messageId) return { messageId, messageIdWarning: '' };
			return { messageId: '', messageIdWarning: MESSAGE_ID_WARNING };
		} catch (error) {
			console.error('Failed to retrieve the accepted Resend Message-ID', error?.message || error?.name || 'unknown error');
			return { messageId: '', messageIdWarning: MESSAGE_ID_WARNING };
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	},

	async toCloudflareAttachments(attachments) {
		const encodedAttachments = await Promise.all((attachments || []).map(async attachment => ({
			...attachment, content: await this.toAttachmentBase64(attachment),
		})));

		return encodedAttachments.map(attachment => {
			const item = {
				content: attachment.content,
				filename: attachment.filename,
				type: attachment.mimeType || attachment.contentType || attachment.type || 'application/octet-stream',
				disposition: attachment.contentId ? 'inline' : 'attachment'
			};

			if (attachment.contentId) {
				item.contentId = attachment.contentId.replace(/^<|>$/g, '');
			}

			return item;
		});
	},

	async toResendAttachments(attachments = []) {
		const result = [];

		for (const attachment of attachments) {
			const content = await this.toAttachmentBase64(attachment);
			if (!content) {
				continue;
			}

			result.push({
				...attachment,
				content,
				contentType: attachment.contentType || attachment.mimeType || attachment.type || 'application/octet-stream'
			});
		}

		return result;
	},

	async toArrayBufferAttachments(attachments = []) {
		const result = [];

		for (const attachment of attachments) {
			const content = await this.toAttachmentArrayBuffer(attachment);
			if (!content) {
				continue;
			}

			result.push({ ...attachment, content });
		}

		return result;
	},

	async toAttachmentBase64(attachment) {
		let content = attachment.content;

		if (!content) {
			return null;
		}

		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				content = content.split(',')[1] || content;
			}
			return content.replace(/\s+/g, '');
		}

		const arrayBuffer = await this.toAttachmentArrayBuffer(attachment);
		if (!arrayBuffer) {
			return null;
		}

		const bytes = new Uint8Array(arrayBuffer);
		let binary = '';

		for (let i = 0; i < bytes.length; i += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		}

		return btoa(binary);
	},

	async toAttachmentArrayBuffer(attachment) {
		let content = attachment.content;

		if (!content) {
			return null;
		}

		if (content instanceof ArrayBuffer) {
			return content;
		}

		if (content instanceof Uint8Array) {
			return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
		}

		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				content = content.split(',')[1] || content;
			}
			return fileUtils.base64ToUint8Array(content.replace(/\s+/g, '')).buffer;
		}

		return content;
	},

	async HandleOnSiteEmail(c, receiveEmail, sendEmailData, attList) {
		const { noRecipient } = await settingService.query(c);
		const accountList = (await Promise.all(receiveEmail.map(async address => {
			const accountRow = await accountService.selectByEmail(c, address);
			if (!accountRow) return null;
			const owner = await userService.selectByIdIncludeDel(c, accountRow.userId);
			return owner?.isDel === isDel.NORMAL ? accountRow : null;
		}))).filter(Boolean);

		let handledCount = 0;
		let deliveredCount = 0;
		let bouncedCount = 0;
		let failedCount = 0;
		let firstBounceMessage = '';

		for (const address of receiveEmail) {
			const accountRow = accountList.find(row => row.email.toLowerCase() === address.toLowerCase());
			if (!accountRow && noRecipient === settingConst.noRecipient.CLOSE) {
				handledCount++;
				bouncedCount++;
				firstBounceMessage ||= `Recipient not found: <${address}>`;
				continue;
			}

			const emailValues = {
				...sendEmailData,
				emailId: null,
				userId: accountRow?.userId || 0,
				accountId: accountRow?.accountId || 0,
				type: emailConst.type.RECEIVE,
				status: accountRow ? emailConst.status.RECEIVE : emailConst.status.NOONE,
				toEmail: address,
				toName: emailUtils.getName(address),
			};
			delete emailValues.attList;
			delete emailValues.deliveryWarning;

			let receivedRow;
			try {
				receivedRow = await orm(c).insert(email).values(emailValues).returning().get();
				handledCount++;
				for (const attRow of attList) {
					const attValues = {
						...attRow,
						attId: null,
						emailId: receivedRow.emailId,
						accountId: receivedRow.accountId,
						userId: receivedRow.userId,
					};
					await orm(c).insert(att).values(attValues).run();
				}
				deliveredCount++;
			} catch (error) {
				failedCount++;
				console.error('Failed to persist an internal recipient copy', error?.message || error?.name || 'unknown error');
				if (receivedRow) {
					try {
						await orm(c).update(email).set({
							status: emailConst.status.FAILED,
							message: JSON.stringify({ message: 'Internal attachment metadata could not be stored completely.' }),
						}).where(eq(email.emailId, receivedRow.emailId)).run();
					} catch (updateError) {
						console.error('Failed to mark partial internal delivery', updateError?.message || updateError?.name || 'unknown error');
					}
				}
			}
		}

		const status = deliveredCount === 0 && bouncedCount > 0 && failedCount === 0
			? emailConst.status.BOUNCED
			: emailConst.status.DELIVERED;
		const message = firstBounceMessage
			? JSON.stringify({ message: firstBounceMessage })
			: '';
		return { status, message, handledCount, deliveredCount, bouncedCount, failedCount };
	},

	async cleanupSendRequests(c) {
		let pendingWithEmail;
		try {
			pendingWithEmail = await c.env.db.prepare(`
				SELECT user_id AS userId, request_id AS requestId
				FROM send_request
				WHERE status = 'pending' AND email_id IS NOT NULL
				  AND create_time <= datetime('now', '-5 minutes')
			`).all();
		} catch (error) {
			if (error.message?.includes('no such table')) return;
			throw error;
		}
		for (const row of pendingWithEmail.results) {
			try {
				const state = await c.env.db.prepare(`
					SELECT email.status AS emailStatus
					FROM send_request
					LEFT JOIN email ON email.email_id = send_request.email_id
					WHERE send_request.user_id = ? AND send_request.request_id = ?
				`).bind(row.userId, row.requestId).first();
				if (state?.emailStatus === emailConst.status.FAILED) {
					await this.deleteSendRequestAndReleaseQuota(c, row.userId, row.requestId);
				} else {
					await this.claimSendRequest(c, row.userId, row.requestId);
				}
			} catch (error) {
				console.error('Failed to recover an old pending send request', error?.message || error?.name || 'unknown error');
			}
		}

		const staleWithoutEmail = await c.env.db.prepare(`
			SELECT user_id AS userId, request_id AS requestId
			FROM send_request
			WHERE status = 'pending' AND email_id IS NULL
			  AND create_time <= datetime('now', '-1 day')
		`).all();
		for (const row of staleWithoutEmail.results) {
			await this.deleteSendRequestAndReleaseQuota(c, row.userId, row.requestId, true);
		}
		await c.env.db.prepare(`
			DELETE FROM send_request
			WHERE status = 'accepted'
			  AND COALESCE(completed_time, create_time) <= datetime('now', '-30 days')
		`).run();
	}
};

export default emailSendService;
