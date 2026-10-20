# Administrator setup

For personal use, your own mailbox account also manages the instance. Complete [deployment](/docs/en/deployment) and external mail tests to start using it. Configure branding, Google sign-in and invited members when needed.

## Add invited members (optional)

Add a user from the sidebar's Users page, providing an email address, name, initial password and applicable quotas. Register the domain under System settings → Mail domains and configure its receiving route and sending provider first.

Invitation-based use currently means the administrator creates accounts and securely shares the login URL, address and initial password. There are no automatic invitation emails, public registration or invitation links. Members should change their initial password after signing in. Disabling, deleting and physically deleting accounts have different consequences; read the confirmation. Physical deletion removes associated messages and attachments.

## Manage mail domains

Apply database patch **328** under System settings → Maintenance before managing existing domains. Adding a domain still needs no redeployment; DNS, Email Routing and sending-provider setup remain separate steps.

- **Disable / enable:** disabling stops new mailboxes and incoming/outgoing mail for the domain. Existing users can still sign in and read history, and the domain can be enabled again. Network deliveries already in progress cannot be recalled.
- **Rename:** choose a domain that is not registered yet. All mailbox addresses move with it, retaining their prefixes and the domain's enabled/disabled state.
- **Migrate mailboxes:** move every mailbox to an existing, enabled target domain while keeping its prefix. The source domain remains registered but is disabled. Any occupied target address, including a retained deleted mailbox, blocks the entire operation; mailboxes are never merged automatically.
- **Delete:** remove a domain only when no mailbox or login account references it, while keeping at least one registered domain. Migrate associated mailboxes first. Removing the domain configuration does not delete messages or attachments.

Preview affected addresses, login users, messages and attachments before confirming. Changes to domains or associated identities require a new preview. Migration preserves user/mailbox IDs, data ownership and original message content, including retained deleted mailbox records. Users whose primary login address changes must sign in with the new address and their existing password, then regenerate CLI tokens; unused authorization codes are invalidated. Local drafts still belong to the same user.

Configure DNS, receiving routes and sending credentials for the new domain separately. Old-domain credentials are not copied; an existing destination keeps its own credentials. Mailbox webhook configuration follows the mailbox, unfinished old-address notifications are cancelled, and future notifications use the new address. Requests already in transit cannot be recalled.

## Mail checks and delivery callbacks

System settings → Mail checks public MX, SPF, DMARC and the selected DKIM record, plus domain state, credentials and bindings. DNS queries use Cloudflare DoH; use the selector provided by your sending service. An unavailable lookup is reported separately from a missing record. These checks do not prove that incoming routes point to this Worker.

Choose an owned sender and a recipient to explicitly send a real test message using the normal quota. Confirm it in the recipient mailbox. For incoming tests, send from an external mailbox using the generated exact subject, then check for arrival. Provider acceptance is separate from actual delivery.

For Resend delivery reports, copy the callback URL to a Resend webhook, subscribe to the listed delivery events, and save that endpoint’s `whsec_...` signing secret here. The server verifies the raw body, timestamp and duplicate event ID. Read responses never expose the secret. Senders can view per-recipient events on sent messages; partial delivery is not counted as complete delivery. This callback is separate from incoming notifications for assistants. [Resend signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)

Saved Resend keys can be marked for removal and cleared by saving the section after sensitive-action verification. Cancel or Reset leaves saved credentials intact.

## Google sign-in (optional)

1. Create a Web application OAuth client in Google Cloud. Configure the consent screen and test users or publishing status as required by Google.
2. Add both Authorized redirect URIs, replacing the sample domain with your actual web address:

~~~text
https://mail.example.com/login/oauth/callback
https://mail.example.com/oauth/bind/callback
~~~

3. Save the Client ID and Client Secret under System settings → Sign-in & authorization, then enable the Google sign-in entry.
4. Members first sign in with their mailbox password and link their Google account in personal settings. They can then sign in with Google.

Google sign-in does not create mailbox members. The entry switch differs from account linking: with credentials configured, personal linking and unlinking remain available when the entry is disabled. Unlinking invalidates existing sessions and the personal CLI token, requiring another sign-in. Update the Google redirects when changing your web domain. [Google setup](https://developers.google.com/identity/protocols/oauth2/web-server)

Replacing a linked Google account preserves the browser session that started the change and signs out all other existing browser sessions, including password sign-ins. First linking and linking the same account again keep those sessions. Older installations must apply database update 326 before replacing a link.

## Turnstile (optional)

Create a Cloudflare Turnstile widget and allow your production web hostname. Save its Site Key and Secret Key under Sign-in & authorization and enable verification through the UI. The Site Key is for the browser; the Secret Key belongs on the server. Test loading and sign-in while signed out. [Official steps](https://developers.cloudflare.com/turnstile/get-started/)

## Branding and service switches

Site brand controls the name, icons, login page and PWA appearance; custom text is not automatically translated. Core services controls site-wide service switches. Save the relevant section and check the resulting interface.

See [receiving setup](/docs/en/receiving) for filters, unknown recipients and forwarding, and [sending setup](/docs/en/sending) for providers. CLI access uses a personal token and does not require adding CORS origins.

## Website authorization and sensitive changes

To use FlareMail as an authorization service for your own websites, follow [OAuth integration](/docs/en/oauth). This is separate from Google sign-in and CLI tokens and is disabled by default.

Confirm your password when prompted for secrets, primary-address migration or deletion. After an administrator migrates a primary address, the user signs in again with the new address and existing password. Pinning a mailbox or selecting a sender does not migrate the login identity.
