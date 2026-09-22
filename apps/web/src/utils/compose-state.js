function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

const REPLY_SUBJECT_PREFIX = /^(?:(?:re(?:\[\d+\])?|回复|回覆|答复)\s*[:：]\s*)+/i

export function stripReplySubjectPrefixes(subject) {
  const original = String(subject || '').trim()
  return original.replace(REPLY_SUBJECT_PREFIX, '').trim()
}

export function normalizeReplySubject(subject) {
  return `Re: ${stripReplySubjectPrefixes(subject)}`
}

export function htmlToPlainText(html) {
  const source = String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:div|p|li|blockquote|article|h[1-6])\s*>/gi, '\n')

  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(source, 'text/html')
    return (document.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  }

  return decodeHtmlEntities(source.replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function editorSnapshot(editor, previous = {}) {
  const content = editor?.getContent?.() ?? previous.content ?? ''
  return { content, text: htmlToPlainText(content) }
}

export function replyRecipients(replyTo, fallbackAddress) {
  const values = Array.isArray(replyTo) ? replyTo : []
  const addresses = values
    .map(value => typeof value === 'string' ? value : value?.address)
    .map(value => String(value || '').trim())
    .filter(Boolean)
  return [...new Set(addresses.length > 0 ? addresses : [String(fallbackAddress || '').trim()].filter(Boolean))]
}

export function sentRecipients(recipient) {
  let values = recipient
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values)
    } catch {
      values = [values]
    }
  }
  if (!Array.isArray(values)) values = []
  return [...new Set(values
    .map(value => typeof value === 'string' ? value : value?.address)
    .map(value => String(value || '').trim())
    .filter(Boolean))]
}

export function replyContext(email, accounts) {
  const sent = Number(email?.type) === 1
  const sentTo = sentRecipients(email?.recipient)
  const recipients = sent
    ? (sentTo.length > 0 ? sentTo : replyRecipients([], email?.toEmail))
    : replyRecipients(email?.replyTo, email?.sendEmail)
  const account = findComposeAccount(accounts, {
    email: sent ? email?.sendEmail : email?.toEmail,
    accountId: sent ? email?.accountId : undefined,
  }) || accounts?.[0] || null
  return { recipients, account }
}

export function findComposeAccount(accounts, { email, accountId } = {}) {
  const list = Array.isArray(accounts) ? accounts : []
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedId = accountId == null ? '' : String(accountId)
  return list.find(account => (
    normalizedId && String(account?.accountId) === normalizedId
  ) || (
    normalizedEmail && String(account?.email || '').toLowerCase() === normalizedEmail
  )) || null
}

export function createComposeLoadGate() {
  let generation = 0
  return {
    begin() {
      generation += 1
      return generation
    },
    isCurrent(token) {
      return token === generation
    },
  }
}
