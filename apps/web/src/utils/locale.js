import { shallowRef } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import enUs from 'element-plus/es/locale/lang/en'
import i18n from '@/i18n/index.js'
import { setDayjsLocale } from '@/utils/day.js'
import { setMailListLocale } from '@/utils/mail-list-time.js'
import { setRuntimeConfigLocale } from '@/utils/runtime-config.js'
import { setBrandLocale } from '@/utils/brand.js'

export const SUPPORTED_LOCALES = ['zh', 'en']
export const DEFAULT_LOCALE = 'zh'
export const LOCALE_STORAGE_KEY = 'locale_pref'

const ELEMENT_LOCALES = { zh: zhCn, en: enUs }
const HTML_LANG = { zh: 'zh-CN', en: 'en' }

// Bound by App.vue so Element Plus follows the active locale without a store dependency.
export const elLocale = shallowRef(ELEMENT_LOCALES[DEFAULT_LOCALE])

// 'zh-CN' / 'zh-Hans-CN' / 'EN-us' all reduce to their base subtag.
export function normalizeLocale(value) {
  const tag = String(value || '').trim().toLowerCase()
  if (!tag) return ''
  const base = tag.split('-')[0]
  return SUPPORTED_LOCALES.includes(base) ? base : ''
}

export function getBrowserLocale() {
  if (typeof navigator === 'undefined') return ''
  const list = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language]
  for (const tag of list) {
    const locale = normalizeLocale(tag)
    if (locale) return locale
  }
  return ''
}

export function getCachedLocale() {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return ''
  }
}

export function cacheLocale(locale) {
  try {
    const normalized = normalizeLocale(locale)
    if (normalized) localStorage.setItem(LOCALE_STORAGE_KEY, normalized)
  } catch {
    // Without storage the next cold start only loses its cached hint.
  }
}

// The account preference wins; the cache covers the signed-out pages, which cannot read it.
export function resolveLocale(serverLocale) {
  return normalizeLocale(serverLocale) || getCachedLocale() || getBrowserLocale() || DEFAULT_LOCALE
}

export function applyLocale(locale) {
  const next = normalizeLocale(locale) || DEFAULT_LOCALE
  i18n.global.locale.value = next
  elLocale.value = ELEMENT_LOCALES[next]
  setDayjsLocale(next)
  setMailListLocale(next)
  setRuntimeConfigLocale(next)
  setBrandLocale(next)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = HTML_LANG[next]
  }
  return next
}
