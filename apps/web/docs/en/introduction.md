# FlareMail

FlareMail is a private domain mailbox deployed in your own Cloudflare account, for personal use and invited families or small teams. Administrators add invited members; each member accesses their own mail. Personal CLI / Agent tokens also connect your own scripts or Agents.

The first formal release, v1.0.0, is in preparation. Start with the [online experience](/docs/en/experience), then [deploy](/docs/en/deployment) for yourself or a few invited members.

It does not provide public registration, bulk code-receiving services or an administrator portal for browsing other members' mail.

## Features

- Multiple domains and addresses, incoming/outgoing mail, replies, forwarding, attachments, stars and contacts.
- Chinese and English interfaces, light/dark themes, responsive layouts and keyboard shortcuts.
- Web setup wizard, domain and invited-member management, and centralized configuration.
- Custom branding and PWA, Google login binding and password confirmation for sensitive changes.
- Personal CLI / Agent tokens and first-party OAuth integration.

## Architecture


The entire application runs as a **single Cloudflare Worker**, requiring no persistent server instances:

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
