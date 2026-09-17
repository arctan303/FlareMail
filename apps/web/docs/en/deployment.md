# Deploy your mailbox

Use the Cloudflare deployment page to get started without installing Git or Node.js or opening a local terminal. One Worker serves the website, APIs and email handler. After Web setup, connect incoming and outgoing mail.

## Prepare your account and domain

- A Cloudflare account.
- A GitHub account to keep your own source and deployment configuration.
- An email domain using Cloudflare DNS, such as example.com.
- A password manager to generate and save your installation secret.
- A sending service: new installations default to Resend; [Cloudflare Email Sending (Beta)](/docs/en/sending) is also available. Providers have separate quotas and pricing.

`owner@example.com` is an email address; `https://mail.example.com` is the website and API origin. Start with the generated workers.dev address and optionally bind your own website domain later.

## Deploy with Cloudflare (recommended)

**[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/arctan303/FlareMail)**

1. Click the deployment link above, sign in to Cloudflare and connect your own GitHub account when prompted.
2. Choose your Cloudflare account and a name for your new repository. Cloudflare copies the project into your GitHub for future updates. Use the default stable branch, main.
3. Choose the Worker, D1 database and KV namespace names. Keep the binding names db and kv. Cloudflare creates the resources; you do not need to enter resource IDs beforehand.
4. Fill SETUP_SECRET with a unique random password of at least 32 characters from your password manager, and save it. Enter the same value in the Web installation wizard later; it is separate from your administrator login password.
5. Keep the repository root as the build entry and confirm the build and deployment settings. Default commands build the frontend and deploy the Worker. Do not change the entry to apps/worker, put SETUP_SECRET in a public variable or commit its value to source.
6. Wait for a successful deployment and open the Worker URL shown on the page. When the installation wizard appears, continue with Web setup below.

The button **creates a new instance**. For an existing mailbox, follow [updates](/docs/en/updates) and preserve its database and storage. Do not click the button again to install a second instance.

After deployment, check db and kv under Worker → Settings → Bindings. In your own repository, check that the root wrangler.jsonc contains the assigned database_id and KV id. If either is still empty, edit the file in GitHub, enter the existing resource IDs from the dashboard and save it. Preserve these IDs on updates; do not replace the customized file with the upstream blank template. [Cloudflare documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/)

If the page does not offer a SETUP_SECRET field, check that the source includes the root .dev.vars.example and wrangler.jsonc. Use a stable version that supports this entry or the command-line route below. A missing required Secret causes deployment to fail; never use a fixed example password.

R2 is optional; the default uses the existing KV object-storage path. Configure [storage](/docs/en/configuration) before storing mail if you want R2. If deployment fails, open the build logs and resolve the reported error before creating more resources.

## Complete Web setup

1. Enter the SETUP_SECRET you saved during deployment to authorize setup.
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

## Command-line deployment (advanced)

Use this for local builds or managing configuration yourself. Install Git and Node.js ≥ 22.12 (24 recommended); commands use the pinned pnpm 10.34.5. The fixed v1.0.0 tag uses this route and does not contain the later deployment-button support.

### Get the source

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

### Prepare instance configuration

For your first installation:

~~~sh
node -e "const fs=require('node:fs');fs.copyFileSync('apps/worker/wrangler.example.toml','apps/worker/wrangler.toml',fs.constants.COPYFILE_EXCL)"
node -e "require('node:fs').writeFileSync('apps/worker/.dev.vars','SETUP_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\n',{flag:'wx'})"
~~~

These commands refuse to overwrite existing files. Edit name in apps/worker/wrangler.toml to choose your Worker name. Keep the binding names and build configuration. D1 and KV do not need to be created beforehand.

SETUP_SECRET authorizes installation and maintenance; it is separate from your mailbox password. Keep it in your password manager. Do not commit instance configuration or .dev.vars. Existing installations should follow [updates](/docs/en/updates) instead of copying the template again.

If you want R2, configure [storage](/docs/en/configuration) before you start storing mail.

### Sign in and deploy

~~~sh
npx --yes pnpm@10.34.5 --filter worker exec wrangler login
npx --yes pnpm@10.34.5 run deploy --secrets-file .dev.vars
~~~

The sign-in command opens a browser to authorize your own Cloudflare account. Deployment builds the frontend and uploads the installation Secret from .dev.vars.

Wrangler automatic provisioning is currently Beta. It creates D1/KV and writes resource IDs back to your configuration. Check that wrangler.toml now contains the D1 database_id and KV id, and back it up. Keep these IDs for later updates. Dashboard or Git deployments may not write them back to the repository; inspect the bindings in the dashboard. [Official documentation](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

A successful deployment prints the Worker URL. Open it to reach the setup wizard. Resolve deployment errors before proceeding; avoid repeatedly creating replacement resources.

After command-line deployment, continue with Complete Web setup and Connect mail above.
