import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, realpath, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {openSnapshot, describeSnapshot, sanitizeRestoredDatabase, dumpSnapshot} from './database.mjs';

export const FORMAT = 'flaremail-instance-backup';
export const VERSION = 1;
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const objectKey = key => typeof key === 'string' && (key.startsWith('attachments/') || key.startsWith('site-assets/'));
const persistentKey = key => /^user:locale:v1:\d+$/.test(key);
const transientKey = key => /^(?:auth-uid:|session:|setting:|send_day_count:|public_key:|security:|oauth:|auth:|domain-preview:|mail-probe:|trash-empty:)/.test(key);
const fileName = (kind, key) => `${kind}/${sha256(key)}.bin`;
const metadata = entry => entry.metadata ?? null;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function verificationPolicy(options = {}) {
    const policy = {attempts: 13, delayMs: 10000, sleep: pause, ...options};
    if (!Number.isInteger(policy.attempts) || policy.attempts < 1 || policy.attempts > 61
        || !Number.isInteger(policy.delayMs) || policy.delayMs < 0 || policy.delayMs > 30000 || typeof policy.sleep !== 'function') throw new Error('Invalid KV verification policy.');
    return policy;
}

export async function inventory(store) {
    const entries = []; const seenKeys = new Set(); const seenCursors = new Set(); let cursor;
    do {
        const page = await store.list(cursor);
        if (!Array.isArray(page.entries)) throw new Error('Invalid storage inventory.');
        for (const entry of page.entries) {
            if (typeof entry.key !== 'string' || !entry.key || seenKeys.has(entry.key)) throw new Error('Storage inventory contains a duplicate or invalid key.');
            seenKeys.add(entry.key); entries.push(entry);
        }
        cursor = page.cursor || null;
        if (cursor && seenCursors.has(cursor)) throw new Error('Storage pagination cursor repeated.');
        seenCursors.add(cursor);
    } while (cursor);
    return entries.sort((a, b) => a.key.localeCompare(b.key));
}

function selectedKv(entries) {
    return entries.filter(entry => {
        if (objectKey(entry.key) || persistentKey(entry.key)) return true;
        if (transientKey(entry.key)) return false;
        throw new Error(`Unrecognized persistent KV key; classify it before backup: ${entry.key}`);
    });
}
function inspectSql(sql) {
    const db = openSnapshot(sql);
    try { return describeSnapshot(db); } finally { db.close(); }
}
function offline(required) { if (required !== true) throw new Error('Stop HTTP/mail/cron writers and explicitly confirm offline mode.'); }

async function readObject(store, entry) {
    const object = await store.get(entry.key);
    if (!object) throw new Error(`A stored object disappeared: ${entry.key}`);
    if (entry.expiration) throw new Error(`Expiring durable objects cannot form a stable snapshot: ${entry.key}`);
    return {data: Buffer.from(object.data), metadata: store.kind === 'kv' ? metadata(entry) : metadata(object), expiration: null};
}

export async function exportBackup({directory, d1, kv, objects, offline: confirmed, now = () => new Date(), applicationVersion = 'unknown'}) {
    offline(confirmed);
    await mkdir(directory, {recursive: false, mode: 0o700});
    await mkdir(join(directory, 'kv'), {mode: 0o700}); await mkdir(join(directory, 'r2'), {mode: 0o700});
    const sql = await d1.exportSql(); const description = inspectSql(sql);
    const kvBefore = selectedKv(await inventory(kv));
    const objectBefore = objects.kind === 'r2' ? await inventory(objects) : kvBefore.filter(entry => objectKey(entry.key));
    const available = new Set(objectBefore.map(entry => entry.key));
    for (const key of description.references) if (!available.has(key)) throw new Error(`A referenced object is missing from active storage: ${key}`);
    const manifest = {format: FORMAT, version: VERSION, createdAt: now().toISOString(), applicationVersion, source: {d1: d1.identity, kv: kv.identity, objects: objects.identity, storage: objects.kind}, database: {...description, file: 'database.sql', sha256: sha256(sql), size: Buffer.byteLength(sql)}, entries: [], excluded: 'Authentication, rate limits, caches and preview receipts are not backed up.'};
    await writeFile(join(directory, 'database.sql'), sql, {mode: 0o600, flag: 'wx'});
    const stores = [{kind: 'kv', store: kv, entries: kvBefore}, ...(objects.kind === 'r2' ? [{kind: 'r2', store: objects, entries: objectBefore}] : [])];
    for (const {kind, store, entries} of stores) for (const entry of entries) {
        const object = await readObject(store, entry); const file = fileName(kind, entry.key);
        await writeFile(join(directory, file), object.data, {flag: 'wx', mode: 0o600});
        manifest.entries.push({kind, key: entry.key, file, metadata: object.metadata, expiration: null, size: object.data.length, sha256: sha256(object.data)});
    }
    if (inspectSql(await d1.exportSql()).databaseDigest !== description.databaseDigest
        || !same(kvBefore, selectedKv(await inventory(kv)))
        || (objects.kind === 'r2' && !same(objectBefore, await inventory(objects)))) throw new Error('The source changed during backup; the incomplete directory must not be restored.');
    // Re-read every durable value; list metadata cannot detect in-place updates.
    for (const entry of manifest.entries) {
        const store = entry.kind === 'kv' ? kv : objects;
        const object = await readObject(store, entry);
        if (sha256(object.data) !== entry.sha256 || !same(metadata(object), entry.metadata)) throw new Error('A source object changed during backup.');
    }
    const json = JSON.stringify(manifest, null, 2) + '\n';
    await writeFile(join(directory, 'manifest.json'), json, {mode: 0o600, flag: 'wx'});
    await writeFile(join(directory, 'manifest.sha256'), sha256(json) + '\n', {mode: 0o600, flag: 'wx'});
    return {directory, objects: manifest.entries.length, database: description.tableCounts, manifestSha256: sha256(json)};
}

async function safeRead(directory, file) {
    const root = await realpath(directory); const target = join(root, file);
    if ((await lstat(target)).isSymbolicLink() || await realpath(target) !== target) throw new Error('Archive symbolic links are not supported.');
    return readFile(target);
}

export async function verifyBackup(directory) {
    const raw = await safeRead(directory, 'manifest.json');
    const expected = (await safeRead(directory, 'manifest.sha256')).toString().trim();
    if (!/^[a-f0-9]{64}$/.test(expected) || sha256(raw) !== expected) throw new Error('Manifest checksum mismatch.');
    const manifest = JSON.parse(raw);
    if (manifest.format !== FORMAT || manifest.version !== VERSION || !['kv', 'r2'].includes(manifest.source?.storage) || !Array.isArray(manifest.entries)) throw new Error('Unsupported archive format or version.');
    if (manifest.database?.file !== 'database.sql') throw new Error('Invalid database file path.');
    const sqlBuffer = await safeRead(directory, 'database.sql');
    if (sqlBuffer.length !== manifest.database.size || sha256(sqlBuffer) !== manifest.database.sha256) throw new Error('Database checksum mismatch.');
    const description = inspectSql(sqlBuffer.toString('utf8'));
    for (const key of ['tableCounts', 'schemaVersions', 'references', 'databaseDigest']) if (!same(description[key], manifest.database[key])) throw new Error('Database manifest does not match the SQL snapshot.');
    const keys = new Set(); const active = new Set();
    for (const entry of manifest.entries) {
        if (!['kv', 'r2'].includes(entry.kind) || typeof entry.key !== 'string' || entry.file !== fileName(entry.kind, entry.key) || keys.has(`${entry.kind}:${entry.key}`)) throw new Error('Invalid or duplicate object entry.');
        if (entry.kind === 'kv' && !objectKey(entry.key) && !persistentKey(entry.key)) throw new Error('An archive must not restore authentication or unknown KV state.');
        if (entry.expiration != null) throw new Error('Expiring durable archive entries are unsupported.');
        keys.add(`${entry.kind}:${entry.key}`);
        const value = await safeRead(directory, entry.file);
        if (value.length !== entry.size || sha256(value) !== entry.sha256) throw new Error(`Object checksum mismatch: ${entry.key}`);
        if (entry.kind === manifest.source.storage) active.add(entry.key);
    }
    for (const key of description.references) if (!active.has(key)) throw new Error(`Referenced object missing from archive: ${key}`);
    return {manifest, sql: sqlBuffer.toString('utf8'), description, manifestSha256: expected};
}

function logicalMetadata(kind, stored) {
    if (kind === 'kv') {
        const raw = stored || {}; const {__flaremailR2CustomMetadata, ...rest} = raw;
        const httpMetadata = {};
        for (const key of ['contentType', 'contentDisposition', 'cacheControl', 'contentEncoding', 'contentLanguage', 'expires']) if (rest[key] != null) httpMetadata[key] = rest[key];
        return {httpMetadata, customMetadata: __flaremailR2CustomMetadata || {}, kvMetadata: stored === null ? null : rest};
    }
    const raw = stored || {}; const custom = {...raw.customMetadata}; const original = custom['flaremail-kv-metadata']; delete custom['flaremail-kv-metadata'];
    const kvMetadata = original ? JSON.parse(Buffer.from(original, 'base64url').toString('utf8')) : {...raw.httpMetadata};
    return {httpMetadata: raw.httpMetadata || {}, customMetadata: custom, kvMetadata, fromKv: !!original};
}
export function convertMetadata(from, to, stored) {
    if (from === to) return stored;
    const value = logicalMetadata(from, stored);
    if (to === 'kv') {
        const originalHttp = {};
        for (const key of ['contentType', 'contentDisposition', 'cacheControl', 'contentEncoding', 'contentLanguage', 'expires']) if (value.kvMetadata?.[key] != null) originalHttp[key] = value.kvMetadata[key];
        originalHttp.contentType ||= 'application/octet-stream';
        if (value.fromKv && same(value.httpMetadata, originalHttp) && !Object.keys(value.customMetadata).length) return value.kvMetadata;
        return {...value.kvMetadata, ...value.httpMetadata, ...(Object.keys(value.customMetadata).length ? {__flaremailR2CustomMetadata: value.customMetadata} : {})};
    }
    return {httpMetadata: {contentType: 'application/octet-stream', ...value.httpMetadata}, customMetadata: {...value.customMetadata, 'flaremail-kv-metadata': Buffer.from(JSON.stringify(value.kvMetadata)).toString('base64url')}};
}
function sameObject(actual, expected) { return actual && sha256(actual.data) === sha256(expected.data) && same(metadata(actual), metadata(expected)); }

async function verifyCopiedKv(target, entry, object, policy) {
    for (let attempt = 0; attempt < policy.attempts; attempt++) {
        try {
            const value = await target.get(entry.key);
            const storedMeta = value ? target.getMetadata ? await target.getMetadata(entry.key) : (await inventory(target)).find(item => item.key === entry.key)?.metadata ?? null : null;
            if (sameObject(value && {...value, metadata: storedMeta}, object)) return;
        } catch (error) {
            // The metadata read can independently be a temporarily negative
            // lookup. Authentication, network and other API errors remain fatal.
            if (error.status !== 404) throw error;
        }
        if (attempt + 1 < policy.attempts) await policy.sleep(policy.delayMs);
    }
    throw new Error(`Target verification failed: KV visibility did not converge; keep the target offline and the source retained. Do not switch bindings: ${entry.key}`);
}

async function copyVerified(target, entry, object, targetInventory, policy) {
    const existing = await target.get(entry.key);
    const existingMeta = target.kind === 'kv' ? targetInventory.find(item => item.key === entry.key)?.metadata ?? null : existing?.metadata;
    if (existing) {
        if (target.kind === 'kv' && targetInventory.find(item => item.key === entry.key)?.expiration) throw new Error(`Target value expires; nothing was overwritten: ${entry.key}`);
        if (!sameObject({...existing, metadata: existingMeta}, object)) throw new Error(`Target object conflicts; nothing was overwritten: ${entry.key}`);
        return 'reused';
    }
    await target.putIfAbsent(entry.key, object);
    if (target.kind === 'kv') {
        // A successful PUT is never replayed. Negative/old bytes and metadata
        // can each remain cached during the platform's propagation interval.
        await verifyCopiedKv(target, entry, object, policy);
        return 'copied';
    }
    const verified = await target.get(entry.key);
    const verifiedMeta = verified?.metadata;
    if (!sameObject(verified && {...verified, metadata: verifiedMeta}, object)) throw new Error(`Target verification failed; keep the source binding: ${entry.key}`);
    return 'copied';
}

export async function restoreBackup({directory, d1, kv, objects, offline: confirmed, kvVerification}) {
    offline(confirmed);
    const policy = verificationPolicy(kvVerification);
    const verified = await verifyBackup(directory);
    if (verified.manifest.source.d1 === d1.identity || verified.manifest.source.kv === kv.identity || verified.manifest.source.objects === objects.identity) throw new Error('Restore must use new resources, not the backup source.');
    await d1.assertEmpty();
    if ((await inventory(kv)).length || (objects.kind === 'r2' && (await inventory(objects)).length)) throw new Error('Restore requires empty KV and object storage.');
    const db = openSnapshot(verified.sql);
    let sql; let expected;
    try { sanitizeRestoredDatabase(db); sql = dumpSnapshot(db); expected = describeSnapshot(db); } finally { db.close(); }
    // Check the generated SQL before writing any remote resource.
    if (inspectSql(sql).databaseDigest !== expected.databaseDigest) throw new Error('Safe restore SQL did not reproduce the expected database.');
    const plan = [];
    for (const entry of verified.manifest.entries) {
        if (entry.kind === 'kv' && persistentKey(entry.key)) plan.push({entry, target: kv, metadata: entry.metadata});
        if (entry.kind === verified.manifest.source.storage && !persistentKey(entry.key)) {
            if (objects.kind === 'kv' && !objectKey(entry.key)) throw new Error('Only application object prefixes may be copied into KV; unknown R2 keys cannot become authentication state.');
            plan.push({entry, target: objects, metadata: convertMetadata(entry.kind, objects.kind, entry.metadata)});
        }
    }
    for (const {entry, target, metadata: converted} of plan) {
        const data = await safeRead(directory, entry.file);
        await copyVerified(target, entry, {data, metadata: converted, expiration: null}, [], policy);
    }
    // The D1 import is last: a failed object copy never produces an installed
    // instance referring to incomplete storage. The target remains offline.
    await d1.assertEmpty();
    await d1.importSql(sql);
    if (inspectSql(await d1.exportSql()).databaseDigest !== expected.databaseDigest) throw new Error('Restored D1 verification failed; do not switch traffic.');
    return {status: 'verified', objects: plan.length, database: expected.tableCounts, credentials: 'Sessions, CLI tokens, authorization codes and verification records were revoked. Passwords remain valid; sign in again.', next: 'Configure new Worker bindings/secrets and mail routing, then test the offline target before switching traffic. The source was retained.'};
}

export async function migrateObjects({source, target, references = [], offline: confirmed, kvVerification}) {
    offline(confirmed);
    const policy = verificationPolicy(kvVerification);
    if (source.identity === target.identity) throw new Error('Source and target storage must differ.');
    const before = (await inventory(source)).filter(entry => source.kind === 'r2' || objectKey(entry.key));
    if (target.kind === 'kv' && before.some(entry => !objectKey(entry.key))) throw new Error('Only application object prefixes may be copied into KV; unknown R2 keys cannot become authentication state.');
    for (const key of references) if (!before.some(entry => entry.key === key)) throw new Error(`Referenced source object is missing: ${key}`);
    const targetInventory = await inventory(target);
    const plan = [];
    // Inspect every conflict before the first write. Retrying a partial copy
    // accepts only byte-for-byte and metadata-for-metadata identical objects.
    for (const entry of before) {
        const object = await readObject(source, entry);
        const expected = {...object, metadata: convertMetadata(source.kind, target.kind, object.metadata)};
        if (target.kind === 'kv' && expected.data.length > 25 * 1024 * 1024) throw new Error(`Object exceeds the KV value limit: ${entry.key}`);
        const existing = await target.get(entry.key);
        const existingMeta = target.kind === 'kv' ? targetInventory.find(item => item.key === entry.key)?.metadata ?? null : existing?.metadata;
        if (existing && target.kind === 'kv' && targetInventory.find(item => item.key === entry.key)?.expiration) throw new Error(`Target value expires; nothing was overwritten: ${entry.key}`);
        if (existing && !sameObject({...existing, metadata: existingMeta}, expected)) throw new Error(`Target object conflicts; nothing was overwritten: ${entry.key}`);
        plan.push({entry, sha256: sha256(object.data), metadata: object.metadata});
    }
    let copied = 0; let reused = 0; const newlyWritten = new Set();
    for (const item of plan) {
        const object = await readObject(source, item.entry);
        if (sha256(object.data) !== item.sha256 || !same(object.metadata, item.metadata)) throw new Error('Source changed during migration; keep its binding.');
        const state = await copyVerified(target, item.entry, {...object, metadata: convertMetadata(source.kind, target.kind, object.metadata)}, targetInventory, policy);
        if (state === 'copied') { copied++; newlyWritten.add(item.entry.key); } else reused++;
    }
    if (!same(before, (await inventory(source)).filter(entry => source.kind === 'r2' || objectKey(entry.key)))) throw new Error('Source inventory changed; keep its binding.');
    const finalTarget = target.kind === 'kv' ? await inventory(target) : [];
    for (const item of plan) {
        const object = await readObject(source, item.entry);
        if (sha256(object.data) !== item.sha256 || !same(object.metadata, item.metadata)) throw new Error('Source changed before cutover; keep its binding.');
        const expected = {...object, metadata: convertMetadata(source.kind, target.kind, object.metadata)};
        if (target.kind === 'kv' && newlyWritten.has(item.entry.key)) {
            await verifyCopiedKv(target, item.entry, expected, policy);
            continue;
        }
        const destination = await target.get(item.entry.key);
        const destinationMeta = target.kind === 'kv' ? finalTarget.find(entry => entry.key === item.entry.key)?.metadata ?? null : destination?.metadata;
        if (!sameObject(destination && {...destination, metadata: destinationMeta}, expected)) throw new Error('Target changed before cutover; keep the source binding.');
    }
    return {status: 'verified', source: source.identity, target: target.identity, copied, reused, objects: plan.map(item => ({key: item.entry.key, sha256: item.sha256})), next: target.kind === 'r2' ? 'Keep writers stopped. Add the target bucket as Worker binding r2 and deploy the matching config; verify attachment and brand URLs before resuming. Keep source KV objects.' : 'Keep writers stopped. Set the Worker kv binding to the target namespace and remove r2. Also copy persistent KV locale preferences with a full backup/restore if moving namespaces. Verify attachment and brand URLs before resuming. Keep the source bucket.'};
}
