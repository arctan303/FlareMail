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
- Provider configuration writes require administrator access, same-origin protection, and recent password authentication.

Real deployment files, database exports, session cookies, API tokens, email bodies, and private Cloudflare identifiers must not be committed. Test configuration contains deliberately fake local credentials.

## Updates

Apply releases with the documented code/configuration/schema compatibility requirements. Back up before a database upgrade. Restoring older code alone is not a database downgrade.

Local test and build results do not replace an operator's verification of DNS, email routing, sending-domain ownership, private bucket access, and production bindings.
