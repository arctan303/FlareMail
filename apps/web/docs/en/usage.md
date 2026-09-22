# User guide

## Read and organize

Choose Inbox, Sent or Drafts from the sidebar. All mailboxes in the top toolbar combines your primary and alias addresses. Selecting one address filters its messages and returns to page one. Combine this with search, unread/star/attachment filters and date sorting; it does not change receiving policies or your login identity.

Inbox, Sent and Starred show one row per conversation, with a message count and up to 50 conversations per page. A conversation containing unread incoming mail appears in bold. Returning preserves filters and pagination. List actions affect members within the current folder and mailbox selection; search, unread and attachment filters do not narrow actions to only the matching messages. Drafts and administrator mail lists remain message-based.

Opening a conversation shows received and sent mail in chronological order, with only the newest message expanded at the bottom. Expand individual messages, expand all, or load earlier messages. After successful loading, existing incoming messages throughout the conversation are marked read, including collapsed messages and earlier pages. Failed read updates can be retried; new arrivals make the conversation unread again. Reading-view attachments, replies, stars, deletion and manual marking still apply to each individual message.

Conversations require reply links and matching subjects. Repeated leading `Re:`, `Re[n]:` and Chinese reply prefixes (`回复`, `回覆`, `答复`) do not split a conversation; changing the actual subject starts a separate conversation. Independently sent messages are not grouped by matching subjects alone, and forwarding prefixes such as `Fwd:` are retained. Older mail without reply headers may remain separate. The page indicates when results are partial. Reading checks up to your latest 5,000 accessible messages plus the selected message and displays at most 200 messages per conversation. List grouping and conversation actions support up to 10,000 active messages per user; exceeding this limit produces an explicit error instead of an incorrect partial total.

The list and conversation heading remove leading reply prefixes for display. Expanded messages do not repeat the heading. Each original subject remains in its message details, and replies still use the selected message's subject. Changing a subject affects grouping while preserving original subjects, reply headers and quoted history.

## Compose, reply and attachments

Choose New message, select a sender, and enter recipients, subject and body. Pick addresses from contacts or enter them manually. Reply and Forward appear at the bottom of the reading view.

Replies to received mail use the sender's Reply-To addresses when available, otherwise the From address. Expand the message header to view or copy Reply-To. Replying to sent mail continues to the original To recipients. Use the ellipsis in the body to expand quoted history without increasingly deep indentation. The composer also has a quoted-text toggle; it changes only the display, preserving the complete history when saving or sending.

Saving Reply-To requires the administrator to apply database update 325. Older databases still support sign-in and existing mail operations after the code update, but Reply-To values discarded before the database update cannot be recovered. Those messages continue to fall back to the From address.

Download attachments and preview images. Real mailboxes block external images until explicitly allowed; the experience never loads these external images. See [sending setup](/docs/en/sending) for limits and troubleshooting.

Closing an unsent message offers to save a draft. Real drafts are stored in the current browser's IndexedDB and do not sync across devices; clearing site data can lose them. Experience drafts live only in the current page and reset on refresh.

## Contacts and mailbox addresses

Contacts support names, addresses, notes, phone numbers and groups. Search or filter by group. Expand message recipient details to save its sender as a contact.

Personal settings let you add aliases, change sender names, pin addresses for sorting and delete aliases. Select your sender when composing. Pinning does not change your primary login address, which cannot be deleted as an ordinary alias. An administrator performs primary-address migration; sign in afterward with the new address and existing password.

## Preferences and integrations

Personal settings manage language, forwarding, CLI tokens and Google linking. Forwarding destinations require Cloudflare verification; see [receiving setup](/docs/en/receiving). Google linking requires prior [administrator setup](/docs/en/administration).

Changing your password invalidates old credentials, sessions and the personal CLI token. Sign in again and generate a new token if needed. See [CLI / Agent](/docs/en/cli) for scripts.

The lower-left user menu provides themes and shortcut help. Press C to compose, Ctrl / Command + K to search, and ? for shortcuts.
