# Costs and preparation

**No VPS purchase is required, and a free Cloudflare account can deploy the application.** Start with Cloudflare's free plan and Resend's free sending allowance for light personal use. Bring your own domain separately.

## A free setup to start with

| Purpose | Service | Cost boundary |
| --- | --- | --- |
| Website, APIs and mail handling | Cloudflare Workers Free | Request and runtime allowances apply; no server rental |
| Mail and application data | Cloudflare D1 + KV | Free read, write and storage allowances; R2 is not required by default |
| Incoming domain mail | Cloudflare Email Routing | Available on Free; handling and storing mail still consumes application resources |
| Sending to external mailboxes | Resend Free | Currently 3,000 emails per month, up to 100 per day; verify your own sending domain |
| Email domain | A domain you own or purchase | Registration and renewal are separate from free service allowances |

This is an available free combination, with usage and storage limits. Resources and usage belong to your accounts. Checked on **2026-10-12**; see the current official [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [KV](https://developers.cloudflare.com/kv/platform/pricing/), [Email Service](https://developers.cloudflare.com/email-service/platform/pricing/) and [Resend](https://resend.com/pricing) terms.

## What to prepare

- **Cloudflare account**: runs the application, database and routing; a free account can get started.
- **Your domain**: use Cloudflare DNS for the email domain, such as `example.com` in `hello@example.com`.
- **GitHub account**: Web deployment saves your own source copy for later updates.
- **Sending account and domain verification**: choose Resend for the free setup and follow the [sending guide](/docs/en/sending).
- **Password manager**: save a separate installation secret and mailbox password.

Web deployment requires no local Git, Node.js or terminal tools. After installing the application, configure DNS, receiving routes and sending-domain verification. Follow the [deployment guide](/docs/en/deployment).

## Sending and receiving entirely through Cloudflare

FlareMail also supports Cloudflare Email Sending. **Sending to arbitrary external addresses requires Workers Paid** and onboarding your sender domain. Free sending to verified destination addresses in your account is a separate exception, rather than a complete free sending setup. [Cloudflare pricing and requirements](https://developers.cloudflare.com/email-service/platform/pricing/)

Neither sending option needs a VPS. Start with the free combination and choose services as your usage grows. Switching providers does not automatically configure the other channel.

## When to consider more capacity or R2

Each service has its own allowance. Sign-in, page operations, caching, saving mail and attachments consume requests or reads and writes, so a request allowance is not a mailbox message allowance. Larger messages also face runtime and mail-size limits, while retained mail uses storage.

Attachments can use KV by default. Consider private R2 when you need more attachment storage, after checking activation requirements, allowances and pricing. R2 is optional; switching does not migrate existing objects. [Storage configuration](/docs/en/configuration) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Ready to start? [Deploy your mailbox](/docs/en/deployment), or [try it online](/inbox) first.
