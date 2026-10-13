# Email on your own domain

FlareMail is for people who want a personal mailbox on their own domain: an address for everyday conversations and project contacts, with a web interface for reading and replying. It runs in your Cloudflare account, with no VPS to maintain.

[Try the mailbox](/inbox) · [Deployment guide](/docs/en/deployment) · [Costs and preparation](/docs/en/costs)

## Start with one address

Bring a domain managed through Cloudflare DNS and create an address for everyday use, such as `you@example.com`. Complete the web setup wizard, configure receiving and a sending service, then use an external mailbox to test incoming mail and a reply.

Open the web interface to read mail. Related replies appear in a conversation; search, stars, contacts and drafts help you organize and continue working. The interface also works on phones and can be installed as a PWA. See [everyday use](/docs/en/usage).

## Add addresses by purpose

When you need to separate projects, public contacts or automated notifications, add addresses such as `project@example.com` or `assistant@example.com`. The top selector shows mail from all your addresses or just one.

An instance can manage multiple domains and addresses. You can also invite family or other members, each with their own mailbox. You can start on your own.

## Where the application and data live

A single Cloudflare Worker serves the website, APIs and mail handler. D1 stores accounts and mail, KV stores caches and related objects, and optional R2 storage handles attachments. These resources live in your Cloudflare account; preserve your database, storage and credentials when updating.

Choose Resend or Cloudflare Email Sending for outgoing mail, subject to their allowances and requirements. Bring your own domain and read [costs and preparation](/docs/en/costs) for sending and attachment options.

## Try it, then deploy

The [online experience](/inbox) needs no sign-in. Open conversations, search messages, switch addresses and compose replies. It uses sample data, and simulated sends do not deliver real email.

When you are ready, follow the [deployment guide](/docs/en/deployment) to install the application, complete web setup and connect domain delivery. Test receiving and replying with an external mailbox. FlareMail currently provides Web and CLI API access; check the [FAQ](/docs/en/faq) if you need a traditional mail client.

## Share your experience

Use [Discussions](https://github.com/arctan303/FlareMail/discussions) to tell us what you want to use the mailbox for, where you got stuck and what would help next. For a reproducible problem, open an [Issue](https://github.com/arctan303/FlareMail/issues) with your version, the guide you followed, and the expected and actual results.

Remove tokens, installation credentials, message contents and private addresses from public feedback. Use [private reporting](https://github.com/arctan303/FlareMail/security/advisories/new) for security vulnerabilities.
