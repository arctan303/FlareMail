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
import verifyUtils from '../utils/verify-utils';
import { conversationLimits, findConversation, groupConversations } from '../utils/mail-conversation';

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
		if (params.view === 'conversation') {
			return this.listConversations(c, { ...params, accountId, type, size, offset, allReceive }, userId);
		}

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
			.leftJoin(account, and(eq(account.accountId, email.accountId), eq(account.userId, email.userId)))
			.where(and(...baseConditions))
			.get();

		const latestResult = await orm(c)
			.select()
			.from(email)
			.leftJoin(account, eq(account.accountId, email.accountId))
			.where(and(...baseConditions))
			.orderBy(desc(email.emailId))
			.limit(1)
			.get();
		const latestEmail = latestResult?.email || latestResult;
		if (latestEmail) await this.emailAddReplyTo(c, [latestEmail]);

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

	async loadConversationMetadata(c, userId) {
		const rows = await c.env.db.prepare(`SELECT e.email_id AS emailId,e.create_time AS createTime,e.type,e.account_id AS accountId,e.unread,substr(e.subject,1,513) AS subject,
			substr(e.message_id,1,513) AS messageId,substr(e.in_reply_to,1,513) AS inReplyTo,substr(e.relation,1,2049) AS relation
			FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id
			WHERE e.user_id=? AND e.is_del=0 AND a.is_del=0 ORDER BY e.create_time DESC,e.email_id DESC LIMIT 10001`).bind(userId).all();
		if ((rows.results || []).length > 10000) throw new BizError(t('conversationViewLimit'), 413);
		return rows.results || [];
	},

	async listConversations(c, params, userId) {
		const metadata = await this.loadConversationMetadata(c, userId);
		const starred = params.starred === true || params.starred === '1';
		let scope = metadata.filter(row => starred || (row.type === params.type && (params.allReceive || row.accountId === params.accountId)));
		const stars = await c.env.db.prepare('SELECT email_id AS emailId FROM star WHERE user_id=?').bind(userId).all();
		let starIds = new Set(stars.results.map(row => row.emailId));
		if (starred) {
			scope = scope.filter(row => starIds.has(row.emailId) && (!params.accountId || row.accountId === Number(params.accountId)));
		}
		const filter = params.filter || 'all';
		const keyword = String(params.keyword || params.q || '').trim();
		if (new TextEncoder().encode(keyword).length > 64) throw new BizError('Search keyword is too long.', 400);
		let matched = new Set(scope.map(row => row.emailId));
		if (filter === 'unread') matched = new Set(scope.filter(row => row.unread === emailConst.unread.UNREAD).map(row => row.emailId));
		else if (filter === 'has_att') {
			const result = await c.env.db.prepare(`SELECT DISTINCT email_id AS emailId FROM attachments WHERE user_id=? AND type=0 AND status=0`).bind(userId).all();
			const attached = new Set(result.results.map(row => row.emailId)); matched = new Set(scope.filter(row => attached.has(row.emailId)).map(row => row.emailId));
		} else if (filter !== 'all') throw new BizError('Invalid mail filter.', 400);
		if (keyword) {
			const emailMatch=keyword.match(/^([^@+]+)(?:\+[^@]*)?@([^@]+)$/i);const patterns=[`%${keyword}%`];
			if(emailMatch){patterns.push(`%${emailMatch[1]}@${emailMatch[2]}%`,`%${emailMatch[1]}+%@${emailMatch[2]}%`);}
			const clauses=patterns.flatMap(()=>['send_email LIKE ?','to_email LIKE ?']);
			const binds=patterns.flatMap(pattern=>[pattern,pattern]);
			const result = await c.env.db.prepare(`SELECT email_id AS emailId FROM email WHERE user_id=? AND is_del=0 AND
				(subject LIKE ? OR name LIKE ? OR text LIKE ? OR code LIKE ? OR ${clauses.join(' OR ')})`)
				.bind(userId,...Array(4).fill(`%${keyword}%`),...binds).all();
			const hits = new Set(result.results.map(row => row.emailId)); matched = new Set([...matched].filter(id => hits.has(id)));
		}
		const scopeIds = new Set(scope.map(row => row.emailId)); const byId = new Map(metadata.map(row => [row.emailId,row]));
		const grouped = groupConversations(metadata);
		const groups = grouped.groups.map(globalIds => ({globalIds,memberIds:globalIds.filter(id => scopeIds.has(id))})).filter(item => item.memberIds.length && item.memberIds.some(id => matched.has(id)));
		const summaries = groups.map(({globalIds,memberIds}) => {
			const members = memberIds.map(id => byId.get(id)).sort((a,b) => b.createTime.localeCompare(a.createTime) || b.emailId-a.emailId);
			return { representative: members[0], memberIds, globalIds, unreadIds: members.filter(row => row.type===emailConst.type.RECEIVE&&row.unread === emailConst.unread.UNREAD).map(row => row.emailId) };
		}).sort((a,b) => b.representative.createTime.localeCompare(a.representative.createTime) || b.representative.emailId-a.representative.emailId);
		if (Number(params.timeSort)) summaries.reverse();
		const page = summaries.slice(params.offset, params.offset + params.size); const repIds = page.map(item => item.representative.emailId);
		let rows = repIds.length ? await orm(c).select({ ...email, starId: star.starId }).from(email)
			.leftJoin(star,and(eq(star.emailId,email.emailId),eq(star.userId,userId))).where(and(eq(email.userId,userId),inArray(email.emailId,repIds))).all() : [];
		await this.emailAddAtt(c, rows); const rowMap = new Map(rows.map(row => [row.emailId,row]));
		const list = page.map(item => ({ ...rowMap.get(item.representative.emailId), unread:item.unreadIds.length?emailConst.unread.UNREAD:emailConst.unread.READ, isStar: item.memberIds.some(id=>starIds.has(id)) ? 1 : 0,
			conversationId: Math.min(...item.globalIds), conversationCount:item.globalIds.length, scopeCount:item.memberIds.length, memberIds:item.memberIds, unreadIds:item.unreadIds }));
		return { list, total:summaries.length, latestEmail:list[0] || null, truncated:grouped.truncated };
	},

	async conversationState(c, body, userId) {
		if (!Array.isArray(body?.emailIds)) throw new BizError('Invalid email IDs.',400);
		const emailIds = [...new Set(body.emailIds.map(Number))];
		if (!emailIds.length || emailIds.length > 50 || emailIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new BizError('Invalid email IDs.',400);
		const action = body.action; if (!['read','unread','delete','star','unstar'].includes(action)) throw new BizError('Invalid conversation action.',400);
		const metadata = await this.loadConversationMetadata(c,userId); const metadataById=new Map(metadata.map(row=>[row.emailId,row])); const grouped=groupConversations(metadata).groups; const groupById=new Map();
		for(const group of grouped) for(const id of group) groupById.set(id,group);
		const view=body.view||{}; const type=Number(view.type); const accountId=Number(view.accountId); const allReceive=Number(view.allReceive)===1;
		if(!view.starred){if(![0,1].includes(type)||!Number.isSafeInteger(accountId)||accountId<=0)throw new BizError('Invalid conversation view.',400);if(!await accountService.selectOwnedById(c,accountId,userId))throw new BizError('Email account not found.',404);}
		else if(view.accountId&&(!Number.isSafeInteger(accountId)||accountId<=0||!await accountService.selectOwnedById(c,accountId,userId)))throw new BizError('Email account not found.',404);
		let starredIds=new Set(); if(view.starred){const result=await c.env.db.prepare('SELECT email_id AS emailId FROM star WHERE user_id=?').bind(userId).all();starredIds=new Set(result.results.map(row=>row.emailId));}
		const selected=new Set();
		for(const anchor of emailIds){ const group=groupById.get(anchor); if(!group) throw new BizError('Email not found.',404); for(const id of group){ const row=metadataById.get(id); if(view.starred ? starredIds.has(id) && (!view.accountId || row.accountId===accountId) : row.type===type && (allReceive||row.accountId===accountId)) selected.add(id); } }
		const ids=[...selected]; if(!ids.length) return {emailIds:[],updatedCount:0};
		const chunks=[];for(let i=0;i<ids.length;i+=90)chunks.push(ids.slice(i,i+90));let statements=[];
		if(action==='read'||action==='unread') statements=chunks.map(chunk=>c.env.db.prepare(`UPDATE email SET unread=? WHERE user_id=? AND email_id IN (${chunk.map(()=>'?').join(',')})`).bind(action==='read'?1:0,userId,...chunk));
		else if(action==='delete') statements=chunks.map(chunk=>c.env.db.prepare(`UPDATE email SET is_del=1 WHERE user_id=? AND email_id IN (${chunk.map(()=>'?').join(',')})`).bind(userId,...chunk));
		else if(action==='unstar') statements=chunks.map(chunk=>c.env.db.prepare(`DELETE FROM star WHERE user_id=? AND email_id IN (${chunk.map(()=>'?').join(',')})`).bind(userId,...chunk));
		else {statements=[];for(let i=0;i<ids.length;i+=45){const chunk=ids.slice(i,i+45);statements.push(c.env.db.prepare(`INSERT OR IGNORE INTO star(user_id,email_id) VALUES ${chunk.map(()=>'(?,?)').join(',')}`).bind(...chunk.flatMap(id=>[userId,id])));}}
		await c.env.db.batch(statements);
		return {emailIds:ids,updatedCount:ids.length};
	},

	async readConversation(c, emailId, readThroughEmailId, userId) {
		const boundary=Number(readThroughEmailId); if(!Number.isSafeInteger(boundary)||boundary<=0) throw new BizError('Invalid read boundary.',400);
		const metadata=await this.loadConversationMetadata(c,userId); const component=findConversation(metadata,Number(emailId),{...conversationLimits,maxMessages:10000});
		if(!component.emailIds.length) throw new BizError('Email not found.',404); const metadataById=new Map(metadata.map(row=>[row.emailId,row])); const ids=component.emailIds.filter(id=>metadataById.get(id)?.type===emailConst.type.RECEIVE);
		const bounded=ids.filter(id=>id<=boundary); if(bounded.length){const statements=[];for(let i=0;i<bounded.length;i+=90){const chunk=bounded.slice(i,i+90);statements.push(c.env.db.prepare(`UPDATE email SET unread=1 WHERE user_id=? AND email_id IN (${chunk.map(()=>'?').join(',')})`).bind(userId,...chunk));}await c.env.db.batch(statements);}
		return {emailIds:bounded,updatedCount:bounded.length};
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

	async receive(c, params, cidAttList, r2domain) {
		const { replyTo, ...emailParams } = params;
		emailParams.content = sanitizeEmailHtml(this.imgReplace(emailParams.content, cidAttList, r2domain));
		const normalizedReplyTo = this.normalizeReplyTo(replyTo);
		let row;
		if (await this.hasReplyToColumn(c)) {
			const statement = orm(c).insert(email).values(emailParams).toSQL();
			const results = await c.env.db.batch([
				c.env.db.prepare(statement.sql).bind(...statement.params),
				c.env.db.prepare('UPDATE email SET reply_to = ? WHERE email_id = last_insert_rowid()')
					.bind(JSON.stringify(normalizedReplyTo)),
			]);
			const emailId = Number(results[0]?.meta?.last_row_id);
			if (!Number.isSafeInteger(emailId) || emailId <= 0) throw new Error('Inbound email insert did not return an ID.');
			row = await orm(c).select().from(email).where(eq(email.emailId, emailId)).get();
		} else {
			row = await orm(c).insert(email).values(emailParams).returning().get();
		}
		row.replyTo = normalizedReplyTo;
		return row;
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

		let replyEmail = { messageId: null, relation: '' };
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
			emailData.relation = emailSendService.buildReplyHeaders(replyEmail.messageId, replyEmail.relation)?.references || '';
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
			references: replyEmail.relation,
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
					const providerMessageId = String(sendResult?.data?.messageId || '').trim();
					if (providerMessageId) emailResult.messageId = providerMessageId;
					addDeliveryWarning(sendResult?.data?.messageIdWarning);
					finalStatus = emailConst.status.SENT;
				}
			}
			if (!emailResult.messageId && externalRecipients.length === 0) {
				const localMessageId = `<${crypto.randomUUID()}@${domain}>`;
				emailResult.messageId = localMessageId;
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
				messageId: emailResult.messageId || '',
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
						messageId: emailResult.messageId || '',
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

	async selectById(c, emailId, userId) {
		const conditions = [eq(email.emailId, emailId), eq(email.isDel, isDel.NORMAL)];
		if (userId !== undefined) conditions.push(eq(email.userId, userId));
		const row = await orm(c).select().from(email).where(and(...conditions)).get();
		if (row) await this.emailAddReplyTo(c, [row]);
		return row;
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

	async conversation(c, params, userId) {
		const anchorEmailId = Number(params.emailId);
		const size = params.size === undefined ? 20 : Number(params.size);
		if (!Number.isSafeInteger(anchorEmailId) || anchorEmailId <= 0) throw new BizError('Invalid email ID.', 400);
		if (!Number.isSafeInteger(size) || size < 1 || size > 50) throw new BizError('Invalid page size.', 400);
		let before = null;
		if (params.before) {
			try {
				before = JSON.parse(atob(String(params.before).replace(/-/g, '+').replace(/_/g, '/')));
			} catch { throw new BizError('Invalid conversation cursor.', 400); }
			if (typeof before?.createTime !== 'string' || !Number.isSafeInteger(before?.emailId)) throw new BizError('Invalid conversation cursor.', 400);
		}
		const anchor = await orm(c).select({ ...email, starId: star.starId }).from(email)
			.leftJoin(account, and(eq(account.accountId, email.accountId), eq(account.userId, email.userId)))
			.leftJoin(star, and(eq(star.emailId, email.emailId), eq(star.userId, userId)))
			.where(and(eq(email.emailId, anchorEmailId), eq(email.userId, userId), eq(email.isDel, isDel.NORMAL), eq(account.isDel, isDel.NORMAL))).get();
		if (!anchor) throw new BizError('Email not found.', 404);
		const metadataResult = await c.env.db.prepare(`
			SELECT e.email_id AS emailId, e.create_time AS createTime, substr(e.subject, 1, 513) AS subject,
			       substr(e.message_id, 1, 513) AS messageId,
			       substr(e.in_reply_to, 1, 513) AS inReplyTo,
			       substr(e.relation, 1, 2049) AS relation
			FROM email e JOIN account a ON a.account_id = e.account_id AND a.user_id = e.user_id
			WHERE e.user_id = ? AND e.is_del = 0 AND a.is_del = 0
			ORDER BY e.create_time DESC, e.email_id DESC LIMIT 5001
		`).bind(userId).all();
		let metadata = metadataResult.results || [];
		const scanLimited = metadata.length > 5000;
		metadata = metadata.slice(0, 5000);
		if (!metadata.some(row => row.emailId === anchorEmailId)) metadata.push({
			emailId: anchor.emailId, createTime: anchor.createTime, messageId: anchor.messageId,
			inReplyTo: anchor.inReplyTo, relation: anchor.relation, subject: anchor.subject,
		});
		const component = findConversation(metadata, anchorEmailId);
		const byId = new Map(metadata.map(row => [row.emailId, row]));
		let ordered = component.emailIds.map(id => byId.get(id)).filter(Boolean).sort((a, b) =>
			b.createTime.localeCompare(a.createTime) || b.emailId - a.emailId);
		if (before) ordered = ordered.filter(row => row.createTime < before.createTime || (row.createTime === before.createTime && row.emailId < before.emailId));
		const pageRows = ordered.slice(0, size);
		const hasMore = ordered.length > size;
		const ids = pageRows.map(row => row.emailId);
		let messages = [];
		if (ids.length) {
			messages = await orm(c).select({ ...email, starId: star.starId }).from(email)
				.leftJoin(account, and(eq(account.accountId, email.accountId), eq(account.userId, email.userId)))
				.leftJoin(star, and(eq(star.emailId, email.emailId), eq(star.userId, userId)))
				.where(and(eq(email.userId, userId), eq(email.isDel, isDel.NORMAL), eq(account.isDel, isDel.NORMAL), inArray(email.emailId, ids))).all();
			await this.emailAddAtt(c, messages);
			messages = messages.map(row => ({ ...row, isStar: row.starId ? 1 : 0 }))
				.sort((a, b) => a.createTime.localeCompare(b.createTime) || a.emailId - b.emailId);
		}
		const anchorView = { ...anchor, isStar: anchor.starId ? 1 : 0 };
		await this.emailAddAtt(c, [anchorView]);
		const cursorRow = pageRows.at(-1);
		const nextCursor = hasMore && cursorRow
			? btoa(JSON.stringify({ createTime: cursorRow.createTime, emailId: cursorRow.emailId })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
			: null;
		return { anchorEmailId, anchor: anchorView, messages, nextCursor, hasMore, scanLimited, truncated: component.truncated,
			readThroughEmailId: Math.max(...metadata.map(row => row.emailId)) };
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
		await this.emailAddReplyTo(c, list);
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

	normalizeReplyTo(value) {
		let items = value;
		if (typeof items === 'string') {
			try { items = JSON.parse(items); } catch { items = []; }
		}
		if (!Array.isArray(items)) return [];
		const result = [];
		const seen = new Set();
		const append = item => {
			if (Array.isArray(item?.group)) {
				item.group.forEach(append);
				return;
			}
			const address = String(item?.address || '').trim();
			if (!verifyUtils.isEmail(address)) return;
			const key = address.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			result.push({ name: String(item?.name || '').trim(), address });
		};
		items.forEach(append);
		return result;
	},

	async hasReplyToColumn(c) {
		const row = await c.env.db.prepare(
			"SELECT 1 AS present FROM pragma_table_info('email') WHERE name = 'reply_to'"
		).first();
		return Boolean(row?.present);
	},

	async emailAddReplyTo(c, list) {
		if (!Array.isArray(list) || list.length === 0) return;
		for (const row of list) row.replyTo = [];
		if (!await this.hasReplyToColumn(c)) return;
		const ids = [...new Set(list.map(row => Number(row.emailId)).filter(Number.isSafeInteger))];
		if (ids.length === 0) return;
		const placeholders = ids.map(() => '?').join(',');
		const values = await c.env.db.prepare(
			`SELECT email_id AS emailId, reply_to AS replyTo FROM email WHERE email_id IN (${placeholders})`
		).bind(...ids).all();
		const byId = new Map(values.results.map(row => [row.emailId, this.normalizeReplyTo(row.replyTo)]));
		for (const row of list) row.replyTo = byId.get(row.emailId) || [];
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
		if (latestEmail) await this.emailAddReplyTo(c, [latestEmail]);

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
		if (latestEmail) await this.emailAddReplyTo(c, [latestEmail]);

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
