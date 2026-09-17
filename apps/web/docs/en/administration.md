# Administrator setup

Complete [deployment](/docs/en/deployment) and external mail tests before adding members or optional features. Administrators manage accounts and system configuration; each member accesses their own mail.

## Add invited members

Add a user from the sidebar's Users page, providing an email address, name, initial password and applicable quotas. Register the domain under System settings → Mail domains and configure its receiving route and sending provider first.

Invitation-based use currently means the administrator creates accounts and securely shares the login URL, address and initial password. There are no automatic invitation emails, public registration or invitation links. Members should change their initial password after signing in. Disabling, deleting and physically deleting accounts have different consequences; read the confirmation. Physical deletion removes associated messages and attachments.

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

## Turnstile (optional)

Create a Cloudflare Turnstile widget and allow your production web hostname. Save its Site Key and Secret Key under Sign-in & authorization and enable verification through the UI. The Site Key is for the browser; the Secret Key belongs on the server. Test loading and sign-in while signed out. [Official steps](https://developers.cloudflare.com/turnstile/get-started/)

## Branding and service switches

Site brand controls the name, icons, login page and PWA appearance; custom text is not automatically translated. Core services controls site-wide service switches. Save the relevant section and check the resulting interface.

See [receiving setup](/docs/en/receiving) for filters, unknown recipients and forwarding, and [sending setup](/docs/en/sending) for providers. CLI access uses a personal token and does not require adding CORS origins.

## Website authorization and sensitive changes

To use FlareMail as an authorization service for your own websites, follow [OAuth integration](/docs/en/oauth). This is separate from Google sign-in and CLI tokens and is disabled by default.

Confirm your password when prompted for secrets, primary-address migration or deletion. After an administrator migrates a primary address, the user signs in again with the new address and existing password. Pinning a mailbox or selecting a sender does not migrate the login identity.
