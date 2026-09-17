# Local development

This page covers local execution and development. For your first real mailbox, start with [deployment](/docs/en/deployment).

## Prerequisites
- **Node.js**: >= 22.12 (CI and verification recommend Node.js 24)
- **Package Manager**: pnpm 10.34.5 (commands use `npx`, no global installation required)

## Run a Complete Local Worker

Using the same architecture as cloud deployment, a single local Worker provides the web UI, APIs, and email handling. No Cloudflare login, real resource IDs, or manual SQL runs are required locally.

Run from the repository root:

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
node -e "const fs=require('node:fs');fs.copyFileSync('apps/worker/wrangler.example.toml','apps/worker/wrangler.toml',fs.constants.COPYFILE_EXCL)"
node -e "require('node:fs').writeFileSync('apps/worker/.dev.vars','SETUP_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\n',{flag:'wx'})"
npx --yes pnpm@10.34.5 dev:worker
```

> The copy and secret generation commands will safely refuse to overwrite existing files. The Worker automatically builds the frontend; wait for `Ready on http://127.0.0.1:8787`.

Open `http://127.0.0.1:8787` in your browser:
1. Verify the `SETUP_SECRET` from `apps/worker/.dev.vars`.
2. Enter at least one email domain (e.g. `example.com`, no DNS required locally).
3. Select the domain and configure your administrator mailbox prefix and password.
4. Confirm initialization; tables are created automatically and you will be signed in.

Stop anytime with `Ctrl+C`. Local data persists in `apps/worker/.wrangler/state`. Re-running `dev:worker` will resume with your existing database.

## Simulate Incoming Mail Locally

Save the following text as `test-email.eml` (replace `owner@example.com` with an address you created):

```text
From: Local Sender <sender@example.net>
To: owner@example.com
Subject: Local mail test
Message-ID: <local-test-001@example.net>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Hello from the local email handler!
```

Run from the directory containing `test-email.eml` (use `curl.exe` on Windows PowerShell):

```sh
curl --request POST "http://127.0.0.1:8787/cdn-cgi/handler/email?from=sender@example.net&to=owner@example.com" --header "Content-Type: message/rfc822" --data-binary "@test-email.eml"
```

Refresh your browser inbox to see the newly delivered message.

## Hot Reload for Development (Two Processes)

Run from the repository root:

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 dev
```

One terminal launches both the Vite dev server (`3001`) and the Worker (`8787`). Open `http://127.0.0.1:3001`; Vite automatically proxies APIs, OAuth endpoints, and the manifest to port `8787` with instant HMR.
