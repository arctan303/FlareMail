import PostalMime from 'postal-mime';
import emailService from '../service/email-service';
import accountService from '../service/account-service';
import settingService from '../service/setting-service';
import attService from '../service/att-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';
import { emailConst, isDel, settingConst } from '../const/entity-const';
import emailUtils from '../utils/email-utils';

import userService from '../service/user-service';
import sanitizeEmailHtml from '../utils/html-sanitizer';
import codeExtractor from '../utils/code-extractor';
import { selectPersistedAdmin } from '../security/admin-identity';

export async function email(message, env, ctx) {
	try {
		const {
			receive,
			r2Domain,
			noRecipient,
			blackSubject,
			blackContent,
			blackFrom
		} = await settingService.query({ env });

		if (receive === settingConst.receive.CLOSE) {
			message.setReject('Service suspended');
			return;
		}

		const rawMessage = await new Response(message.raw).arrayBuffer();
		const parsedEmail = await PostalMime.parse(rawMessage);
		if (checkBlock(blackSubject, blackContent, blackFrom, parsedEmail)) {
			message.setReject('Message rejected');
			return;
		}

		let account = await accountService.selectByEmail({ env }, message.to);
		let userRow = null;
		if (account) {
			userRow = await userService.selectByIdIncludeDel({ env }, account.userId);
			if (!userRow || userRow.isDel !== isDel.NORMAL) {
				account = null;
				userRow = null;
			}
		}
		if (!account) {
			const adminRow = await selectPersistedAdmin({ env });
			const policy = adminRow?.unmatchedPolicy || 'reject';

			if (policy === 'drop') {
				return;
			}
			if (policy === 'reject' || noRecipient === settingConst.noRecipient.CLOSE) {
				message.setReject('Recipient not found');
				return;
			}
		}



		if (!parsedEmail.to) {
			parsedEmail.to = [{ address: message.to, name: emailUtils.getName(message.to) }];
		}

		const toName = parsedEmail.to.find(item => item.address === message.to)?.name || '';
		const code = codeExtractor.extract({
			subject: parsedEmail.subject,
			text: parsedEmail.text,
			html: parsedEmail.html
		});

		const params = {
			toEmail: message.to,
			toName,
			sendEmail: parsedEmail.from.address,
			name: parsedEmail.from.name || emailUtils.getName(parsedEmail.from.address),
			subject: parsedEmail.subject,
			code,
			content: sanitizeEmailHtml(parsedEmail.html),
			text: parsedEmail.text,
			cc: parsedEmail.cc ? JSON.stringify(parsedEmail.cc) : '[]',
			bcc: parsedEmail.bcc ? JSON.stringify(parsedEmail.bcc) : '[]',
			recipient: JSON.stringify(parsedEmail.to),
			inReplyTo: parsedEmail.inReplyTo,
			relation: parsedEmail.references,
			messageId: parsedEmail.messageId,
			userId: account ? account.userId : 0,
			accountId: account ? account.accountId : 0,
			isDel: isDel.DELETE,
			status: emailConst.status.SAVING
		};

		const attachments = [];
		const cidAttachments = [];
		for (const item of parsedEmail.attachments) {
			const attachment = { ...item };
			attachment.key = constant.ATTACHMENT_PREFIX
				+ await fileUtils.createAttachmentKey(attachment.content, item.filename);
			attachment.size = item.content.length ?? item.content.byteLength;
			attachments.push(attachment);
			if (attachment.contentId) {
				cidAttachments.push(attachment);
			}
		}

		let emailRow = await emailService.receive({ env }, params, cidAttachments, r2Domain);
		attachments.forEach(attachment => {
			attachment.emailId = emailRow.emailId;
			attachment.userId = emailRow.userId;
			attachment.accountId = emailRow.accountId;
		});

		let attachmentSaveFailed = false;
		try {
			if (attachments.length > 0) {
				await attService.addAtt({ env }, attachments);
			}
		} catch (error) {
			attachmentSaveFailed = true;
			console.error('Failed to save attachments', error?.message || error?.name || 'unknown error');
		}
		if (attachmentSaveFailed) {
			await env.db.prepare(`
				UPDATE email
				SET is_del = ?, status = ?, message = ?
				WHERE email_id = ?
			`).bind(
				isDel.NORMAL,
				emailConst.status.FAILED,
				JSON.stringify({ message: 'One or more attachments could not be stored; forwarding was skipped.' }),
				emailRow.emailId,
			).run();
			return;
		}

		emailRow = await emailService.completeReceive(
			{ env },
			account ? emailConst.status.RECEIVE : emailConst.status.NOONE,
			emailRow.emailId
		);

		if (
			userRow &&
			userRow.isDel === isDel.NORMAL &&
			userRow.status === 0 &&
			userRow.forwardStatus === settingConst.forwardStatus.OPEN &&
			userRow.forwardEmail
		) {
			const isForwardingAllowed = account ? account.forwardStatus === 0 : userRow.mainForwardStatus === 0;
			if (isForwardingAllowed) {
				try {
					await message.forward(userRow.forwardEmail);
				} catch (error) {
					console.error('Failed to forward received email', error?.message || error?.name || 'unknown error');
				}
			}
		}

	} catch (error) {
		console.error('Failed to receive email', error?.message || error?.name || 'unknown error');
		throw error;
	}
}

function checkBlock(blackSubjectStr, blackContentStr, blackFromStr, parsedEmail) {
	const blackFromList = blackFromStr ? blackFromStr.split(',').filter(item => item) : [];
	const blackContentList = blackContentStr ? blackContentStr.split(',').filter(item => item) : [];
	const blackSubjectList = blackSubjectStr ? blackSubjectStr.split(',').filter(item => item) : [];

	for (const blackSubject of blackSubjectList) {
		if (parsedEmail.subject?.includes(blackSubject)) {
			return true;
		}
	}

	for (const blackContent of blackContentList) {
		if (parsedEmail.html?.includes(blackContent) || parsedEmail.text?.includes(blackContent)) {
			return true;
		}
	}

	for (const blackFrom of blackFromList) {
		if (
			parsedEmail.from.address === blackFrom ||
			emailUtils.getDomain(parsedEmail.from.address) === blackFrom
		) {
			return true;
		}
	}

	return false;
}
