import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {gzipSync, deflateSync, brotliCompressSync} from 'node:zlib';
import {exportBackup, verifyBackup, restoreBackup, migrateObjects, inventory, sha256, convertMetadata} from '../instance-data/archive.mjs';
import {openSnapshot, describeSnapshot, dumpSnapshot} from '../instance-data/database.mjs';
import {CloudflareApi, CloudflareD1, CloudflareKv, CloudflareR2, rawObjectDownload} from '../instance-data/cloudflare.mjs';
import {runBackup, runStorage} from '../instance-data/cli.mjs';

const binary = Buffer.from([0, 255, 1, 128, 13, 10, 0]);
const fixtureSql = `
CREATE TABLE user(user_id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL,password TEXT NOT NULL,salt TEXT NOT NULL,cli_token TEXT,session_epoch INTEGER NOT NULL DEFAULT 0,preserved_session_hash TEXT DEFAULT '',google_sub TEXT);
CREATE TABLE account(account_id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,email TEXT);
CREATE TABLE email(email_id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,account_id INTEGER,status INTEGER,content TEXT,deleted_at INTEGER);
CREATE TABLE attachments(att_id INTEGER PRIMARY KEY AUTOINCREMENT,email_id INTEGER,key TEXT);
CREATE TABLE setting(title TEXT,cli_token TEXT,site_logo TEXT,site_pwa_icons TEXT,oauth_provider_revision INTEGER);
CREATE TABLE managed_domain(domain TEXT PRIMARY KEY,enabled INTEGER NOT NULL);
CREATE TABLE installation_state(id INTEGER PRIMARY KEY,status TEXT,revision INTEGER);
CREATE TABLE installation_guard(valid INTEGER CHECK(valid=1));
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
CREATE TABLE oauth_authorization_code(code_hash TEXT);
CREATE TABLE verify_record(token TEXT);
CREATE TABLE admin_confirmation(token TEXT);
CREATE TABLE session_revocation(session_hash TEXT);
CREATE TABLE webhook_delivery(event_id TEXT PRIMARY KEY,status TEXT,lease_until INTEGER,lease_token TEXT,error TEXT);
CREATE TABLE send_request(request_id TEXT,status TEXT,payload_hash TEXT);
CREATE TABLE mail_delivery_config(secret TEXT,revision INTEGER);
CREATE TABLE mail_delivery_event(event_id TEXT,event_type TEXT);
INSERT INTO user VALUES(9,'person@disabled.test','password-hash','salt','sha256$old-cli',3,'old-session','google-identity');
INSERT INTO account VALUES(42,9,'person@disabled.test');
INSERT INTO email VALUES(100,9,42,0,'a private message ''with quotes'' and 世界',1234);
INSERT INTO email VALUES(500,9,42,0,'deleted high id',NULL);
DELETE FROM email WHERE email_id=500;
INSERT INTO attachments VALUES(7,100,'attachments/a 零?#.bin');
INSERT INTO setting VALUES('Mailbox','old-admin-cli','/api/site-assets/brand/id-1/logo.png','{}',2);
INSERT INTO managed_domain VALUES('disabled.test',0);
INSERT INTO installation_state VALUES(1,'installed',80);
INSERT INTO schema_migrations VALUES(328);
INSERT INTO oauth_authorization_code VALUES('old-code');
INSERT INTO verify_record VALUES('old-code');
INSERT INTO admin_confirmation VALUES('old-confirmation');
INSERT INTO session_revocation VALUES('old-revocation');
INSERT INTO webhook_delivery VALUES('pending-event','pending',123,'old-lease','');
INSERT INTO webhook_delivery VALUES('sent-event','delivered',0,'','');
INSERT INTO send_request VALUES('delivered','completed','request-hash');
INSERT INTO mail_delivery_config VALUES('whsec-old-endpoint',3);
INSERT INTO mail_delivery_event VALUES('received-event','delivered');
CREATE INDEX attachment_key ON attachments(key);
CREATE TRIGGER reject_disabled_account BEFORE INSERT ON account WHEN EXISTS(SELECT 1 FROM managed_domain WHERE enabled=0) BEGIN SELECT RAISE(ABORT,'domain_disabled'); END;
`;

class MemoryStore {
    constructor(kind, identity, entries = [], pageSize = 2) {
        this.kind = kind; this.identity = identity; this.entries = new Map(entries.map(([key, data, metadata = null]) => [key, {data: Buffer.from(data), metadata: structuredClone(metadata)}]));
        this.pageSize = pageSize; this.writes = []; this.reads = []; this.listCalls = [];
    }
    async list(cursor) {
        this.listCalls.push(cursor);
        const start = Number(cursor || 0); const keys = [...this.entries.keys()].sort();
        return {entries: keys.slice(start, start + this.pageSize).map(key => ({key, ...(this.kind === 'kv' ? {metadata: structuredClone(this.entries.get(key).metadata), expiration: null} : {size: this.entries.get(key).data.length})})), cursor: start + this.pageSize < keys.length ? String(start + this.pageSize) : null};
    }
    async get(key) { this.reads.push(key); const object = this.entries.get(key); return object ? {data: Buffer.from(object.data), ...(this.kind === 'r2' ? {metadata: structuredClone(object.metadata)} : {})} : null; }
    async getMetadata(key) { return structuredClone(this.entries.get(key)?.metadata ?? null); }
    async putIfAbsent(key, object) {
        if (this.failAt === this.writes.length) throw new Error('Injected copy interruption');
        if (this.entries.has(key)) throw new Error('Refusing overwrite');
        this.writes.push(key); this.entries.set(key, {data: Buffer.from(object.data), metadata: structuredClone(object.metadata)});
        if (this.corrupt) this.entries.get(key).data[0] ^= 255;
    }
}
class MemoryD1 {
    constructor(identity = 'source-d1', sql = fixtureSql) { this.identity = identity; this.sql = sql; this.imports = 0; this.exports = 0; }
    async exportSql() { this.exports++; return this.sql; }
    async assertEmpty() { if (this.sql) throw new Error('Restore requires an empty D1 database.'); }
    async importSql(sql) { this.imports++; const db = openSnapshot(sql); db.close(); this.sql = sql; }
}
function instance(kind = 'kv') {
    const values = [
        ['attachments/a 零?#.bin', binary, {contentType: 'application/octet-stream', contentDisposition: 'attachment;filename=hello.bin', owner: 'legacy metadata'}],
        ['site-assets/brand/id-1/logo.png', Buffer.from('image'), {contentType: 'image/png', cacheControl: 'public,max-age=3600'}],
    ];
    const kv = new MemoryStore('kv', 'source-kv', [...values, ['user:locale:v1:9', 'zh'], ['session:v2:stale', 'secret-session'], ['oauth:provider:token:old', 'secret'], ['domain-preview:receipt', 'receipt'], ['mail-probe:test', 'probe'], ['trash-empty:snapshot', 'temporary-snapshot']]);
    const objects = kind === 'kv' ? kv : new MemoryStore('r2', 'source-r2', values.map(([key, data, meta]) => [key, data, convertMetadata('kv', 'r2', meta)]));
    return {d1: new MemoryD1(), kv, objects};
}
async function local(t) { const directory = await mkdtemp(join(tmpdir(), 'flaremail-data-test-')); t.after(() => rm(directory, {recursive: true, force: true})); return directory; }
async function backup(t, kind) { const root = await local(t); const directory = join(root, 'backup'); const source = instance(kind); await exportBackup({...source, directory, offline: true, applicationVersion: 'test'}); return {root, directory, source}; }

test('full KV backup captures schema, binary values, durable preferences and excludes authentication', async t => {
    const {directory, source} = await backup(t);
    const result = await verifyBackup(directory);
    assert.equal(result.manifest.entries.length, 3);
    assert.equal(result.description.tableCounts.email, 1);
    assert.deepEqual(result.description.schemaVersions, [328]);
    assert.equal(result.manifest.entries.some(entry => /session|oauth|preview|probe|trash-empty/.test(entry.key)), false);
    const object = result.manifest.entries.find(entry => entry.key.startsWith('attachments/'));
    assert.deepEqual(await readFile(join(directory, object.file)), binary);
    assert.equal(object.metadata.owner, 'legacy metadata');
    assert(source.kv.listCalls.some(cursor => cursor));
    assert(source.kv.reads.filter(key => key.startsWith('attachments/')).length >= 2);
});

test('R2 backup includes active bucket objects and existing legacy KV objects', async t => {
    const {directory, source} = await backup(t, 'r2');
    const result = await verifyBackup(directory);
    assert.equal(result.manifest.entries.length, 5);
    assert.equal(result.manifest.source.storage, 'r2');
    assert.equal(source.objects.writes.length, 0);
});

test('manifest and object corruption block restore before any target write', async t => {
    const {directory} = await backup(t);
    const result = await verifyBackup(directory);
    const object = result.manifest.entries[0];
    await writeFile(join(directory, object.file), 'damaged');
    const kv = new MemoryStore('kv', 'new-kv'); const d1 = new MemoryD1('new-d1', '');
    await assert.rejects(restoreBackup({directory, d1, kv, objects: kv, offline: true}), /checksum mismatch/);
    assert.equal(kv.writes.length, 0); assert.equal(d1.imports, 0);
});

test('manifest checksum and unsupported versions are rejected', async t => {
    const {directory} = await backup(t);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'))); manifest.version = 999;
    const raw = JSON.stringify(manifest); await writeFile(join(directory, 'manifest.json'), raw);
    await assert.rejects(verifyBackup(directory), /Manifest checksum/);
    await writeFile(join(directory, 'manifest.sha256'), sha256(raw));
    await assert.rejects(verifyBackup(directory), /Unsupported archive/);
});

test('missing reference and unknown durable KV keys prevent a valid backup', async t => {
    const root = await local(t); const source = instance(); source.kv.entries.delete('attachments/a 零?#.bin');
    await assert.rejects(exportBackup({...source, directory: join(root, 'missing'), offline: true}), /referenced object is missing/);
    const other = instance(); other.kv.entries.set('new-feature:important', {data: Buffer.from('state'), metadata: null});
    await assert.rejects(exportBackup({...other, directory: join(root, 'unknown'), offline: true}), /Unrecognized persistent KV key/);
});

test('an in-place source value change produces no valid manifest', async t => {
    const root = await local(t); const source = instance();
    const original = source.d1.exportSql.bind(source.d1);
    source.d1.exportSql = async () => { const sql = await original(); if (source.d1.exports === 2) source.kv.entries.get('attachments/a 零?#.bin').data[0] = 40; return sql; };
    const directory = join(root, 'changed');
    await assert.rejects(exportBackup({...source, directory, offline: true}), /changed during backup/);
    await assert.rejects(verifyBackup(directory), /ENOENT/);
});

test('a source database change and a SAVING mail row refuse snapshot completion', async t => {
    const root = await local(t); const source = instance();
    source.d1.exportSql = async () => { source.d1.exports++; return fixtureSql + (source.d1.exports === 2 ? "UPDATE setting SET title='changed';" : ''); };
    await assert.rejects(exportBackup({...source, directory: join(root, 'changed'), offline: true}), /source changed/);
    const busy = instance(); busy.d1.sql += 'UPDATE email SET status=6;';
    await assert.rejects(exportBackup({...busy, directory: join(root, 'busy'), offline: true}), /persistence is in progress/);
});

test('restoring an empty instance preserves IDs, disabled domains and data and revokes capabilities before import', async t => {
    const {directory} = await backup(t);
    const kv = new MemoryStore('kv', 'new-kv'); const d1 = new MemoryD1('new-d1', '');
    const result = await restoreBackup({directory, kv, objects: kv, d1, offline: true});
    assert.equal(result.status, 'verified'); assert.equal(d1.imports, 1);
    const db = openSnapshot(d1.sql);
    try {
        assert.deepEqual({...db.prepare('SELECT user_id,cli_token,session_epoch,preserved_session_hash,google_sub FROM user').get()}, {user_id: 9, cli_token: '', session_epoch: 4, preserved_session_hash: '', google_sub: 'google-identity'});
        assert.equal(db.prepare('SELECT password FROM user').get().password, 'password-hash');
        assert.equal(db.prepare('SELECT account_id FROM account').get().account_id, 42);
        assert.equal(db.prepare('SELECT email_id FROM email').get().email_id, 100);
        assert.equal(db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get('email').seq, 500);
        assert.equal(db.prepare('SELECT enabled FROM managed_domain').get().enabled, 0);
        for (const table of ['oauth_authorization_code', 'verify_record', 'admin_confirmation', 'session_revocation']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
        assert.equal(db.prepare("SELECT status FROM webhook_delivery WHERE event_id='pending-event'").get().status, 'cancelled');
        assert.equal(db.prepare("SELECT status FROM webhook_delivery WHERE event_id='sent-event'").get().status, 'delivered');
        assert.deepEqual({...db.prepare('SELECT secret,revision FROM mail_delivery_config').get()}, {secret: '', revision: 4});
        assert.equal(db.prepare('SELECT event_id FROM mail_delivery_event').get().event_id, 'received-event');
        assert.throws(() => db.exec("INSERT INTO account VALUES(90,9,'new@disabled.test')"), /domain_disabled/);
    } finally { db.close(); }
    assert.equal(kv.entries.has('session:v2:stale'), false); assert.deepEqual(kv.entries.get('attachments/a 零?#.bin').data, binary);
});

test('nonempty target, reused source and missing offline attestation refuse restore', async t => {
    const {directory, source} = await backup(t);
    const kv = new MemoryStore('kv', 'new-kv'); const d1 = new MemoryD1('new-d1', '');
    await assert.rejects(restoreBackup({directory, ...source, offline: true}), /new resources/);
    await assert.rejects(restoreBackup({directory, d1, kv, objects: kv}), /offline/);
    kv.entries.set('anything', {data: Buffer.from('exists'), metadata: null});
    await assert.rejects(restoreBackup({directory, d1, kv, objects: kv, offline: true}), /empty KV/);
    assert.equal(d1.imports, 0); assert.equal(kv.writes.length, 0);
});

test('object copy verification failure leaves target D1 empty and source untouched', async t => {
    const {directory, source} = await backup(t);
    const target = new MemoryStore('r2', 'target-r2'); target.corrupt = true;
    const d1 = new MemoryD1('new-d1', ''); const kv = new MemoryStore('kv', 'target-kv');
    await assert.rejects(restoreBackup({directory, d1, kv, objects: target, offline: true}), /verification failed/);
    assert.equal(d1.imports, 0); assert.equal(source.kv.writes.length, 0);
});

class DelayedKv extends MemoryStore {
    constructor(identity, neverVisible = false) { super('kv', identity); this.valueReads = new Map(); this.metadataReads = new Map(); this.neverVisible = neverVisible; }
    async get(key) {
        if (!this.writes.includes(key)) return super.get(key);
        const attempt = (this.valueReads.get(key) || 0) + 1; this.valueReads.set(key, attempt);
        if (attempt === 1) return null;
        if (attempt === 2 || this.neverVisible) return {data: Buffer.from('old cached value')};
        return super.get(key);
    }
    async getMetadata(key) {
        const attempt = (this.metadataReads.get(key) || 0) + 1; this.metadataReads.set(key, attempt);
        if (attempt === 1) return {cached: 'old metadata'};
        if (attempt === 2) { const error = new Error('metadata not yet visible'); error.status = 404; throw error; }
        return super.getMetadata(key);
    }
}

test('KV restore waits for separately delayed bytes and metadata without repeating successful PUTs', async t => {
    const {directory, source} = await backup(t); const target = new DelayedKv('fresh-target-kv'); const d1 = new MemoryD1('fresh-target-d1', '');
    const waits = [];
    const result = await restoreBackup({directory, kv: target, objects: target, d1, offline: true, kvVerification: {attempts: 7, delayMs: 1, sleep: async milliseconds => waits.push(milliseconds)}});
    assert.equal(result.status, 'verified'); assert.equal(d1.imports, 1);
    assert.equal(target.writes.length, 3); assert.equal(new Set(target.writes).size, 3);
    assert(waits.length >= 3); assert(waits.every(value => value === 1));
    for (const key of target.writes) { assert(target.valueReads.get(key) >= 4); assert(target.metadataReads.get(key) >= 3); }
    assert.deepEqual(target.entries.get('attachments/a 零?#.bin').data, binary); assert.equal(source.kv.writes.length, 0);
});

test('KV migration bounded retries never rewrite a successful PUT and refuse cutover if visibility never converges', async () => {
    const source = new MemoryStore('r2', 'source-r2', [['attachments/one', binary, {httpMetadata: {contentType: 'application/octet-stream'}, customMetadata: {}}]]);
    const target = new DelayedKv('fresh-target-kv', true); const waits = [];
    await assert.rejects(migrateObjects({source, target, offline: true, kvVerification: {attempts: 4, delayMs: 1, sleep: async milliseconds => waits.push(milliseconds)}}), /keep the target offline and the source retained.*Do not switch bindings/);
    assert.equal(target.writes.length, 1); assert.equal(source.writes.length, 0); assert.equal(waits.length, 3);
});

test('KV restore visibility timeout keeps target D1 empty and retains the source', async t => {
    const {directory, source} = await backup(t); const target = new DelayedKv('fresh-target-kv', true); const d1 = new MemoryD1('fresh-target-d1', '');
    await assert.rejects(restoreBackup({directory, kv: target, objects: target, d1, offline: true, kvVerification: {attempts: 3, delayMs: 0, sleep: async () => {}}}), /visibility did not converge/);
    assert.equal(d1.imports, 0); assert.equal(d1.sql, ''); assert.equal(target.writes.length, 1); assert.equal(source.kv.writes.length, 0);
});

test('full restore converts R2 metadata and values to KV with unchanged keys', async t => {
    const {directory} = await backup(t, 'r2'); const kv = new MemoryStore('kv', 'new-kv');
    const result = await restoreBackup({directory, kv, objects: kv, d1: new MemoryD1('new-d1', ''), offline: true});
    assert.equal(result.objects, 3);
    assert.equal(kv.entries.get('attachments/a 零?#.bin').metadata.owner, 'legacy metadata');
    assert.equal(kv.entries.get('user:locale:v1:9').data.toString(), 'zh');
});

test('migration preserves the source, skips auth/preferences and roundtrips binary and metadata', async () => {
    const source = instance(); const target = new MemoryStore('r2', 'target-r2');
    const result = await migrateObjects({source: source.kv, target, references: ['attachments/a 零?#.bin'], offline: true});
    assert.equal(result.copied, 2); assert.equal(source.kv.writes.length, 0);
    assert.equal(target.entries.has('user:locale:v1:9'), false);
    const restored = new MemoryStore('kv', 'third-kv');
    await migrateObjects({source: target, target: restored, offline: true});
    for (const [key, value] of restored.entries) assert.deepEqual(value, source.kv.entries.get(key));
});

test('legacy KV objects without metadata receive an explicit R2 content type and roundtrip unchanged', async () => {
    const source = new MemoryStore('kv', 'legacy-kv', [['attachments/plain', binary]]); const target = new MemoryStore('r2', 'target-r2');
    await migrateObjects({source, target, offline: true});
    assert.equal(target.entries.get('attachments/plain').metadata.httpMetadata.contentType, 'application/octet-stream');
    const restored = new MemoryStore('kv', 'restored-kv'); await migrateObjects({source: target, target: restored, offline: true});
    assert.deepEqual(restored.entries.get('attachments/plain'), source.entries.get('attachments/plain'));
});

test('migration detects all target conflicts before its first write', async () => {
    const source = instance(); const target = new MemoryStore('r2', 'target-r2', [['site-assets/brand/id-1/logo.png', 'different', {}]]);
    await assert.rejects(migrateObjects({source: source.kv, target, offline: true}), /conflicts/);
    assert.equal(target.writes.length, 0); assert.equal(source.kv.writes.length, 0);
});

test('R2 keys cannot be restored as authentication capabilities in a KV namespace', async () => {
    const source = new MemoryStore('r2', 'source-r2', [['session:v2:forged', 'authentication-state', {httpMetadata: {}, customMetadata: {}}]]);
    const target = new MemoryStore('kv', 'target-kv');
    await assert.rejects(migrateObjects({source, target, offline: true}), /cannot become authentication state/);
    assert.equal(target.writes.length, 0);
});

test('partial migration retry reuses identical objects without rewriting and completes safely', async () => {
    const source = instance(); const target = new MemoryStore('r2', 'target-r2'); target.failAt = 1;
    await assert.rejects(migrateObjects({source: source.kv, target, offline: true}), /Injected copy interruption/);
    assert.equal(target.writes.length, 1); target.failAt = undefined;
    const result = await migrateObjects({source: source.kv, target, offline: true});
    assert.equal(result.copied, 1); assert.equal(result.reused, 1); assert.equal(target.writes.length, 2);
});

test('migration blocks oversized R2 values before writing a KV target', async () => {
    const source = new MemoryStore('r2', 'source-r2', [['attachments/big', Buffer.alloc(25 * 1024 * 1024 + 1), {httpMetadata: {}, customMetadata: {}}]]);
    const target = new MemoryStore('kv', 'target-kv');
    await assert.rejects(migrateObjects({source, target, offline: true}), /KV value limit/); assert.equal(target.writes.length, 0);
});

test('repeated pagination and source mismatch fail closed', async () => {
    await assert.rejects(inventory({list: async () => ({entries: [], cursor: 'same'})}), /cursor repeated/);
    const source = instance();
    await assert.rejects(migrateObjects({source: source.kv, target: source.kv, offline: true}), /must differ/);
    await assert.rejects(migrateObjects({source: source.kv, target: new MemoryStore('r2', 'new'), references: ['attachments/missing'], offline: true}), /source object is missing/);
});

test('database parser rejects filesystem statements and preserves text with NUL bytes', () => {
    assert.throws(() => openSnapshot("ATTACH DATABASE 'outside.db' AS other;"), /forbidden/);
    assert.throws(() => openSnapshot('PRAGMA temp_store_directory=other;'), /forbidden/);
    assert.throws(() => openSnapshot('PRAGMA application_id=123;'), /unsupported PRAGMA/);
    const exported = openSnapshot("PRAGMA defer_foreign_keys=TRUE; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('D1 literal\0世界');");
    try { assert.equal(exported.prepare('SELECT hex(value) AS h FROM sample').get().h, Buffer.from('D1 literal\0世界').toString('hex').toUpperCase()); } finally { exported.close(); }
    const db = openSnapshot(fixtureSql); db.prepare('UPDATE email SET content=?').run('null\0字');
    const restored = openSnapshot(dumpSnapshot(db));
    try { assert.equal(restored.prepare('SELECT hex(content) AS h FROM email').get().h, Buffer.from('null\0字').toString('hex').toUpperCase()); assert.equal(describeSnapshot(restored).databaseDigest, describeSnapshot(db).databaseDigest); } finally { db.close(); restored.close(); }
});

test('CLI help is local and rejected options cannot trigger a cloud operation', async () => {
    const output = []; await runBackup(['--help'], value => output.push(value)); await runStorage(['--help'], value => output.push(value));
    assert.equal(output.length, 2); assert.match(output[0], /NEW EMPTY/);
    await assert.rejects(runBackup(['restore']), /--config is required/);
    await assert.rejects(runStorage(['--token', 'never-an-argument']), /Unknown option/);
});

test('large mail bodies and binary cells are split into bounded D1 statements without changing bytes', () => {
    const db = openSnapshot(fixtureSql);
    db.exec('ALTER TABLE email ADD COLUMN raw BLOB');
    const content = ('ab世界\0'.repeat(21000)); const bytes = Buffer.alloc(280001);
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
    db.prepare('UPDATE email SET content=?,raw=?').run(content, bytes);
    const dumped = dumpSnapshot(db); assert(dumped.includes('WHERE rowid=100'));
    const restored = openSnapshot(dumped);
    try {
        assert.equal(restored.prepare('SELECT hex(content) AS h FROM email').get().h, Buffer.from(content).toString('hex').toUpperCase());
        assert.deepEqual(Buffer.from(restored.prepare('SELECT raw FROM email').get().raw), bytes);
        assert.equal(describeSnapshot(restored).databaseDigest, describeSnapshot(db).databaseDigest);
        for (const line of dumped.split('\n').filter(value => /^(?:INSERT|UPDATE)/.test(value))) assert(Buffer.byteLength(line) < 50000);
    } finally { db.close(); restored.close(); }
});

test('snapshot dump and digest work without StatementSync.iterate on Node 22.12', () => {
    const db = openSnapshot(fixtureSql); const prototype = Object.getPrototypeOf(db.prepare('SELECT 1'));
    const previous = prototype.iterate;
    try {
        prototype.iterate = undefined;
        const dumped = dumpSnapshot(db); const restored = openSnapshot(dumped);
        try { assert.equal(describeSnapshot(restored).databaseDigest, describeSnapshot(db).databaseDigest); } finally { restored.close(); }
    } finally { prototype.iterate = previous; db.close(); }
});

test('R2 downloads retain original gzip, br and deflate bytes and HTTP metadata over a real HTTP connection', async () => {
    const original = Buffer.from('binary original 世界\0\u00ff'.repeat(100));
    const values = {gzip: gzipSync(original), br: brotliCompressSync(original), deflate: deflateSync(original)};
    let redirectHits = 0;
    const server = createServer((request, response) => {
        const name = request.url.slice(1);
        if (name === 'redirect') { response.writeHead(302, {Location: '/redirect-target'}); response.end(); return; }
        if (name === 'redirect-target') { redirectHits++; response.end('must not be followed'); return; }
        response.writeHead(200, {'Content-Encoding': name, 'Content-Type': 'application/octet-stream', 'Content-Length': values[name].length, 'x-amz-meta-original': 'yes'});
        response.end(values[name]);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const name of Object.keys(values)) {
            const store = new CloudflareR2({accountId: 'a'.repeat(32), bucket: 'private-mail', accessKeyId: 'test', secretAccessKey: 'test', downloadImpl: async (url, options) => {
                assert.equal(new URL(url).protocol, 'https:'); assert.equal(new URL(url).hostname, 'a'.repeat(32) + '.r2.cloudflarestorage.com');
                return rawObjectDownload(`${base}/${name}`, options);
            }});
            const object = await store.get('attachments/compressed');
            assert.deepEqual(object.data, values[name]); assert.notDeepEqual(object.data, original);
            assert.equal(object.metadata.httpMetadata.contentEncoding, name); assert.equal(object.metadata.customMetadata.original, 'yes');
        }
        const redirected = await rawObjectDownload(`${base}/redirect`);
        assert.equal(redirected.status, 302); assert.equal(redirectHits, 0);
        await assert.rejects(rawObjectDownload('http://example.com/unsafe'), /Unsafe object download URL/);
    } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('rate-limited Cloudflare requests retry without changing credentials or payload', async () => {
    let attempts = 0; const waits = [];
    const api = new CloudflareApi({accountId: 'a'.repeat(32), token: 'never-print', sleep: async milliseconds => waits.push(milliseconds), fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer never-print');
        return ++attempts < 3 ? new Response('rate limited', {status: 429, headers: {'Retry-After': '2'}}) : Response.json({success: true, result: []});
    }});
    await api.request('test'); assert.equal(attempts, 3); assert.deepEqual(waits, [2000, 2000]);
});

test('Cloudflare KV adapter follows opaque cursors, preserves binary and uses multipart metadata', async () => {
    const calls = []; let stored = false;
    const api = new CloudflareApi({accountId: 'a'.repeat(32), token: 'test-token', fetchImpl: async (url, options = {}) => {
        calls.push({url: String(url), options}); const parsed = new URL(url);
        assert.equal(options.headers.Authorization, 'Bearer test-token');
        if (parsed.pathname.endsWith('/keys')) return Response.json({success: true, result: [{name: 'attachments/a ?/字', metadata: {contentType: 'image/png'}}], result_info: {cursor: parsed.searchParams.has('cursor') ? '' : 'opaque:token/+'}});
        if (parsed.pathname.includes('/metadata/')) return Response.json({success: true, result: {contentType: 'image/png'}});
        if (options.method === 'PUT') { assert(options.body instanceof FormData); assert.deepEqual(Buffer.from(await options.body.get('value').arrayBuffer()), binary); assert.deepEqual(JSON.parse(options.body.get('metadata')), {contentType: 'image/png'}); stored = true; return Response.json({success: true, result: {}}); }
        return stored ? new Response(binary) : new Response(null, {status: 404});
    }});
    const store = new CloudflareKv(api, 'b'.repeat(32)); const first = await store.list(); await store.list(first.cursor);
    assert(calls[1].url.includes('cursor=opaque%3Atoken%2F%2B'));
    await store.putIfAbsent('attachments/a ?/字', {data: binary, metadata: {contentType: 'image/png'}});
    assert.deepEqual((await store.get('attachments/a ?/字')).data, binary);
    assert.deepEqual(await store.getMetadata('attachments/a ?/字'), {contentType: 'image/png'});
    await assert.rejects(store.putIfAbsent('attachments/a ?/字', {data: binary}), /no value was overwritten/);
    assert(calls.some(call => call.url.includes('attachments%2Fa%20%3F%2F%E5%AD%97')));
});

test('D1 adapter polls export/import, transfers without API token and refuses populated target', async () => {
    const calls = []; let exportPoll = 0; let importPoll = 0; let populated = false;
    const api = new CloudflareApi({accountId: 'a'.repeat(32), token: 'api-secret', sleep: async () => {}, fetchImpl: async (url, options = {}) => {
        calls.push({url: String(url), options});
        if (String(url).startsWith('https://transfer.example/')) { assert.equal(options.headers, undefined); return options.method === 'PUT' ? new Response('ok') : new Response(fixtureSql); }
        const body = JSON.parse(options.body);
        if (String(url).endsWith('/export')) return Response.json({success: true, result: ++exportPoll === 1 ? {at_bookmark: 'bookmark'} : {status: 'complete', result: {signed_url: 'https://transfer.example/export'}}});
        if (String(url).endsWith('/query')) return Response.json({success: true, result: [{success: true, results: populated ? [{name: 'user'}] : []}]});
        if (body.action === 'init') return Response.json({success: true, result: {filename: 'dump.sql', upload_url: 'https://transfer.example/import'}});
        if (body.action === 'ingest') return Response.json({success: true, result: {at_bookmark: 'ingesting'}});
        importPoll++; return Response.json({success: true, result: {status: 'complete'}});
    }});
    const d1 = new CloudflareD1(api, '11111111-1111-1111-1111-111111111111');
    assert.equal(await d1.exportSql(), fixtureSql); assert.equal(exportPoll, 2);
    await d1.assertEmpty(); await d1.importSql(fixtureSql); assert.equal(importPoll, 1);
    populated = true; await assert.rejects(d1.assertEmpty(), /empty D1/);
    assert.equal(calls.filter(call => call.url.includes('/import') && call.options.method === 'PUT').length, 1);
});

test('R2 adapter signs requests, parses encoded pagination keys and guards conditional writes', async () => {
    const calls = []; let race = false;
    const store = new CloudflareR2({accountId: 'a'.repeat(32), bucket: 'private-mail', accessKeyId: 'access-test', secretAccessKey: 'secret-test', now: () => new Date('2026-10-20T12:34:56.000Z'), fetchImpl: async (url, options) => {
        calls.push({url: String(url), options}); assert.match(options.headers.authorization, /Credential=access-test\/20261020\/auto\/s3\/aws4_request/);
        if (new URL(url).searchParams.has('list-type')) return new Response('<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>attachments%2Fa%20%3F%2F%E5%AD%97</Key><Size>7</Size></Contents><NextContinuationToken>next&amp;token</NextContinuationToken></ListBucketResult>');
        if (options.method === 'PUT') { assert.equal(options.headers['if-none-match'], '*'); assert.equal(options.headers['content-type'], 'image/png'); assert.deepEqual(options.body, binary); return new Response('', {status: race ? 412 : 200}); }
        return new Response(binary, {headers: {'Content-Type': 'image/png', 'x-amz-meta-owner': 'test', 'Cache-Control': 'private'}});
    }});
    const list = await store.list(); assert.equal(list.entries[0].key, 'attachments/a ?/字'); assert.equal(list.cursor, 'next&token');
    const object = await store.get('attachments/a ?/字'); assert.deepEqual(object.data, binary); assert.deepEqual(object.metadata, {httpMetadata: {contentType: 'image/png', cacheControl: 'private'}, customMetadata: {owner: 'test'}});
    await store.putIfAbsent('attachments/a ?/字', object); race = true;
    await assert.rejects(store.putIfAbsent('attachments/a ?/字', object), /no object was overwritten/);
    assert(calls.some(call => call.url.includes('/attachments/a%20%3F/%E5%AD%97')));
    assert.match(calls[0].options.headers['x-amz-content-sha256'], /^[a-f0-9]{64}$/);
});
