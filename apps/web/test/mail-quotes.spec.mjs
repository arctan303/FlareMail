import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { collapseMailQuotes } from '../src/utils/mail-quotes.js'
import { sanitizeEmailHtml } from '../src/utils/html-sanitizer.js'
import { sanitizeEmailHtml as sanitizeInboundHtml } from '../../worker/src/utils/html-sanitizer.js'

// Reuse the workspace's MIME/HTML parser instead of adding a second DOM dependency.
const { parseHTML, DOMParser } = createRequire(new URL('../../worker/package.json', import.meta.url))('linkedom')

function body(html) {
  return parseHTML(`<html><body>${html}</body></html>`).document.body
}

test('ordinary blockquotes stay visible while explicit mail history collapses', () => {
  const content = body('<p>My reply</p><blockquote>A quotation I wrote</blockquote><div class="gmail_quote">History<blockquote>Older history</blockquote></div>')
  collapseMailQuotes(content, { label: '显示或隐藏引用内容' })
  assert.equal(content.querySelector('blockquote').classList.contains('gmail_quote_collapsed'), false)
  assert.equal(content.querySelectorAll('button').length, 1)
  assert.equal(content.querySelector('.gmail_quote').classList.contains('gmail_quote_collapsed'), true)
  const button = content.querySelector('button')
  assert.equal(button.getAttribute('aria-label'), '显示或隐藏引用内容')
  button.click()
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.equal(content.querySelector('.gmail_quote').classList.contains('gmail_quote_collapsed'), false)
  button.click()
  assert.equal(button.getAttribute('aria-expanded'), 'false')
})

test('nested FlareMail and cite histories have one usable outer toggle', () => {
  const content = body('<div class="flaremail_quote">Latest<blockquote type="cite"><div class="gmail_quote">Oldest</div></blockquote></div>')
  let toggles = 0
  collapseMailQuotes(content, { onToggle: () => toggles++ })
  assert.equal(content.querySelectorAll('button').length, 1)
  content.querySelector('button').click()
  assert.equal(content.querySelectorAll('.gmail_quote_collapsed').length, 0)
  assert.equal(toggles, 1)
  assert.match(content.textContent, /Latest.*Oldest/)
})

test('sanitization preserves cite history without preserving active content', () => {
  globalThis.DOMParser = DOMParser
  globalThis.window = { location: { origin: 'https://mail.example' } }
  try {
    const inbound = sanitizeInboundHtml('<html><body><p>Reply</p><blockquote type="cite" onclick="alert(1)"><img src="https://tracker.example/pixel">History</blockquote></body></html>')
    const result = sanitizeEmailHtml(inbound)
    assert.match(result.html, /type="cite"/)
    assert.doesNotMatch(result.html, /onclick|<img src=/)
    assert.equal(result.blockedRemoteImages, 1)
    const content = body(result.html)
    collapseMailQuotes(content)
    assert.equal(content.querySelectorAll('button').length, 1)
  } finally {
    delete globalThis.DOMParser
    delete globalThis.window
  }
})

test('ten history levels and inline responses stay intact behind a single reader toggle', () => {
  let html = '<p>Oldest message</p><blockquote>An ordinary quotation</blockquote>'
  for (let level = 0; level < 10; level++) {
    html = `<div class="gmail_quote"><p>History ${level}</p><blockquote type="cite" style="margin-left:40px">${html}</blockquote><p>Inline response ${level}</p></div>`
  }
  const content = body(`<p>Current message</p>${html}`)
  const originalText = content.textContent
  const originalQuotes = content.querySelectorAll('blockquote').length
  collapseMailQuotes(content)
  assert.equal(content.querySelectorAll('button').length, 1)
  content.querySelector('button').click()
  assert.equal(content.textContent.replace('···', ''), originalText)
  assert.equal(content.querySelectorAll('blockquote').length, originalQuotes)
  assert.equal(content.querySelectorAll('.gmail_quote_collapsed').length, 0)
})
