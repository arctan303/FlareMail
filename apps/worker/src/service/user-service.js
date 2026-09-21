import BizError from '../error/biz-error';
import accountService from './account-service';
import orm from '../entity/orm';
import user from '../entity/user';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { emailConst, isDel, userConst } from '../const/entity-const';
import cryptoUtils from '../utils/crypto-utils';
import emailService from './email-service';
import dayjs from 'dayjs';
import emailUtils from '../utils/email-utils';
import saltHashUtils from '../utils/crypto-utils';
import { t } from '../i18n/i18n';
import reqUtils from '../utils/req-utils';
import verifyUtils from '../utils/verify-utils';
import sessionService from './session-service';
import { assertObjectDeleteQueue } from '../utils/delete-queue-utils';
import { isAdmin, resolvePermKeys } from '../security/admin-identity';
import managedDomainService from './managed-domain-service';
import localeService from './locale-service';

const userService = {

	async loginUserInfo(c, userId) {

		const userRow = await userService.selectById(c, userId);

		if (!userRow) {
			throw new BizError(t('authExpired'), 401);
		}

		const account = await accountService.selectByEmailIncludeDel(c, userRow.email);

		const admin = isAdmin(userRow);
		const permKeys = resolvePermKeys(userRow);

		const user = {};
		user.userId = userRow.userId;
		user.sendCount = userRow.sendCount;
		user.sendLimit = userRow.sendLimit;
		user.accountLimit = admin ? 0 : userRow.accountLimit;
		user.accountCount = await accountService.countUserAccount(c, userId);
		user.accountList = await accountService.selectAllForUser(c, userId);
		user.email = userRow.email;
		user.account = account;
		user.name = account?.name;
		user.permKeys = permKeys;
		user.type = admin ? 0 : 1;
		user.forwardStatus = userRow.forwardStatus;
		user.mainForwardStatus = userRow.mainForwardStatus;
		user.forwardEmail = userRow.forwardEmail;
		user.hasCliToken = !!userRow.cliToken;
		user.domainList = await managedDomainService.suffixes(c);
		user.googleEmail = userRow.googleEmail || '';
		// Empty string means "never chosen" so the client can fall back to its cache.
		user.locale = await localeService.get(c, userId);

		return user;
	},

	async setForward(c, params, userId) {
		const forwardStatus = Number(params.forwardStatus);
		const mainForwardStatus = params.mainForwardStatus !== undefined ? Number(params.mainForwardStatus) : undefined;
		const forwardEmail = (params.forwardEmail || '').trim().toLowerCase();

		if (![0, 1].includes(forwardStatus)) {
			throw new BizError('Invalid forwarding status');
		}

		if (forwardEmail && !verifyUtils.isEmail(forwardEmail)) {
			throw new BizError(t('notEmail'));
		}
		if (forwardStatus === 0 && !forwardEmail) throw new BizError(t('notEmail'));

		const userRow = await this.selectById(c, userId);
		if (forwardEmail && forwardEmail === userRow.email.toLowerCase()) {
			throw new BizError('Forwarding address cannot be the same as your mailbox');
		}
		if (forwardEmail && (await managedDomainService.get(c)).domains.includes(emailUtils.getDomain(forwardEmail).toLowerCase())) {
			throw new BizError('Forwarding to a managed mailbox domain is not allowed.');
		}

		const setFields = {
			forwardStatus,
			forwardEmail: forwardEmail || ''
		};
		if (mainForwardStatus !== undefined) {
			setFields.mainForwardStatus = mainForwardStatus;
		}

		await orm(c)
			.update(user)
			.set(setFields)
			.where(eq(user.userId, userId))
			.run();
	},


	async resetPassword(c, params, userId) {

		const { password } = params;
		const passwordError = cryptoUtils.passwordPolicyError(password);
		if (passwordError) throw new BizError(passwordError);
		const { salt, hash } = await cryptoUtils.hashPassword(password);
		await orm(c).update(user).set({ password: hash, salt, cliToken: '' }).where(eq(user.userId, userId)).run();
		await sessionService.revokeAll(c, userId);
	},

	async upgradePasswordHash(c, userId, password, previousHash, previousSalt) {
		const { salt, hash } = await cryptoUtils.hashPassword(password);
		const updated = await orm(c).update(user).set({ password: hash, salt }).where(and(
			eq(user.userId, userId),
			eq(user.password, previousHash),
			eq(user.salt, previousSalt),
		)).returning({ password: user.password }).get();
		return updated?.password || null;
	},

	selectByEmail(c, email) {
		return orm(c).select().from(user).where(
			and(
				eq(user.email, email),
				eq(user.isDel, isDel.NORMAL)))
			.get();
	},

	async insert(c, params) {
		const { userId } = await orm(c).insert(user).values({ ...params }).returning().get();
		return userId;
	},

	selectByEmailIncludeDel(c, email) {
		return orm(c).select().from(user).where(sql`${user.email} COLLATE NOCASE = ${email}`).get();
	},

	selectByIdIncludeDel(c, userId) {
		return orm(c).select().from(user).where(eq(user.userId, userId)).get();
	},

	selectById(c, userId) {
		return orm(c).select().from(user).where(
			and(
				eq(user.userId, userId),
				eq(user.isDel, isDel.NORMAL)))
			.get();
	},

	selectByGoogleSub(c, sub) {
		if (!sub) return Promise.resolve(null);
		return orm(c).select().from(user).where(
			and(
				eq(user.googleSub, sub),
				eq(user.isDel, isDel.NORMAL)))
			.get();
	},

	selectByGoogleSubIncludeDel(c, sub) {
		if (!sub) return Promise.resolve(null);
		return orm(c).select().from(user).where(eq(user.googleSub, sub)).get();
	},

	async updateGoogleBinding(c, userId, sub, email) {
		await orm(c).update(user).set({ googleSub: sub, googleEmail: email }).where(eq(user.userId, userId)).run();
	},

	async clearGoogleBinding(c, userId) {
		await orm(c).update(user).set({ googleSub: '', googleEmail: '' }).where(eq(user.userId, userId)).run();
	},

	async delete(c, userId) {
		await this.assertNotAdminTarget(c, userId);
		await orm(c).update(user).set({ isDel: isDel.DELETE, cliToken: '' }).where(eq(user.userId, userId)).run();
		await sessionService.revokeAll(c, userId);
	},

	async physicsDelete(c, params) {
		let { userIds } = params;
		userIds = [...new Set(String(userIds || '').split(',').map(Number))];
		if (userIds.length === 0 || userIds.length > 100 || userIds.some(userId => !Number.isInteger(userId) || userId <= 0)) {
			throw new BizError('Invalid user ID');
		}
		await this.assertNotAdminTargets(c, userIds);
		await Promise.all(userIds.map(userId => sessionService.revokeAll(c, userId)));
		await assertObjectDeleteQueue(c);
		const placeholders = userIds.map(() => '?').join(',');
		await c.env.db.batch([
			c.env.db.prepare(`
				INSERT OR REPLACE INTO object_delete_queue(key)
				SELECT DISTINCT key FROM attachments WHERE user_id IN (${placeholders})
			`).bind(...userIds),
			c.env.db.prepare(`DELETE FROM attachments WHERE user_id IN (${placeholders})`).bind(...userIds),
			c.env.db.prepare(`DELETE FROM star WHERE user_id IN (${placeholders})`).bind(...userIds),
			c.env.db.prepare(`
				DELETE FROM star
				WHERE email_id IN (SELECT email_id FROM email WHERE user_id IN (${placeholders}))
			`).bind(...userIds),
			c.env.db.prepare(`DELETE FROM send_request WHERE user_id IN (${placeholders})`).bind(...userIds),
			c.env.db.prepare(`DELETE FROM email WHERE user_id IN (${placeholders})`).bind(...userIds),
			c.env.db.prepare(`DELETE FROM account WHERE user_id IN (${placeholders})`).bind(...userIds),
			c.env.db.prepare(`DELETE FROM user WHERE user_id IN (${placeholders})`).bind(...userIds),
		]);
	},

	async list(c, params) {

		let { num, size, email, timeSort, status } = params;

		size = Math.min(50, Math.max(1, Number(size) || 20));
		num = Math.max(1, Number(num) || 1);
		timeSort = Number(timeSort) === 1 ? 1 : 0;
		status = params.status === undefined ? -1 : Number(status);
		const deleted = params.isDel === undefined ? isDel.NORMAL : Number(params.isDel);
		if (![-1, userConst.status.NORMAL, userConst.status.BAN].includes(status)) {
			throw new BizError('Invalid user status.');
		}
		if (![isDel.NORMAL, isDel.DELETE].includes(deleted)) {
			throw new BizError('Invalid deletion status.');
		}
		email = String(email || '').trim();
		if (new TextEncoder().encode(email).length > 48) throw new BizError('Invalid email filter.');

		num = (num - 1) * size;

		const conditions = [];

		if (status !== -1) {
			conditions.push(eq(user.status, status));
		}
		conditions.push(eq(user.isDel, deleted));

		if (email) {
			conditions.push(sql`${user.email} COLLATE NOCASE LIKE ${'%'+ email + '%'}`);
		}


		const query = orm(c).select().from(user)
			.where(and(...conditions));


		if (timeSort) {
			query.orderBy(asc(user.userId));
		} else {
			query.orderBy(desc(user.userId));
		}

		const list = await query.limit(size).offset(num);

		const { total } = await orm(c)
			.select({ total: count() })
			.from(user)
			.where(and(...conditions)).get();
		const userIds = list.map(user => user.userId);

		const [emailCounts, delEmailCounts, sendCounts, delSendCounts, accountCounts, delAccountCounts] = await Promise.all([
			emailService.selectUserEmailCountList(c, userIds, emailConst.type.RECEIVE),
			emailService.selectUserEmailCountList(c, userIds, emailConst.type.RECEIVE, isDel.DELETE),
			emailService.selectUserEmailCountList(c, userIds, emailConst.type.SEND),
			emailService.selectUserEmailCountList(c, userIds, emailConst.type.SEND, isDel.DELETE),
			accountService.selectUserAccountCountList(c, userIds),
			accountService.selectUserAccountCountList(c, userIds, isDel.DELETE)
		]);

		const receiveMap = Object.fromEntries(emailCounts.map(item => [item.userId, item.count]));
		const sendMap = Object.fromEntries(sendCounts.map(item => [item.userId, item.count]));
		const accountMap = Object.fromEntries(accountCounts.map(item => [item.userId, item.count]));

		const delReceiveMap = Object.fromEntries(delEmailCounts.map(item => [item.userId, item.count]));
		const delSendMap = Object.fromEntries(delSendCounts.map(item => [item.userId, item.count]));
		const delAccountMap = Object.fromEntries(delAccountCounts.map(item => [item.userId, item.count]));

		for (const user of list) {

			const userId = user.userId;

			user.receiveEmailCount = receiveMap[userId] || 0;
			user.sendEmailCount = sendMap[userId] || 0;
			user.accountCount = accountMap[userId] || 0;

			user.delReceiveEmailCount = delReceiveMap[userId] || 0;
			user.delSendEmailCount = delSendMap[userId] || 0;
			user.delAccountCount = delAccountMap[userId] || 0;

			let sendAction = {
				sendCount: user.sendLimit,
				sendType: 'day',
				hasPerm: true
			};

			if (isAdmin(user)) {
				user.type = 0;
			} else {
				user.type = 1;
			}

			user.sendAction = sendAction;
			delete user.password;
			delete user.salt;
			delete user.cliToken;
		}

		return { list, total };
	},

	async updateUserInfo(c, userId, recordCreateIp = false) {



		const activeIp = reqUtils.getIp(c);

		const {os, browser, device} = reqUtils.getUserAgent(c);

		const params = {
			os,
			browser,
			device,
			activeIp,
			activeTime: dayjs().format('YYYY-MM-DD HH:mm:ss')
		};

		if (recordCreateIp) {
			params.createIp = activeIp;
		}

		await orm(c)
			.update(user)
			.set(params)
			.where(eq(user.userId, userId))
			.run();
	},

	async setPwd(c, params) {

		const userId = Number(params.userId);
		await this.assertNotAdminTarget(c, userId);
		await this.resetPassword(c, { password: params.password }, userId);
	},

	async setStatus(c, params) {

		const status = Number(params.status);
		const userId = Number(params.userId);
		if (![userConst.status.NORMAL, userConst.status.BAN].includes(status)) {
			throw new BizError('Invalid user status.');
		}
		await this.assertNotAdminTarget(c, userId);

		await orm(c)
			.update(user)
			.set(status === userConst.status.BAN ? { status, cliToken: '' } : { status })
			.where(eq(user.userId, userId))
			.run();

		if (status === userConst.status.BAN) {
			await sessionService.revokeAll(c, userId);
		}
	},

	async reserveSendQuota(c, quantity, userId, requestId) {
		const results = await c.env.db.batch([
			c.env.db.prepare(`
				UPDATE user
				SET send_count = CAST(send_count AS INTEGER) + ?
				WHERE user_id = ?
				  AND is_del = 0
				  AND status = 0
				  AND (send_limit <= 0 OR CAST(send_count AS INTEGER) + ? <= send_limit)
				RETURNING send_count AS sendCount, send_limit AS sendLimit
			`).bind(quantity, userId, quantity),
			c.env.db.prepare(`
				UPDATE send_request
				SET recipient_count = ?, quota_reserved = 1
				WHERE user_id = ? AND request_id = ? AND changes() > 0
			`).bind(quantity, userId, requestId),
		]);
		const reserved = results[0]?.results?.[0] || null;

		if (!reserved) {
			throw new BizError(t('daySendLack'), 403);
		}
		return reserved;
	},

	async releaseSendQuota(c, quantity, userId) {
		await c.env.db.prepare(`
			UPDATE user
			SET send_count = MAX(0, CAST(send_count AS INTEGER) - ?)
			WHERE user_id = ?
		`).bind(quantity, userId).run();
	},

	async add(c, params) {

		let { email, password } = params;
		email = String(email || '').trim().toLowerCase();
		if (!verifyUtils.isEmail(email)) throw new BizError(t('notEmail'));

		if (!await managedDomainService.containsEmail(c, email)) {
			throw new BizError(t('notEmailDomain'));
		}

		const passwordError = cryptoUtils.passwordPolicyError(password);
		if (passwordError) throw new BizError(passwordError);

		const accountRow = await accountService.selectByEmailIncludeDel(c, email);

		if (accountRow && accountRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelUser'));
		}

		if (accountRow) {
			throw new BizError(t('isRegAccount'));
		}

		const { salt, hash } = await saltHashUtils.hashPassword(password);

		const type = 1;
		const userId = await userService.insert(c, { email, password: hash, salt, type, sendLimit: 50 });

		await userService.updateUserInfo(c, userId, true);

		await accountService.insert(c, { userId: userId, email, type, name: emailUtils.getName(email), allReceive: 1, isDefaultSend: 1 });
	},

	async createInitialAdmin(c, params) {
		const email = String(params.email || '').trim().toLowerCase();
		if (!verifyUtils.isEmail(email)) throw new BizError(t('notEmail'));
		const domains = managedDomainService.normalizeInput(params.domains);
		if (!domains.includes(emailUtils.getDomain(email))) throw new BizError(t('notEmailDomain'));
		const passwordError = cryptoUtils.passwordPolicyError(params.password);
		if (passwordError) throw new BizError(passwordError);
		const { salt, hash } = await saltHashUtils.hashPassword(params.password);
		const activeIp = reqUtils.getIp(c);
		const { os, browser, device } = reqUtils.getUserAgent(c);
		const activeTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
		const statements = [
			c.env.db.prepare('DELETE FROM installation_guard'),
			c.env.db.prepare(`
				INSERT INTO user (
					email, password, salt, type, is_admin, send_limit,
					create_ip, active_ip, active_time, os, browser, device
				)
				SELECT ?, ?, ?, 0, 1, 50, ?, ?, ?, ?, ?, ?
				WHERE NOT EXISTS (SELECT 1 FROM user)
				  AND EXISTS (SELECT 1 FROM installation_state WHERE id = 1 AND status = 'pending')
				RETURNING user_id AS userId
			`).bind(email, hash, salt, activeIp, activeIp, activeTime, os, browser, device),
			c.env.db.prepare(`
				INSERT INTO installation_guard(valid)
				SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END
			`),
			c.env.db.prepare(`
				INSERT INTO account (email, name, user_id, all_receive, is_default_send)
				VALUES (?, ?, (
					SELECT user_id FROM user WHERE email = ? AND is_admin = 1
				), 1, 1)
			`).bind(email, emailUtils.getName(email), email),
			...domains.map(domain => c.env.db.prepare(
				'INSERT INTO managed_domain(domain) VALUES (?)',
			).bind(domain)),
			c.env.db.prepare(`
				UPDATE installation_state
				SET status = 'installed', revision = 1, update_time = CURRENT_TIMESTAMP
				WHERE id = 1 AND status = 'pending'
			`),
			c.env.db.prepare('DELETE FROM installation_guard'),
		];
		const results = await c.env.db.batch(statements);
		const userId = results[1]?.results?.[0]?.userId;
		if (!userId || Number(results[3]?.meta?.changes || 0) !== 1
			|| Number(results[results.length - 2]?.meta?.changes || 0) !== 1) {
			throw new Error('Initial administrator creation did not complete atomically.');
		}
		return userId;
	},

	async updateAccountLimit(c, params) {
		const userId = Number(params.userId);
		const accountLimit = Number(params.accountLimit);
		if (!Number.isInteger(userId) || userId <= 0) throw new BizError('Invalid user ID');
		if (!Number.isInteger(accountLimit) || accountLimit < 1 || accountLimit > 999999) {
			throw new BizError('Mailbox limit must be an integer between 1 and 999999');
		}
		const targetUser = await this.selectById(c, userId);
		if (!targetUser) throw new BizError(t('notExistUser'), 404);
		if (isAdmin(targetUser)) {
			throw new BizError('Administrator mailbox limit is always unlimited');
		}
		await orm(c).update(user).set({ accountLimit }).where(eq(user.userId, userId)).run();
	},

	async updateSendLimit(c, params) {
		const { userId, sendLimit } = params;
		const targetUserId = Number(userId);
		const targetSendLimit = Number(sendLimit);
		if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
			throw new BizError('Invalid user ID');
		}
		if (!Number.isInteger(targetSendLimit) || targetSendLimit < 0 || targetSendLimit > 999999) {
			throw new BizError('Send limit must be an integer between 0 and 999999');
		}
		await this.assertNotAdminTarget(c, targetUserId);
		await orm(c).update(user).set({ sendLimit: targetSendLimit }).where(eq(user.userId, targetUserId)).run();
	},

	async assertNotAdminTarget(c, userId) {
		const targetUserId = Number(userId);
		if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
			throw new BizError('Invalid user ID');
		}
		const targetUser = await this.selectByIdIncludeDel(c, targetUserId);
		if (!targetUser) {
			throw new BizError(t('notExistUser'));
		}
		if (isAdmin(targetUser)) {
			throw new BizError('Administrator account cannot be modified');
		}
	},

	async assertNotAdminTargets(c, userIds) {
		const targetUsers = await orm(c).select({
			userId: user.userId,
			isAdmin: user.isAdmin
		}).from(user).where(inArray(user.userId, userIds)).all();
		if (targetUsers.length !== new Set(userIds).size) {
			throw new BizError(t('notExistUser'));
		}
		if (targetUsers.some(isAdmin)) {
			throw new BizError('Administrator account cannot be modified');
		}
	},

	async resetDaySendCount(c) {
		await orm(c).update(user).set({ sendCount: 0 }).run();
	},

	async resetSendCount(c, params) {
		const userId = Number(params.userId);
		await this.assertNotAdminTarget(c, userId);
		await orm(c).update(user).set({ sendCount: 0 }).where(eq(user.userId, userId)).run();
	},

	async restore(c, params) {
		const userId = Number(params.userId);
		const type = Number(params.type || 0);
		if (![0, 1].includes(type)) throw new BizError('Invalid restore type.');
		await this.assertNotAdminTarget(c, userId);
		await orm(c)
			.update(user)
			.set({ isDel: isDel.NORMAL })
			.where(eq(user.userId, userId))
			.run();
		const userRow = await this.selectById(c, userId);
		await accountService.restoreByEmail(c, userRow.email);

		if (type) {
			await emailService.restoreByUserId(c, userId);
			await accountService.restoreByUserId(c, userId);
		}

	},

	async verifyCliToken(c, token) {
		if (!token) return null;
		const tokenHash = await cryptoUtils.hashSecret(token);
		const db = orm(c);
		const userRow = await db.select().from(user)
			.where(and(
				eq(user.cliToken, `sha256$${tokenHash}`),
				eq(user.isDel, isDel.NORMAL),
				eq(user.status, userConst.status.NORMAL),
			)).get();
		if (!userRow) return null;
		return userRow;
	},

	async genCliToken(c, userId) {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = 'cl_' + cryptoUtils.toBase64Url(bytes);
		const tokenHash = await cryptoUtils.hashSecret(token);
		await orm(c).update(user).set({ cliToken: `sha256$${tokenHash}` }).where(eq(user.userId, userId)).run();
		return token;
	},

	async revokeCliToken(c, userId) {
		await orm(c).update(user).set({ cliToken: '' }).where(eq(user.userId, userId)).run();
	}

};

export default userService;
