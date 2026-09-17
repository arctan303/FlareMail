# FAQ

## Does the experience deliver real mail?

No. It is a static frontend with sample data and no real Worker or mail service. Refresh restores the initial data; settings are primarily for viewing.

## Is public registration available?

No. Administrators create invited members and share initial sign-in details. Google sign-in does not register mailbox accounts. [Administrator setup](/docs/en/administration)

## Can I connect Outlook or a mobile mail client?

Use the Web interface or CLI API. IMAP, POP3 and SMTP client access are not provided. Installing the PWA does not provide a complete offline mailbox or cross-device draft synchronization.

## Why can't I send or receive after adding a domain?

Adding a domain only configures the application. Receiving requires DNS and Email Routing to the Worker; sending requires domain verification and provider credentials. Test with an external mailbox and check spam. [Receiving](/docs/en/receiving) · [Sending](/docs/en/sending)

## Why can't local development receive public mail?

A local Worker has no public inbound route. Use the [simulated local mail event](/docs/en/getting-started) during development; deploy for real receiving.

## Why does Google sign-in fail?

Check configured credentials, exact redirect URLs and allowed users. Members must first sign in with a password and link their Google account. [Setup steps](/docs/en/administration)

## Do attachments require a public R2 domain?

No. The Worker authorizes attachment access and the R2 bucket stays private. R2 is optional; without its binding, KV stores objects. Switching storage does not migrate old attachments. [Configuration and storage](/docs/en/configuration)

## What should I do about a pending database upgrade?

Keep existing resources and check patches under System settings → Maintenance. Back up before upgrading; database recovery alone does not restore attachment objects. [Updates and recovery](/docs/en/updates)

## Why does some text not change with the language?

Choose Simplified Chinese or English in personal settings. Custom brand text and mail content are not automatically translated. The experience initializes from your browser language on each load: Chinese becomes Simplified Chinese, other languages use English.
