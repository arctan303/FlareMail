process.env.WRANGLER_LOG_PATH ||= '.wrangler/logs';

const { cloudflareTest } = await import('@cloudflare/vitest-pool-workers');
const { defineConfig } = await import('vitest/config');

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler-vitest.toml' },
		}),
	],
	test: {
		testTimeout: 60000,
		hookTimeout: 60000,
	},
});
