# Receiving setup

This step brings external incoming mail into your FlareMail inbox: use Cloudflare Email Routing to seamlessly hand off incoming domain mail to your deployed Worker.

After routing reaches the Worker, mail for an existing, enabled mailbox enters its inbox if reception checks pass. Unknown addresses follow your configured policy.

> [!NOTE] Pricing and limits
> Inbound Email Routing is available on Workers Free and Paid. The inbound message limit is **25 MiB**; Worker processing still has request, CPU and memory limits, and complex messages may exceed Free limits. FlareMail also validates attachment count and total size. See [Costs & preparation](/docs/en/costs) and [platform limits](https://developers.cloudflare.com/email-service/platform/limits/).

## Prerequisites

- Your domain is active on Cloudflare DNS.
- Your FlareMail Worker is deployed (see [Deploy your mailbox](/docs/en/deployment)).
- An external email address (such as personal Gmail, Outlook, or Yahoo) for testing.

---

## Step 1: Open Cloudflare Email Routing

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Select the account, open **Compute → Email Service → Email Routing**, and select your mailbox domain (e.g. `example.com`).
3. Some dashboards still provide the domain's **Email → Email Routing** entry. Follow the navigation shown in your account. [Official setup guide](https://developers.cloudflare.com/email-service/get-started/route-emails/)

---

## Step 2: Enable Email Routing and configure DNS

If you are setting up Email Routing on this domain for the first time:

1. Select **Onboard Domain**, or **Enable Email Routing** in the older dashboard.
2. Review the MX, SPF, DKIM and other records listed for your domain. MX targets commonly include `route1.mx.cloudflare.net`; use your dashboard's exact record count, priorities and values rather than copying another domain's example.
3. Add the records as instructed and wait for activation. If SPF already exists, merge the required authorization into it instead of publishing multiple SPF records for the same hostname. Preserve authorization needed by your sending provider.

> [!WARNING] Resolving conflicting MX records
> Changing MX changes where the entire domain receives mail. If another service is in use, back up first and schedule the switch. Prepare the Worker, addresses and routing before replacing conflicting MX records as Cloudflare instructs. Mixed providers can deliver mail to the wrong service; do not delete an active mail configuration merely to try this setup.

---

## Step 3: Configure routing rules to target your Worker

Once DNS records are active, switch to the **Routing Rules** tab. This tells Cloudflare where to send incoming emails.

### Recommended approach: Configure a Catch-all rule (strongly recommended)

A Catch-all rule intercepts all incoming emails sent to your domain that don't match a specific custom rule. Once enabled, you can create new aliases and member accounts inside FlareMail **without ever needing to return to Cloudflare to add individual rules**.

1. Scroll down to the **Catch-all rule** section on the Routing Rules tab.
2. Click **Edit** on the right side.
3. **Action**: Select **Send to a Worker** from the dropdown menu.
4. **Destination Worker**: Select your deployed FlareMail Worker (typically named `flaremail`).
5. Save and ensure the Catch-all toggle switch is **Enabled**.

### Alternative approach: Custom address rules (optional)

If you prefer not to route the entire domain and only want specific addresses (e.g., `me@example.com`) handled by FlareMail:

1. Click **Create rule** in the **Custom addresses** section.
2. **Custom address**: Enter your prefix (e.g., `me`).
3. **Action**: Choose **Send to a Worker**.
4. **Destination Worker**: Select your FlareMail Worker.
5. Save and enable the rule.

---

## Step 4: Complete setup inside FlareMail

Cloudflare handles edge reception and passes the raw message to Worker; FlareMail validates recipient permissions and stores it into your database:

1. **Register the domain**:
   - Log in to your FlareMail administrator dashboard.
   - Go to **System settings → Mail domains**, click **Add domain**, and enter your domain (e.g. `example.com`).
   - Select **Unknown recipients** in its separate card in the same section. This policy applies to the entire instance:
     - *Reject*: Immediately bounces and rejects unregistered addresses.
     - *Drop*: Silently discards mail sent to unregistered addresses.
     - *Unmatched*: Temporarily stores mail in the Unmatched Mail section for review.
2. **Create your mailbox address**:
   - Add your own address under **Personal settings → Mailboxes & aliases**. Create a new member's primary mailbox from the administrator's **User list**. Confirm the intended address exists (e.g. `owner@example.com`).

---

## Step 5: Verification & troubleshooting

### 1. Send a test email

- From an **external email account** (e.g. personal Gmail), send a test email to your new FlareMail address.
- **Do not** send the test from another FlareMail address on the same instance, to avoid internal bypass delivery.
- Refresh the inbox, or use the incoming test under **System settings → Mail operations**, which provides a unique subject to verify external receipt. Delivery time depends on the external service and routing; loading the webpage alone does not verify reception.

### 2. Troubleshooting missing messages with Stream Logs

If your external email shows sent successfully but no message appears in FlareMail:

1. **Check Worker real-time logs (Stream Logs)**:
   - In Cloudflare Dashboard, go to **Workers & Pages**.
   - Select your `flaremail` Worker and open **Observability → Logs**; older dashboards may show a direct **Logs** tab.
   - Open the live stream (such as **Live / Begin real-time stream**), verify logging is enabled and remove unrelated filters.
   - Send another test email from your external account while watching the stream.
   - Diagnosing output:
     - If you see incoming `email` events, Cloudflare Email Routing successfully reached your Worker. Check the console error output (e.g. D1 database write failure, domain unregistered in settings, or dropped by unknown address policy).
     - If **no entries appear**, check logging, the time range and filters first. Missing logs alone do not prove that the Worker received no mail. Also check:
       - Whether the Catch-all rule is active and points to the right Worker;
       - Whether MX records have propagated (`nslookup -type=mx yourdomain.com`);
       - Whether your domain status on Cloudflare is still Pending or paused.
2. **Check Unmatched Mail**:
   - If mail was sent to a prefix not yet registered in FlareMail, inspect the **Unmatched Mail** table in System settings.
3. **Message size limits**:
   - Total message size (headers, body, and all attachments) must not exceed 25 MiB. Messages above this limit are rejected by Cloudflare edge. [Platform limits](https://developers.cloudflare.com/email-service/platform/limits/)

---

## Forward externally (optional)

To automatically copy or forward incoming mail to another address (e.g. personal Gmail):

1. Add and verify the destination address in Cloudflare Email Routing → **Destination Addresses**.
2. Enter the destination in **Personal settings → Mailboxes & aliases**, save, and enable forwarding for the primary mailbox or alias as appropriate.
3. Send a test message from an external account and verify it arrives in both FlareMail and the target mailbox.

Purely internal mail also follows the recipient's forwarding settings. It uses their configured sending channel and quota, sends from the receiving mailbox, sets Reply-To to the original sender, preserves body and attachments, and omits Bcc addresses. A forwarding failure preserves the internal message and displays a failure notice. External incoming mail keeps the Cloudflare Email Routing forwarding path.

> [!CAUTION] Loop protection
> Forwarding targets cannot be a domain managed by this same FlareMail instance. FlareMail includes loop prevention markers to prevent infinite bounce cycles between mail servers.
