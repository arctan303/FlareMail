# Everyday use

Once delivery tests pass, this is your own domain mailbox. Start by reading and replying with your primary address, then add addresses, organize contacts or [connect your assistant](/docs/en/cli) as needed. You can use it on your own without adding members or configuring optional sign-in methods.

## Read and organize

Trash retains deleted mail for 30 days. During that period you can view it, restore it to the original mailbox or permanently delete it. Emptying Trash requires confirmation and affects the messages in that confirmation snapshot. Restore a deleted alias in personal settings before restoring its mail. Existing deleted messages receive a fresh 30-day grace period when patch 329 is applied; hidden saving placeholders are excluded. After expiry, bounded background jobs remove records and queue safe attachment cleanup. Local drafts keep their existing lifecycle and do not enter Trash.

Compose supports To, Cc and Bcc, with at most 20 unique addresses in total. Recipients can see To/Cc; Bcc stays only in the sender’s sent copy. Reply all uses Reply-To and the original To/Cc, excludes your own addresses and never automatically includes Bcc. Drafts and failed-send recovery preserve these fields. Patch 329 enables Cc/Bcc and content fingerprints. Any message containing an external recipient goes entirely through the provider with complete recipient roles; local recipients then arrive through real incoming routes, without duplicate local copies. Purely internal mail remains directly delivered without an external provider.

Personal settings let you choose a default sender for new messages and restore individual deleted aliases without changing their IDs or history. Replies and reopened drafts keep their original sender. Disabled domains and current alias quotas apply. Contacts now offer Load earlier messages, using stable ID pagination across your active mailboxes and exact address matching, including Cc and your own sent Bcc.

Expand Delivery events on sent mail for verified Resend acceptance, delivery, bounce, delay and complaint reports. An administrator must configure callbacks. A provider or binding without delivery callbacks never implies verified delivery.

The inbox checks for new mail every 30 seconds by default while visible and online, and immediately when you return or reconnect. Updates preserve the current page and scroll position and are deferred while messages are selected or menus are open. Checks pause when the page is hidden; manual refresh remains available.

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

Links in mail and the editor allow URLs up to 8192 characters. Longer links retain their text without a clickable destination. Each table allows at most 10000 expanded cells and each cell's row/column span at most 100; larger tables become plain text with their visible text preserved. These rules also apply to quoted mail, pasted content, Source and restored drafts.

Use Save draft at the bottom of the composer, even before completing recipients, subject or body. Saving stores the body and attachments and closes the window. Closing a new message also offers to save; closing an existing draft updates it. A failed save keeps your edits open. Real drafts are stored in the current browser's IndexedDB and do not sync across devices; clearing site data can lose them. Experience drafts live only in the current page and reset on refresh.

Real drafts are isolated by a stable user ID and survive an email-address change. Reassigning that address to someone else does not give them access to the previous user's drafts. Older drafts with an owner marker migrate automatically; unowned drafts stay hidden until explicitly claimed from the Drafts page. Claim only drafts you recognize as yours. Session expiry and 401 responses preserve drafts; explicitly signing out clears the current user's local drafts and attachments.

## Contacts and mailbox addresses

Contacts support names, addresses, notes, phone numbers and groups. Search or filter by group. Expand message recipient details to save its sender as a contact.

Personal settings let you add aliases, change sender names, pin addresses for sorting and delete aliases. Select your sender when composing. Pinning does not change your primary login address, which cannot be deleted as an ordinary alias. An administrator performs primary-address migration; sign in afterward with the new address and existing password.

## Preferences and integrations

Personal settings manage language, forwarding, CLI tokens and Google linking. Forwarding destinations require Cloudflare verification; see [receiving setup](/docs/en/receiving). Google linking requires prior [administrator setup](/docs/en/administration).

Internal incoming mail also follows the recipient mailbox's forwarding switch, using the recipient's sending channel and quota. The forwarded copy is sent from that mailbox with Reply-To pointing to the original sender; body, inline images and attachments are preserved, without Bcc addresses. If forwarding fails or is unconfirmed, the original stays in the inbox and its details show a failure notice. Check the channel, quota and forwarding settings before retrying an unconfirmed attempt.

Changing your password invalidates old credentials, sessions, the personal CLI token and previously unredeemed OAuth authorization codes. Sign in again and generate a new token if needed. See [CLI / Agent](/docs/en/cli) for scripts.

The lower-left user menu provides themes and shortcut help. Press C to compose, Ctrl / Command + K to search, and ? for shortcuts.
