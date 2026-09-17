# Incoming mail

Cloudflare Email Routing delivers messages to the FlareMail Worker, which stores them for the matching mailbox user. Registering domains or addresses in FlareMail does not create public routing rules.

## Enable routing

1. Select your email domain under Cloudflare Email Service → Email Routing and enable routing. Add the DNS records required by the dashboard.
2. In Routing Rules, create an address rule with the action that sends mail to a Worker. Select your deployed FlareMail Worker.
3. To send all aliases to the application, point Catch-all at the same Worker. Check existing address rules too, as they may route elsewhere.
4. Register the domain in FlareMail under System settings → Mail domains, and create addresses in personal settings or the user list.

DNS propagation takes time. Use records generated for your domain rather than copying another operator's MX/SPF values. If the domain already uses another mail service, review its existing MX records before changing routing. [Cloudflare routing guide](https://developers.cloudflare.com/email-service/get-started/route-emails/)

## Known and unknown addresses

Created primary and alias addresses receive their own messages. Catch-all sends messages to the Worker; it does not automatically create accounts.

System settings → Mail domains controls unknown recipients: reject, drop, or place messages in the unmatched area. Quarantine also depends on the switch for accepting unknown recipients. A normal inbox does not collect other members' mail or unmatched messages. Configure this intentionally; unknown addresses are not new members.

## Forward externally (optional)

1. Add and verify the target in Cloudflare Email Routing → Destination Addresses.
2. Save the target in FlareMail personal settings, enable forwarding and check each address's forwarding switch.
3. Send a test message from an external mailbox and check both FlareMail and the forwarding target.

Targets cannot belong to a domain managed by this instance. A forwarding failure does not mean the original message was not stored. Check target verification, switches and Worker logs first.

## Verify and troubleshoot

- Send externally to an existing address and confirm the message appears. Use the top mailbox selector to inspect an alias.
- No Worker receiving event: inspect DNS, routing status and address/Catch-all targets.
- Worker received it but Inbox is empty: check the recipient, deleted addresses, receiving switch, filters and unknown-recipient policy.
- Processing depends on Workers CPU/memory and platform message limits. Inspect Worker logs after failures rather than assuming a free plan can handle any message. [Platform limits](https://developers.cloudflare.com/email-service/platform/limits/)

Logs may contain private information. Share only redacted errors and configuration names when requesting help.
