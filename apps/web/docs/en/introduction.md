# A personal domain mailbox, without a VPS

FlareMail gives your own domain a mailbox in your own Cloudflare account. **Start on the free plan and deploy and initialize the application through the Web**, with no VPS to buy or maintain.

Keep an address for everyday mail, another for project contacts and one for your assistant. Read, search and reply across your addresses in a single Web interface.

[Try it online](/inbox) · [Costs and preparation](/docs/en/costs) · [Deploy your mailbox](/docs/en/deployment)

## Made for personal use

- **Start with one person**: the setup wizard creates your own administrator mailbox. Add more addresses or invited members when needed.
- **No server to maintain**: the website, APIs and mail handler run on Cloudflare. D1 and KV in your account store the data; R2 is optional for attachments.
- **Deploy with a free account**: host the application and receive mail on Cloudflare's free plan, with Resend's free allowance for sending. Bring your own domain and check the [service limits](/docs/en/costs).
- **Set it up in the browser**: deploy the application, create your mailbox in the wizard, then connect domain routing and sending. Manage everyday settings, mailbox addresses and branding through the Web.

## What you can do

### Everyday conversations and project contacts

Use your domain as your contact address. Replies, forwarding, attachments, search, stars and contacts cover everyday mail. Related messages appear as a conversation, with collapsible quotes for easier reading.

Manage several domains and addresses in one instance. The top selector shows all your mailboxes or just one address. Mobile layouts, light and dark themes, Chinese and English, and an installable PWA make it easy to open wherever you are.

### Give your assistant a mailbox

A personal CLI Token lets scripts and Agents query, search, read and reply to mail. Incoming webhooks notify your receiver after mail and attachments are ready, while your assistant manages its own queue. Configure notification rules, secrets, tests and delivery records through the CLI. See [CLI / Agent](/docs/en/cli) and check your deployed version.

### Share with family when you need to

Administrators can create invited members, each with their own mailbox. Member management is optional; you can use the mailbox on your own. Google sign-in, branding and OAuth authorization for your own websites are also available when needed.

## Start here

1. [Explore the mailbox](/docs/en/experience): try reading, organizing and composing sample mail without signing in.
2. [Check costs and preparation](/docs/en/costs): choose a domain and understand the free setup and sending options.
3. [Deploy and connect delivery](/docs/en/deployment): create the application, complete Web setup, then configure routing and a sending provider.
4. [Use your mailbox](/docs/en/usage): manage addresses, read conversations and search mail, or [connect your assistant](/docs/en/cli).

Use the mailbox through the Web or CLI API. See the [FAQ](/docs/en/faq) for client support, attachments and other questions. Stable versions and changes are listed in [Releases](https://github.com/arctan303/FlareMail/releases).

## Where the application and data live

A **single Cloudflare Worker** serves the website, HTTP APIs and inbound mail handler, with no persistent server instance. Choose Resend or Cloudflare Email Sending for outbound mail; sending to arbitrary external addresses through Cloudflare requires Workers Paid.

| Component | Technology | Purpose |
| --- | --- | --- |
| **Worker Gateway** | Cloudflare Workers + Hono | Email processing, HTTP APIs, authentication, and static asset delivery |
| **Relational Database** | Cloudflare D1 (binding `db`) | Users, accounts, email headers/bodies, contacts, system settings, and migrations |
| **Key-Value Store** | Cloudflare KV (binding `kv`) | Sessions, short-lived tokens, brand/locale cache, and fallback object storage |
| **Object Storage** | Cloudflare R2 (binding `r2`, optional) | Large mail attachments and uploaded brand assets (access authorized via Worker) |
| **Frontend Application** | Vue 3 + Vite + Element Plus | Responsive webmail client and administrator console (built to `apps/worker/dist`) |
| **Inbound Routing** | Cloudflare Email Routing | Delivers incoming domain emails directly to the Worker's `email()` handler |
| **Outbound Sending** | Resend / Cloudflare Email Sending (Beta) | Reliable external email delivery |

## Project structure


```text
FlareMail/
├─ apps/
│  ├─ web/          # Vue 3 application, components, i18n and frontend unit tests
│  └─ worker/       # Cloudflare Worker, Hono APIs, D1 migrations and backend unit tests
├─ scripts/         # Workspace launchers
├─ package.json     # Workspace commands (pnpm)
├─ pnpm-workspace.yaml
└─ pnpm-lock.yaml   # Single root lockfile
```

Frontend production builds output to `apps/worker/dist`; deployment always targets a single unified Worker. Private instance configuration is stored in `apps/worker/wrangler.toml`, and local secrets are stored in `apps/worker/.dev.vars` (both are gitignored).

The online experience reuses frontend components and builds independently as a static Pages site. The real mailbox remains a single Worker.

FlareMail is one of the products in the 一方 family, developed over three months. The maintainer uses it as a primary mailbox and will continue maintaining it.
