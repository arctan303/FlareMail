# Deploy your mailbox

Start with a new installation. One Cloudflare Worker serves the website, APIs and email handler. After deploying the website, connect incoming and outgoing mail to use it as a real mailbox.

## Prepare your account and domain

- A Cloudflare account and an email domain using Cloudflare DNS, such as example.com.
- Git and Node.js ≥ 22.12 (24 recommended) on your computer. Commands use pnpm 10.34.5 without a global install.
- A sending service: new installations default to Resend. [Cloudflare Email Sending (Beta)](/docs/en/sending) is another option. Providers have separate quotas and pricing; delivery is not guaranteed to be unlimited or free.

`owner@example.com` is an email address; `https://mail.example.com` is the website and API origin. Start with the generated workers.dev address and optionally add your own website domain later.

## Get the source

`main` is the default stable branch; `dev` contains ongoing development. Keep the default branch when forking for deployment. Avoid deploying the development branch to production. Each formal release has a fixed version tag and a [Release](https://github.com/arctan303/FlareMail/releases).

~~~sh
git clone --branch main --single-branch https://github.com/arctan303/FlareMail.git
cd FlareMail
npx --yes pnpm@10.34.5 install --frozen-lockfile
~~~

Alternatively, download and extract the source ZIP, then install from the directory containing package.json. Run all commands below from this repository root.

To pin the first release, download the [v1.0.0 source ZIP](https://github.com/arctan303/FlareMail/archive/refs/tags/v1.0.0.zip), or run after cloning and before installing dependencies:

~~~sh
git fetch origin tag v1.0.0
git switch --detach v1.0.0
~~~

This pins the source to that tag rather than following stable branch updates. Read the next Release and [update guide](/docs/en/updates) before upgrading.

## Prepare instance configuration

For your first installation:

~~~sh
node -e "const fs=require('node:fs');fs.copyFileSync('apps/worker/wrangler.example.toml','apps/worker/wrangler.toml',fs.constants.COPYFILE_EXCL)"
node -e "require('node:fs').writeFileSync('apps/worker/.dev.vars','SETUP_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\n',{flag:'wx'})"
~~~

These commands refuse to overwrite existing files. Edit name in apps/worker/wrangler.toml to choose your Worker name. Keep the binding names and build configuration. D1 and KV do not need to be created beforehand.

SETUP_SECRET authorizes installation and maintenance; it is separate from your mailbox password. Keep it in your password manager. Do not commit instance configuration or .dev.vars. Existing installations should follow [updates](/docs/en/updates) instead of copying the template again.

If you want R2, configure [storage](/docs/en/configuration) before you start storing mail.

## Sign in and deploy

~~~sh
npx --yes pnpm@10.34.5 --filter worker exec wrangler login
npx --yes pnpm@10.34.5 run deploy --secrets-file .dev.vars
~~~

The sign-in command opens a browser to authorize your own Cloudflare account. Deployment builds the frontend and uploads the installation Secret from .dev.vars.

Wrangler automatic provisioning is currently Beta. It creates D1/KV and writes resource IDs back to your configuration. Check that wrangler.toml now contains the D1 database_id and KV id, and back it up. Keep these IDs for later updates. Dashboard or Git deployments may not write them back to the repository; inspect the bindings in the dashboard. [Official documentation](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

A successful deployment prints the Worker URL. Open it to reach the setup wizard. Resolve deployment errors before proceeding; avoid repeatedly creating replacement resources.

## Complete Web setup

1. Verify the SETUP_SECRET from .dev.vars.
2. Enter your email domain, such as example.com, rather than a website URL.
3. Choose the domain and enter the administrator address prefix and sign-in password.
4. Confirm. FlareMail creates the tables and administrator and opens the mailbox.

Your website and account are ready. Public mail delivery still needs the next steps.

## Connect delivery

1. Follow [incoming mail](/docs/en/receiving) to route the domain's mail to this Worker.
2. Follow [outgoing mail](/docs/en/sending) to verify sender domains and configure credentials and the provider.
3. Send to your administrator address from another external mailbox, read it in Inbox, then reply and confirm receipt externally. Test a small attachment and check spam folders as well.

Use an external mailbox: mail within the same instance may use internal delivery and does not prove public routing works.

## Add a website domain (optional)

Open the Worker in Cloudflare → Settings → Domains & Routes, and add a Custom Domain such as mail.example.com. It must belong to a Cloudflare DNS zone in your account. Sign in from the new URL. Update Google callbacks or the OAuth issuer if already configured. [Official steps](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

A website domain does not configure email delivery. Continue with [administrator configuration](/docs/en/administration) to add members, branding and optional sign-in methods.
