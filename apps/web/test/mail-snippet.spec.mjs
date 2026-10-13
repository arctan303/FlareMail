import test from 'node:test'
import assert from 'node:assert/strict'
import { mailSnippet } from '../src/utils/mail-snippet.js'

test('plaintext is displayed as text and takes precedence over HTML', () => {
  assert.equal(mailSnippet({ text: '<image src="private"> &amp; hello', content: '<p>different</p>' }), '<image src="private"> &amp; hello')
  assert.equal(mailSnippet({ text: '  Hello\u200b\n world  ' }), 'Hello world')
})

test('HTML summaries decode text without inserting or rewriting resource markup', () => {
  globalThis.document = { createElement: () => { throw new Error('A summary must not create active elements') } }
  try {
    for (const content of [
      '<p>Hello &amp; <b>world</b></p><image src="https://tracker.invalid/a">',
      '<!-- <img src="https://tracker.invalid/a"> --!><p>Hello &amp; world</p>',
      '<div title="<i<image src=https://tracker.invalid/a>mg>">Hello &amp; world</div>',
      '<style>body{background:url(https://tracker.invalid/a)}</style><script>ignored()</script>Hello &amp; world',
    ]) assert.equal(mailSnippet({ content }), 'Hello & world')
    assert.equal(mailSnippet({ content: '<p>&#x4f60;&#22909;&nbsp;&lt;test&gt;</p>' }), '你好 <test>')
  } finally { delete globalThis.document }
})

test('long markup and whitespace keep late visible text and short summaries bounded', () => {
  assert.equal(mailSnippet({ content: '<div title="' + 'x'.repeat(100000) + '">' + ' '.repeat(100000) + 'Hello</div>' }), 'Hello')
  assert.equal(mailSnippet({ text: 'a'.repeat(5000000) }), 'a'.repeat(120) + '…')
  assert.equal(mailSnippet({ content: '<'.repeat(5000000) }), '<'.repeat(120) + '…')
  assert.equal(mailSnippet({ content: '<p>Hello world</p>' }, 5), 'Hello…')
  assert.equal(mailSnippet({ content: '<p>Hello<br>world</p>' }, Infinity), 'Hello world')
})
