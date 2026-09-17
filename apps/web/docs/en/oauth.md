# OAuth integration

FlareMail can authorize the deployer's own websites. This capability is disabled by default and is independent of password login, Google binding and personal CLI / Agent tokens.

The integration uses a shared first-party secret. Clients need a server that can store it securely; never put it in browser code, mobile packages or public repositories. The protocol provides authorization codes, short-lived access tokens and userinfo. It does not provide OIDC ID tokens, refresh tokens, per-client secrets or a new consent page.

## Administrator configuration

1. Set a fixed HTTPS mailbox origin (issuer), such as `https://mail.example.com`, and enter or generate a shared secret.
2. Register clients with an identifier, display name, enabled state and full callback URLs. Mailbox domains do not authorize websites.
3. Enable authorization after the issuer, secret and client configuration are ready. Sensitive changes use recent password confirmation.
4. Revealing or copying the shared secret requires a separate password check. Normal settings queries do not return plaintext; closing the dialog clears it.
5. Keep the same shared secret on the client's server. It is separate from the administrator password, setup secret, CLI token and Google secret.

The saved issuer does not change with request Host or the URL used to access the mailbox. Production requires an HTTPS origin without path, query or fragment. Local development permits `http://127.0.0.1:8787` (Worker) or `http://127.0.0.1:3001` (Vite); issuer and callbacks do not accept HTTP localhost. Vite proxies the public endpoints below. Sign in and authorize from the configured origin.

Changing domains requires explicitly updating the issuer. Revealing the secret does not rotate it; replacing it is a separate save and clients must update their copy.

Callbacks match the complete URL, including domain, path, query and port. Wildcards, prefix matching, fragments and URL credentials are rejected. Production callbacks require HTTPS; development only permits HTTP 127.0.0.1.

Client IDs contain 1–128 letters, digits or `._~-`; names contain 1–80 characters. There are at most 32 clients and 16 callbacks per client. Create a new client to change its identifier.

Clients can be edited while authorization is disabled. The switch and client list save separately; toggling never clears, reorders or overwrites clients, callbacks, issuer or secret. A stale revision returns 409; reload and reconcile changes.

## Authorization flow

| Step | Endpoint | Caller |
| --- | --- | --- |
| Metadata | GET /.well-known/oauth-authorization-server | Client |
| Authorize | GET /oauth/authorize | Browser |
| Exchange code | POST /oauth/token | Client server |
| Read identity | GET /oauth/userinfo | Client server |

These public paths have no /api prefix.

Generate fresh random state and a PKCE code_verifier for every login; keep them in a short-lived client-side login session. The verifier has 43–128 Base64URL characters. Hash it with SHA-256 and encode without padding for code_challenge; code_challenge_method is always S256.

| Parameter | Value |
| --- | --- |
| response_type | code |
| client_id | Registered identifier |
| redirect_uri | Full registered callback |
| state | Fresh, non-empty; at most 512 characters |
| code_challenge | PKCE challenge |
| code_challenge_method | S256 |
| scope | email; may be omitted |
| prompt | Omit for normal login; none for silent attempts |

Users without a session sign in to FlareMail, then return to the authorization request. Success redirects to the registered callback with code and state. Verify the returned state before exchanging the code from your server.

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=personal-site&client_secret=SERVER_SIDE_SECRET&redirect_uri=https%3A%2F%2Fsite.example.com%2Fauth%2Fcallback&code=RETURNED_CODE&code_verifier=SAVED_VERIFIER
```

Successful response:

```json
{
  "access_token": "opaque-access-token",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "email"
}
```

Authorization codes expire after 90 seconds and can be used once. Access tokens are opaque and expire after five minutes; do not decode them as JWTs or extend their lifetime.

```http
GET /oauth/userinfo
Authorization: Bearer RETURNED_ACCESS_TOKEN
```

The response includes sub (persistent user ID string), email, email_verified, name and role (admin or member). These roles describe the mailbox instance; clients create their own sessions and assign local permissions.

## Disabling authorization and existing credentials

| Action | New authorization | Unexchanged codes | Existing access tokens |
| --- | --- | --- | --- |
| Disable authorization | Rejected locally | Redeemable within 90 seconds if client/callback remain valid | Original lifetime and user checks |
| Re-enable | Saved client configuration | Original rules | Original rules |
| Disable/delete a client | Rejected for that client | Current client validation fails | Original rules |
| Remove/change a callback | Old callback rejected | A code bound to the old URL cannot use either URL | Original rules |
| Change display name | Unchanged | Unchanged | Unchanged |

Disabling does not clear clients, codes or tokens, or log users out of other sites. Existing user-disable, deletion and credential-change invalidation rules remain. Client sites manage their own local sessions.

The switch and trust configuration are read from D1 for each request, so stale general settings in KV cannot keep issuing authorization.

## Silent authorization

prompt=none never opens interactive login. Without a usable session, it returns to the registered callback with error=login_required and state.

For iframe use, explicitly register a silent frame ancestor origin on that callback, such as https://site.example.com. It cannot include path, query, fragment or user information. This origin applies only to that validated client/callback; it does not permit embedding the entire mailbox or change mailbox API CORS.

Third-party cookie policies may prevent silent login. Keep a top-level login fallback.

## Failure handling

OAuth endpoints return raw error JSON or append error to a trusted callback; they do not use the mailbox's internal code/message/data envelope. Check the HTTP status and error.

- authorization_disabled: new authorization disabled; responds locally without arbitrary redirects.
- provider_not_ready: runtime configuration incomplete.
- invalid_client_or_redirect / invalid_client: invalid client, callback or shared secret.
- invalid_request: invalid parameters.
- invalid_grant: expired/used code, PKCE mismatch or disallowed user.
- invalid_token: missing/expired token or failed user/credential validation.
- login_required: no session for silent authorization.

Metadata remains readable when disabled and includes provider_enabled, issuer_ready, secret_ready and configuration_ready. An invalid/missing issuer is omitted along with derived endpoints; it is never inferred from the request. Readiness and explicit enablement are separate; client lists and secrets are not public.

Authorization and token responses use Cache-Control: no-store. Callback servers should not log codes, verifiers, secrets or tokens.
