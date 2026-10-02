# Security

FlareMail is a private mailbox service for an administrator and invited members.

## Reporting

Report security vulnerabilities through [GitHub Private vulnerability reporting](https://github.com/arctan303/FlareMail/security/advisories). On the repository’s **Security → Advisories** page, select **Report a vulnerability** to submit privately. This entry requires private vulnerability reporting to be enabled by the maintainer; if the button is unavailable, an Issue may ask for the private channel without disclosing vulnerability details. [GitHub reporting guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)

Keep exploit details, credentials, mailbox addresses, message contents and customer data out of public Issues and Discussions.

Include the affected code version, deployment configuration names (not values), a minimal reproduction with synthetic data, the expected behavior, and the observed impact. Do not test against someone else's mailbox or deployment.

## Deployment boundaries

- Each operator owns their Cloudflare account, bindings, domains, and Secrets.
- Mail and attachments belong to their mailbox user. Public brand assets use a separate route and object prefix; the underlying R2 bucket remains private.
- Password and Google mailbox login are separate from the optional OAuth Provider.
- “Enable authorization” stops or permits new grants. Disabling it preserves client settings and does not revoke existing codes, access tokens, or downstream sessions. Existing validation and expiry still apply.
- Client removal and callback edits affect unused authorization codes through the current client checks. Existing access tokens retain their existing expiry and user-credential checks.
- Password changes atomically invalidate unused authorization codes; issuance and redemption are checked against the validated credentials. Disabling the Provider remains a separate action that preserves otherwise valid grants.
- Replacing a Google link revokes prior browser sessions except the initiating session. Database patch 326 supplies the durable revocation state required before replacing a link.
- Browser drafts belong to a stable user ID. Legacy drafts migrate only to their recorded owner; unowned legacy drafts stay hidden until explicitly claimed. Passive session expiry preserves drafts; explicit sign-out clears only that user's drafts.
- Provider configuration writes require administrator access and same-origin protection. Recent password authentication follows the administrator's shared sensitive-operation confirmation policy, which defaults to disabled. Reading the Shared Secret always requires a fresh password check.

Real deployment files, database exports, session cookies, API tokens, email bodies, and private Cloudflare identifiers must not be committed. Test configuration contains deliberately fake local credentials.

## Updates

Apply releases with the documented code/configuration/schema compatibility requirements. Back up before a database upgrade. Restoring older code alone is not a database downgrade.

Local test and build results do not replace an operator's verification of DNS, email routing, sending-domain ownership, private bucket access, and production bindings.
