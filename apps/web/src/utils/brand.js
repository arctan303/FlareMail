// The built-in sign-in copy is English by design: it is the deployer's voice, and only the
// deployer's own overrides are meant to reach visitors. cardTitle / cardSubtitle were
// Chinese by accident, which put Chinese text on an otherwise English card for every
// deployment that never customised it, so those two follow the interface language.
//
// Same shape as utils/mail-list-time.js: this module is unit-tested directly, so it keeps
// its own locale instead of importing the app's i18n instance. utils/locale.js drives it.
const LOGIN_COPY_BASE = Object.freeze({
  subtitle: 'Private mailbox',
  slogan: 'Your mail,\nunder your control.',
  quoteLead: 'A private mailbox for your domain.',
  quoteBody: 'Use your own Cloudflare account and domain for a mailbox you control.',
  sealText: 'FM',
  footerText: 'FlareMail',
  stampText: 'Private mailbox',
})

const LOGIN_COPY_LOCALIZED = Object.freeze({
  zh: Object.freeze({
    cardTitle: '登录服务',
    cardSubtitle: '轻启一扇窗，静候每封来信',
  }),
  en: Object.freeze({
    cardTitle: 'Sign in',
    cardSubtitle: 'A quiet window, awaiting every letter',
  }),
})

const FALLBACK_LOCALE = 'zh'
let activeLocale = FALLBACK_LOCALE

export function setBrandLocale(locale) {
  activeLocale = LOGIN_COPY_LOCALIZED[locale] ? locale : FALLBACK_LOCALE
}

export function defaultLoginCopy() {
  return { ...LOGIN_COPY_BASE, ...LOGIN_COPY_LOCALIZED[activeLocale] }
}

// Kept for callers that want the fallback-locale set; prefer defaultLoginCopy().
export const DEFAULT_LOGIN_COPY = Object.freeze(defaultLoginCopy())

export const DEFAULT_BRAND = Object.freeze({
  title: 'FlareMail',
  siteDescription: 'A private mailbox for your domain.',
  logoUrl: '/mail-logo.svg',
  faviconUrl: '/favicon.svg',
  loginCopy: DEFAULT_LOGIN_COPY,
  manifestUrl: '/manifest.webmanifest',
})

function textOr(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function normalizeBrand(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const rawCopy = source.loginCopy && typeof source.loginCopy === 'object' ? source.loginCopy : {}
  const defaults = defaultLoginCopy()
  const loginCopy = Object.fromEntries(Object.keys(defaults).map(key => [
    key,
    textOr(rawCopy[key], defaults[key]),
  ]))
  return {
    title: textOr(source.title, DEFAULT_BRAND.title),
    siteDescription: textOr(source.siteDescription, DEFAULT_BRAND.siteDescription),
    logoUrl: textOr(source.logoUrl, DEFAULT_BRAND.logoUrl),
    faviconUrl: textOr(source.faviconUrl, DEFAULT_BRAND.faviconUrl),
    loginCopy,
    manifestUrl: textOr(source.manifestUrl, DEFAULT_BRAND.manifestUrl),
  }
}

function faviconType(url) {
  const path = String(url || '').split('?')[0].toLowerCase()
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/svg+xml'
}

// Mirrors the locale/theme pattern: the tab title and the splash logo are painted
// before the bundle runs, so the last known brand has to be readable from storage.
export const BRAND_STORAGE_KEY = 'brand_cache'

export function getCachedBrand() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BRAND_STORAGE_KEY) || 'null')
    return parsed && typeof parsed === 'object' ? normalizeBrand(parsed) : null
  } catch {
    // A corrupt entry only costs the next cold start its head start.
    return null
  }
}

// normalizeBrand whitelists the fields, so response-only keys (turnstile site key,
// domain list) never end up in storage.
export function cacheBrand(value) {
  try {
    localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(normalizeBrand(value)))
  } catch {
    // Without storage the next cold start falls back to the default brand.
  }
}

// The splash logo is inside <body>, so the synchronous <head> script cannot reach the
// element itself. It publishes the URL as a custom property instead, which index.html's
// stylesheet reads as the background image.
function applyBrandLogoVariable(logoUrl) {
  const safe = /^(?:\/|https:\/\/)[^\s"'()\\]*$/.test(logoUrl) ? logoUrl : ''
  if (safe) {
    document.documentElement.style.setProperty('--brand-logo', `url("${safe}")`)
  } else {
    document.documentElement.style.removeProperty('--brand-logo')
  }
}

export function applyBrandToDocument(value, pageTitle = '') {
  if (typeof document === 'undefined') return normalizeBrand(value)
  const brand = normalizeBrand(value)
  document.title = pageTitle ? `${brand.title} | ${pageTitle}` : brand.title
  const description = document.querySelector('meta[name="description"]')
  if (description) description.setAttribute('content', brand.siteDescription)
  applyBrandLogoVariable(brand.logoUrl)

  const icons = Array.from(document.querySelectorAll('link[rel="icon"]'))
  if (!icons.length) {
    const created = document.createElement('link')
    created.rel = 'icon'
    document.head.appendChild(created)
    icons.push(created)
  }
  icons.forEach(icon => {
    icon.setAttribute('href', brand.faviconUrl)
    icon.setAttribute('type', faviconType(brand.faviconUrl))
  })
  return brand
}

export function pageTitle(value, page = '') {
  const brand = normalizeBrand(value)
  return page ? `${brand.title} | ${page}` : brand.title
}