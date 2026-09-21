import orm from '../entity/orm';
import email from '../entity/email';
import { attConst, emailConst, isDel, settingConst } from '../const/entity-const';
import { and, desc, eq, gt, inArray, lt, count, asc, ne, or, like, sql } from 'drizzle-orm';
import { star } from '../entity/star';
import settingService from './setting-service';
import accountService from './account-service';
import BizError from '../error/biz-error';
import emailUtils from '../utils/email-utils';
import attService from './att-service';
import { parseHTML } from 'linkedom';
import sanitizeEmailHtml from '../utils/html-sanitizer';
import userService from './user-service';
import { t } from '../i18n/i18n';
import domainUtils from '../utils/domain-utils';
import account from "../entity/account";
import { normalizeSendParams, validatePreparedAttachments } from '../utils/send-validator';
import { isAdmin } from '../security/admin-identity';
import emailSendService from './email-send-service';
import mailProviderService, { hasCloudflareEmail } from './mail-provider-service';
import { cloudflareRejection } from '../utils/cloudflare-mail';

const emailService = {
	...emailSendService,

	async list(c, params, userId) {
		let { emailId, type, accountId, size, timeSort, allReceive, keyword, q } = params;

		const offset = Number(params.offset ?? 0);
		if (!Number.isSafeInteger(offset) || offset < 0) throw new BizError('Invalid mail offset.', 400);
		size = Math.min(100, Math.max(1, Number(size) || 20));
		emailId = Number(emailId);
		timeSort = Number(timeSort);
		accountId = Number(accountId);
		allReceive = Number(allReceive);
		if (![emailConst.type.RECEIVE, emailConst.type.SEND].includes(Number(type))) {
			throw new BizError('Invalid email type.', 400);
		}
		type = Number(type);
		const accountRow = await accountService.selectOwnedById(c, accountId, userId);
		if (!accountRow) throw new BizError(t('noUserAccount'), 404);

		if (!emailId) {
			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}
		}

		if (![0, 1].includes(allReceive)) allReceive = accountRow.allReceive;

		const searchKw = (keyword || q || '').trim();
		if (searchKw && new TextEncoder().encode(searchKw).length > 64) {
			throw new BizError('Search keyword is too long.', 400);
		}

		const baseConditions = [
			allReceive ? eq(1, 1) : eq(email.accountId, accountId),
			eq(email.userId, userId),
			eq(email.type, type),
			eq(email.isDel, isDel.NORMAL),
			eq(account.isDel, isDel.NORMAL)
		];

		const filter = params.filter || 'all';
		if (!['all', 'unread', 'has_att'].includes(filter)) throw new BizError('Invalid mail filter.', 400);
		if (filter === 'unread') baseConditions.push(eq(email.unread, emailConst.unread.UNREAD));
		if (filter === 'has_att') baseConditions.push(sql`EXISTS (
			SELECT 1 FROM attachments a WHERE a.email_id = ${email.emailId}
			AND a.user_id = ${userId} AND a.type = 0 AND a.status = 0
		)`);

		if (searchKw) {
			const emailMatch = searchKw.match(/^([^@+]+)(?:\+[^@]*)?@([^@]+)$/i);
			if (emailMatch) {
				const baseUser = emailMatch[1];
				const domain = emailMatch[2];
				const baseEmail = `${baseUser}@${domain}`;
				const subPattern = `${baseUser}+%@${domain}`;

				baseConditions.push(
					or(
						like(email.sendEmail, `%${searchKw}%`),
						like(email.toEmail, `%${searchKw}%`),
						like(email.sendEmail, `%${baseEmail}%`),
						like(email.toEmail, `%${baseEmail}%`),
						like(email.sendEmail, `%${subPattern}%`),
						like(email.toEmail, `%${subPattern}%`),
						like(email.name, `%${searchKw}%`),
						like(email.subject, `%${searchKw}%`)
					)
				);
			} else {
				baseConditions.push(
					or(
						like(email.subject, `%${searchKw}%`),
						like(email.sendEmail, `%${searchKw}%`),
						like(email.toEmail, `%${searchKw}%`),
						like(email.name, `%${searchKw}%`),
						like(email.text, `%${searchKw}%`),
						like(email.code, `%${searchKw}%`)
					)
				);
			}
		}

		const query = orm(c)
			.select({
				...email,
				starId: star.starId
			})
			.from(email)
			.leftJoin(
				star,
				and(
					eq(star.emailId, email.emailId),
					eq(star.userId, userId)
				)
			).leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					...baseConditions,
					timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId)
				)
			)
			.orderBy(timeSort ? asc(email.emailId) : desc(email.emailId))
			.limit(size)
			.offset(offset);

		const list = await query.all();
		await this.emailAddAtt(c, list);

		const { total } = await orm(c)
			.select({ total: count() })
			.from(email)
			.leftJoin(account, eq(account.accountId, email.accountId))
			.where(and(...baseConditions))
			.get();

		const latestEmail = await orm(c)
			.select()
			.from(email)
			.leftJoin(account, eq(account.accountId, email.accountId))
			.where(and(...baseConditions))
			.orderBy(desc(email.emailId))
			.limit(1)
			.get();

		const emailList = list.map(item => {
			let isStar = 0;
			if (item.starId) {
				isStar = 1;
			}
			return {
				...item,
				isStar: isStar
			};
		});

		return {
			list: emailList,
			total,
			latestEmail: latestEmail?.email || latestEmail
		};
	},

	async delete(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = this.parseEmailIds(emailIds);
		await orm(c).update(email).set({ isDel: isDel.DELETE }).where(
			and(
				eq(email.userId, userId),
				inArray(email.emailId, emailIdList)))
			.run();
	},

	receive(c, params, cidAttList, r2domain) {
		params.content = sanitizeEmailHtml(this.imgReplace(params.content, cidAttList, r2domain));
		return orm(c).insert(email).values({ ...params }).returning().get();
	},

	// 邮件发送
	async send(c, rawParams, userId) {
		const params = normalizeSendParams(rawParams);
		let { accountId, name, sendType, emailId, receiveEmail, text, content, subject, attachments, requestId } = params;
		const { resendTokens, r2Domain, send, domainList } = await settingService.query(c);
		if (send === settingConst.send.CLOSE) throw new BizError(t('disabledSend'), 403);

		const userRow = await userService.selectById(c, userId);
		if (!userRow || userRow.status !== 0) throw new BizError(t('authExpired'), 401);
		const admin = isAdmin(userRow);

		const accountRow = await accountService.selectById(c, accountId);
		if (!accountRow) throw new BizError(t('senderAccountNotExist'), 400);
		if (accountRow.userId !== userId) throw new BizError(t('sendEmailNotCurUser'), 403);
		name = (accountRow.name || '').trim() || emailUtils.getName(accountRow.email);

		let replyEmail = { messageId: null };
		if (sendType === 'reply') {
			replyEmail = await this.selectById(c, emailId, userId);
			if (!replyEmail) throw new BizError(t('notExistEmailReply'), 404);
		}

		const managedDomains = new Set((domainList || []).map(value => String(value).replace(/^@/, '').toLowerCase()));
		const internalRecipients = receiveEmail.filter(address => managedDomains.has(emailUtils.getDomain(address).toLowerCase()));
		const externalRecipients = receiveEmail.filter(address => !managedDomains.has(emailUtils.getDomain(address).toLowerCase()));
		const domain = emailUtils.getDomain(accountRow.email).toLowerCase();
		const resendToken = resendTokens?.[domain];
		const useCloudflareEmail = externalRecipients.length > 0 && (await mailProviderService.read(c)).mailProvider === 'cloudflare';
		if (useCloudflareEmail && !hasCloudflareEmail(c)) throw new BizError(t('cloudflareEmailNotBound'), 503);
		if (externalRecipients.length > 0 && !useCloudflareEmail && !resendToken) {
			throw new BizError(t('noSendProvider'), 503);
		}

		let { imageDataList, html } = await attService.toImageUrlHtml(c, content, userId);
		html = sanitizeEmailHtml(html, { blockRemoteImages: false });
		validatePreparedAttachments([...imageDataList, ...attachments]);

		const storedImages = imageDataList.map(item => ({
			...item,
			contentId: `<${String(item.contentId || '').replace(/^<|>$/g, '')}>`,
		}));
		const storedHtml = sanitizeEmailHtml(this.imgReplace(html, storedImages, r2Domain));
		const recipient = receiveEmail.map(address => ({ address, name: '' }));
		const emailData = {
			sendEmail: accountRow.email,
			name,
			subject,
			content: storedHtml,
			text,
			accountId,
			status: emailConst.status.SAVING,
			type: emailConst.type.SEND,
			unread: emailConst.unread.READ,
			userId,
			recipient: JSON.stringify(recipient),
		};
		if (sendType === 'reply') {
			emailData.inReplyTo = replyEmail.messageId;
			emailData.relation = replyEmail.messageId;
		}
		const deliveryParams = {
			name,
			accountEmail: accountRow.email,
			receiveEmail: externalRecipients,
			subject,
			text,
			html,
			attachments: [...imageDataList, ...attachments],
			sendType,
			messageId: replyEmail.messageId,
		};
		const preparedCloudflareEmail = useCloudflareEmail ? await emailSendService.prepareCloudflareEmail(deliveryParams) : null;
		const previousSend = await emailSendService.claimSendRequest(c, userId, requestId);
		if (previousSend) return [previousSend];

		let quotaReserved = false;
		let requestClaimed = true;
		let providerAccepted = false;
		let providerOutcomeUnknown = false;
		let localCommitted = false;
		let emailResult;
		let providerId = null;
		let finalStatus = emailConst.status.DELIVERED;
		let deliveryWarning = '';
		const deliveryWarnings = [];
		const addDeliveryWarning = warning => {
			if (warning && !deliveryWarnings.includes(warning)) deliveryWarnings.push(warning);
		};
		try {
			if (!admin) {
				await userService.reserveSendQuota(c, receiveEmail.length, userId, requestId);
				quotaReserved = true;
			}

			emailResult = await orm(c).insert(email).values(emailData).returning().get();
			emailResult.requestId = requestId;
			await c.env.db.prepare(`UPDATE send_request SET email_id = ? WHERE user_id = ? AND request_id = ?`)
				.bind(emailResult.emailId, userId, requestId).run();
			if (imageDataList.length > 0) {
				await attService.saveArticleAtt(c, imageDataList, userId, accountId, emailResult.emailId);
			}
			if (attachments.length > 0) {
				await attService.saveSendAtt(c, attachments, userId, accountId, emailResult.emailId);
			}

			if (externalRecipients.length > 0) {

				let sendResult;
				try {
					sendResult = useCloudflareEmail
						? await emailSendService.sendByCloudflareEmail(c, deliveryParams, preparedCloudflareEmail)
						: await emailSendService.sendByResend(resendToken, deliveryParams);
				} catch (providerError) {
					const rejection = useCloudflareEmail && cloudflareRejection(providerError);
					if (rejection) throw rejection;
					console.error('Mail provider request failed', providerError?.code || providerError?.name || 'unknown error');
					providerOutcomeUnknown = true;
					finalStatus = emailConst.status.DELAYED;
					addDeliveryWarning('The provider response was not confirmed; do not resend this message automatically.');
				}
				if (!providerOutcomeUnknown) {
					if (sendResult?.error) throw new BizError(sendResult.error.message || 'Mail provider rejected the message.', 502);
					providerAccepted = true;
					providerId = sendResult?.data?.id || null;
					finalStatus = emailConst.status.SENT;
				}
			}

			let message = '';
			if (internalRecipients.length > 0) {
				const allAttachments = await attService.selectAllByEmailIds(c, [emailResult.emailId]);
				const localResult = await emailSendService.HandleOnSiteEmail(c, internalRecipients, emailResult, allAttachments);
				localCommitted = localResult.handledCount > 0;
				if (localResult.failedCount > 0) {
					addDeliveryWarning(`${localResult.failedCount} internal recipient(s) could not be stored.`);
				}
				if (localResult.status === emailConst.status.BOUNCED && deliveryWarnings.length === 0) {
					if (!providerAccepted) finalStatus = localResult.status;
					message = localResult.message;
				}
				if (localResult.handledCount === 0 && !providerAccepted && !providerOutcomeUnknown) {
					throw new BizError('Internal delivery failed before any recipient accepted the message.', 503);
				}
			}
			deliveryWarning = deliveryWarnings.join(' ');
			if (deliveryWarning) message = JSON.stringify({ message: deliveryWarning });

			emailResult.status = finalStatus;
			emailResult.message = message;
			emailResult.resendEmailId = providerId;
			emailResult = await orm(c).update(email).set({
				status: finalStatus,
				message,
				resendEmailId: providerId,
			}).where(eq(email.emailId, emailResult.emailId)).returning().get();
			emailResult.requestId = requestId;
			emailResult.attList = await attService.selectByEmailIds(c, [emailResult.emailId]);
			if (deliveryWarning) emailResult.deliveryWarning = deliveryWarning;
			await emailSendService.completeSendRequest(c, userId, requestId, emailResult.emailId, finalStatus, deliveryWarning);
			await emailSendService.incrementDaySendStat(c, receiveEmail.length);
			return [emailResult];
		} catch (error) {
			const committed = providerAccepted || providerOutcomeUnknown || localCommitted;
			if (emailResult && committed) {
				addDeliveryWarning('Delivery was accepted, but local status persistence was incomplete.');
				deliveryWarning = deliveryWarnings.join(' ');
				emailResult.status = finalStatus;
				emailResult.resendEmailId = providerId;
				emailResult.requestId = requestId;
				emailResult.deliveryWarning = deliveryWarning;
				try {
					await orm(c).update(email).set({
						status: finalStatus,
						resendEmailId: providerId,
						message: JSON.stringify({ message: deliveryWarning }),
					}).where(eq(email.emailId, emailResult.emailId)).run();
				} catch (updateError) {
					console.error('Failed to persist accepted delivery state', updateError?.message || updateError?.name || 'unknown error');
				}
				try {
					await emailSendService.completeSendRequest(c, userId, requestId, emailResult.emailId, finalStatus, deliveryWarning);
				} catch (requestError) {
					console.error('Failed to persist send idempotency state', requestError?.message || requestError?.name || 'unknown error');
				}
				return [emailResult];
			}
			if (emailResult) {
				try {
					await orm(c).update(email).set({
						status: emailConst.status.FAILED,
						message: JSON.stringify({ message: 'Message delivery failed.' }),
					}).where(eq(email.emailId, emailResult.emailId)).run();
				} catch (updateError) {
					console.error('Failed to mark outgoing message as failed', updateError?.message || updateError?.name || 'unknown error');
				}
			}
			if (requestClaimed) {
				await emailSendService.deleteSendRequestAndReleaseQuota(c, userId, requestId);
				requestClaimed = false;
			} else if (quotaReserved) {
				await userService.releaseSendQuota(c, receiveEmail.length, userId);
			}
			throw error;
		}
	},

	imgReplace(content, cidAttList, r2domain) {
		if (!content) return '';

		const { document } = parseHTML(content);
		const images = Array.from(document.querySelectorAll('img'));
		const legacyDomain = domainUtils.toOssDomain(r2domain);
		const useAtts = [];

		for (const img of images) {
			const src = img.getAttribute('src');
			if (src && src.startsWith('cid:') && cidAttList) {
				const cid = src.replace(/^cid:/, '');
				const attCidIndex = cidAttList.findIndex(cidAtt => cidAtt.contentId.replace(/^<|>$/g, '') === cid);
				if (attCidIndex > -1) {
					const cidAtt = cidAttList[attCidIndex];
					img.setAttribute('src', '{{domain}}' + cidAtt.key);
					useAtts.push(cidAtt);
				}
			}

			if (legacyDomain && src && src.startsWith(legacyDomain + '/')) {
				img.setAttribute('src', src.replace(legacyDomain + '/', '{{domain}}'));
			}
		}

		useAtts.forEach(att => {
			att.type = attConst.type.EMBED;
		});

		return document.toString();
	},

	selectById(c, emailId, userId) {
		const conditions = [eq(email.emailId, emailId), eq(email.isDel, isDel.NORMAL)];
		if (userId !== undefined) conditions.push(eq(email.userId, userId));
		return orm(c).select().from(email).where(and(...conditions)).get();
	},

	async latest(c, params, userId) {
		let { emailId, accountId, allReceive } = params;
		emailId = Number(emailId) || 0;
		accountId = Number(accountId);
		allReceive = Number(allReceive);
		const accountRow = await accountService.selectOwnedById(c, accountId, userId);
		if (!accountRow) throw new BizError(t('noUserAccount'), 404);
		if (![0, 1].includes(allReceive)) allReceive = accountRow.allReceive;

		let list = await orm(c).select({ ...email }).from(email)
			.leftJoin(account, eq(account.accountId, email.accountId))
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.userId, userId),
					eq(email.isDel, isDel.NORMAL),
					eq(account.isDel, isDel.NORMAL),
					allReceive ? eq(1, 1) : eq(email.accountId, accountId),
					eq(email.type, emailConst.type.RECEIVE)
				)
			)
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);
		return list;
	},

	async selectUserEmailCountList(c, userIds, type, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: email.userId,
				count: count(email.emailId)
			})
			.from(email)
			.where(and(
				inArray(email.userId, userIds),
				eq(email.type, type),
				eq(email.isDel, del),
				ne(email.status, emailConst.status.SAVING),
			))
			.groupBy(email.userId);
		return result;
	},

	async emailAddAtt(c, list) {
		for (const emailRow of list) {
			emailRow.content = sanitizeEmailHtml(emailRow.content);
		}

		const emailIds = list.map(item => item.emailId);
		if (emailIds.length > 0) {
			const attList = await attService.selectByEmailIds(c, emailIds);
			list.forEach(emailRow => {
				const atts = attList.filter(attRow => attRow.emailId === emailRow.emailId);
				emailRow.attList = atts;
			});
		}
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(email).set({ isDel: isDel.NORMAL }).where(eq(email.userId, userId)).run();
	},

	async completeReceive(c, status, emailId) {
		return await orm(c).update(email).set({
			isDel: isDel.NORMAL,
			status: status
		}).where(eq(email.emailId, emailId)).returning().get();
	},

	async completeReceiveAll(c) {
		await c.env.db.prepare(`UPDATE email as e SET is_del = ${isDel.NORMAL}, status = ${emailConst.status.RECEIVE} WHERE type = ${emailConst.type.RECEIVE} AND status = ${emailConst.status.SAVING} AND EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
		await c.env.db.prepare(`UPDATE email as e SET is_del = ${isDel.NORMAL}, status = ${emailConst.status.NOONE} WHERE type = ${emailConst.type.RECEIVE} AND status = ${emailConst.status.SAVING} AND NOT EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
		const sendRequestTable = await c.env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'send_request'`
		).first();
		const pendingGuard = sendRequestTable
			? `AND NOT EXISTS (
				SELECT 1 FROM send_request
				WHERE send_request.email_id = email.email_id AND send_request.status = 'pending'
			)`
			: '';
		await c.env.db.prepare(`
			UPDATE email
			SET status = ${emailConst.status.FAILED},
			    message = '{"message":"Outgoing delivery state could not be confirmed."}'
			WHERE type = ${emailConst.type.SEND} AND status = ${emailConst.status.SAVING}
			  AND create_time <= datetime('now', '-5 minutes')
			${pendingGuard}
		`).run();
	},

	async read(c, params, userId) {
		const { emailIds } = params;
		const ids = this.parseEmailIds(emailIds);
		await orm(c).update(email).set({ unread: emailConst.unread.READ }).where(
			and(eq(email.userId, userId), inArray(email.emailId, ids))
		).run();
	},

	parseEmailIds(value) {
		const raw = Array.isArray(value) ? value : String(value || '').split(',');
		const ids = [...new Set(raw.map(Number))];
		if (ids.length === 0 || ids.length > 100 || ids.some(id => !Number.isInteger(id) || id <= 0)) {
			throw new BizError('Invalid email IDs.', 400);
		}
		return ids;
	},

	async setUnread(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = this.parseEmailIds(emailIds);
		await orm(c).update(email).set({ unread: emailConst.unread.UNREAD }).where(
			and(
				eq(email.userId, userId),
				inArray(email.emailId, emailIdList)
			)
		).run();
	},

	async starList(c, params, userId) {
		let { emailId, size, timeSort, allReceive, keyword, q } = params;
		size = Math.min(50, Math.max(1, Number(size) || 20));
		emailId = Number(emailId);
		timeSort = Number(timeSort);

		if (!emailId) {
			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}
		}

		const searchKw = (keyword || q || '').trim();
		if (searchKw && new TextEncoder().encode(searchKw).length > 64) {
			throw new BizError('Search keyword is too long.', 400);
		}

		const baseConditions = [
			eq(email.userId, userId),
			eq(email.isDel, isDel.NORMAL),
			eq(account.isDel, isDel.NORMAL)
		];

		if (searchKw) {
			baseConditions.push(
				or(
					like(email.subject, `%${searchKw}%`),
					like(email.sendEmail, `%${searchKw}%`),
					like(email.toEmail, `%${searchKw}%`),
					like(email.name, `%${searchKw}%`),
					like(email.text, `%${searchKw}%`),
					like(email.code, `%${searchKw}%`)
				)
			);
		}

		const query = orm(c)
			.select({
				...email,
				starId: star.starId
			})
			.from(star)
			.leftJoin(
				email,
				eq(star.emailId, email.emailId)
			).leftJoin(
				account,
				eq(account.accountId, email.accountId)
			)
			.where(
				and(
					...baseConditions,
					timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId)
				)
			)
			.orderBy(timeSort ? asc(email.emailId) : desc(email.emailId))
			.limit(size);

		const list = await query.all();
		await this.emailAddAtt(c, list);

		const { total } = await orm(c)
			.select({ total: count() })
			.from(star)
			.leftJoin(email, eq(star.emailId, email.emailId))
			.leftJoin(account, eq(account.accountId, email.accountId))
			.where(and(...baseConditions))
			.get();

		const latestEmail = await orm(c)
			.select({
				...email,
				starId: star.starId
			})
			.from(star)
			.leftJoin(email, eq(star.emailId, email.emailId))
			.leftJoin(account, eq(account.accountId, email.accountId))
			.where(and(...baseConditions))
			.orderBy(desc(email.emailId))
			.limit(1)
			.get();

		const emailList = list.map(item => {
			let isStar = 0;
			if (item.starId) {
				isStar = 1;
			}
			return {
				...item,
				isStar: isStar
			};
		});

		return {
			list: emailList,
			total,
			latestEmail
		};
	},

	async queryAllList(c, params) {
		let { emailId, size, timeSort, user, account: accountEmail, name, keyword, q } = params;
		size = Math.min(50, Math.max(1, Number(size) || 20));
		emailId = Number(emailId);
		timeSort = Number(timeSort);

		if (!emailId) {
			if (timeSort) {
				emailId = 0;
			} else {
				emailId = 9999999999;
			}
		}

		const baseConditions = [];
		if (user) {
			const users = await userService.selectByEmail(c, user);
			if (users.length > 0) {
				baseConditions.push(inArray(email.userId, users.map(item => item.userId)));
			} else {
				return { list: [], total: 0, latestEmail: null };
			}
		}
		if (accountEmail) {
			baseConditions.push(eq(email.toEmail, accountEmail));
		}
		if (name) {
			baseConditions.push(eq(email.name, name));
		}

		const searchKw = (keyword || q || '').trim();
		if (searchKw && new TextEncoder().encode(searchKw).length > 64) {
			throw new BizError('Search keyword is too long.', 400);
		}
		if (searchKw) {
			baseConditions.push(
				or(
					like(email.subject, `%${searchKw}%`),
					like(email.sendEmail, `%${searchKw}%`),
					like(email.toEmail, `%${searchKw}%`),
					like(email.name, `%${searchKw}%`),
					like(email.text, `%${searchKw}%`),
					like(email.code, `%${searchKw}%`)
				)
			);
		}

		const query = orm(c)
			.select({
				...email,
				userEmail: userService.user.email
			})
			.from(email)
			.leftJoin(userService.user, eq(userService.user.userId, email.userId))
			.where(
				and(
					...baseConditions,
					timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId)
				)
			)
			.orderBy(timeSort ? asc(email.emailId) : desc(email.emailId))
			.limit(size);

		const list = await query.all();
		await this.emailAddAtt(c, list);

		const { total } = await orm(c)
			.select({ total: count() })
			.from(email)
			.where(and(...baseConditions))
			.get();

		const latestEmail = await orm(c)
			.select()
			.from(email)
			.where(and(...baseConditions))
			.orderBy(desc(email.emailId))
			.limit(1)
			.get();

		return {
			list,
			total,
			latestEmail
		};
	},

	async allDelete(c, params) {
		const { emailIds } = params;
		const emailIdList = this.parseEmailIds(emailIds);
		await orm(c).delete(email).where(inArray(email.emailId, emailIdList)).run();
		await attService.deleteAttByEmailIds(c, emailIdList);
	},

	async unReadCount(c, userId) {
		const countResult = await orm(c).select({
			count: count(),
			accountId: email.accountId
		}).from(email).leftJoin(
			account,
			eq(account.accountId, email.accountId)
		).where(
			and(
				eq(email.userId, userId),
				eq(email.unread, emailConst.unread.UNREAD),
				eq(email.type, emailConst.type.RECEIVE),
				eq(email.isDel, isDel.NORMAL),
				eq(account.isDel, isDel.NORMAL)
			)
		).groupBy(email.accountId).all();

		const map = {};
		for (const countRow of countResult) {
			map[countRow.accountId] = countRow.count;
		}
		return map;
	},

	async deleteByAccountIds(c, accountIds, userId) {
		if (!accountIds.length) return;
		await orm(c).update(email).set({
			isDel: isDel.DELETE
		}).where(
			and(
				eq(email.userId, userId),
				inArray(email.accountId, accountIds)
			)
		).run();
	},

	async cleanAllDel(c, accountId, userId) {
		const targetAccount = await accountService.selectOwnedById(c, accountId, userId);
		if (!targetAccount) throw new BizError(t('noUserAccount'), 404);

		const deleteCondition = targetAccount.allReceive
			? and(eq(email.userId, userId), eq(email.isDel, isDel.DELETE))
			: and(eq(email.userId, userId), eq(email.accountId, accountId), eq(email.isDel, isDel.DELETE));

		const selectCondition = targetAccount.allReceive
			? `user_id = ? AND is_del = 1`
			: `user_id = ? AND account_id = ? AND is_del = 1`;
		const selectBindings = targetAccount.allReceive
			? [userId]
			: [userId, accountId];

		const rows = await c.env.db.prepare(
			`SELECT email_id AS emailId FROM email WHERE ${selectCondition}`
		).bind(...selectBindings).all();
		const emailIds = (rows.results || []).map(row => row.emailId);
		if (emailIds.length === 0) return { deletedCount: 0 };

		await orm(c).delete(email).where(deleteCondition).run();
		await attService.deleteAttByEmailIds(c, emailIds);
		return { deletedCount: emailIds.length };
	}
};

export default emailService;
