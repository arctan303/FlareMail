import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src';
import { dbInit } from '../src/init/init';
import baseline from './fixtures/schema-320.json';

const SETUP_SECRET = 'domain-preflight-setup-secret';
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const allow = { limit: async () => ({ success: true }) };

function runtime(overrides = {}) {
	return {
		...env,
		SETUP_SECRET,
		SETUP_RATE_LIMITER: allow,
		SETUP_STATUS_RATE_LIMITER: allow,
		...overrides,
	};
}

function context(config = runtime()) {
	const values = new Map();
	return { env: config, get: key => values.get(key), set: (key, value) => values.set(key, value) };
}

async function request(path, options = {}, config = runtime()) {
	const execution = createExecutionContext();
	const response = await worker.fetch(new Request(`http://localhost${path}`, options), config, execution);
	await waitOnExecutionContext(execution);
	return response;
}

async function snapshot() {
	const structures = await env.db.prepare(`
		SELECT name, sql FROM sqlite_master
		WHERE sql IS NOT NULL AND name NOT GLOB '_*'
		ORDER BY name
	`).all();
	const contents = {};
	for (const { name } of structures.results.filter(row => /^CREATE TABLE/i.test(row.sql))) {
		contents[name] = (await env.db.prepare(`SELECT * FROM ${quote(name)} ORDER BY 1`).all()).results;
	}
	return { structures: structures.results, contents };
}

beforeEach(async () => {
	const tables = await env.db.prepare(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_*'",
	).all();
	for (const { name } of tables.results) await env.db.prepare(`DROP TABLE ${quote(name)}`).run();
	for (const entry of baseline.schema) await env.db.prepare(entry.sql).run();
	const columns = Object.keys(baseline.settings);
	await env.db.prepare(`
		INSERT INTO setting (${columns.map(quote).join(',')})
		VALUES (${columns.map(() => '?').join(',')})
	`).bind(...columns.map(key => baseline.settings[key])).run();
	for (const version of baseline.versions) {
		await env.db.prepare("INSERT INTO schema_migrations(version,applied_time) VALUES (?, '2026-09-14 00:00:00')")
			.bind(version).run();
	}
	await env.db.prepare(`
		INSERT INTO user(email,password,salt,is_admin) VALUES ('owner@example.com','hash','salt',1)
	`).run();
});

describe('schema 320 managed-domain upgrade preflight', () => {
	it.each([
		['missing', undefined],
		['invalid', ['https://not-a-domain.example/path']],
	])('reports %s legacy domains as unsupported and rejects upgrade without writes', async (_label, domains) => {
		const config = runtime({ FLAREMAIL_DOMAINS: domains });
		const before = await snapshot();
		const status = await request('/api/setup/status', {}, config);
		expect(status.status).toBe(200);
		expect((await status.json()).data).toEqual({
			setupRequired: false,
			upgradeRequired: true,
			upgradeBlocking: true,
			upgradeSupported: false,
		});
		expect(await snapshot()).toEqual(before);

		const upgrade = await request('/api/setup/upgrade', {
			method: 'POST',
			headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
			body: JSON.stringify({ setupToken: SETUP_SECRET }),
		}, config);
		expect(upgrade.status).toBe(409);
		expect((await upgrade.json()).message).toMatch(/temporarily restore FLAREMAIL_DOMAINS/i);
		expect(await snapshot()).toEqual(before);
	});

	it('ignores missing legacy environment domains after 321 has persisted D1 authority', async () => {
		await dbInit.migrate(context(runtime({ FLAREMAIL_DOMAINS: ['example.com'] })));
		const before = await snapshot();
		const status = await request('/api/setup/status', {}, runtime({ FLAREMAIL_DOMAINS: undefined }));
		expect((await status.json()).data).toEqual({
			setupRequired: false,
			upgradeRequired: false,
			upgradeBlocking: false,
			upgradeSupported: true,
		});
		expect(await snapshot()).toEqual(before);
	});
});
