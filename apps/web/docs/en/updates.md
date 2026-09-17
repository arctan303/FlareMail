# Updates, backups and recovery

Update in this order: back up resources and configuration → update code and locked dependencies → deploy → check database version → verify mail.

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

Sign in as an administrator and check pending patches under System settings → Maintenance. Apply upgrades when prompted. The current schema is **324**. Compatible patches allow normal sign-in. If a future incompatible upgrade prevents it, use the login maintenance entry with SETUP_SECRET. This secret is not a forgotten-password reset tool.

Check sign-in, mailbox filters, historical messages and attachments. Then test incoming mail and replies with an external mailbox; loading the webpage alone does not verify mail service.

## Recovery boundaries

D1 Time Travel can restore within its retention window: 7 days on Free and 30 on Paid, subject to your account and current documentation. Restoration rolls back later database changes; back up the current state and pause related operations first. [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

For SQL recovery, validate import and schema in a separate database before planning a switch. Do not treat importing a backup into a live database as complete recovery. Application code must be compatible with the recovered schema, and attachment/brand objects need restoration under their original keys. Rolling back code does not reverse database upgrades or recover deleted objects.

There is no one-click complete backup, recovery or object-storage migration. Schedule regular backups for important mail and verify that historical messages and attachments can be recovered.
