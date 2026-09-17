const LOCAL_HOSTS = new Set(['127.0.0.1'])

// Same shape as utils/mail-list-time.js: this module is unit-tested directly, so it
// cannot import the app's i18n instance (no bundler aliases in that context). It keeps
// its own message table plus a setter instead, and utils/locale.js drives the setter.
const MESSAGES = {
  zh: {
    strictOriginRequired: '请输入严格的 origin（例如 https://mail.example.com）。',
    invalidOrigin: '请输入有效的 origin。',
    originExtras: 'Origin 不能包含路径、查询、片段或用户信息。',
    originHttps: '生产 origin 必须使用 HTTPS。',
    duplicateOrigin: '额外来源重复：{origin}',
    tooManyOrigins: '额外来源最多 32 个。',
    insecureRandom: '当前浏览器不支持安全随机数。',
  },
  en: {
    strictOriginRequired: 'Enter a strict origin (for example https://mail.example.com).',
    invalidOrigin: 'Enter a valid origin.',
    originExtras: 'An origin cannot contain a path, query, fragment or user information.',
    originHttps: 'A production origin must use HTTPS.',
    duplicateOrigin: 'Duplicate extra origin: {origin}',
    tooManyOrigins: 'At most 32 extra origins.',
    insecureRandom: 'This browser does not support secure random numbers.',
  },
}

const FALLBACK_LOCALE = 'zh'
let activeLocale = FALLBACK_LOCALE

export function setRuntimeConfigLocale(locale) {
  activeLocale = MESSAGES[locale] ? locale : FALLBACK_LOCALE
}

function message(key, values) {
  const table = MESSAGES[activeLocale] || MESSAGES[FALLBACK_LOCALE]
  const text = table[key] || MESSAGES[FALLBACK_LOCALE][key]
  return values
    ? text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
    : text
}

function sourceObject(value) {
  return value?.data && typeof value.data === 'object' ? value.data : value
}

export function normalizeStrictOrigin(value, { allowEmpty = false, issuer = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text && allowEmpty) return ''
  if (!text || /\s/.test(text)) throw new Error(message('strictOriginRequired'))
  let parsed
  try { parsed = new URL(text) } catch { throw new Error(message('invalidOrigin')) }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error(message('originExtras'))
  if (issuer && parsed.protocol !== 'https:' && !LOCAL_HOSTS.has(parsed.hostname)) throw new Error(message('originHttps'))
  return parsed.origin
}

export function normalizeOriginList(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/)
  const origins = []
  const seen = new Set()
  for (const item of values) {
    const text = String(item ?? '').trim()
    if (!text) continue
    const origin = normalizeStrictOrigin(text)
    if (seen.has(origin)) throw new Error(message('duplicateOrigin', { origin }))
    seen.add(origin)
    origins.push(origin)
  }
  if (origins.length > 32) throw new Error(message('tooManyOrigins'))
  return origins
}

export function normalizeRuntimeConfig(value) {
  const source = sourceObject(value)
  if (!source || typeof source !== 'object' || Array.isArray(source) || !Number.isSafeInteger(source.revision) || source.revision < 0 || !Array.isArray(source.allowedOrigins)) return null
  const turnstile = source.turnstile
  const oauth = source.oauth
  if (!turnstile || typeof turnstile !== 'object' || Array.isArray(turnstile) || typeof turnstile.siteKey !== 'string' || typeof turnstile.secretConfigured !== 'boolean' || !oauth || typeof oauth !== 'object' || Array.isArray(oauth) || typeof oauth.issuer !== 'string' || typeof oauth.secretConfigured !== 'boolean') return null
  try {
    return { revision: source.revision, allowedOrigins: normalizeOriginList(source.allowedOrigins), turnstile: { siteKey: turnstile.siteKey, secretConfigured: turnstile.secretConfigured }, oauth: { issuer: normalizeStrictOrigin(oauth.issuer, { allowEmpty: true, issuer: true }), secretConfigured: oauth.secretConfigured } }
  } catch { return null }
}

function sameList(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

export function buildRuntimePatch(draft, baseline) {
  if (!draft || !baseline) return null
  const payload = { revision: baseline.revision }
  let changed = false
  const allowedOrigins = normalizeOriginList(draft.allowedOrigins)
  if (!sameList(allowedOrigins, baseline.allowedOrigins)) { payload.allowedOrigins = allowedOrigins; changed = true }
  const turnstile = {}
  const siteKey = String(draft.turnstile?.siteKey ?? '').trim()
  if (siteKey !== baseline.turnstile.siteKey) turnstile.siteKey = siteKey
  const turnstileSecret = String(draft.turnstile?.secretInput ?? '').trim()
  const turnstileAction = draft.turnstile?.secretAction === 'clear' ? 'clear' : turnstileSecret ? 'replace' : 'keep'
  if (turnstileAction !== 'keep' || Object.keys(turnstile).length) { turnstile.siteKey = turnstileAction === 'clear' ? '' : siteKey; turnstile.secretAction = turnstileAction; if (turnstileAction === 'replace') turnstile.secret = turnstileSecret; changed = true }
  if (Object.keys(turnstile).length) payload.turnstile = turnstile
  const oauth = {}
  const issuer = String(draft.oauth?.issuer ?? '').trim()
  if (issuer !== baseline.oauth.issuer) oauth.issuer = normalizeStrictOrigin(issuer, { allowEmpty: true, issuer: true })
  const oauthSecret = String(draft.oauth?.secretInput ?? '').trim()
  const oauthAction = draft.oauth?.secretAction === 'clear' ? 'clear' : oauthSecret ? 'replace' : 'keep'
  if (oauthAction !== 'keep' || Object.keys(oauth).length) { oauth.issuer = oauthAction === 'clear' ? '' : issuer; oauth.secretAction = oauthAction; if (oauthAction === 'replace') oauth.secret = oauthSecret; changed = true }
  if (Object.keys(oauth).length) payload.oauth = oauth
  return changed ? payload : null
}

export function currentOrigin(locationLike = globalThis.location) {
  if (!locationLike) return ''
  try { return normalizeStrictOrigin(`${locationLike.protocol}//${locationLike.host}`, { allowEmpty: true, issuer: true }) } catch { return '' }
}

export function generateRuntimeSecret(byteLength = 32) {
  if (!globalThis.crypto?.getRandomValues) throw new Error(message('insecureRandom'))
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}