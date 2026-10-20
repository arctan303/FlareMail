import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve, sep, basename} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {openSnapshot, describeSnapshot, dumpSnapshot, sanitizeRestoredDatabase} from '../instance-data/database.mjs';

test('safe restore SQL roundtrips through native local D1 with large Unicode/NUL mail and inactive-domain trigger', {timeout: 120000}, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flaremail-native-backup-test-'));
    let db;
    try {
        db = openSnapshot(`
            CREATE TABLE user(user_id INTEGER PRIMARY KEY,email TEXT,password TEXT,salt TEXT,cli_token TEXT,session_epoch INTEGER DEFAULT 0,preserved_session_hash TEXT DEFAULT '');
            CREATE TABLE account(account_id INTEGER PRIMARY KEY,user_id INTEGER,email TEXT);
            CREATE TABLE email(email_id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,account_id INTEGER,content TEXT,text TEXT,status INTEGER);
            CREATE TABLE attachments(att_id INTEGER PRIMARY KEY,key TEXT);
            CREATE TABLE setting(title TEXT);
            CREATE TABLE managed_domain(domain TEXT PRIMARY KEY,enabled INTEGER);
            CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);
            INSERT INTO user VALUES(1,'a@disabled.test','hash','salt','old-cli',2,'old-session');
            INSERT INTO account VALUES(3,1,'a@disabled.test');
            INSERT INTO managed_domain VALUES('disabled.test',0);
            INSERT INTO schema_migrations VALUES(328);
            INSERT INTO setting VALUES('native test');
            CREATE TRIGGER no_new_disabled_account BEFORE INSERT ON account WHEN EXISTS(SELECT 1 FROM managed_domain WHERE enabled=0) BEGIN SELECT RAISE(ABORT,'disabled'); END;
        `);
        db.prepare('INSERT INTO email(email_id,user_id,account_id,content,text,status) VALUES(?,?,?,?,?,?)').run(7, 1, 3, 'mail 世界\0'.repeat(16000), 'plain '.repeat(18000), 0);
        db.exec("INSERT INTO email(email_id,user_id,account_id,status) VALUES(900,1,3,0); DELETE FROM email WHERE email_id=900;");
        sanitizeRestoredDatabase(db);
        const description = describeSnapshot(db); const sql = dumpSnapshot(db);
        const file = join(directory, 'restore.sql'); await writeFile(file, sql, {mode: 0o600});
        const config = join(directory, 'wrangler.json');
        await writeFile(config, JSON.stringify({name: 'instance-data-native-local', compatibility_date: '2025-06-04', d1_databases: [{binding: 'db', database_name: 'instance-data-native-local', database_id: '00000000-0000-0000-0000-000000000099'}]}));
        const require = createRequire(new URL('../../apps/worker/package.json', import.meta.url));
        const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
        const run = args => new Promise((resolveRun, reject) => {
            const child = spawn(process.execPath, [wrangler, ...args], {cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, WRANGLER_SEND_METRICS: 'false'}});
            let output = '';
            child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
            child.on('error', reject); child.on('close', code => code === 0 ? resolveRun(output) : reject(new Error(output)));
        });
        await run(['d1', 'execute', 'db', '--local', '--config', config, '--file', file]);
        const exported = join(directory, 'export.sql');
        await run(['d1', 'export', 'db', '--local', '--config', config, '--output', exported]);
        const restored = openSnapshot(await readFile(exported, 'utf8'));
        try {
            assert.equal(describeSnapshot(restored).databaseDigest, description.databaseDigest);
            assert.equal(restored.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get('email').seq, 900);
            assert.equal(restored.prepare('SELECT cli_token FROM user').get().cli_token, '');
            assert.equal(restored.prepare('SELECT session_epoch FROM user').get().session_epoch, 3);
            assert.throws(() => restored.exec("INSERT INTO account VALUES(5,1,'b@disabled.test')"), /disabled/);
        } finally { restored.close(); }
    } finally {
        db?.close();
        const absolute = resolve(directory);
        if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('flaremail-native-backup-test-')) throw new Error('Unexpected test cleanup path.');
        await rm(absolute, {recursive: true, force: true});
    }
});
