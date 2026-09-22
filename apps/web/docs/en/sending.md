# Outgoing mail

Choose an instance-wide provider under System settings → Mail delivery. New installations default to Resend; Cloudflare Email Sending is a Beta alternative. Switching preserves the other provider's configuration and never enables automatic fallback after a failure.

## Resend

1. Add a sender domain you own, such as example.com, to Resend. Configure its DNS records and wait for verification.
2. Create an API key permitted to send from that domain.
3. Select Resend under FlareMail System settings → Mail delivery. Enter the key for the matching domain, save and confirm your administrator password when prompted.
4. Compose from an address on that domain, send to your own external mailbox and confirm receipt.

Each sender domain needs valid credentials and verification. Leaving an existing secret field empty generally keeps its value rather than removing it. Keep keys out of source and documentation. Resend's test domain and recipient restrictions are not a replacement for your production domain. [Domain verification](https://resend.com/docs/dashboard/domains/introduction) · [API keys](https://resend.com/docs/dashboard/api-keys/introduction)

After an accepted send, FlareMail attempts to retrieve the actual Message-ID for subsequent replies. If the key cannot read emails or retrieval fails, the send remains accepted and the interface warns that the Message-ID was unavailable. A later reply to that sent message may not join the original conversation in external clients. This warning does not require resending the message. [Resend threading details](https://resend.com/changelog/message-id-for-sent-emails)

## Cloudflare Email Sending (Beta)

Sending to arbitrary external recipients requires Workers Paid and onboarding each sender domain in your account. Free sends to already verified destination addresses are a separate exception, rather than a general mailbox sending setup. [Pricing and requirements](https://developers.cloudflare.com/email-service/platform/pricing/)

1. Onboard your sender domain in Cloudflare Email Service → Email Sending and complete DNS verification.
2. Enable the template's commented binding in your own apps/worker/wrangler.toml:

~~~toml
[[send_email]]
name = "email"
~~~

3. Redeploy from the repository root:

~~~sh
npx --yes pnpm@10.34.5 run deploy
~~~

4. Under System settings → Mail delivery, confirm the binding is ready, select Cloudflare and save. If a schema upgrade is pending, complete it under Maintenance first.
5. Send externally and inspect the recipient's inbox, spam folder and Cloudflare sending logs.

Adding the binding alone does not select the provider. Local simulated bindings do not deliver real mail. Do not add remote = true for ordinary local testing. [Platform setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)

## Attachments and size

Application sending allows up to 10 attachments including inline images, 10 MiB per file and 20 MiB in total. The Cloudflare provider also applies a conservative 5 MiB estimate for the entire encoded message, leaving less room for attachments. Providers may impose additional quotas, recipient or content limits. [Cloudflare limits](https://developers.cloudflare.com/email-service/platform/limits/)

## Results and retries

Inspect the status and warning in Sent. Provider acceptance does not guarantee arrival in the recipient's main inbox; check spam folders or provider logs.

Correct unverified domains, invalid credentials, missing bindings, quotas or excessive size before trying again. Do not immediately resend after a timeout or unknown outcome. CLI/Agent retries of the same operation must reuse the original requestId; see [CLI / Agent](/docs/en/cli).
