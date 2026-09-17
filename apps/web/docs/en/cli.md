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
| q | Optional search across subject, sender, recipient or sender name; at most 48 UTF-8 bytes |

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

A message detail's `data` contains `id`, `from`, `to`, `cc`, `subject`, `date`, plain-text `body` and `attachments`. Each attachment has `filename`, `size`, `mimeType`, and `url`. Resolve relative URLs against your mailbox origin and send the same Bearer token when downloading.

## Send and reply

Sending requires JSON fields `to` and `subject`. `body` is optional plain text; optional `accountId` selects your sender mailbox. If omitted, the server selects an available mailbox. `requestId` is required: a unique string of 16–128 bytes. CLI sending does not support CC recipients or attachment uploads.

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
