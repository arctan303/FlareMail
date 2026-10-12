# A mailbox for your assistant

Give your assistant an email address as an entry point for tasks and reference material. FlareMail provides a personal CLI API and incoming webhooks: an assistant can query, read and reply to mail, while a receiver can get notified when a message is ready and schedule its processing.

[CLI and webhooks](/docs/en/cli) · [Try the mailbox interface](/inbox) · [Deploy your mailbox](/docs/en/deployment)

## Give the assistant mail access

Create an address in your instance and generate a CLI Token in personal settings. With that token, the assistant can list mailboxes, filter unread messages, fetch a message or attachment by ID, and send or reply to mail.

A token accesses its owner's data. To give an assistant its own account, create a separate member rather than sharing the administrator's token. HTML mail provides a readable body, and incremental queries reduce repeated full-list requests. See [CLI / Agent](/docs/en/cli) for endpoints and examples.

## Notify a receiver when mail arrives

After a message and its attachments are ready, a webhook sends an event to your public HTTPS receiver with an event ID, message ID and recipient mailbox. The receiver verifies the separate shared secret, durably queues the event and acknowledges it, then uses its own CLI Token to fetch the message.

Deduplicate by event ID and use your receiver's execution policy to queue work, combine notifications or wake the assistant. The receiver determines how events become assistant runs. FlareMail provides events and delivery records, with bounded retries for failed notifications.

Both external mail and internal delivery can produce notifications. Configure, enable, disable, rotate secrets, send test events and inspect deliveries through either the CLI or the web interface; both manage the same settings.

## Choose which senders trigger notifications

Notify for all senders or only addresses on an allowlist. Filtering only affects notifications; other messages are still received normally. An empty allowlist triggers no notifications.

The current allowlist matches the complete address in the message's From field without case sensitivity. Address matching does not authenticate the sender. Your receiver still decides which message contents may become assistant instructions.

## Check the integration

Start with a test notification to confirm reachability, matching secrets and successful queueing and acknowledgement. Then send a message from an external mailbox and check the event, message retrieval and assistant processing together. An IPv6-only receiver needs its actual network path tested.

Webhook and CLI behavior has been tested locally; a real IPv6 callback and end-to-end assistant wake-up still need integration testing. Your deployed version must include these features. The [online mailbox experience](/inbox) does not provide a real CLI API or external callbacks.

## Share your integration

Use [Discussions](https://github.com/arctan303/FlareMail/discussions) to describe your assistant, receiver environment, intended trigger behavior and where you got stuck. For reproducible problems, include the version, steps and redacted delivery results in an [Issue](https://github.com/arctan303/FlareMail/issues).

Remove tokens, webhook secrets, private callback URLs and message contents from public feedback. Report security issues [privately](https://github.com/arctan303/FlareMail/security/advisories/new).
