export const SCHEMA_PATCH_CATALOG = [
	{ version: 308, label: 'v3.8', descKey: 'schemaPatch308' },
	{ version: 309, label: 'v3.8.1', descKey: 'schemaPatch309' },
	{ version: 310, label: 'v3.9', descKey: 'schemaPatch310' },
	{ version: 311, label: 'v3.10', descKey: 'schemaPatch311' },
	{ version: 312, label: 'v3.11', descKey: 'schemaPatch312' },
	{ version: 314, label: 'v3.13', descKey: 'schemaPatch314' },
	{ version: 315, label: 'v3.14', descKey: 'schemaPatch315' },
	{ version: 316, label: 'v3.15', descKey: 'schemaPatch316' },
	{ version: 317, label: 'v3.16', descKey: 'schemaPatch317' },
	{ version: 318, label: 'v3.17', descKey: 'schemaPatch318' },
	{ version: 319, label: 'v3.19', descKey: 'schemaPatch319' },
	{ version: 320, label: 'v3.20', descKey: 'schemaPatch320' },
	{ version: 321, label: 'v3.21', descKey: 'schemaPatch321' },
	{ version: 322, label: 'v3.22', descKey: 'schemaPatch322' },
	{ version: 323, label: 'v3.23', descKey: 'schemaPatch323' },
	{ version: 324, label: 'v3.24', descKey: 'schemaPatch324' },
];

export const LATEST_SCHEMA_VERSION = 324;

export function getPatchMeta(version) {
	const numeric = Number(version);
	const match = SCHEMA_PATCH_CATALOG.find(p => p.version === numeric);
	if (match) return match;
	return {
		version: numeric,
		label: `v${numeric}`,
		descKey: 'schemaPatchGeneric',
	};
}
