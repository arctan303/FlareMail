import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';

const quote = value => `"${String(value).replaceAll('"', '""')}"`;
class SQLiteText { constructor(bytes) { this.bytes = bytes; } }
const literal = value => value instanceof SQLiteText ? `CAST(X'${Buffer.from(value.bytes).toString('hex')}' AS TEXT)` : value === null ? 'NULL' : typeof value === 'bigint' || typeof value === 'number'
    ? String(value) : value instanceof Uint8Array ? `X'${Buffer.from(value).toString('hex')}'`
        : String(value).includes('\0') ? `CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT)`
            : `'${String(value).replaceAll("'", "''")}'`;
const statement = (db, sql) => { const result = db.prepare(sql); result.setReadBigInts(true); return result; };

// SQL archives are data, not executable administration scripts. SQLite extensions
// stay disabled, and database/file escape statements are refused before parsing.
function checkSql(sql) {
    const tokens = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]])*\]|--[^\r\n]*|\/\*[\s\S]*?\*\//g, ' ');
    if (/\b(?:attach|detach|vacuum|load_extension|writable_schema|temp_store_directory|data_store_directory)\b/i.test(tokens)) {
        throw new Error('Archive SQL contains a forbidden database or filesystem operation.');
    }
    for (const match of tokens.matchAll(/\bpragma\s+([^;]*)/gi)) {
        if (!/^\s*(?:foreign_keys|defer_foreign_keys)\s*=\s*(?:on|off|true|false|0|1)\s*$/i.test(match[1])) {
            throw new Error('Archive SQL contains an unsupported PRAGMA.');
        }
    }
}

export function openSnapshot(sql) {
    checkSql(sql);
    // D1's SQL exporter can emit a literal NUL inside a quoted TEXT value.
    // sqlite3_exec treats an unescaped NUL as the end of SQL, so encode just
    // those string literals before parsing (the archive checksum stays raw).
    const executable = sql.replace(/'(?:''|[^'])*'/g, value => value.includes('\0')
        ? `CAST(X'${Buffer.from(value.slice(1, -1).replaceAll("''", "'")).toString('hex')}' AS TEXT)` : value);
    if (executable.includes('\0')) throw new Error('Archive SQL contains a NUL outside a string literal.');
    const db = new DatabaseSync(':memory:', {allowExtension: false});
    try {
        db.exec(executable);
        const integrity = db.prepare('PRAGMA integrity_check').all();
        if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok'
            || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity check failed.');
        return db;
    } catch (error) { db.close(); throw error; }
}

function schema(db) {
    return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all();
}
function columns(db, name) { return db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name); }
function tables(db) { return schema(db).filter(row => row.type === 'table'); }
function hasTable(db, name) { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }
function* values(db, name, includeRowId = false) {
    const names = columns(db, name);
    // node:sqlite's text conversion can truncate embedded NULs. Read TEXT as
    // bytes and retain its SQLite type so every byte survives dump and digest.
    const projection = names.flatMap((column, index) => [`CASE WHEN typeof(${quote(column)})='text' THEN CAST(${quote(column)} AS BLOB) ELSE ${quote(column)} END AS v${index}`, `typeof(${quote(column)}) AS t${index}`]);
    if (includeRowId) projection.push('rowid AS __flaremail_rowid');
    const query = statement(db, `SELECT ${projection.join(',')} FROM ${quote(name)} ORDER BY ${names.map(quote).join(',')}`);
    // StatementSync.iterate was added after the project's Node 22.12 minimum.
    for (const raw of typeof query.iterate === 'function' ? query.iterate() : query.all()) {
        const result = Object.fromEntries(names.map((column, index) => [column, raw[`t${index}`] === 'text' ? new SQLiteText(raw[`v${index}`]) : raw[`v${index}`]]));
        if (includeRowId) Object.defineProperty(result, '__flaremail_rowid', {value: raw.__flaremail_rowid});
        yield result;
    }
}

export function describeSnapshot(db) {
    const tableCounts = {};
    for (const table of tables(db)) tableCounts[table.name] = Number(statement(db, `SELECT count(*) AS n FROM ${quote(table.name)}`).get().n);
    const versions = hasTable(db, 'schema_migrations') ? db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version) : [];
    if (!['user', 'account', 'email', 'attachments', 'setting'].every(name => hasTable(db, name))) throw new Error('Not a complete FlareMail database.');
    const references = new Set(db.prepare('SELECT DISTINCT key FROM attachments').all().map(row => row.key));
    const assetColumns = columns(db, 'setting').filter(name => ['site_logo', 'site_favicon', 'site_pwa_icons'].includes(name));
    if (assetColumns.length) {
        for (const row of db.prepare(`SELECT ${assetColumns.map(quote).join(',')} FROM setting`).all()) {
            for (const value of Object.values(row)) for (const match of String(value || '').matchAll(/\/api\/site-assets\/(brand\/[a-zA-Z0-9-]+\/[a-zA-Z0-9.-]+)/g)) references.add(`site-assets/${match[1]}`);
        }
    }
    // A snapshot taken while attachment persistence or an external send is in
    // progress cannot establish a complete point-in-time instance backup.
    if (columns(db, 'email').includes('status') && db.prepare('SELECT 1 FROM email WHERE status=6 LIMIT 1').get()) throw new Error('Mail persistence is in progress; stop writers and retry.');
    if (hasTable(db, 'send_request') && db.prepare("SELECT 1 FROM send_request WHERE status='pending' LIMIT 1").get()) throw new Error('A send is in progress; finish it before backup.');
    const digest = createHash('sha256');
    for (const entry of schema(db)) digest.update(JSON.stringify(entry) + '\n');
    for (const table of tables(db)) {
        digest.update(`${table.name}\n`);
        for (const row of values(db, table.name)) digest.update(Object.values(row).map(literal).join(',') + '\n');
    }
    if (hasTable(db, 'sqlite_sequence')) for (const row of db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all()) digest.update(JSON.stringify(row) + '\n');
    return {tableCounts, schemaVersions: versions, references: [...references].sort(), databaseDigest: digest.digest('hex')};
}

export function sanitizeRestoredDatabase(db) {
    const update = (table, assignments) => {
        if (!hasTable(db, table)) return;
        const names = columns(db, table);
        const entries = Object.entries(assignments).filter(([column]) => names.includes(column));
        if (entries.length) db.exec(`UPDATE ${quote(table)} SET ${entries.map(([column, sql]) => `${quote(column)}=${sql}`).join(',')}`);
    };
    // Passwords and third-party identity links remain valid for an interactive
    // login. Every issued capability is invalidated before SQL leaves this host.
    update('user', {cli_token: "''", session_epoch: 'session_epoch+1', preserved_session_hash: "''"});
    update('setting', {cli_token: "''", oauth_provider_revision: 'oauth_provider_revision+1'});
    update('mail_delivery_config', {secret: "''", revision: 'revision+1'});
    for (const table of ['oauth_authorization_code', 'verify_record', 'admin_confirmation', 'session_revocation', 'installation_guard']) {
        if (hasTable(db, table)) db.exec(`DELETE FROM ${quote(table)}`);
    }
    // Historical pending delivery must not notify callbacks again on restore.
    if (hasTable(db, 'webhook_delivery')) db.exec("UPDATE webhook_delivery SET status='cancelled',lease_until=0,lease_token='',error='instance_restored' WHERE status IN ('pending','sending')");
    if (hasTable(db, 'installation_state')) db.exec('UPDATE installation_state SET revision=revision+1');
}

export function dumpSnapshot(db) {
    const entries = schema(db);
    const sql = ['PRAGMA defer_foreign_keys=ON;'];
    for (const table of entries.filter(entry => entry.type === 'table')) sql.push(`${table.sql};`);
    // Install triggers only after data so a disabled domain's historical users
    // and addresses can be restored without replaying admission side effects.
    for (const table of tables(db)) {
        const names = columns(db, table.name);
        const rowId = !/\bWITHOUT\s+ROWID\b/i.test(table.sql);
        for (const row of values(db, table.name, rowId)) {
            const original = Object.values(row); const encoded = original.map(literal); const chunks = [];
            const insertion = () => `INSERT INTO ${quote(table.name)}(${[...(rowId ? ['rowid'] : []), ...names].map(quote).join(',')}) VALUES(${[...(rowId ? [literal(row.__flaremail_rowid)] : []), ...encoded].join(',')});`;
            // D1 limits individual SQL statements. A large mail body must be
            // reconstructed with bounded updates instead of one oversized INSERT.
            while (Buffer.byteLength(insertion()) > 48000) {
                const candidates = encoded.map((value, index) => ({index, length: value.length})).filter(({index}) => original[index] instanceof SQLiteText || original[index] instanceof Uint8Array).sort((a, b) => b.length - a.length);
                const next = candidates.find(({index}) => !chunks.includes(index));
                if (!next || !rowId) throw new Error('A database row cannot be safely split for D1 import.');
                encoded[next.index] = original[next.index] instanceof SQLiteText ? "CAST(X'' AS TEXT)" : "X''"; chunks.push(next.index);
            }
            sql.push(insertion());
            for (const index of chunks) {
                const isText = original[index] instanceof SQLiteText;
                const bytes = Buffer.from(isText ? original[index].bytes : original[index]);
                for (let offset = 0; offset < bytes.length; offset += 16000) {
                    sql.push(`UPDATE ${quote(table.name)} SET ${quote(names[index])}=CAST(CAST(${quote(names[index])} AS BLOB)||X'${bytes.subarray(offset, offset + 16000).toString('hex')}' AS ${isText ? 'TEXT' : 'BLOB'}) WHERE rowid=${literal(row.__flaremail_rowid)};`);
                }
            }
        }
    }
    if (hasTable(db, 'sqlite_sequence')) {
        sql.push('DELETE FROM sqlite_sequence;');
        for (const row of db.prepare('SELECT name,seq FROM sqlite_sequence').all()) sql.push(`INSERT INTO sqlite_sequence(name,seq) VALUES(${literal(row.name)},${literal(row.seq)});`);
    }
    for (const entry of entries.filter(entry => entry.type !== 'table')) sql.push(`${entry.sql};`);
    return sql.join('\n') + '\n';
}
