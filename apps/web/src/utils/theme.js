import { useUiStore } from '@/store/ui.js'
import { applyThemeAccent } from './theme-accent.js'

export const THEME_STORAGE_KEY = 'theme_pref'
export const THEME_TTL = 365 * 24 * 60 * 60 * 1000

export function getStoredThemeMode() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (!stored) return 'system'
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored
    }
    const data = JSON.parse(stored)
    if (data && (data.value === 'dark' || data.value === 'light' || data.value === 'system')) {
      return data.value
    }
    localStorage.removeItem(THEME_STORAGE_KEY)
  } catch (e) {
    localStorage.removeItem(THEME_STORAGE_KEY)
  }
  return 'system'
}

export function hasStoredTheme() {
  return getStoredThemeMode() !== 'system'
}

export function isSystemDark() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function openDark(e) {
  const uiStore = useUiStore()
  const nextMode = uiStore.dark ? 'light' : 'dark'
  setThemeMode(nextMode, e)
}

export function setThemeMode(mode, e) {
  const isDark = mode === 'system' ? isSystemDark() : (mode === 'dark')
  const root = document.documentElement

  const doSwitch = () => {
    switchDark(isDark, root, mode)
  }

  if (e && document.startViewTransition) {
    const x = e?.clientX ?? (window.innerWidth / 2)
    const y = e?.clientY ?? 20

    const maxX = Math.max(x, window.innerWidth - x)
    const maxY = Math.max(y, window.innerHeight - y)
    const endRadius = Math.hypot(maxX, maxY)

    root.setAttribute('data-theme-to', isDark ? 'dark' : 'light')
    root.style.setProperty('--vt-x', `${x}px`)
    root.style.setProperty('--vt-y', `${y}px`)
    root.style.setProperty('--vt-end-radius', `${endRadius + 10}px`)

    const transition = document.startViewTransition(() => {
      doSwitch()
    })

    transition.finished.finally(() => {
      root.removeAttribute('data-theme-to')
    })
  } else {
    doSwitch()
  }
}

export function switchDark(nextIsDark, root = document.documentElement, mode = null) {
  const uiStore = useUiStore()
  root.setAttribute('class', nextIsDark ? 'dark' : '')
  root.style.colorScheme = nextIsDark ? 'dark' : 'light'
  const metaTag = document.getElementById('theme-color-meta')
  const isMobile = !window.matchMedia('(pointer: fine) and (hover: hover)').matches
  if (metaTag) {
    metaTag.setAttribute('content', nextIsDark ? '#000000' : (isMobile ? '#FFFFFF' : '#F7F7F8'))
  }
  if (mode) {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      value: mode,
      expires: Date.now() + THEME_TTL,
    }))
    uiStore.themeMode = mode
  }
  uiStore.dark = nextIsDark
  applyThemeAccent(null, nextIsDark)
}
