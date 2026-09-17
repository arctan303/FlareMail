# User guide

## Read and organize

Choose Inbox, Sent or Drafts from the sidebar. All mailboxes in the top toolbar combines your primary and alias addresses. Selecting one address filters its messages and returns to page one. Combine this with search, unread/star/attachment filters and date sorting; it does not change receiving policies or your login identity.

Each page holds up to 50 messages; use the toolbar arrows to paginate. Opening unread mail marks it read, and returning preserves filters and pagination. Copy detected verification codes directly, or select messages for batch organization, marking and deletion.

## Compose, reply and attachments

Choose New message, select a sender, and enter recipients, subject and body. Pick addresses from contacts or enter them manually. Reply and Forward appear at the bottom of the reading view.

Download attachments and preview images. Real mailboxes block external images until explicitly allowed; the experience never loads these external images. See [sending setup](/docs/en/sending) for limits and troubleshooting.

Closing an unsent message offers to save a draft. Real drafts are stored in the current browser's IndexedDB and do not sync across devices; clearing site data can lose them. Experience drafts live only in the current page and reset on refresh.

## Contacts and mailbox addresses

Contacts support names, addresses, notes, phone numbers and groups. Search or filter by group. Expand message recipient details to save its sender as a contact.

Personal settings let you add aliases, change sender names, pin addresses for sorting and delete aliases. Select your sender when composing. Pinning does not change your primary login address, which cannot be deleted as an ordinary alias. An administrator performs primary-address migration; sign in afterward with the new address and existing password.

## Preferences and integrations

Personal settings manage language, forwarding, CLI tokens and Google linking. Forwarding destinations require Cloudflare verification; see [receiving setup](/docs/en/receiving). Google linking requires prior [administrator setup](/docs/en/administration).

Changing your password invalidates old credentials, sessions and the personal CLI token. Sign in again and generate a new token if needed. See [CLI / Agent](/docs/en/cli) for scripts.

The lower-left user menu provides themes and shortcut help. Press C to compose, Ctrl / Command + K to search, and ? for shortcuts.
