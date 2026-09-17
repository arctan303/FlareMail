(function () {
  const root = document.documentElement;
  const metaTag = document.getElementById('theme-color-meta');
  const isMobile = !window.matchMedia('(pointer: fine) and (hover: hover)').matches;
  const lightColor = isMobile ? '#FFFFFF' : '#F7F7F8';
  const darkColor = isMobile ? '#141414' : '#000000';

  function applyTheme(theme) {
    root.setAttribute('class', theme === 'dark' ? 'dark' : '');
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    if (metaTag) metaTag.setAttribute('content', theme === 'dark' ? darkColor : lightColor);
  }

  function getThemeMode() {
    try {
      const stored = localStorage.getItem('theme_pref');
      if (stored) {
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          return stored;
        }
        const data = JSON.parse(stored);
        if (data && (data.value === 'dark' || data.value === 'light' || data.value === 'system')) {
          return data.value;
        }
        localStorage.removeItem('theme_pref');
      }
    } catch {
      localStorage.removeItem('theme_pref');
    }
    return 'system';
  }

  // Mirrors utils/locale.js. This file runs before the bundle, so it cannot import
  // it; keep the supported list and the storage key in sync with that module.
  function getLocale() {
    const supported = ['zh', 'en'];
    try {
      const stored = String(localStorage.getItem('locale_pref') || '').trim().toLowerCase();
      if (supported.includes(stored)) return stored;
    } catch {
      // Storage unavailable: fall through to the browser languages.
    }
    const list = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language];
    for (const tag of list) {
      const base = String(tag || '').trim().toLowerCase().split('-')[0];
      if (supported.includes(base)) return base;
    }
    return 'zh';
  }

  // Mirrors utils/brand.js. Same reason as getLocale(): this file runs before the
  // bundle, so it re-reads the cache the store writes instead of importing it.
  function getCachedBrand() {
    try {
      const parsed = JSON.parse(localStorage.getItem('brand_cache') || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function safeAssetUrl(value) {
    const url = typeof value === 'string' ? value.trim() : '';
    return /^(?:\/|https:\/\/)[^\s"'()\\]*$/.test(url) ? url : '';
  }

  function faviconType(url) {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    return 'image/svg+xml';
  }

  // The site name only reaches the client with /setting/websiteConfig, so without this
  // the tab and the splash logo would show the default brand until that request lands.
  function applyCachedBrand() {
    const cached = getCachedBrand();
    if (!cached) return;

    const title = typeof cached.title === 'string' && cached.title.trim() ? cached.title.trim() : '';
    if (title) document.title = title;

    const description = typeof cached.siteDescription === 'string' ? cached.siteDescription.trim() : '';
    const metaTag = document.querySelector('meta[name="description"]');
    if (description && metaTag) metaTag.setAttribute('content', description);

    const logo = safeAssetUrl(cached.logoUrl);
    if (logo) root.style.setProperty('--brand-logo', 'url("' + logo + '")');

    const favicon = safeAssetUrl(cached.faviconUrl);
    if (favicon) {
      const icons = document.querySelectorAll('link[rel="icon"]');
      for (const icon of icons) {
        icon.setAttribute('href', favicon);
        icon.setAttribute('type', faviconType(favicon));
      }
    }
  }

  const mode = getThemeMode();
  const theme = (mode === 'system')
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  applyTheme(theme);

  root.lang = getLocale() === 'en' ? 'en' : 'zh-CN';

  applyCachedBrand();
}());
