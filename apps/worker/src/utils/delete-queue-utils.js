import BizError from '../error/biz-error';

export async function assertObjectDeleteQueue(c) {
	const table = await c.env.db.prepare(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'object_delete_queue'`
	).first();
	if (!table) {
		throw new BizError('Database upgrade required before permanent deletion.', 503);
	}
}
