# Updates, backups and recovery

Update in this order: back up resources and configuration → update code and locked dependencies → deploy → check database version → verify mail.

## Update an instance created with the deploy button

Update **the code in your own GitHub repository and its existing Worker**. Cloning again only downloads code. Pushing reviewed changes to the production branch connected to Workers Builds triggers the original instance's build and deployment. There is currently no in-app one-click version updater. [Workers Builds branch rules](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)

The deploy button creates a source repository in your account. It may be an ordinary copy without Sync fork. A real fork supports GitHub synchronization, but that does not check instance configuration or upgrade the database for you. The local procedure below works for both repository types without converting a copy to a fork. Do not click the deploy button again to create another instance. [Deploy button documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [GitHub fork synchronization](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork)

## Preserve before updating

- In the original Worker's Settings → Build, record the connected repository, production branch, build/deploy commands and actual configuration path. Examples below use main as the production branch; substitute yours where necessary. Disable unneeded non-production builds first so older preview configurations cannot use production mailbox resources.
- Web deployments usually use the root wrangler.jsonc; CLI installations usually use apps/worker/wrangler.toml. For custom builds, check the actual --config path. Preserve the Worker name, D1 database_id, KV id, R2 bucket name and existing bindings. Compare them with the original dashboard resources and fill missing IDs before proceeding. Do not replace the configuration with a blank template.
- Preserve Worker secrets, including SETUP_SECRET. Ordinary updates do not require regeneration or re-upload. Keep third-party credentials and local .dev.vars separately.
- Back up D1 and attachment/brand objects in KV/R2. A D1 SQL export does not contain object files, browser drafts or Worker secrets.

This D1 export example runs from an existing workspace with dependencies installed and explicitly selects the web deployment's root configuration:

~~~sh
node -e "require('node:fs').mkdirSync('output/backups',{recursive:true})"
npx --yes pnpm@10.34.5 --filter worker exec wrangler d1 export db --config ../../wrangler.jsonc --remote --output ../../output/backups/flaremail-before-update.sql
~~~

For a CLI instance, replace the --config path with wrangler.toml; use your own path for custom configurations. Verify that its db binding points to the original database before exporting. Requests may be affected during export, so choose a maintenance window. SQL includes private mail and account data; do not commit or share it. [D1 export guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## Update the stable version in your repository

You need Git and Node.js ≥ 22.12 (24 recommended). The example below updates **v1.1.1 → v1.1.2**. First confirm that the target is officially published in [Releases](https://github.com/arctan303/FlareMail/releases). The old tag must match the upstream source originally used for your installation. For another starting version, replace every old tag and the patch filename below. If the source version is unknown, check deployment history before proceeding; do not guess or force a patch. Do not use `dev` for production updates.

### 1. Clone your own repository into a new directory

Replace YOUR_ACCOUNT/YOUR_REPOSITORY with the repository actually connected to Cloudflare, rather than the maintainer's repository. A fresh directory keeps your original local source, ignored files and configuration backups intact:

~~~sh
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git FlareMail-update
cd FlareMail-update
git switch main
git pull --ff-only origin main
git status --short
git switch -c update/flaremail-1.1.2
git remote add flaremail-upstream https://github.com/arctan303/FlareMail.git
~~~

git status --short should be empty. origin continues to point at your repository; git pull origin main alone only retrieves your own old code. This creates a local branch without pushing or deploying. Separately copy local-only wrangler.toml and other instance configuration to their matching paths in the new directory, preserving their ignored status and excluding them from public commits.

### 2. Apply the release difference while preserving configuration

Fetch explicit release tags into separate remote references to avoid confusing them with tags in your repository:

~~~sh
git fetch --no-tags flaremail-upstream refs/tags/v1.1.1:refs/remotes/flaremail-upstream/releases/v1.1.1 refs/tags/v1.1.2:refs/remotes/flaremail-upstream/releases/v1.1.2
git diff --binary --full-index --output=../flaremail-v1.1.1-to-v1.1.2.patch flaremail-upstream/releases/v1.1.1 flaremail-upstream/releases/v1.1.2 -- . ":(exclude)wrangler.jsonc" ":(exclude)apps/worker/wrangler.toml"
git apply --3way --index ../flaremail-v1.1.1-to-v1.1.2.patch
git diff --cached --stat
git diff --cached --check
~~~

This merges the difference between two releases into your code. An ordinary source copy does not need a shared commit history with upstream; instance configuration is excluded from the patch. If a custom build uses additional instance configuration files, append `":(exclude)YOUR_CONFIG_PATH"` for each path to git diff. Do not exclude application code or the lockfile. [Git patch merging](https://git-scm.com/docs/git-apply)

Run commands one at a time and stop on any error before committing or pushing. A three-way merge can leave conflicts and partially staged changes. Inspect git status, resolve each conflict, stage only resolved files, and review the complete difference again. Do not bypass conflicts with --force, --ours, --theirs or a full-repository overwrite. If unsure, keep the directory for investigation; the original Worker has not changed.

### 3. Merge configuration requirements and verify locally

The patch preserves your old configuration, so **manually merge new configuration requirements from the target release** as well. For v1.1.2 retain the original daily Cron and add a minute schedule. The root JSONC configuration's default example is below; keep your existing daily value if customized:

~~~json
"triggers": { "crons": ["0 16 * * *", "* * * * *"] }
~~~

For TOML, merge into the existing triggers section without creating a duplicate:

~~~toml
[triggers]
crons = ["0 16 * * *", "* * * * *"]
~~~

The minute schedule handles notification retries and bounded expired-mail cleanup. Cron uses UTC, and configuration changes can take up to 15 minutes to propagate. Wrangler deployments synchronize the schedule, so also update private files or build variables that generate your configuration; otherwise a later build can overwrite dashboard-only edits. [Cron configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Recheck the original Worker name, D1/KV/R2 resources, existing mail bindings and keep_vars. Keep secret values out of configuration files. Stage intended resource-identifier-only changes to the tracked root wrangler.jsonc separately; local private configuration stays ignored. Then run:

~~~sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 test
npx --yes pnpm@10.34.5 test:deploy
npx --yes pnpm@10.34.5 build
git diff --name-only --diff-filter=U
git diff --cached --check
git diff --cached
git status --short
~~~

These commands test and build without deploying. git diff --name-only --diff-filter=U must produce no output. Commit only after tests pass, every conflict is resolved, and staged changes contain only intended code/configuration updates. Avoid git add . so unrelated or private files are not included.

### 4. Push the production branch and wait for the original Worker

~~~sh
git commit -m "Update FlareMail to v1.1.2"
git switch main
git pull --ff-only origin main
git merge --ff-only update/flaremail-1.1.2
git push origin main
~~~

The final push triggers the build and deployment connected to that production branch. If pull, merge or push fails because of concurrent commits, permissions or branch protection, stop and reconcile the changes without force-pushing. Repositories requiring a PR should use their own PR process; confirm non-production builds are disabled before pushing the update branch.

Check the original Worker's build logs for success and confirm the deployed commit and original resource bindings. Resolve failed builds from their logs without creating replacement databases or using the deploy button again. Then complete the database upgrade and mail verification below.

## Instances deployed only from the command line

If you cloned directly from the maintainer, have no Git-based automatic deployment, and keep instance configuration in the ignored apps/worker/wrangler.toml, update the pinned release in your existing local directory. Back up first, confirm git status --short is empty and git remote get-url origin is https://github.com/arctan303/FlareMail.git, then run:

~~~sh
git fetch --no-tags origin refs/tags/v1.1.2:refs/remotes/origin/releases/v1.1.2
git switch --detach origin/releases/v1.1.2
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 test
npx --yes pnpm@10.34.5 test:deploy
npx --yes pnpm@10.34.5 build
~~~

Preserve customized application code and use the patch procedure above to integrate it instead of switching over it. Recheck the original instance configuration and merge target requirements such as Cron schedules. After tests pass, run `npx --yes pnpm@10.34.5 run deploy` from the repository root; this deploys immediately without a push. Deployment prefers an existing apps/worker/wrangler.toml and otherwise uses the root wrangler.jsonc. Pass --config explicitly for a custom path and verify the target. Ordinary updates omit --secrets-file to preserve existing remote secrets. [Wrangler configuration preservation](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)

## Upgrade the database after deployment

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
