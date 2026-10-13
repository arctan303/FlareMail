const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const HIDDEN_TAGS = new Set(['script', 'style', 'title', 'template', 'noscript'])

// Summaries are text, never a DOM insertion. Scan once and stop after enough
// visible text, rather than repeatedly matching tags against the entire body.
export function mailSnippet(message, maxLength = 120) {
  const plaintext = String(message?.text || '')
  const source = plaintext || String(message?.content || '')
  const html = !plaintext
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : Infinity
  let result = '', pendingSpace = false, hiddenTag = ''

  function append(value) {
    for (const char of value) {
      if (/[\u200B-\u200F\uFEFF\u034F\u00AD]/.test(char)) continue
      if (/\s/.test(char)) {
        if (result) pendingSpace = true
        continue
      }
      if (pendingSpace) { result += ' '; pendingSpace = false }
      result += char
      if (result.length > limit) return false
    }
    return true
  }

  let position = 0
  while (position < source.length && result.length <= limit) {
    if (html && source.startsWith('<!--', position)) {
      // Both HTML comment endings are accepted by browser HTML parsers.
      let end = position + 4
      while (end < source.length && !source.startsWith('-->', end) && !source.startsWith('--!>', end)) end++
      position = end < source.length ? end + (source.startsWith('--!>', end) ? 4 : 3) : source.length
      continue
    }
    if (html && source[position] === '<' && /[A-Za-z/!?]/.test(source[position + 1] || '')) {
      let cursor = position + 1, closing = false
      if (source[cursor] === '/') { closing = true; cursor++ }
      const nameStart = cursor
      while (/[A-Za-z0-9:-]/.test(source[cursor] || '')) cursor++
      const name = source.slice(nameStart, cursor).toLowerCase()
      let quote = ''
      for (; cursor < source.length; cursor++) {
        const char = source[cursor]
        if (quote) { if (char === quote) quote = '' }
        else if (char === '"' || char === "'") quote = char
        else if (char === '>') break
      }
      position = Math.min(cursor + 1, source.length)
      if (hiddenTag) { if (closing && name === hiddenTag) hiddenTag = '' }
      else if (!closing && HIDDEN_TAGS.has(name)) hiddenTag = name
      if (result) pendingSpace = true
      continue
    }
    if (hiddenTag) { position++; continue }
    if (html && source[position] === '&') {
      // An entity has bounded syntax; never search the remaining mail for ';'.
      const match = /^&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,5});/i.exec(source.slice(position, position + 12))
      if (match) {
        const token = match[1].toLowerCase()
        let decoded = ENTITIES[token]
        if (token[0] === '#') {
          const number = token[1] === 'x' ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10)
          decoded = number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\uFFFD'
        }
        if (decoded !== undefined) { append(decoded); position += match[0].length; continue }
      }
    }
    append(source[position++])
  }
  return result.length > limit ? `${result.slice(0, limit).trimEnd()}…` : result
}
