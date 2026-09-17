import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';
import { t } from '../i18n/i18n';

const contactService = {
	async list(c, params = {}, userId) {
		const uid = Number(userId);
		if (!uid || uid <= 0) throw new BizError(t('unauthorized'), 401);

		const { keyword, group } = params;
		let query = `
			SELECT contact_id AS contactId, user_id AS userId, name, email, phone,
			       remark, group_name AS groupName, create_time AS createTime, update_time AS updateTime
			FROM contact
			WHERE user_id = ? AND is_del = 0
		`;
		const binds = [uid];

		if (group && group.trim() !== '') {
			if (group === '未分组' || group === '__ungrouped__') {
				query += ` AND (group_name IS NULL OR group_name = '')`;
			} else {
				query += ` AND group_name = ?`;
				binds.push(group.trim());
			}
		}

		if (keyword && keyword.trim() !== '') {
			const kw = `%${keyword.trim()}%`;
			query += ` AND (name LIKE ? OR email LIKE ? OR remark LIKE ? OR phone LIKE ? OR group_name LIKE ?)`;
			binds.push(kw, kw, kw, kw, kw);
		}

		query += ` ORDER BY name COLLATE NOCASE ASC, create_time DESC`;

		const result = await c.env.db.prepare(query).bind(...binds).all();
		const list = result.results || [];

		return {
			list,
			total: list.length
		};
	},

	async groups(c, userId) {
		const uid = Number(userId);
		if (!uid || uid <= 0) throw new BizError(t('unauthorized'), 401);

		const result = await c.env.db.prepare(`
			SELECT DISTINCT group_name AS groupName
			FROM contact
			WHERE user_id = ? AND is_del = 0 AND group_name IS NOT NULL AND group_name != ''
			ORDER BY group_name ASC
		`).bind(uid).all();

		return (result.results || []).map(r => r.groupName);
	},

	async getById(c, contactId, userId) {
		const uid = Number(userId);
		const cid = Number(contactId);
		if (!cid || cid <= 0) throw new BizError('Invalid contact ID', 400);

		const item = await c.env.db.prepare(`
			SELECT contact_id AS contactId, user_id AS userId, name, email, phone,
			       remark, group_name AS groupName, create_time AS createTime, update_time AS updateTime
			FROM contact
			WHERE contact_id = ? AND user_id = ? AND is_del = 0
		`).bind(cid, uid).first();

		if (!item) throw new BizError('联系人不存在', 404);
		return item;
	},

	async add(c, data = {}, userId) {
		const uid = Number(userId);
		if (!uid || uid <= 0) throw new BizError(t('unauthorized'), 401);

		let { name, email, phone = '', remark = '', group_name = '', groupName = '' } = data;
		name = (name || '').trim();
		email = (email || '').trim();
		phone = (phone || '').trim();
		remark = (remark || '').trim();
		const groupVal = (group_name || groupName || '').trim();

		if (!name) throw new BizError('联系人姓名不能为空', 400);
		if (!email) throw new BizError('联系人邮箱不能为空', 400);
		if (!verifyUtils.isEmail(email)) throw new BizError(t('notEmail'), 400);

		// Check if same email already exists for this user
		const existing = await c.env.db.prepare(`
			SELECT contact_id AS contactId FROM contact
			WHERE user_id = ? AND email = ? AND is_del = 0
			LIMIT 1
		`).bind(uid, email).first();

		if (existing) {
			throw new BizError(`已存在邮箱为 ${email} 的联系人`, 400);
		}

		const insertResult = await c.env.db.prepare(`
			INSERT INTO contact (user_id, name, email, phone, remark, group_name)
			VALUES (?, ?, ?, ?, ?, ?)
		`).bind(uid, name, email, phone, remark, groupVal).run();

		const contactId = insertResult.meta?.last_row_id;
		return await this.getById(c, contactId, uid);
	},

	async update(c, data = {}, userId) {
		const uid = Number(userId);
		if (!uid || uid <= 0) throw new BizError(t('unauthorized'), 401);

		let { contactId, contact_id, name, email, phone = '', remark = '', group_name = '', groupName = '' } = data;
		const cid = Number(contactId || contact_id);
		if (!cid || cid <= 0) throw new BizError('Invalid contact ID', 400);

		name = (name || '').trim();
		email = (email || '').trim();
		phone = (phone || '').trim();
		remark = (remark || '').trim();
		const groupVal = (group_name || groupName || '').trim();

		if (!name) throw new BizError('联系人姓名不能为空', 400);
		if (!email) throw new BizError('联系人邮箱不能为空', 400);
		if (!verifyUtils.isEmail(email)) throw new BizError(t('notEmail'), 400);

		// Verify contact exists and belongs to current user
		const target = await this.getById(c, cid, uid);
		if (!target) throw new BizError('联系人不存在', 404);

		// Check duplicate email
		const duplicate = await c.env.db.prepare(`
			SELECT contact_id AS contactId FROM contact
			WHERE user_id = ? AND email = ? AND contact_id != ? AND is_del = 0
			LIMIT 1
		`).bind(uid, email, cid).first();

		if (duplicate) {
			throw new BizError(`已存在邮箱为 ${email} 的联系人`, 400);
		}

		await c.env.db.prepare(`
			UPDATE contact
			SET name = ?, email = ?, phone = ?, remark = ?, group_name = ?, update_time = CURRENT_TIMESTAMP
			WHERE contact_id = ? AND user_id = ? AND is_del = 0
		`).bind(name, email, phone, remark, groupVal, cid, uid).run();

		return await this.getById(c, cid, uid);
	},

	async delete(c, params = {}, userId) {
		const uid = Number(userId);
		if (!uid || uid <= 0) throw new BizError(t('unauthorized'), 401);

		const contactId = params.contactId || params.contact_id;
		const contactIds = params.contactIds || params.contact_ids;

		let idsToDelete = [];
		if (Array.isArray(contactIds) && contactIds.length > 0) {
			idsToDelete = contactIds.map(Number).filter(id => id > 0);
		} else if (contactId) {
			const cid = Number(contactId);
			if (cid > 0) idsToDelete.push(cid);
		}

		if (idsToDelete.length === 0) {
			throw new BizError('请选择要删除的联系人', 400);
		}

		const placeholders = idsToDelete.map(() => '?').join(',');
		await c.env.db.prepare(`
			UPDATE contact
			SET is_del = 1, update_time = CURRENT_TIMESTAMP
			WHERE user_id = ? AND contact_id IN (${placeholders})
		`).bind(uid, ...idsToDelete).run();

		return { count: idsToDelete.length };
	}
};

export default contactService;
