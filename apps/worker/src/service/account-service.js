import BizError from '../error/biz-error';
import emailUtils from '../utils/email-utils';
import userService from './user-service';
import orm from '../entity/orm';
import account from '../entity/account';
import { and, asc, eq, gt, inArray, count, sql, ne, or, lt, desc } from 'drizzle-orm';
import {accountConst, isDel, userConst} from '../const/entity-const';
import verifyUtils from '../utils/verify-utils';
import { t } from '../i18n/i18n';
import { assertObjectDeleteQueue } from '../utils/delete-queue-utils';
import managedDomainService from './managed-domain-service';
import { isAdmin } from '../security/admin-identity';

const accountService = {
	selectByEmail(c, email) {
		return orm(c).select().from(account).where(and(
			sql`${account.email} COLLATE NOCASE = ${email}`,
			eq(account.isDel, isDel.NORMAL),
		)).get();
	},

	selectByEmailIncludeDel(c, email) {
		return orm(c).select().from(account).where(sql`${account.email} COLLATE NOCASE = ${email}`).get();
	},

	list(c, params, userId) {
		let { accountId, size, lastSort } = params;

		accountId = Number(accountId) || 0;
		size = Math.min(100, Math.max(1, Number(size) || 30));

		if (accountId === 0 || lastSort === undefined || lastSort === null || lastSort === '' || lastSort === 'null' || lastSort === 'undefined') {
			lastSort = 9999999999;
		} else {
			lastSort = Number(lastSort);
			if (Number.isNaN(lastSort)) {
				lastSort = 9999999999;
			}
		}

		return orm(c).select().from(account).where(
			and(
				eq(account.userId, userId),
				eq(account.isDel, isDel.NORMAL),
					or(
						lt(account.sort, lastSort),
						and(
							eq(account.sort, lastSort),
							gt(account.accountId, accountId)
						)
					))
				)
			.orderBy(desc(account.sort), asc(account.accountId))
			.limit(size)
			.all();
	},

	async delete(c, params, userId) {

		const accountId = Number(params.accountId);

		const user = await userService.selectById(c, userId);
		const accountRow = await this.selectOwnedById(c, accountId, userId);
		if (!accountRow) throw new BizError(t('noUserAccount'), 404);

		if (accountRow.email === user.email) {
			throw new BizError(t('delMyAccount'));
		}

		await orm(c).update(account).set({ isDel: isDel.DELETE }).where(
			and(eq(account.userId, userId),
				eq(account.accountId, accountId)))
			.run();
	},

	selectById(c, accountId) {
		return orm(c).select().from(account).where(
			and(eq(account.accountId, accountId),
				eq(account.isDel, isDel.NORMAL)))
			.get();
	},

	async insert(c, params) {
		await orm(c).insert(account).values({ ...params }).returning();
	},

	async insertList(c, list) {
		await orm(c).insert(account).values(list).run();
	},

	async selectUserAccountCountList(c, userIds, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: account.userId,
				count: count(account.accountId)
			})
			.from(account)
			.where(and(
				inArray(account.userId, userIds),
				eq(account.isDel, del)
			))
			.groupBy(account.userId)
		return result;
	},

	async countUserAccount(c, userId) {
		const { num } = await orm(c).select({num: count()}).from(account).where(and(eq(account.userId, userId),eq(account.isDel, isDel.NORMAL))).get();
		return num;
	},

	async restoreByEmail(c, email) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.email, email)).run();
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.userId, userId)).run();
	},

	async setName(c, params, userId) {
		const accountId = Number(params.accountId);
		const name = String(params.name || '').trim();
		if (!name || name.length > 30) {
			throw new BizError(t('usernameLengthLimit'));
		}
		const userRow = await userService.selectById(c, userId);
		const admin = isAdmin(userRow);
		const conditions = admin
			? and(eq(account.accountId, accountId), eq(account.isDel, isDel.NORMAL))
			: and(eq(account.userId, userId), eq(account.accountId, accountId), eq(account.isDel, isDel.NORMAL));
		const updated = await orm(c).update(account).set({name}).where(conditions).returning({ accountId: account.accountId }).get();
		if (!updated) throw new BizError(t('noUserAccount'), 404);
	},

	async allAccount(c, params) {

		let { userId, num, size } = params

		userId = Number(userId)

		num = Math.max(1, Number(num) || 1)
		size = Math.min(30, Math.max(1, Number(size) || 30))

		if (!Number.isInteger(userId) || userId <= 0) throw new BizError('Invalid user ID');
		num = (num - 1) * size;

		const userRow = await userService.selectByIdIncludeDel(c, userId);
		if (!userRow) throw new BizError(t('notExistUser'), 404);

		const conditions = and(eq(account.userId, userId), ne(account.email, userRow.email));
		const list = await orm(c).select().from(account).where(conditions).limit(size).offset(num);
		const { total } = await orm(c).select({ total: count() }).from(account).where(conditions).get();

		return { list, total }
	},

	async setForward(c, params, userId) {
		const accountId = Number(params.accountId);
		const forwardStatus = Number(params.forwardStatus);

		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new BizError(t('notExistUser'));
		}
		if (![0, 1].includes(forwardStatus)) {
			throw new BizError(t('notExistUser'));
		}

		await orm(c).update(account)
			.set({ forwardStatus })
			.where(and(
				eq(account.userId, userId),
				eq(account.accountId, accountId)
			))
			.run();
	},

	selectByIdIncludeDel(c, accountId) {
		return orm(c).select().from(account).where(eq(account.accountId, accountId)).get();
	},

	selectOwnedById(c, accountId, userId) {
		return orm(c).select().from(account).where(and(
			eq(account.accountId, accountId),
			eq(account.userId, userId),
			eq(account.isDel, isDel.NORMAL),
		)).get();
	},

	async add(c, params, userId) {
		const targetUser = await userService.selectById(c, userId);
		if (!targetUser || targetUser.status !== userConst.status.NORMAL) {
			throw new BizError(t('authExpired'), 401);
		}
		return await this.createForUser(c, params.email, targetUser);
	},

	async adminAdd(c, params) {
		const userId = Number(params.userId);
		if (!Number.isInteger(userId) || userId <= 0) throw new BizError('Invalid user ID');

		const targetUser = await userService.selectById(c, userId);
		if (!targetUser || targetUser.status !== userConst.status.NORMAL) {
			throw new BizError(t('notExistUser'));
		}
		return await this.createForUser(c, params.email, targetUser);
	},

	async createForUser(c, value, targetUser) {
		const email = String(value || '').trim().toLowerCase();
		if (!verifyUtils.isEmail(email)) throw new BizError(t('notEmail'));
		if (!await managedDomainService.containsEmail(c, email)) throw new BizError(t('notEmailDomain'));
		if (await this.selectByEmailIncludeDel(c, email)) {
			throw new BizError(t('isRegAccount'), 409);
		}

		const admin = isAdmin(targetUser);
		const defaultName = targetUser.name || emailUtils.getName(email);
		const inserted = await c.env.db.prepare(`
			INSERT INTO account (email, name, user_id)
			SELECT ?, ?, ?
			WHERE EXISTS (
				SELECT 1 FROM user
				WHERE user_id = ? AND status = ? AND is_del = ?
			)
			AND (? = 1 OR (
				SELECT COUNT(*) FROM account WHERE user_id = ? AND is_del = 0
			) < (
				SELECT account_limit FROM user WHERE user_id = ?
			))
			AND NOT EXISTS (SELECT 1 FROM account WHERE email = ? COLLATE NOCASE)
			RETURNING account_id AS accountId, email, name, user_id AS userId,
				all_receive AS allReceive, sort, is_del AS isDel
		`).bind(
			email,
			defaultName,
			targetUser.userId,
			targetUser.userId,
			userConst.status.NORMAL,
			isDel.NORMAL,
			admin ? 1 : 0,
			targetUser.userId,
			targetUser.userId,
			email,
		).first();

		if (!inserted) {
			if (await this.selectByEmailIncludeDel(c, email)) throw new BizError(t('isRegAccount'), 409);
			throw new BizError(t('accountLimit'), 403);
		}
		inserted.accountCount = await this.countUserAccount(c, targetUser.userId);
		const currentUser = await userService.selectById(c, targetUser.userId);
		inserted.accountLimit = admin ? 0 : (Number(currentUser?.accountLimit) || 10);
		return inserted;
	},

	async physicsDelete(c, params) {
		const accountId = Number(params.accountId);
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new BizError('Invalid account ID');
		}
		const accountRow = await this.selectByIdIncludeDel(c, accountId);
		if (!accountRow) {
			throw new BizError(t('noUserAccount'));
		}
		const userRow = await userService.selectByIdIncludeDel(c, accountRow.userId);
		if (!userRow) {
			throw new BizError(t('notExistUser'));
		}
		if (accountRow.email?.toLowerCase() === userRow.email?.toLowerCase()) {
			throw new BizError('Primary account cannot be deleted');
		}
		await assertObjectDeleteQueue(c);
		await c.env.db.batch([
			c.env.db.prepare(`
				INSERT OR REPLACE INTO object_delete_queue(key)
				SELECT DISTINCT key FROM attachments WHERE account_id = ?
			`).bind(accountId),
			c.env.db.prepare(`DELETE FROM attachments WHERE account_id = ?`).bind(accountId),
			c.env.db.prepare(`
				DELETE FROM star
				WHERE email_id IN (SELECT email_id FROM email WHERE account_id = ?)
			`).bind(accountId),
			c.env.db.prepare(`DELETE FROM email WHERE account_id = ?`).bind(accountId),
			c.env.db.prepare(`DELETE FROM account WHERE account_id = ?`).bind(accountId),
		]);
	},

	async setAllReceive(c, params, userId) {
		const accountId = Number(params.accountId);
		const accountRow = await this.selectOwnedById(c, accountId, userId);
		if (!accountRow) throw new BizError(t('noUserAccount'), 404);
		const nextValue = accountRow.allReceive ? 0 : 1;
		await c.env.db.prepare(`
			UPDATE account
			SET all_receive = CASE WHEN account_id = ? THEN ? ELSE 0 END
			WHERE user_id = ?
		`).bind(accountId, nextValue, userId).run();
	},

	async setAsTop(c, params, userId) {
		const accountId = Number(params.accountId);
		const selected = await this.selectOwnedById(c, accountId, userId);
		if (!selected) throw new BizError(t('noUserAccount'), 404);
		const userRow = await userService.selectById(c, userId);
		const mainAccountRow = await accountService.selectByEmailIncludeDel(c, userRow.email);
		let mainSort = mainAccountRow.sort === 0 ? 2 : mainAccountRow.sort + 1;
		await orm(c).update(account).set({ sort: mainSort }).where(eq(account.email, userRow.email )).run();
		await orm(c).update(account).set({ sort: mainSort - 1 }).where(and(eq(account.accountId, accountId),eq(account.userId,userId))).run();
	},

	async setDefaultSend(c, params, userId) {
		const accountId = Number(params.accountId);
		const accountRow = await this.selectOwnedById(c, accountId, userId);
		if (!accountRow) throw new BizError(t('noUserAccount'), 404);
		await c.env.db.batch([
			c.env.db.prepare(`UPDATE account SET is_default_send = 0 WHERE user_id = ?`).bind(userId),
			c.env.db.prepare(`UPDATE account SET is_default_send = 1 WHERE account_id = ? AND user_id = ?`).bind(accountId, userId)
		]);
	},

	async getDefaultSendAccount(c, userId) {
		const defaultAccount = await c.env.db.prepare(`
			SELECT account_id AS accountId, email, name, user_id AS userId, is_default_send AS isDefaultSend
			FROM account
			WHERE user_id = ? AND is_del = 0 AND is_default_send = 1
			LIMIT 1
		`).bind(userId).first();
		if (defaultAccount) return defaultAccount;
		const userRow = await userService.selectById(c, userId);
		if (!userRow) return null;
		return await this.selectByEmail(c, userRow.email);
	},

	async selectAllForUser(c, userId) {
		return await orm(c).select().from(account).where(and(
			eq(account.userId, userId),
			eq(account.isDel, isDel.NORMAL)
		)).orderBy(asc(account.sort), asc(account.accountId));
	}
};

export default accountService;
