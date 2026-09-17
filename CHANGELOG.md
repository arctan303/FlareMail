# Changelog

## v1.0.0 — Release preparation

First formal release of FlareMail, an invitation-based private mailbox on your own domain.

### Included

- A single Cloudflare Worker serves the Web interface, API and incoming mail handler; D1/KV are required and R2 object storage is optional.
- Multiple domains and mailbox addresses, mail reading and organization, composing, replies, forwarding, attachments, contacts and browser-local drafts.
- Administrator-created invited members, per-user mail access, Web setup, centralized settings and custom branding.
- Chinese/English interfaces, light/dark appearance, responsive layout, keyboard shortcuts and PWA installation.
- Personal CLI / Agent tokens and optional first-party OAuth authorization; optional linked Google sign-in and Turnstile verification.
- Resend sending by default, with optional Cloudflare Email Sending (Beta).
- A separate static Pages experience with sample data and bilingual Docs.

### Before deployment

- Configure receiving DNS/routing and verify the selected sending provider; test delivery with an external mailbox.
- Browser drafts do not synchronize across devices. IMAP, POP3 and SMTP client access are not provided.
- Back up D1 and attachment/brand objects separately before upgrades or storage changes. Current database schema: 324.

[中文部署文档](https://flaremail-demo.pages.dev/docs/zh/deployment) · [English deployment guide](https://flaremail-demo.pages.dev/docs/en/deployment)
