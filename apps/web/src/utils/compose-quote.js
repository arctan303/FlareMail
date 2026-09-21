export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildQuotedEmailHtml({ dateText, name, email, wroteText, contentHtml, text }, sanitizeHtml) {
  const body = contentHtml || `<pre style="font-family: inherit;word-break: break-word;white-space: pre-wrap;margin: 0">${escapeHtml(text)}</pre>`
  const quote = `
    <p><br></p>
    <div class="gmail_quote flaremail_quote" style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #64748b;">
      <div class="flaremail_quote_header" style="font-size: 12.5px; margin-bottom: 8px; color: #64748b;">
        ${escapeHtml(dateText)} ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt; ${escapeHtml(wroteText)}:
      </div>
      <blockquote class="flaremail_quote_body mceNonEditable" style="margin: 0; padding-left: 12px; border-left: 2px solid #cbd5e1; color: inherit;">
        <article>${body}</article>
      </blockquote>
    </div>`
  return sanitizeHtml(quote)
}
