import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { sanitizeEmailHtml } from '../src/utils/html-sanitizer.js'
import { sanitizeEmailHtml as sanitizeInboundHtml } from '../../worker/src/utils/html-sanitizer.js'

const { parseHTML, DOMParser } = createRequire(new URL('../../worker/package.json', import.meta.url))('linkedom')
const urlAt = length => 'https://example.test/' + 'x'.repeat(length - 'https://example.test/'.length)
const row = (cells = 1, text = 'Cell') => `<tr>${`<td>${text}</td>`.repeat(cells)}</tr>`
const table = body => `<table>${body}</table>`

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

const cleanDocument = html => parseHTML(`<html><body>${reader(html).html}</body></html>`).document

test('reader retains 8192-character links but removes the click at 8193 and after URL expansion', () => {
  for (const length of [8192, 8193]) {
    const clean = cleanDocument(`<a href="  ${urlAt(length)}  "><b>Readable</b></a>`)
    assert.equal(clean.querySelector('a').hasAttribute('href'), length === 8192)
    assert.equal(clean.querySelector('a').textContent, 'Readable')
    assert.ok(clean.querySelector('b'))
  }
  const prefix = 'https://example.test/'
  const decoded = prefix + '&#120;'.repeat(8192 - prefix.length)
  assert.equal(cleanDocument(`<a href="${decoded}">Decoded</a>`).querySelector('a').getAttribute('href'), urlAt(8192))
  const unicode = prefix + 'é'.repeat(1400)
  assert.ok(unicode.length < 8192 && new URL(unicode).toString().length > 8192)
  assert.equal(cleanDocument(`<a href="${unicode}">Unicode</a>`).querySelector('a').hasAttribute('href'), false)
  const relative = '/' + 'x'.repeat(8191)
  assert.equal(cleanDocument(`<a href="${relative}">Relative expansion</a>`).querySelector('a').hasAttribute('href'), false)
  // LinkeDOM's serializer used by this fixture does not escape ampersands like
  // the native DOM serializer. Inspect its single-pass output without adding a
  // second entity-decoding fixture pass; real browser serialization is covered
  // by the native editor/reader harness.
  assert.match(reader('<a href="https://example.test/?literal=%2526amp%253B&amp;amp;">Literal</a>').html, /literal=%2526amp%253B&amp;/)
})

test('reader keeps existing relative/protocol-relative/mail links and remote image consent at long URLs', () => {
  const source = `<a href="mailto:reader@example.test">Mail</a><a href="/local">Local</a><a href="//example.test/path">Network</a><a href="javascript:alert(1)">Unsafe</a><img src="${urlAt(8193)}">`
  const blocked = reader(source)
  const clean = parseHTML(`<html><body>${blocked.html}</body></html>`).document
  assert.equal(clean.querySelectorAll('a[href]').length, 3)
  assert.equal(blocked.blockedRemoteImages, 1)
  assert.equal(clean.querySelector('img').hasAttribute('src'), false)
  assert.equal(clean.querySelector('img').getAttribute('data-remote-src').length, 8193)
  const allowed = reader(blocked.html, { allowRemoteImages: true })
  assert.equal(parseHTML(`<html><body>${allowed.html}</body></html>`).document.querySelector('img').getAttribute('src').length, 8193)
})

test('reader independently bounds 10000 expanded cells, each 100-span cell and sparse rectangles', () => {
  for (const cells of [10000, 10001]) {
    const clean = cleanDocument(table(row(cells, 'x')))
    assert.equal(!!clean.querySelector('table'), cells === 10000)
    assert.equal((clean.body.textContent.match(/x/g) || []).length, cells)
  }
  assert.ok(cleanDocument(table(row(100).repeat(100))).querySelector('table'))
  for (const tag of ['td', 'th']) {
    assert.ok(cleanDocument(table(`<tr><${tag} colspan="100" rowspan="100">Spanned</${tag}></tr>`)).querySelector(tag))
    for (const attribute of ['rowspan', 'colspan']) {
      const clean = cleanDocument(table(`<tr><${tag} ${attribute}="101">Spanned</${tag}></tr>`))
      assert.equal(clean.querySelector('table'), null)
      assert.match(clean.body.textContent, /Spanned/)
    }
  }
  const sparse = '<tr><td colspan="99" rowspan="100">Tall</td></tr><tr><td>Edge</td></tr>'
  assert.ok(cleanDocument(table(sparse)).querySelector('table'))
  assert.equal(cleanDocument(table(sparse + '<tr><td colspan="2">Beyond</td></tr>')).querySelector('table'), null)
  assert.ok(cleanDocument(table(row(100) + '<tr></tr>'.repeat(99))).querySelector('table'))
  assert.equal(cleanDocument(table(row(100) + '<tr></tr>'.repeat(100))).querySelector('table'), null)
})

test('reader budgets COL expansion and numeric-prefix spans without unbounded allocation', () => {
  assert.ok(cleanDocument(table('<colgroup><col span="101"></colgroup>' + row())).querySelector('table'))
  assert.ok(cleanDocument(table('<col span="10000">' + row())).querySelector('table'))
  for (const source of ['<col span="10001">' + row(), '<col span="10000">' + row().repeat(2), '<col span="5000"><col span="5001">' + row()]) {
    assert.equal(cleanDocument(table(source)).querySelector('table'), null)
  }
  for (const span of ['100suffix', '+100suffix', '0100', '1e999', '-101', 'Infinity', 'not-a-number']) {
    assert.ok(cleanDocument(table(`<tr><td colspan="${span}">Kept</td></tr>`)).querySelector('table'), span)
  }
  for (const span of ['101suffix', '+101suffix', '0101', '9'.repeat(400)]) {
    assert.equal(cleanDocument(table(`<tr><td colspan="${span}">Kept</td></tr>`)).querySelector('table'), null, span)
  }
})

test('reader applies rowspan zero to remaining rows in the same group and separate nested budgets', () => {
  const first = '<tr><td rowspan="0">Group</td><td>First</td></tr>'
  assert.ok(cleanDocument(table(`<tbody>${first}${row().repeat(99)}</tbody><tbody>${row().repeat(101)}</tbody>`)).querySelector('table'))
  assert.equal(cleanDocument(table(`<tbody>${first}${row().repeat(100)}</tbody>`)).querySelector('table'), null)
  assert.ok(cleanDocument(table(`<tbody>${row().repeat(101)}${first}</tbody>`)).querySelector('table'))
  assert.equal(cleanDocument(table(`<tr><td>Outer${table(row(10000, 'n'))}</td></tr>`)).querySelectorAll('table').length, 2)
  assert.equal(cleanDocument(table(`<tr><td>Outer${table(row(10001, 'n'))}</td></tr>`)).querySelectorAll('table').length, 1)
})

test('overbudget reader tables become inert readable text, preserving caption/cell/row/nested separators', () => {
  const source = table('<caption>Caption &lt;img src=x&gt;</caption><tr><td colspan="101">One<a href="https://example.test">Link</a><script>Forbidden</script><img src="https://tracker.test/x" alt="Alternative">' + table(row(1, 'Nested')) + 'Tail</td><td>Two<br>End</td></tr>')
  const result = reader(source)
  const clean = parseHTML(`<html><body>${result.html}</body></html>`).document
  assert.equal(clean.querySelector('table, a, img, script'), null)
  assert.match(clean.querySelector('pre').getAttribute('style'), /white-space:\s*pre-wrap/)
  assert.match(clean.body.textContent, /Caption <img src=x>\n/)
  assert.match(clean.body.textContent, /OneLinkAlternative\nNested\n/)
  assert.match(clean.body.textContent, /Tail\tTwo\nEnd\n/)
  assert.doesNotMatch(clean.body.textContent, /Forbidden/)
  assert.equal(result.blockedRemoteImages, 0)
  const repeated = reader(sanitizeInboundHtml(source))
  assert.equal(parseHTML(`<html><body>${repeated.html}</body></html>`).document.querySelector('table, a, img, script'), null)
  assert.match(repeated.html, /&lt;img src=x&gt;/)
})
