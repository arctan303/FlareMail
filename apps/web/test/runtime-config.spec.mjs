import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRuntimePatch, currentOrigin, generateRuntimeSecret, normalizeOriginList, normalizeRuntimeConfig, setRuntimeConfigLocale } from '../src/utils/runtime-config.js'

const baseline = normalizeRuntimeConfig({ revision: 7, allowedOrigins: [], turnstile: { siteKey: 'site-key', secretConfigured: true }, oauth: { issuer: 'https://mail.example.com', secretConfigured: true } })

test('runtime patch contains only changed sections and keeps blank secrets', () => {
  const patch = buildRuntimePatch({ allowedOrigins: 'https://app.example.com\n', turnstile: { siteKey: 'site-key', secretInput: '', secretAction: 'keep' }, oauth: { issuer: 'https://mail.example.com', secretInput: '', secretAction: 'keep' } }, baseline)
  assert.deepEqual(patch, { revision: 7, allowedOrigins: ['https://app.example.com'] })
  assert.equal(JSON.stringify(patch).includes('secret'), false)
})

test('secret clear and replace carry each section primary key', () => {
  const patch = buildRuntimePatch({ allowedOrigins: [], turnstile: { siteKey: 'site-key', secretInput: '', secretAction: 'clear' }, oauth: { issuer: 'https://mail.example.com', secretInput: 'new-secret', secretAction: 'keep' } }, baseline)
  assert.deepEqual(patch, { revision: 7, turnstile: { siteKey: '', secretAction: 'clear' }, oauth: { issuer: 'https://mail.example.com', secretAction: 'replace', secret: 'new-secret' } })
})

test('origins reject paths while allowing strict HTTP or HTTPS origins', () => {
  assert.throws(() => normalizeOriginList('https://app.example.com/path'))
  assert.deepEqual(normalizeOriginList('http://app.example.com'), ['http://app.example.com'])
  assert.deepEqual(normalizeOriginList('http://127.0.0.1:5173\n'), ['http://127.0.0.1:5173'])
})

test('malformed runtime response is rejected without a saveable empty draft', () => {
  assert.equal(normalizeRuntimeConfig(null), null)
  assert.equal(normalizeRuntimeConfig({ revision: 1, allowedOrigins: ['https://good.example'] }), null)
  assert.equal(normalizeRuntimeConfig({ revision: 1, allowedOrigins: [], turnstile: { siteKey: '', secretConfigured: false }, oauth: { issuer: 'http://localhost:8787', secretConfigured: false } }), null)
  assert.equal(normalizeRuntimeConfig({ revision: 1, allowedOrigins: [], turnstile: { siteKey: '', secretConfigured: false }, oauth: { issuer: '', secretConfigured: false } }).oauth.issuer, '')
})

test('issuer suggestion is a normalized current origin and secrets are random', () => {
  assert.equal(currentOrigin({ protocol: 'https:', host: 'mail.example.com' }), 'https://mail.example.com')
  const secret = generateRuntimeSecret(32)
  assert.match(secret, /^[0-9a-f]{64}$/)
})
function catchError(fn) {
  try { fn() } catch (error) { return error }
  throw new Error('expected the call to throw')
}

test('validation messages follow the locale set by the app', () => {
  // This module is unit-tested without bundler aliases, so it carries its own message
  // table; the setter is what keeps it in step with the interface language.
  const chinese = /[\u4e00-\u9fff]/
  try {
    setRuntimeConfigLocale('zh')
    assert.match(catchError(() => normalizeOriginList('https://app.example.com/path')).message, chinese)
    assert.equal(
      catchError(() => normalizeOriginList('https://app.example.com\nhttps://app.example.com')).message,
      '额外来源重复：https://app.example.com',
    )

    setRuntimeConfigLocale('en')
    assert.doesNotMatch(catchError(() => normalizeOriginList('https://app.example.com/path')).message, chinese)
    assert.equal(
      catchError(() => normalizeOriginList('https://app.example.com\nhttps://app.example.com')).message,
      'Duplicate extra origin: https://app.example.com',
    )
    assert.equal(
      catchError(() => normalizeOriginList('not a url')).message,
      'Enter a strict origin (for example https://mail.example.com).',
    )
  } finally {
    setRuntimeConfigLocale('zh')
  }
})

test('an unsupported locale falls back instead of leaving messages undefined', () => {
  setRuntimeConfigLocale('de')
  assert.match(catchError(() => normalizeOriginList('https://app.example.com/path')).message, /[\u4e00-\u9fff]/)
  setRuntimeConfigLocale('zh')
})
