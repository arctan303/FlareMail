import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Run the real launcher in an isolated repository. The stub records the actual
// child arguments and cwd without invoking Cloudflare or reading private files.
function launch(args, privateConfig = false) {
    const output = resolve('output/deploy-launcher-tests');
    mkdirSync(output, {recursive: true});
    const root = mkdtempSync(join(output, 'repo-'));
    try {
        mkdirSync(join(root, 'scripts'), {recursive: true});
        const worker = join(root, 'apps/worker');
        const stub = join(worker, 'node_modules/wrangler/bin');
        mkdirSync(stub, {recursive: true});
        copyFileSync(new URL('../worker.mjs', import.meta.url), join(root, 'scripts/worker.mjs'));
        writeFileSync(join(worker, 'package.json'), '{"name":"worker"}');
        writeFileSync(join(worker, 'node_modules/wrangler/package.json'), '{"name":"wrangler"}');
        writeFileSync(join(stub, 'wrangler.js'), 'process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))');
        writeFileSync(join(root, 'wrangler.jsonc'), '{}');
        if (privateConfig) writeFileSync(join(worker, 'wrangler.toml'), 'name = "existing-mailbox"');
        const result = spawnSync(process.execPath, [join(root, 'scripts/worker.mjs'), ...args], {encoding: 'utf8'});
        return {root, worker, status: result.status, stderr: result.stderr, child: result.status === 0 ? JSON.parse(result.stdout) : null};
    } finally {
        rmSync(root, {recursive: true, force: true});
    }
}

test('existing installations keep their private configuration and Worker cwd', () => {
    const result = launch(['deploy', '--dry-run'], true);
    assert.equal(result.status, 0);
    assert.equal(result.child.cwd, result.worker);
    assert.deepEqual(result.child.args, ['deploy', '--config', 'wrangler.toml', '--dry-run']);
});

test('new installations deploy the root configuration from the repository root', () => {
    const result = launch(['deploy', '--dry-run']);
    assert.equal(result.status, 0);
    assert.equal(result.child.cwd, result.root);
    assert.deepEqual(result.child.args, ['deploy', '--config', join(result.root, 'wrangler.jsonc'), '--dry-run']);
});

test('explicit configuration keeps its existing resolution and takes priority', () => {
    for (const args of [['--config', 'custom.toml'], ['-c', 'custom.toml'], ['--config=custom.toml']]) {
        const result = launch(['deploy', ...args], true);
        assert.equal(result.status, 0);
        assert.equal(result.child.cwd, result.worker);
        assert.deepEqual(result.child.args, ['deploy', ...args]);
    }
});

test('development retains the local template and never falls back to cloud configuration', () => {
    const result = launch(['dev']);
    assert.equal(result.status, 0);
    assert.equal(result.child.cwd, result.worker);
    assert.deepEqual(result.child.args, ['dev', '--config', 'wrangler-dev.toml', '--local']);
    const existing = launch(['dev'], true);
    assert.deepEqual(existing.child.args, ['dev', '--config', 'wrangler.toml', '--local']);
});

test('development rejects remote bindings and public tunnels before invoking Wrangler', () => {
    for (const arg of ['--remote', '--local=false', '--tunnel', '--remote=true']) {
        const result = launch(['dev', arg]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /runs locally/);
        assert.equal(result.child, null);
    }
});
