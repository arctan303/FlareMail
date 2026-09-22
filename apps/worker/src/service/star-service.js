import orm from '../entity/orm';
import { star } from '../entity/star';
import emailService from './email-service';
import BizError from '../error/biz-error';
import { and, desc, eq, lt, sql, or, like, count } from 'drizzle-orm';
import email from '../entity/email';
import { isDel } from '../const/entity-const';
import attService from "./att-service";
import { t } from '../i18n/i18n'
import accountService from './account-service';
const starService = {

	async add(c, params, userId) {
		const emailId = Number(params.emailId);
		if (!Number.isInteger(emailId) || emailId <= 0) throw new BizError(t('starNotExistEmail'), 404);
		const email = await emailService.selectById(c, emailId, userId);
		if (!email) {
			throw new BizError(t('starNotExistEmail'), 404);
		}
		const exist = await orm(c).select().from(star).where(
			and(
				eq(star.userId, userId),
				eq(star.emailId, emailId)))
			.get()

		if (exist) {
			return
		}

		await orm(c).insert(star).values({ userId, emailId }).onConflictDoNothing().run();
	},

	async cancel(c, params, userId) {
		const emailId = Number(params.emailId);
		if (!Number.isInteger(emailId) || emailId <= 0) throw new BizError(t('starNotExistEmail'), 404);
		await orm(c).delete(star).where(
			and(
				eq(star.userId, userId),
				eq(star.emailId, emailId)))
			.run();
	},

	async list(c, params, userId) {
		let { emailId, size, keyword, q } = params;
		const offset = Number(params.offset ?? 0);
		if (!Number.isSafeInteger(offset) || offset < 0) throw new BizError('Invalid mail offset.', 400);
		emailId = Number(emailId);
		size = Math.min(50, Math.max(1, Number(size) || 20));
		if (params.view === 'conversation') {
			const accountId = params.accountId ? Number(params.accountId) : 0;
			if (accountId && !await accountService.selectOwnedById(c, accountId, userId)) throw new BizError('Email account not found.',404);
			return emailService.listConversations(c, { ...params, starred: true, size, offset, accountId }, userId);
		}

		if (!emailId) {
			emailId = 9999999999;
		}

		const searchKw = (keyword || q || '').trim();
		if (searchKw && new TextEncoder().encode(searchKw).length > 64) {
			throw new BizError('Search keyword is too long.', 400);
		}

		const conditions = [
			eq(star.userId, userId),
			eq(email.isDel, isDel.NORMAL)
		];

		if (params.accountId !== undefined && params.accountId !== '') {
			const accountId = Number(params.accountId);
			if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new BizError('Invalid account ID.', 400);
			conditions.push(eq(email.accountId, accountId));
		}

		if (searchKw) {
			conditions.push(
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

		const list = await orm(c).select({
			isStar: sql`1`.as('isStar'),
			starId: star.starId
			, ...email
		}).from(star)
			.leftJoin(email, eq(email.emailId, star.emailId))
			.where(and(...conditions, lt(star.emailId, emailId)))
			.orderBy(desc(star.emailId))
			.limit(size)
			.offset(offset)
			.all();

		const emailIds = list.map(item => item.emailId);

		const attsList = await attService.selectByEmailIds(c, emailIds);

		list.forEach(emailRow => {
			const atts = attsList.filter(attsRow => attsRow.emailId === emailRow.emailId);
			emailRow.attList = atts;
		});

		const { total } = await orm(c).select({ total: count() }).from(star)
			.leftJoin(email, eq(email.emailId, star.emailId)).where(and(...conditions)).get();
		return { list, total };
	}
};

export default starService;
