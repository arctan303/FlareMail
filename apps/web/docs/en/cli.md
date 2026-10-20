# CLI / Agent

Use a personal CLI token to manage your mail from scripts or an Agent. Enter your mailbox URL above to generate full endpoint URLs and commands. Opening this page from personal settings supplies the address automatically.

## Get a token

Generate a token under **Personal settings → CLI / Agent** in your real mailbox. It is shown only when generated; the server stores a hash. Rotation replaces the old token, revocation invalidates it immediately, and password changes also clear personal CLI tokens.

Every request, including attachment downloads, requires this header:

```http
Authorization: Bearer <YOUR_CLI_TOKEN>
```

This documentation site does not read or store tokens. Replace the placeholder locally. The experience site uses sample data and provides no real CLI API; token settings are for viewing only.

## Quick start

Multiline curl examples use Bash / POSIX continuation syntax. On Windows, use Git Bash, or use curl.exe in PowerShell and put each command on one line or adapt its continuation syntax.

```sh
curl 'https://mail.example.com/api/cli/accounts' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>'
```

Use a returned mailbox `id` to list that mailbox's incoming messages:

```sh
curl 'https://mail.example.com/api/cli/emails?page=1&size=20&type=0&accountId=1' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>'
```

## Endpoints

These endpoints only access the token owner's data. Replace `:id` with a message ID and `:key` with an attachment key.

| Method | Full URL | Purpose |
| --- | --- | --- |
| GET | https://mail.example.com/api/cli/accounts | List mailboxes: id, email, name (up to 50) |
| GET | https://mail.example.com/api/cli/emails | List messages |
| GET | https://mail.example.com/api/cli/emails/:id | Plain-text body and attachment metadata |
| GET | https://mail.example.com/api/cli/attachments/:key | Download an attachment with the same Bearer token |
| POST | https://mail.example.com/api/cli/emails/send | Send plain-text mail |
| POST | https://mail.example.com/api/cli/emails/:id/reply | Reply with quoted history |
| PUT | https://mail.example.com/api/cli/emails/:id/read | Mark as read |
| DELETE | https://mail.example.com/api/cli/emails/:id | Delete a message |

Default rate limits are shared per user: queries, reads, marking and deletion use EMAIL_RATE_LIMITER (60/minute); sending and replies use SEND_RATE_LIMITER (10/minute). Related Web operations count toward the same limits. Actual limits depend on instance bindings; without them the application uses fallback limiting. These are not independent quotas per endpoint.

## List messages

| Parameter | Description |
| --- | --- |
| page | Integer page number ≥ 1; default 1 |
| size | Page size from 1–50; default 20 |
| type | 0 for incoming mail (default), 1 for sent mail |
| accountId | Optional positive integer; filters one of your mailboxes. Omit to query all your mailboxes |
| q | Search subject, sender, recipient, sender name, text body and HTML source; at most 48 UTF-8 bytes. No attachment or semantic search; tags/entities affect matching |
| unread | Optional: true for unread, false for read; omit for both |
| afterId | Optional nonnegative integer; return IDs greater than the cursor in ascending order |

JSON responses use a `code`, `message`, `data` envelope. Example:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 1, "page": 1, "size": 20,
    "list": [{"id": 1001, "from": "Sender <sender@example.com>", "to": "user@example.com", "subject": "Hello", "date": "2026-09-17 12:00:00", "unread": true, "hasAtt": true}]
  }
}
```

A message detail includes original MIME plain text in `text` and `bodySource` (html or text). `body` prefers readable HTML converted with paragraphs, lists and link destinations, falling back to text. It does not load remote content, execute HTML or recognize text in images. Each attachment has `filename`, `size`, `mimeType`, and `url`. Resolve relative URLs against your mailbox origin and send the same Bearer token.

For incremental recovery, start with `afterId=0&page=1`. Process a page, persist `nextAfterId`, then request that cursor with `page=1`. End the current pass when the list is empty or the cursor stops advancing, and check again later. If an earlier message is still saving attachments, `scanPending=true` and the cursor cannot cross it; later messages may repeat, so deduplicate by message ID. Incremental scans require page=1. Without afterId, ordering remains descending by ID. Avoid unread filtering when recovering all mail, since read state can change.

## Incoming mail webhooks

Available after database patch v3.27. No configuration means no notifications. Settings are independent per mailbox. Personal settings → Security & credentials → Mail webhooks and the CLI manage the same data; no Web setup is required first.

| Method | Path (under /api) | Purpose |
| --- | --- | --- |
| GET | /cli/webhooks/:accountId | Read settings and revision; never returns an existing secret |
| PUT | /cli/webhooks/:accountId | Set revision, url, enabled, mode, allowlist and optional secret |
| DELETE | /cli/webhooks/:accountId?revision=current | Delete settings/secret and cancel queued events; retain a revision tombstone |
| POST | /cli/webhooks/:accountId/secret | Rotate secret with {"revision":current} |
| POST | /cli/webhooks/:accountId/test | Test the saved endpoint, even when disabled |
| GET | /cli/webhooks/:accountId/deliveries | Latest 50 records; pass nextBefore as before for the next page |
| POST | /cli/webhooks/:accountId/deliveries/:eventId/retry | Retry a failed event younger than 24 hours with an unchanged configuration revision |

GET the revision first (0 when never configured), then PUT. Explicitly choose `mode`: `all` or `allowlist`. An empty allowlist sends no notifications; excluded messages are still received. Up to 100 full addresses are trimmed and matched case-insensitively against MIME From addresses, never display names. **Address filtering does not authenticate senders or guarantee protection from spoofing.** Mail content remains untrusted input.

```sh
curl --fail-with-body -sS -X PUT 'https://mail.example.com/api/cli/webhooks/1' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"revision":0,"url":"https://assistant.example.com/mail","enabled":true,"mode":"allowlist","allowlist":["owner@example.com"]}'
```

Use a public HTTPS hostname on port 443. IP literals, internal hostnames, URL credentials and fragments are rejected; redirects are not followed. Hostnames resolving to IPv6 are accepted; verify actual Worker-to-IPv6 connectivity with a test after deployment. Secrets are separate from CLI Tokens: 32–256 printable ASCII characters without spaces. Omit secret on creation to generate one, returned only once; rotation also returns it once. Omit secret on updates to retain it. Reads and delivery records never return secrets.

External and internal mail generate a POST only after mail and attachments are saved (v1 fields; receivers should ignore unknown fields):

```json
{"event":"email.received","eventId":"stable-event-id","emailId":1001,"mailbox":"xiaoa@example.com"}
```

The `X-FlareMail-Webhook-Secret` header carries the shared secret. The JSON notification contains no email body, attachments or CLI Token. Verify the secret, deduplicate by eventId, enqueue durably and promptly return any 2xx; then fetch emailId with your own CLI Token. `webhook.test` has emailId null and is not new mail. Each message has one event; the receiver decides queueing, batching and waking. An acknowledged delivery does not confirm assistant completion or mark mail as read.

Delivery is attempted immediately. Every-minute Cron recovers failed work, up to 3 events per run. Each request times out after 8 seconds. Each automatic cycle allows 5 attempts with approximate delays of 1 minute, 5 minutes, 30 minutes and 2 hours, affected by scheduling/backlog. Events expire after 24 hours. A lost acknowledgment can cause duplicates with the same eventId; manual retry starts another finite cycle with that ID.

Records show pending/sending/delivered/failed/cancelled, attempts, httpStatus, fixed error reasons and timestamps. Terminal records are cleaned after 7 days; response bodies are not retained. Tests/retries share send rate limits; other operations share query limits. Every configuration update increments revision and cancels older queued events without backfilling historical mail. An HTTP request already in flight cannot be recalled. On 409, refresh before editing. Notification failure does not prevent mail receipt; use afterId for occasional recovery.

## Send and reply

Sending requires `to` and `subject`. `to` accepts one address or an array; optional `cc` and `bcc` accept address arrays, with at most 20 unique recipients in total. `body` is optional plain text. Optional `accountId` selects your sender mailbox; otherwise the server chooses an available mailbox. `requestId` is required: a unique string of 16–128 bytes. Cc/Bcc require database patch 329. Attachment uploads remain unsupported by this CLI endpoint.

Pass `"replyAll":true` when replying to include Reply-To and the original To/Cc while excluding your own addresses. Bcc is never added automatically. Only a sender can read their own Bcc list. Deletion moves mail to the 30-day Trash, with recovery available in the web UI. Reusing a requestId with changed recipients, body or attachments returns 409; retries must keep the original payload.

```sh
curl 'https://mail.example.com/api/cli/emails/send' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"to":"recipient@example.com","subject":"Hello","body":"Sent from CLI","accountId":1,"requestId":"cli-send-20260917-0001"}'
```

Replies use JSON fields `body` and required `requestId`. The server selects the original message's mailbox, falling back to an available mailbox if necessary, creates a `Re:` subject and quotes the original:

```sh
curl 'https://mail.example.com/api/cli/emails/1001/reply' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"body":"Thanks!","requestId":"cli-reply-20260917-0001"}'
```

Send and reply responses return `data` with `id`, `status`, `requestId`, and `warning`. Check `status` and `warning` for delivery results rather than relying only on request success.

Generate a new `requestId` for each new send or reply. Reuse the original value when retrying a timed-out operation to avoid duplicate delivery.

status is numeric: 0 received, 1 sent, 2 delivered, 3 bounced, 4 complained, 5 delayed, 6 saving, 7 unknown recipient, 8 failed. Provider acceptance does not guarantee placement in the recipient’s inbox; also inspect warning and actual receipt.

## Agent instructions

Copy the English instructions below, then insert your token in your own secure environment. Addresses follow the mailbox URL above; changing the page language keeps the instructions in English by default.

<!-- CLI_AGENT_PROMPT -->

## Errors and retries

| code | Action |
| --- | --- |
| 200 | Request succeeded; inspect delivery status in data |
| 400 | Fix invalid parameters; do not blindly resend |
| 401 | Token is invalid or revoked; check your token |
| 404 | Message or attachment is missing or not accessible to this user |
| 409 | The same requestId is processing or its result is uncertain; wait, check sent mail and retry with the original value rather than blindly generating a new one |
| 429 | Rate limit reached; wait with backoff before retrying |
| 503 | Sending is unavailable or under maintenance; retry later with the same requestId |

Keep tokens out of public repositories, documentation links and shared commands.
