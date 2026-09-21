import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQuotedEmailHtml, escapeHtml } from '../src/utils/compose-quote.js'

test('quoted reply and forward metadata and plaintext are escaped as text', () => {
  const output = buildQuotedEmailHtml({
    dateText: '<img src=x>',
    name: '<img src="https://tracker.example/pixel">',
    email: 'attacker@example.com"><svg/onload=alert(1)>',
    wroteText: 'wrote',
    contentHtml: '',
    text: '<img src="https://tracker.example/plain"> & private',
  }, html => html)

  assert.doesNotMatch(output, /<img/i)
  assert.doesNotMatch(output, /<svg/i)
  assert.match(output, /&lt;img src=&quot;https:\/\/tracker\.example\/plain&quot;&gt; &amp; private/)
  assert.equal(escapeHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;')
})

test('quoted rich content is emitted only from the remote-image-blocking sanitizer result', () => {
  let received = ''
  const output = buildQuotedEmailHtml({
    dateText: 'today', name: 'Sender', email: 'sender@example.com', wroteText: 'wrote',
    contentHtml: '<p>hello<img src="https://tracker.example/pixel"><img src="/api/attachment/attachments/local.png"></p>',
    text: '',
  }, html => {
    received = html
    return html.replace('src="https://tracker.example/pixel"', 'data-remote-src="https://tracker.example/pixel"')
  })

  assert.match(received, /src="https:\/\/tracker\.example\/pixel"/)
  assert.doesNotMatch(output, /<img\s+src="https:\/\/tracker\.example\/pixel"/)
  assert.match(output, /data-remote-src="https:\/\/tracker\.example\/pixel"/)
  assert.match(output, /src="\/api\/attachment\/attachments\/local\.png"/)
})
