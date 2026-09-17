// The browser's preferred language determines a fresh preview session.
// All Chinese variants use Simplified Chinese; every other language uses English.
export function browserPreviewLocale(browser={}) {
  const preferred=browser.languages?.[0] || browser.language || '';
  return /^zh(?:[-_]|$)/i.test(String(preferred).trim()) ? 'zh' : 'en';
}
export function initialPreviewLocale(path='',browser={}) {
  return path.match(/^\/docs\/(zh|en)(?:\/|$)/)?.[1] || browserPreviewLocale(browser);
}
