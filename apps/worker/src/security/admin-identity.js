export function isAdmin(userRow) {
	return Number(userRow?.isAdmin ?? userRow?.is_admin) === 1;
}

// Single source of truth for the permission keys granted to each role at runtime.
// The request guard (security.js) and the login payload (user-service.js) must
// both resolve permissions through resolvePermKeys so they cannot drift apart.
// The legacy perm/role_perm seed rows in init/migrations.js encode a similar key
// list but are dropped again by v3_2DB, and nothing reads them at runtime; see
// the note above that table.
const ADMIN_PERM_KEYS = Object.freeze(['*']);
const MEMBER_PERM_KEYS = Object.freeze([
	'email:delete', 'account:add', 'account:query', 'account:delete', 'email:send',
]);

export function resolvePermKeys(userRow) {
	return isAdmin(userRow) ? [...ADMIN_PERM_KEYS] : [...MEMBER_PERM_KEYS];
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
