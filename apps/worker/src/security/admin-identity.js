export function isAdmin(userRow) {
	return Number(userRow?.isAdmin ?? userRow?.is_admin) === 1;
}

export async function selectPersistedAdmin(c) {
	const rows = await c.env.db.prepare(`
		SELECT user_id AS userId, email, status, is_del AS isDel,
			is_admin AS isAdmin, unmatched_policy AS unmatchedPolicy
		FROM user
		WHERE is_admin = 1
		LIMIT 2
	`).all();
	return rows.results?.length === 1 ? rows.results[0] : null;
}
