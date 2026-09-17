export async function markInstalled(
	runtimeEnv,
	domains = ['example.com'],
	allowedOrigins = ['http://localhost:8787'],
) {
	await runtimeEnv.db.batch([
		runtimeEnv.db.prepare('DELETE FROM managed_domain'),
		...domains.map(domain => runtimeEnv.db.prepare(
			'INSERT INTO managed_domain(domain) VALUES (?)',
		).bind(domain)),
		runtimeEnv.db.prepare(`
			UPDATE installation_state
			SET status = 'installed', revision = 1, update_time = CURRENT_TIMESTAMP
			WHERE id = 1
		`),
		runtimeEnv.db.prepare(`
			UPDATE runtime_config SET allowed_origins = ? WHERE id = 1
		`).bind(JSON.stringify(allowedOrigins)),
	]);
}
