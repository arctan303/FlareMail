import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const workerDir = fileURLToPath(new URL('../apps/worker/', import.meta.url));
const [command, ...args] = process.argv.slice(2);
if (!['dev', 'deploy'].includes(command)) {
    console.error('Usage: node scripts/worker.mjs <dev|deploy> [Wrangler options]');
    process.exit(1);
}
const hasConfig = args.some(arg => arg === '--config' || arg === '-c' || arg.startsWith('--config='));
if (!hasConfig) {
    const instanceExists = existsSync(join(workerDir, 'wrangler.toml'));
    if (command === 'deploy' && !instanceExists) {
        console.error('Create apps/worker/wrangler.toml from wrangler.example.toml before deploying. See README.md.');
        process.exit(1);
    }
    args.unshift('--config', instanceExists ? 'wrangler.toml' : 'wrangler-dev.toml');
}
if (command === 'dev') {
    if (args.some(arg => ['-r', '--remote', '--tunnel', '--tunnel-name', '--local=false'].includes(arg)
        || ['--remote=', '--tunnel=', '--tunnel-name='].some(prefix => arg.startsWith(prefix)))) {
        console.error('Workspace development runs locally; remote bindings and public tunnels are not supported.');
        process.exit(1);
    }
    args.push('--local');
}
const require = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const child = spawn(process.execPath, [wrangler, command, ...args], {cwd: workerDir, stdio: 'inherit'});
child.on('error', error => {
    console.error(error.message);
    process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        if (!child.killed) child.kill(signal);
    });
}
child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
