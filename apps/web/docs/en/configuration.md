# Configuration and storage

A new installation needs one application Secret: `SETUP_SECRET`. Domains, sending credentials and optional features are mainly configured in the Web console. DNS, resource bindings and third-party verification still require platform setup.

## Where to configure

| Location | Purpose |
| --- | --- |
| System settings → Core services | Instance-wide receiving and sending switches |
| System settings → Mail domains | Address domains and unknown-recipient policy |
| System settings → Mail delivery | Incoming filters, provider and Resend keys |
| System settings → Sign-in & authorization | Google, Turnstile, OAuth Provider and additional origins |
| System settings → Site brand | Names, icons, login page and PWA appearance |
| System settings → Maintenance | Schema inspection and controlled upgrades |
| Personal settings | Password, language, aliases, forwarding, Google binding and CLI token |

Confirm your administrator or personal password when a sensitive operation requests it. Saving one configuration area does not save every other area; check unsaved indicators. See [administrator configuration](/docs/en/administration), [incoming mail](/docs/en/receiving) and [outgoing mail](/docs/en/sending).

## Secret and bindings

SETUP_SECRET lives in the Cloudflare Worker Secret store. Upload it from .dev.vars for the first deployment; ordinary updates do not need to upload it again. It authorizes setup and necessary maintenance recovery rather than member sign-in.

| Binding | Resource | Required |
| --- | --- | --- |
| db | D1: accounts, message bodies/metadata, contacts and settings | Yes |
| kv | KV: sessions, short-lived tokens, preferences/cache and fallback objects | Yes |
| r2 | Private R2: attachments and brand assets | Optional |
| email | Cloudflare Email Sending | Only for that provider |

Keep the binding names expected by the application. Preserve existing resource IDs, bucket names and Secrets rather than replacing them with a blank template.

## Choose object storage

FlareMail uses R2 when r2 is bound, otherwise KV. No public bucket or R2 custom domain is required: the Worker authorizes attachment access. Normally leave the legacy public R2 URL field empty.

For R2 on a new installation, enable the template section with your chosen bucket name:

~~~toml
[[r2_buckets]]
binding = "r2"
bucket_name = "your-mail-files"
~~~

Redeploy and inspect the binding in the dashboard. Automatic creation depends on Wrangler's current provisioning support; first enable R2 in your account if required. KV has storage, write and value-size limits. R2, Workers and sending providers have separate quotas. [KV limits](https://developers.cloudflare.com/kv/platform/limits/) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Adding or removing r2 after storing mail does not migrate objects. Back up first, migrate existing attachment and brand objects with their original keys, then verify them. FlareMail has no one-click storage migration wizard. A database backup does not contain these objects; see [maintenance](/docs/en/updates).

## Distinguish domains

Mailbox domains determine available email addresses; the website domain serves sign-in and APIs; OAuth callbacks or additional CORS origins authorize website integration. Registering a mailbox domain does not authorize websites or configure delivery DNS.
