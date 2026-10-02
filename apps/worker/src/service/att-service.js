import orm from '../entity/orm';
import { att } from '../entity/att';
import { and, eq, inArray, desc } from 'drizzle-orm';
import r2Service from './r2-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';
import { attConst } from '../const/entity-const';
import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-utils';
import settingService from "./setting-service";
import { validatePreparedAttachments } from '../utils/send-validator';

const attService = {

	async addAtt(c, attachments) {

		for (let attachment of attachments) {

			let metadate = {
				contentType: attachment.mimeType,
			}

			if (!attachment.contentId) {
				metadate.contentDisposition = `attachment;filename=${attachment.filename}`
			} else {
				metadate.contentDisposition = `inline;filename=${attachment.filename}`
				metadate.cacheControl = `max-age=259200`
			}

			await r2Service.putObj(c, attachment.key, attachment.content, metadate);

		}

		await orm(c).insert(att).values(attachments).run();
	},

	async toImageUrlHtml(c, content, userId, attachments = []) {

		const { r2Domain } = await settingService.query(c);
		const legacyDomain = domainUtils.toOssDomain(r2Domain);

		const { document } = parseHTML(content);

		const images = Array.from(document.querySelectorAll('img'));

		let imageDataList = [];

		for (const img of images) {

			//邮件正文base64图片转cid附件
			const src = img.getAttribute('src');
			if (src && src.toLowerCase().startsWith('data:image')) {
				const cid = crypto.randomUUID().replace(/-/g, '');

				img.setAttribute('src', 'cid:' + cid);

				const attData = {};
				attData.dataUrl = src;
				attData.content = fileUtils.base64ToDataStr(src);
				attData.contentId = cid;

				imageDataList.push(attData);
			}

			//邮件正文站内图片转cid附件
			const privatePrefix = '/api/attachment/';
			let privatePath = src;
			try {
				const parsed = new URL(src, c.req.url);
				if (parsed.origin === new URL(c.req.url).origin) privatePath = parsed.pathname;
			} catch {
				privatePath = src;
			}
			const isLegacyAttachment = src && legacyDomain && src.startsWith(legacyDomain + '/');
			if (src && (isLegacyAttachment || src.startsWith('attachments/') || privatePath.startsWith(privatePrefix))) {

				const cid = crypto.randomUUID().replace(/-/g, '')
				img.setAttribute('src', 'cid:' + cid);

				const attData = {};

				if (isLegacyAttachment) {
					attData.key = src.slice(legacyDomain.length + 1);
				}

				if (src.startsWith('attachments/')) {
					attData.key = src;
				}

				if (privatePath.startsWith(privatePrefix)) {
					try {
						attData.key = decodeURIComponent(privatePath.slice(privatePrefix.length));
					} catch {
						attData.key = '';
					}
				}

				attData.contentId = cid;
				attData.type = attConst.type.EMBED;
				imageDataList.push(attData);

			}

			const hasInlineWidth = img.hasAttribute('width');
			const style = img.getAttribute('style') || '';
			const hasStyleWidth = /(^|\s)width\s*:\s*[^;]+/.test(style);

			if (!hasInlineWidth && !hasStyleWidth) {
				const newStyle = (style ? style.trim().replace(/;$/, '') + '; ' : '') + 'max-width: 100%;';
				img.setAttribute('style', newStyle);
			}
		}

		//查询已有内嵌url图片信息
		const keys = [...new Set(imageDataList.filter(item => !item.dataUrl).map(item => item.key))];
		const dbImageList  = await this.selectOneByKeys(c, keys, userId);
		const dbImagesByKey = new Map(dbImageList.map(image => [image.key, image]));

		// Count every MIME reference, but check owned sizes before any object read or
		// data-image decoding. Unknown/foreign references remain omitted as before.
		validatePreparedAttachments([
			...attachments,
			...imageDataList.filter(image => image.dataUrl),
		], imageDataList.filter(image => !image.dataUrl)
			.map(image => dbImagesByKey.get(image.key)).filter(Boolean));

		const copiedImages = new Map();
		const copyOwnedImage = async (key, dbImage) => {
			const obj = await r2Service.getObj(c, key);
			if (!obj) return null;
			const content = obj instanceof ArrayBuffer ? obj : await obj.arrayBuffer();
			return {
				content,
				buff: content,
				key: constant.ATTACHMENT_PREFIX + await fileUtils.createAttachmentKey(content, dbImage.filename),
			};
		};

		//设置给当前附件
		await Promise.all(imageDataList.map(async image => {
			if (image.dataUrl) {
				const file = fileUtils.base64ToFile(image.dataUrl);
				const buff = await file.arrayBuffer();
				image.key = constant.ATTACHMENT_PREFIX + await fileUtils.createAttachmentKey(buff, file.name);
				image.filename = file.name;
				image.mimeType = file.type;
				image.size = file.size;
				image.buff = buff;
				delete image.dataUrl;
				return;
			}

			const dbImage = dbImagesByKey.get(image.key);
			if (!dbImage) {
				return;
			}

			image.size = dbImage.size;
			image.filename = dbImage.filename;
			image.mimeType = dbImage.mimeType;
			image.contentType = dbImage.mimeType;

			if (!copiedImages.has(image.key)) {
				copiedImages.set(image.key, copyOwnedImage(image.key, dbImage));
			}
			const copied = await copiedImages.get(image.key);
			if (copied) Object.assign(image, copied);
		}))

		imageDataList = imageDataList.filter(image => image.content);

		return { imageDataList, html: document.toString() };
	},

	async saveSendAtt(c, attList, userId, accountId, emailId) {

		const attDataList = [];

		for (let att of attList) {
			att.buff = fileUtils.base64ToUint8Array(att.content);
			att.key = constant.ATTACHMENT_PREFIX + await fileUtils.createAttachmentKey(att.buff, att.filename);
			const attData = { userId, accountId, emailId };
			attData.key = att.key;
			attData.size = att.buff.length;
			attData.filename = att.filename;
			attData.mimeType = att.type;
			attData.type = attConst.type.ATT;
			attDataList.push(attData);
		}

		await orm(c).insert(att).values(attDataList).run();

		for (let att of attList) {
			await r2Service.putObj(c, att.key, att.buff, {
				contentType: att.type,
				contentDisposition: `attachment;filename=${att.filename}`
			});
		}

	},

	async saveArticleAtt(c, attDataList, userId, accountId, emailId) {

		for (let attData of attDataList) {
			attData.userId = userId;
			attData.emailId = emailId;
			attData.accountId = accountId;
			attData.type = attConst.type.EMBED;
			if (!attData.buff) {
				continue;
			}
			await r2Service.putObj(c, attData.key, attData.buff, {
				contentType: attData.mimeType,
				cacheControl: `max-age=259200`,
				contentDisposition: `inline;filename=${attData.filename}`
			});
			delete attData.buff;
		}

		await orm(c).insert(att).values(attDataList).run();

	},

	selectByEmailIds(c, emailIds) {
		return orm(c).select().from(att).where(
			and(
				inArray(att.emailId, emailIds),
				eq(att.type, attConst.type.ATT)
			))
			.all();
	},

	selectAllByEmailIds(c, emailIds) {
		if (!emailIds?.length) return [];
		return orm(c).select().from(att).where(inArray(att.emailId, emailIds)).all();
	},

	async cleanupDeleteQueue(c) {
		const table = await c.env.db.prepare(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'object_delete_queue'`
		).first();
		if (!table) return;

		const { results } = await c.env.db.prepare(`
			SELECT q.key FROM object_delete_queue q
			WHERE q.create_time <= datetime('now', '-7 days')
			  AND (q.claim_time IS NULL OR q.claim_time <= datetime('now', '-1 hour'))
			  AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.key = q.key)
			ORDER BY q.create_time
			LIMIT 100
		`).all();

		for (const row of results) {
			const claimed = await c.env.db.prepare(`
				UPDATE object_delete_queue
				SET claim_time = CURRENT_TIMESTAMP
				WHERE key = ?
				  AND create_time <= datetime('now', '-7 days')
				  AND (claim_time IS NULL OR claim_time <= datetime('now', '-1 hour'))
				  AND NOT EXISTS (SELECT 1 FROM attachments WHERE key = ?)
				RETURNING key
			`).bind(row.key, row.key).first();
			if (!claimed) continue;

			try {
				// New attachment writes use unique keys. The grace period also keeps old
				// hash-based keys safe while in-flight copies finish.
				await r2Service.delete(c, row.key);
				await c.env.db.prepare(`DELETE FROM object_delete_queue WHERE key = ?`).bind(row.key).run();
			} catch (error) {
				console.error(`Attachment garbage collection failed for ${row.key}`, error);
				await c.env.db.prepare(`UPDATE object_delete_queue SET claim_time = NULL WHERE key = ?`).bind(row.key).run();
			}
		}
	},

	selectOneByKeys(c, keys, userId) {
		if (!keys || keys.length === 0) {
			return []
		}
		const conditions = [inArray(att.key, keys)];
		if (userId) conditions.push(eq(att.userId, userId));
		return orm(c).select().from(att).where(and(...conditions)).orderBy(desc(att.attId)).groupBy(att.key).all();
	},

	selectOwnedByKey(c, key, userId) {
		return orm(c).select().from(att).where(and(
			eq(att.key, key),
			eq(att.userId, userId),
		)).orderBy(desc(att.attId)).get();
	}
};

export default attService;
