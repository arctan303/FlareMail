import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { sanitizeEmailHtml } from '../src/utils/html-sanitizer.js'
import { sanitizeEmailHtml as sanitizeInboundHtml } from '../../worker/src/utils/html-sanitizer.js'

const { parseHTML, DOMParser } = createRequire(new URL('../../worker/package.json', import.meta.url))('linkedom')

function reader(html, options) {
  globalThis.DOMParser = DOMParser
  globalThis.window = { location: { origin: 'https://mail.example' } }
  try {
    return sanitizeEmailHtml(`<html><body>${html}</body></html>`, options)
  } finally {
    delete globalThis.DOMParser
    delete globalThis.window
  }
}

test('reader only exempts real private attachments after URL and key normalization', () => {
  for (const source of [
    '/api/attachment/attachments/../../../oauth/authorize',
    '/api/attachment/attachments/%2e%2e/%2e%2e/login/oauth/start',
    '/api/attachment/attachments/%2F..%2Foauth/authorize',
    '/api/attachment/attachments/%5c..%5clogin/oauth/start',
    '/api/attachment/attachments/%00bad.png',
    '/api/attachment/attachments/%zz',
    '/api/attachment/not-a-private-key',
  ]) {
    const clean = reader(`<img src="${source}">`)
    assert.equal(parseHTML(`<html><body>${clean.html}</body></html>`).document.querySelector('img').hasAttribute('src'), false, source)
  }
  const clean = reader('<p><b>Rich text</b></p><img src="/api/attachment/attachments/hash%20name.png"><img src="/api/attachment/__pages_inline_0">')
  assert.match(clean.html, /<b>Rich text<\/b>/)
  assert.equal(parseHTML(`<html><body>${clean.html}</body></html>`).document.querySelectorAll('img[src]').length, 2)
})

test('remote images require consent while mixed-case attributes and comments stay inert', () => {
  const source = '<p STYLE="background-image:url(https://tracker.example/css);color:red">Visible</p><img SRC="https://tracker.example/pixel"><!--mce:protected %3Cimg%20src%3D%22https%3A//tracker.example/hidden%22%3E-->'
  const clean = reader(source)
  assert.equal(clean.blockedRemoteImages, 1)
  assert.doesNotMatch(clean.html, /<img src=|<!--|hidden|background-image/)
  assert.match(clean.html, /data-remote-src="https:\/\/tracker.example\/pixel"/)
  const allowed = reader(clean.html, { allowRemoteImages: true })
  assert.match(allowed.html, /src="https:\/\/tracker.example\/pixel"/)
})

test('repeated inbound and reader parsing cannot expose entity-layered CSS resources', () => {
  let inbound = '<p style="color:red&#38#38#38#59background-image:u&#38#38#38#114l(https://tracker.example/css)" title="A &amp;amp;#60; B">Visible</p>'
  inbound = sanitizeInboundHtml(inbound)
  inbound = parseHTML(inbound).document.toString()
  inbound = sanitizeInboundHtml(inbound)
  const clean = reader(inbound)
  assert.doesNotMatch(clean.html, /url\(|<!--/)
  assert.match(clean.html, /Visible/)
})
