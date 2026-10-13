import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Exercise the scanner actually bundled in TinyMCE, against the previous URI
// grammar as a compatibility oracle, including empty vs undefined captures.
const vendor = readFileSync(new URL('../public/tinymce/tinymce.min.js', import.meta.url), 'utf8')
const start = vendor.indexOf('function flareMailParseUri(')
const end = vendor.indexOf('class OC{', start)
assert.ok(start > 0 && end > start)
const scan = Function(`${vendor.slice(start, end)};return flareMailParseUri`)()
const previous = /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@\/]*):?([^:@\/]*))?@)?(\[[a-zA-Z0-9:.%]+\]|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
const fields = match => match?.slice(0, 14)

test('bundled URI scanner preserves protocol, authority, directory, filename and suffix fields', () => {
  const hosts = ['https://mail.example', 'http://user:pass@mail.example:8080', '//mail.example', 'https://[::1]:123', 'https://name@mail.example', 'ftp://host', 'https://host:broken']
  const paths = ['', '/', '/folder', '/folder/', '/folder/file.txt', '/a.b/extensionless', '/.hidden', '/two.dots.txt', '/trailing.', '/a./b', '/中文/文件.txt', '/encoded%2Fpath', '/a/b/../c']
  for (const host of hosts) for (const path of paths) for (const tail of ['', '?a=1&b=2', '#part', '?x=#hash']) {
    const input = host + path + tail
    assert.deepEqual(fields(scan(input)), fields(previous.exec(input)), input)
  }
  let seed = 4102
  for (let i = 0; i < 10000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const segment = ['plain', '.hidden', 'file.txt', 'trailing.', 'a.b.c', '中文', 'a%2Fb'][seed % 7]
    const input = hosts[seed % hosts.length] + '/prefix/' + segment + ['/suffix', '/', '.png', '?q=a.b#c', '#d', ''][seed % 6]
    assert.deepEqual(fields(scan(input)), fields(previous.exec(input)), input)
  }
})

test('long extensionless paths and authorities stay usable without nested suffix scans', () => {
  for (const size of [20000, 40000, 80000]) {
    const path = `https://images.example/${'a'.repeat(size)}`
    const host = `https://${'a'.repeat(size)}.example/path`
    const first = scan(path)
    const second = scan(host)
    assert.equal(first[0], path)
    assert.equal(first[9], `/${'a'.repeat(size)}`)
    assert.equal(second[0], host)
    assert.equal(second[6], `${'a'.repeat(size)}.example`)
  }
})
