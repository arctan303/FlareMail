function timeValue(message) {
  const parsed = Date.parse(message?.createTime || '')
  return Number.isFinite(parsed) ? parsed : 0
}

// Presentation only: retain the original subject on each message and in replies.
export function conversationSubject(subject) {
  const original = String(subject || '').trim()
  return stripReplySubjectPrefixes(original)
}

export function mergeConversationMessages(existing = [], incoming = [], anchor = null) {
  const byId = new Map()
  for (const message of [...existing, ...incoming, ...(anchor?.emailId ? [anchor] : [])]) {
    if (message?.emailId) byId.set(Number(message.emailId), message)
  }
  return [...byId.values()].sort((a, b) => timeValue(a) - timeValue(b) || Number(a.emailId) - Number(b.emailId))
}

export function initialExpandedIds(messages, anchorEmailId) {
  const ids = new Set()
  const latest = messages.at(-1)?.emailId
  if (latest) ids.add(Number(latest))
  return ids
}

export function createConversationRequestGate() {
  let generation = 0
  return {
    begin(anchorEmailId) {
      generation += 1
      return { generation, anchorEmailId: Number(anchorEmailId) }
    },
    isCurrent(token, anchorEmailId) {
      return token?.generation === generation && token.anchorEmailId === Number(anchorEmailId)
    },
  }
}

export function conversationSnippet(message, maxLength = 120) {
  const source = String(message?.text || '') || String(message?.content || '')
  const text = source.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength).trimEnd()}…` : compact
}

export function conversationAllowsUnread(showUnread, message) {
  return Boolean(showUnread) && Number(message?.type) === 0
}

export function conversationMemberIds(row) {
  const values = Array.isArray(row?.memberIds) ? row.memberIds : [row?.emailId]
  return [...new Set(values.map(Number).filter(Number.isSafeInteger))]
}

export function applyConversationRead(rows, emailIds) {
  const read = new Set((emailIds || []).map(Number))
  for (const row of rows || []) {
    const unreadIds = (row.unreadIds || []).map(Number).filter(id => !read.has(id))
    row.unreadIds = unreadIds
    row.unread = unreadIds.length ? 0 : 1
  }
}

export function applyReadIdsToMessages(messages, emailIds) {
  const read = new Set(Array.from(emailIds || [], Number))
  for (const message of messages || []) {
    if (read.has(Number(message?.emailId))) message.unread = 1
  }
  return messages
}
import { stripReplySubjectPrefixes } from './compose-state.js'
