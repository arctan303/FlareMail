import {readFile, writeFile, access} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {CloudflareApi, CloudflareD1, CloudflareKv, CloudflareR2} from './cloudflare.mjs';
import {exportBackup, verifyBackup, restoreBackup, migrateObjects} from './archive.mjs';
import {openSnapshot, describeSnapshot} from './database.mjs';

export const HELP = `FlareMail instance data tools (Node >=22.12; no Worker endpoint)

  pnpm backup:export --config source.json --out BACKUP_DIRECTORY --offline
  pnpm backup:verify --in BACKUP_DIRECTORY
  pnpm backup:restore --config target.json --in BACKUP_DIRECTORY --offline --confirm-target D1_UUID
  pnpm storage:migrate --source source.json --target target.json --out REPORT.json --offline --confirm-target BUCKET_OR_NAMESPACE_ID

These package commands pass --experimental-sqlite for Node 22.12 compatibility.
Direct invocations must use node --experimental-sqlite scripts/backup.mjs ...
or node --experimental-sqlite scripts/storage-migrate.mjs ... on Node 22.12.

Configuration JSON (resource identifiers only; never put credentials in this file):
  {"accountId":"32_HEX","databaseId":"D1_UUID","namespaceId":"32_HEX","storage":"kv"}
  R2: use storage:"r2", bucket:"name" and S3 environment variables below.
  Optional tokenEnv/r2AccessKeyIdEnv/r2SecretAccessKeyEnv select environment names.

Credentials are read from CLOUDFLARE_API_TOKEN, R2_ACCESS_KEY_ID and
R2_SECRET_ACCESS_KEY by default. Separate source/target environment names are supported.
--offline confirms HTTP, incoming mail, scheduled tasks and other writers are stopped.
Before exporting KV, wait at least 60 seconds after the last write (longer for a
configured cache TTL) and check stable repeated reads. KV propagation is eventual;
these checks do not establish a globally strongly consistent snapshot.
Restore requires NEW EMPTY D1/KV/storage and never overwrites or deletes the source.
Migration copies and verifies bytes/metadata, retains source, and prints binding cutover
steps. Keep writers stopped until cutover. KV conditional writes are unavailable, so
its target must be exclusively controlled. No command automatically deploys or deletes.
Successful KV writes use at most 13 byte/metadata probes with 10-second pauses
(120 seconds of pauses plus request time), without replaying PUT. Timeout keeps the target offline and
the source retained; it must not be followed by D1 import or binding cutover.

Backups contain private messages, password hashes and application credentials.
Protect the directory with filesystem access controls and encryption at rest. The
SHA-256 manifest detects corruption, not a maliciously rewritten archive. Only
restore your own trusted backup. Cloudflare API/S3 credentials and Worker secrets
are not included; configure those separately on a replacement Worker.
Incomplete backup directories have no valid manifest and cannot be restored.`;

async function profile(path, env = process.env) {
    const config = JSON.parse(await readFile(path, 'utf8'));
    const allowed = ['accountId', 'databaseId', 'namespaceId', 'storage', 'bucket', 'tokenEnv', 'r2AccessKeyIdEnv', 'r2SecretAccessKeyEnv'];
    if (!config || typeof config !== 'object' || Object.keys(config).some(key => !allowed.includes(key)) || !['kv', 'r2'].includes(config.storage)) throw new Error('Invalid profile. Use resource identifiers and environment variable names only.');
    for (const key of ['tokenEnv', 'r2AccessKeyIdEnv', 'r2SecretAccessKeyEnv']) if (config[key] && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config[key])) throw new Error('Invalid credential environment variable name.');
    const api = new CloudflareApi({accountId: config.accountId, token: env[config.tokenEnv || 'CLOUDFLARE_API_TOKEN']});
    const d1 = config.databaseId ? new CloudflareD1(api, config.databaseId) : null;
    const kv = config.namespaceId ? new CloudflareKv(api, config.namespaceId) : null;
    const objects = config.storage === 'kv' ? kv : new CloudflareR2({accountId: config.accountId, bucket: config.bucket, accessKeyId: env[config.r2AccessKeyIdEnv || 'R2_ACCESS_KEY_ID'], secretAccessKey: env[config.r2SecretAccessKeyEnv || 'R2_SECRET_ACCESS_KEY']});
    return {config, d1, kv, objects};
}
function requireOption(values, name) { if (!values[name]) throw new Error(`--${name} is required.`); return values[name]; }
async function mustNotExist(path) { try { await access(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; } throw new Error('The output path already exists; choose a new path.'); }
function confirm(values, expected) { if (requireOption(values, 'confirm-target') !== expected) throw new Error('--confirm-target must exactly match the target resource identifier.'); }

export async function runBackup(argv = process.argv.slice(2), print = console.log) {
    const {values, positionals} = parseArgs({args: argv, allowPositionals: true, options: {config: {type: 'string'}, out: {type: 'string'}, in: {type: 'string'}, offline: {type: 'boolean'}, 'confirm-target': {type: 'string'}, help: {type: 'boolean'}}});
    if (values.help) { print(HELP); return; }
    const [command] = positionals;
    if (positionals.length !== 1 || !['export', 'verify', 'restore'].includes(command)) throw new Error('Use export, verify or restore. Run with --help for usage.');
    if (command === 'verify') {
        const verified = await verifyBackup(requireOption(values, 'in'));
        print(JSON.stringify({status: 'verified', objects: verified.manifest.entries.length, database: verified.description.tableCounts, manifestSha256: verified.manifestSha256}, null, 2)); return;
    }
    const instance = await profile(requireOption(values, 'config'));
    if (!instance.d1 || !instance.kv) throw new Error('Backup profiles require databaseId and namespaceId.');
    if (command === 'export') {
        const directory = requireOption(values, 'out'); await mustNotExist(directory);
        const version = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version;
        print(JSON.stringify(await exportBackup({...instance, directory, offline: values.offline, applicationVersion: version}), null, 2));
    } else {
        confirm(values, instance.config.databaseId);
        print(JSON.stringify(await restoreBackup({...instance, directory: requireOption(values, 'in'), offline: values.offline}), null, 2));
    }
}

export async function runStorage(argv = process.argv.slice(2), print = console.log) {
    const {values} = parseArgs({args: argv, options: {source: {type: 'string'}, target: {type: 'string'}, out: {type: 'string'}, offline: {type: 'boolean'}, 'confirm-target': {type: 'string'}, help: {type: 'boolean'}}});
    if (values.help) { print(HELP); return; }
    const source = await profile(requireOption(values, 'source')); const target = await profile(requireOption(values, 'target'));
    if (!source.d1 || !source.kv || !source.objects || !target.objects) throw new Error('Source requires D1/KV/storage and target requires storage.');
    confirm(values, target.config.storage === 'r2' ? target.config.bucket : target.config.namespaceId);
    const output = requireOption(values, 'out'); await mustNotExist(output);
    if (values.offline !== true) throw new Error('--offline is required after stopping all writers.');
    const sql = await source.d1.exportSql(); const db = openSnapshot(sql); let description;
    try { description = describeSnapshot(db); } finally { db.close(); }
    const result = await migrateObjects({source: source.objects, target: target.objects, references: description.references, offline: true});
    const after = openSnapshot(await source.d1.exportSql());
    try { if (describeSnapshot(after).databaseDigest !== description.databaseDigest) throw new Error('Source D1 changed; do not switch bindings.'); } finally { after.close(); }
    await writeFile(output, JSON.stringify({...result, sourceDatabaseDigest: description.databaseDigest, verifiedAt: new Date().toISOString()}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    print(JSON.stringify({status: result.status, copied: result.copied, reused: result.reused, report: output, next: result.next}, null, 2));
}
