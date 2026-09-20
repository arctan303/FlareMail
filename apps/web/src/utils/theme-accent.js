/**
 * 主题配色管理 (Theme Accent Palette)
 * 提供包含“白灰 (Monochrome)”在内的 5 组精选配色方案，支持深浅模式智能切换与 LocalStorage 持久化。
 * 不仅改变强调色，同时联动全套画布背景 (--paper)、卡片表面 (--surface)、分割线 (--line) 等环境色。
 */

export const THEME_ACCENT_STORAGE_KEY = 'theme_accent'
export const DEFAULT_THEME_ACCENT = 'ocean'

export const THEME_ACCENTS = [
  {
    id: 'monochrome',
    nameKey: 'accentMonochrome',
    preview: {
      light: '#ffffff',
      dark: '#ffffff',
      border: '#94a3b8',
      bg: '#0f172a',
    },
    light: {
      accent: '#0f172a',
      accentHover: '#1e293b',
      accentLight: '#f1f5f9',
      accentContrast: '#ffffff',
      focusRing: 'rgba(15, 23, 42, 0.15)',
      paper: '#f8fafc',
      paperSoft: '#edf0f4',
      surface: '#ffffff',
      line: '#e2e8f0',
      lineStrong: '#cbd5e1',
    },
    dark: {
      accent: '#ffffff',
      accentHover: '#f1f5f9',
      accentLight: 'rgba(255, 255, 255, 0.08)',
      accentContrast: '#0f172a',
      focusRing: 'rgba(255, 255, 255, 0.25)',
      paper: '#0c0d10',
      paperSoft: '#181a20',
      surface: '#15171c',
      line: '#242730',
      lineStrong: '#363a46',
    },
  },
  {
    id: 'ocean',
    nameKey: 'accentOcean',
    preview: {
      light: '#1b456f',
      dark: '#4f8ff7',
    },
    light: {
      accent: '#1b456f',
      accentHover: '#143354',
      accentLight: '#eaf1f8',
      accentContrast: '#ffffff',
      focusRing: 'color-mix(in srgb, #1b456f 30%, transparent)',
      paper: '#f0f4f9',
      paperSoft: '#e7ecf3',
      surface: '#ffffff',
      line: '#e2e8f0',
      lineStrong: '#cbd5e1',
    },
    dark: {
      accent: '#4f8ff7',
      accentHover: '#6ea4f9',
      accentLight: '#16294a',
      accentContrast: '#ffffff',
      focusRing: 'color-mix(in srgb, #4f8ff7 38%, transparent)',
      paper: '#101216',
      paperSoft: '#181b22',
      surface: '#1e222b',
      line: '#292e3a',
      lineStrong: '#3b4353',
    },
  },
  {
    id: 'sage',
    nameKey: 'accentSage',
    preview: {
      light: '#15803d',
      dark: '#4ade80',
    },
    light: {
      accent: '#15803d',
      accentHover: '#166534',
      accentLight: '#f0fdf4',
      accentContrast: '#ffffff',
      focusRing: 'color-mix(in srgb, #15803d 30%, transparent)',
      paper: '#f2f6f3',
      paperSoft: '#e5eee7',
      surface: '#ffffff',
      line: '#dce5de',
      lineStrong: '#c2d2c5',
    },
    dark: {
      accent: '#4ade80',
      accentHover: '#86efac',
      accentLight: '#052e16',
      accentContrast: '#052e16',
      focusRing: 'color-mix(in srgb, #4ade80 38%, transparent)',
      paper: '#0e1511',
      paperSoft: '#141e18',
      surface: '#18241d',
      line: '#24332a',
      lineStrong: '#33473b',
    },
  },
  {
    id: 'iris',
    nameKey: 'accentIris',
    preview: {
      light: '#6366f1',
      dark: '#818cf8',
    },
    light: {
      accent: '#6366f1',
      accentHover: '#4f46e5',
      accentLight: '#eef2ff',
      accentContrast: '#ffffff',
      focusRing: 'color-mix(in srgb, #6366f1 30%, transparent)',
      paper: '#f4f4fa',
      paperSoft: '#eaeaf6',
      surface: '#ffffff',
      line: '#e1e1f0',
      lineStrong: '#cbccdf',
    },
    dark: {
      accent: '#818cf8',
      accentHover: '#a5b4fc',
      accentLight: '#1e1b4b',
      accentContrast: '#ffffff',
      focusRing: 'color-mix(in srgb, #818cf8 38%, transparent)',
      paper: '#0f0f18',
      paperSoft: '#161624',
      surface: '#1c1c2e',
      line: '#2a2a44',
      lineStrong: '#3b3b5e',
    },
  },
  {
    id: 'amber',
    nameKey: 'accentAmber',
    preview: {
      light: '#c2410c',
      dark: '#fb923c',
    },
    light: {
      accent: '#c2410c',
      accentHover: '#9a3412',
      accentLight: '#fff7ed',
      accentContrast: '#ffffff',
      focusRing: 'color-mix(in srgb, #c2410c 30%, transparent)',
      paper: '#f8f4f0',
      paperSoft: '#f0e8e2',
      surface: '#ffffff',
      line: '#e8ded6',
      lineStrong: '#d5c4b8',
    },
    dark: {
      accent: '#fb923c',
      accentHover: '#fdba74',
      accentLight: '#431407',
      accentContrast: '#ffffff',
      focusRing: 'color-mix(in srgb, #fb923c 38%, transparent)',
      paper: '#140f0c',
      paperSoft: '#1f1612',
      surface: '#261c16',
      line: '#3a2b22',
      lineStrong: '#503c2f',
    },
  },
]

export function getStoredThemeAccent() {
  try {
    const stored = localStorage.getItem(THEME_ACCENT_STORAGE_KEY)
    if (stored && THEME_ACCENTS.some(a => a.id === stored)) {
      return stored
    }
  } catch {
    // ignore
  }
  return DEFAULT_THEME_ACCENT
}

export function applyThemeAccent(accentId = null, isDark = null) {
  if (typeof document === 'undefined') return
  const id = accentId || getStoredThemeAccent()
  const accentConfig = THEME_ACCENTS.find(a => a.id === id) || THEME_ACCENTS[1]
  const root = document.documentElement

  const dark = isDark !== null ? isDark : root.classList.contains('dark')
  const palette = dark ? accentConfig.dark : accentConfig.light

  root.setAttribute('data-theme-accent', id)

  // 注入强调色及文字反差色
  root.style.setProperty('--accent', palette.accent)
  root.style.setProperty('--accent-hover', palette.accentHover)
  root.style.setProperty('--accent-light', palette.accentLight)
  root.style.setProperty('--accent-contrast', palette.accentContrast)
  root.style.setProperty('--focus-ring', palette.focusRing)
  root.style.setProperty('--el-color-primary', palette.accent)
  root.style.setProperty('--el-color-primary-text-color', palette.accentContrast)

  // 注入环境色相（画布、表面、分割线）
  if (palette.paper) root.style.setProperty('--paper', palette.paper)
  if (palette.paperSoft) root.style.setProperty('--paper-soft', palette.paperSoft)
  if (palette.surface) root.style.setProperty('--surface', palette.surface)
  if (palette.line) root.style.setProperty('--line', palette.line)
  if (palette.lineStrong) root.style.setProperty('--line-strong', palette.lineStrong)
}

export function setThemeAccent(accentId) {
  const target = THEME_ACCENTS.some(a => a.id === accentId) ? accentId : DEFAULT_THEME_ACCENT
  try {
    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, target)
  } catch {
    // ignore
  }
  applyThemeAccent(target)
}
