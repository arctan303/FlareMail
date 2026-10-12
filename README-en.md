<h1 align="center">
  <img src="./assets/flaremail-wordmark.svg" width="205" height="48" alt="FlareMail" />
</h1>

<p align="center">
  <strong>A personal domain mailbox, without a VPS</strong><br />
  Deploy in your own Cloudflare account, starting on the free plan.
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.1.1-blue" alt="Version: 1.1.1" /></a>
  <a href="THIRD-PARTY-NOTICES.md"><img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License: AGPL 3.0" /></a>
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-F38020.svg?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <a href="README-en.md">English</a> ·
  <a href="https://flaremail-demo.pages.dev/inbox">Try it online</a> ·
  <a href="https://flaremail-demo.pages.dev/docs/en/introduction">Documentation</a> ·
  <a href="https://github.com/arctan303/FlareMail/releases">Releases</a>
</p>

FlareMail is an open-source domain mailbox for personal use, with everyday mail, multiple addresses and assistant integrations. The website, API and mail processing run in a single Cloudflare Worker. Mail data stays in your own Cloudflare account, with no VPS to buy or maintain.

## Try it online

**[Open the FlareMail experience →](https://flaremail-demo.pages.dev/inbox)**

No sign-in required. Try conversations, search, mailbox switching, composing replies and drafts, including on your phone. The experience uses sample data; simulated sends never deliver real mail, and refreshing restores the initial samples. See the [experience guide](apps/web/docs/en/experience.md).

## Features

- **Domains and addresses**: Manage multiple domains and addresses for personal contacts, projects or assistants. Invite family or other members when needed.
- **Everyday mail**: Send, receive, reply, forward, attach files, search message content, star mail, manage contacts and read conversations, with saved drafts and send undo.
- **Web client**: Responsive layouts, Chinese/English, light/dark themes, keyboard shortcuts and an installable PWA.
- **CLI / Agent**: Use a personal token to query, read, send and reply to mail. HTML messages provide readable bodies; unread filters and incremental queries are supported.
- **Incoming webhooks**: Notify a receiver when new mail is ready, for all senders or an optional address allowlist. Manage configuration, secrets, test notifications and delivery records through the Web or CLI.
- **Administration**: Configure domains, members, branding, Google sign-in and OAuth authorization through the Web. Private R2 attachment storage is optional.

## Quick deployment

Bring your **Cloudflare account, GitHub account and a domain using Cloudflare DNS**. Deploy through the Web without installing local development tools.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/arctan303/FlareMail)

1. **Deploy the application**: Follow Cloudflare's prompts to create the Worker, D1 and KV, then set and save a separate installation secret.
2. **Set up your mailbox**: Open the deployed URL and use the Web wizard to create your administrator and email domain.
3. **Connect delivery**: Configure the receiving route and sending service, then test incoming mail and a reply with an external mailbox.

Cloudflare's free plan can host the application and receive mail, with Resend's free allowance for sending. Bring your own domain; each service has usage limits, and R2 is optional. **The button installs the application; real delivery still needs domain configuration.**

Continue with the [deployment guide](apps/web/docs/en/deployment.md) and [costs and preparation](apps/web/docs/en/costs.md). The deploy button uses the stable `main` branch. Existing installations should follow [updates](apps/web/docs/en/updates.md) and preserve their resources.

## Documentation

The [online documentation](https://flaremail-demo.pages.dev/docs/en/introduction) covers setup and everyday use. You can also browse the guides below by topic.

| Topic | Guides |
| --- | --- |
| Getting started | [Introduction](apps/web/docs/en/introduction.md) · [Costs and preparation](apps/web/docs/en/costs.md) · [Deployment](apps/web/docs/en/deployment.md) |
| Mail delivery and use | [Receiving](apps/web/docs/en/receiving.md) · [Sending](apps/web/docs/en/sending.md) · [Everyday use](apps/web/docs/en/usage.md) |
| Settings and administration | [Configuration](apps/web/docs/en/configuration.md) · [Administration](apps/web/docs/en/administration.md) |
| Assistants and integrations | [CLI / Agent and webhooks](apps/web/docs/en/cli.md) · [OAuth integration](apps/web/docs/en/oauth.md) |
| Maintenance and troubleshooting | [Updates, backups and recovery](apps/web/docs/en/updates.md) · [FAQ](apps/web/docs/en/faq.md) |
| Development and experience site | [Local development](apps/web/docs/en/getting-started.md) · [Deploy the experience site](apps/web/docs/en/pages.md) |

## Local development

Use Node.js ≥ 22.12 and the pinned pnpm 10.34.5. Install dependencies from the repository root:

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
```

Prepare instance configuration as described in [local development](apps/web/docs/en/getting-started.md), then start the mailbox:

```sh
npx --yes pnpm@10.34.5 dev
```

- `apps/web`: Vue 3, Vite and Element Plus frontend.
- `apps/worker`: Cloudflare Workers, Hono backend and database migrations.
- `apps/web/docs`: Bilingual user documentation.

Production frontend output goes to `apps/worker/dist` and deploys with the Worker. For the static experience site and Docs, use `dev:pages` and build with `build:pages` into `apps/web/dist-pages`. Private configuration, credentials and runtime data stay out of source control.

## Feedback and contributing

Report issues through [Issues](https://github.com/arctan303/FlareMail/issues) and discuss usage in [Discussions](https://github.com/arctan303/FlareMail/discussions). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

`main` contains the published stable version; `dev` is for ongoing development. Start contribution branches from `dev`. See the [release process](RELEASING.md) for branch gates, bilingual notes, tags and Releases. Run the tests and builds relevant to your changes:

```sh
npx --yes pnpm@10.34.5 test:web
npx --yes pnpm@10.34.5 test:worker
npx --yes pnpm@10.34.5 build
npx --yes pnpm@10.34.5 build:pages
```

## License

FlareMail's own source is [MIT](LICENSE). The complete distribution is provided under **AGPL-3.0-or-later**; see [third-party notices](THIRD-PARTY-NOTICES.md).

FlareMail is one of the Yifang products, and its maintainer uses it as a daily primary mailbox.
