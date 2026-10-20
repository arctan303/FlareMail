# Updates, backups and recovery

Update in this order: back up resources and configuration → update code and locked dependencies → deploy → check database version → verify mail.

## Update an instance created with the deploy button

The button creates a source repository in your GitHub account and connects it to Workers Builds. Update that repository and the existing Worker; do not click the deployment button again.

1. Read the target [Release](https://github.com/arctan303/FlareMail/releases), then back up the database, stored objects and configuration.
2. Inspect db, kv and optional R2 bindings on the existing Worker. In your GitHub repository, check that the root wrangler.jsonc keeps the existing Worker name, D1 database_id, KV id and optional R2 bucket name. Fill missing IDs from the existing dashboard resources and preserve the installation Secret.
3. Update application code to the target stable version in your repository, preserving your customized wrangler.jsonc. The created repository may be a source copy without GitHub's Sync fork action; do not assume fork synchronization is available or overwrite instance configuration with the entire upstream repository.
4. Pushing to the connected production branch triggers Workers Builds. Check the build logs for success and verify resource bindings afterward. Disable unneeded non-production branch builds before updating code to avoid connecting previews to your real mailbox resources.
5. Follow the database upgrade steps below, then verify historical mail and external delivery.

There is no in-app one-click version updater. If merging code versions is unfamiliar, use the command-line route below after recording your existing bindings in your own instance configuration. Do not replace the existing database with a new one. [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)

## Preserve before updating

- Keep the Worker name, D1/KV resource IDs, R2 bucket name and existing bindings in apps/worker/wrangler.toml. Do not replace it with a fresh template.
- Preserve Worker secrets, including SETUP_SECRET. Ordinary updates do not require regeneration or re-upload. Keep third-party credentials and local .dev.vars separately.
- Back up D1 and attachment/brand objects in KV/R2. A D1 SQL export does not contain object files, browser drafts or Worker secrets.

From the repository root, create a backup directory and export remote D1:

~~~sh
node -e "require('node:fs').mkdirSync('output/backups',{recursive:true})"
npx --yes pnpm@10.34.5 --filter worker exec wrangler d1 export db --remote --output ../../output/backups/flaremail-before-update.sql
~~~

This exports the remote database referenced by your current db binding. Requests may be affected during export, so choose a maintenance window. SQL includes private mail and account data; do not commit or share it. [D1 export guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## Update and upgrade the database

Read the target [Release](https://github.com/arctan303/FlareMail/releases) and upgrade notes first. `main` follows the latest stable version, while `dev` is for development. Pinned tags do not update automatically. Preserve instance configuration and fetch the source from the repository root:

~~~sh
git fetch origin --tags
~~~

For a stable branch installation, run `git switch main` and `git pull --ff-only origin main`. For a pinned installation, use `git switch --detach <target-version-tag>`. Save local source changes before switching; do not force-overwrite them or replace instance configuration with a fresh template.

After confirming the source version, install locked dependencies and deploy:

~~~sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 run deploy
~~~

Sign in as an administrator and check pending patches under System settings → Maintenance. The current schema is **329**. Google link replacement requires 326, incoming webhooks 327, domain lifecycle 328, and Trash retention, recipient fingerprints and delivery callbacks 329. Compatible patches allow normal sign-in. If a future incompatible upgrade prevents it, use the login maintenance entry with SETUP_SECRET. This secret is not a forgotten-password reset tool.

Patch 329 adds deletion timestamps and generations, send fingerprints and delivery events. Existing deleted messages receive a fresh 30-day grace period at upgrade rather than being expired by their creation dates. Retain both daily and minute Cron schedules for bounded cleanup. An intact 328 installation keeps basic sign-in, reading and To-only sending; new dependent operations require the patch.

Patch 328 adds domain state and migration protection. Existing domains remain enabled; messages and attachments are not moved. An intact 327 instance remains usable before the upgrade, with new domain operations available afterwards. Migrated primary users sign in with their new address. Older code does not enforce disabled domains, so do not restore it while relying on domain suspension. Rolling back code does not reverse address migrations; preview and perform a reverse migration with the new version when needed. See [domain management](/docs/en/administration).

Patch 327 adds webhook configuration and delivery tables without enabling notifications. Preserve your resource IDs. Add `* * * * *` to triggers.crons in your own Wrangler configuration while retaining the daily task; otherwise recovery may wait for later mail or the daily run. Public templates include it, but customized existing configurations need merging. D1 backups contain shared webhook secrets and must remain private. Disable webhooks before rolling back code and retain the new tables. See [CLI / Agent](cli) for configuration.

Patch 326 adds fields and a session revocation table while retaining existing accounts and sessions. Preserve both during a code rollback. Older code does not enforce the new revocation rules, so invalidate every browser session before serving it again. Draft migration retains legacy databases and migration records; clearing site data to roll back can lose drafts.

Check sign-in, mailbox filters, historical messages and attachments. Then test incoming mail and replies with an external mailbox; loading the webpage alone does not verify mail service.

## Recovery boundaries

D1 Time Travel can restore within its retention window: 7 days on Free and 30 on Paid, subject to your account and current documentation. Restoration rolls back later database changes; back up the current state and pause related operations first. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

For SQL recovery, validate import and schema in a separate database before planning a switch. Do not treat importing a backup into a live database as complete recovery. Application code must be compatible with the recovered schema, and attachment/brand objects need restoration under their original keys. Rolling back code does not reverse database upgrades or recover deleted objects.

## Complete instance backup and recovery

Repository commands run locally without exposing a whole-database web endpoint. Node 22.12 is supported through the SQLite flag in the root commands. Stop HTTP, Email Routing, Cron and all other writers first. Wait at least 60 seconds for KV propagation, longer for a larger cacheTtl, and verify stable reads. `--offline` confirms this preparation; it does not stop production for you.

Profiles contain resource IDs and credential environment variable names only:

~~~json
{"accountId":"YOUR_32_HEX_ACCOUNT_ID","databaseId":"D1_UUID","namespaceId":"KV_NAMESPACE_ID","storage":"kv","tokenEnv":"SOURCE_CLOUDFLARE_API_TOKEN"}
~~~

For R2 use storage r2 and add bucket. Optional r2AccessKeyIdEnv and r2SecretAccessKeyEnv select S3 credential variables, defaulting to R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY. The default Cloudflare token variable is CLOUDFLARE_API_TOKEN. Keep actual credentials out of profiles and command examples. Sources need read permissions; targets need write permissions. Worker secrets, SETUP_SECRET and browser drafts are not included and must be protected separately.

~~~sh
pnpm backup:export --config source.json --out output/backups/new-backup --offline
pnpm backup:verify --in output/backups/new-backup
pnpm backup:restore --config target.json --in output/backups/new-backup --offline --confirm-target TARGET_D1_UUID
~~~

The archive includes D1 schema/data, persistent KV, attachments and branding objects, metadata and SHA-256 manifests. Missing references, source changes and corruption prevent verification. Archives contain private mail, password hashes and application credentials: use private encrypted storage and never commit them. Checksums detect corruption, not malicious rewriting; restore only trusted archives you own.

Restore accepts different, new empty D1/KV/R2 resources and never overwrites an existing instance. It validates the entire archive and references before copying and verifying objects, then imports D1 last. Account/mail IDs remain; sessions, CLI tokens, unredeemed codes and queued notifications are revoked, and the Resend signing secret is cleared. Sign in and configure these credentials again. Keep failed targets offline and follow recovery instructions or retry with fresh empty resources. Do not import into a live database.

## KV / R2 object migration

~~~sh
pnpm storage:migrate --source source.json --target target.json --out output/storage-report.json --offline --confirm-target TARGET_BUCKET_OR_KV_NAMESPACE_ID
~~~

Migration preserves keys, bytes and metadata, retains the source, and rejects conflicting target objects. Retries reuse only exact matches. R2→KV objects over 25 MiB or keys unsafe for application KV are rejected before writes. KV targets must be exclusively offline; the tool cannot provide conditional atomic writes that KV does not support. Successful writes receive bounded visibility checks; a timeout prevents cutover. Follow the verified report to change bindings, then test history, attachments and mail flow. Commands never deploy, change bindings or delete the source. For a new KV namespace, use full backup recovery to include persistent preferences; for attachment migration prefer retaining the existing kv binding and switching r2.
