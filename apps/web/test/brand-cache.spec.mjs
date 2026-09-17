import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  BRAND_STORAGE_KEY,
  DEFAULT_BRAND,
  cacheBrand,
  defaultLoginCopy,
  getCachedBrand,
  normalizeBrand,
  setBrandLocale,
} from '../src/utils/brand.js';

// utils/brand.js reads localStorage lazily, so a stub installed at module scope is enough.
const storage = new Map();
globalThis.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};

function reset() {
  storage.clear();
}

test('the cached brand survives a reload and keeps only brand fields', () => {
  reset();
  // /setting/websiteConfig returns far more than the brand; none of it belongs in storage.
  cacheBrand({
    title: 'Acme Mail',
    siteDescription: 'Mail for acme.example',
    logoUrl: '/api/site-assets/brand/abc/logo.png',
    faviconUrl: 'https://cdn.example/favicon-512.png',
    loginCopy: { subtitle: 'Private mailbox', slogan: 'Your mail' },
    siteKey: 'turnstile-site-key',
    domainList: ['acme.example'],
    autoRefresh: 1,
  });

  const cached = getCachedBrand();
  assert.equal(cached.title, 'Acme Mail');
  assert.equal(cached.siteDescription, 'Mail for acme.example');
  assert.equal(cached.logoUrl, '/api/site-assets/brand/abc/logo.png');
  assert.equal(cached.faviconUrl, 'https://cdn.example/favicon-512.png');
  assert.equal(cached.loginCopy.subtitle, 'Private mailbox');
  // Unset login-copy keys fall back to the defaults rather than disappearing.
  assert.equal(cached.loginCopy.cardTitle, DEFAULT_BRAND.loginCopy.cardTitle);
  assert.equal(cached.siteKey, undefined);
  assert.equal(cached.domainList, undefined);
  assert.equal(cached.autoRefresh, undefined);
  assert.deepEqual(Object.keys(cached).sort(), Object.keys(normalizeBrand({})).sort());
});

test('a missing, corrupt or non-object entry reads as "no cache" instead of throwing', () => {
  reset();
  assert.equal(getCachedBrand(), null);
  storage.set(BRAND_STORAGE_KEY, '{not json');
  assert.equal(getCachedBrand(), null);
  storage.set(BRAND_STORAGE_KEY, '"a string"');
  assert.equal(getCachedBrand(), null);
  storage.set(BRAND_STORAGE_KEY, 'null');
  assert.equal(getCachedBrand(), null);
});

test('an empty cached brand normalizes to the defaults', () => {
  reset();
  storage.set(BRAND_STORAGE_KEY, '{}');
  assert.deepEqual(getCachedBrand(), normalizeBrand({}));
});

// public/theme-init.js paints before the bundle exists, so it re-implements the cache
// read. This test is what keeps the two copies honest.
function bootWith(storedBrand) {
  const bootStorage = new Map();
  if (storedBrand !== undefined) bootStorage.set('brand_cache', storedBrand);

  const attributes = new Map();
  const iconLinks = [{ setAttribute: (k, v) => attributes.set(`icon:${k}`, v) }];
  const description = { setAttribute: (k, v) => attributes.set(`meta:${k}`, v) };
  const root = {
    style: { setProperty: (k, v) => attributes.set(`var:${k}`, v) },
    setAttribute: () => {},
  };

  const context = {
    localStorage: { getItem: key => (bootStorage.has(key) ? bootStorage.get(key) : null) },
    navigator: { languages: ['zh-CN'] },
    document: {
      documentElement: root,
      title: 'FlareMail',
      getElementById: () => null,
      querySelector: selector => (selector === 'meta[name="description"]' ? description : null),
      querySelectorAll: selector => (selector === 'link[rel="icon"]' ? iconLinks : []),
    },
    attributes,
  };
  context.window = {
    matchMedia: () => ({ matches: false }),
  };

  const source = readFileSync(fileURLToPath(new URL('../public/theme-init.js', import.meta.url)), 'utf8');
  runInNewContext(source, context);
  return context;
}

test('the pre-bundle boot script applies the cached brand before first paint', () => {
  const context = bootWith(JSON.stringify({
    title: 'Acme Mail',
    siteDescription: 'Mail for acme.example',
    logoUrl: '/api/site-assets/brand/abc/logo.png',
    faviconUrl: 'https://cdn.example/favicon-512.png',
  }));

  assert.equal(context.document.title, 'Acme Mail');
  assert.equal(context.attributes.get('meta:content'), 'Mail for acme.example');
  assert.equal(context.attributes.get('var:--brand-logo'), 'url("/api/site-assets/brand/abc/logo.png")');
  assert.equal(context.attributes.get('icon:href'), 'https://cdn.example/favicon-512.png');
  assert.equal(context.attributes.get('icon:type'), 'image/png');
});

test('the boot script leaves the static defaults alone without a cache', () => {
  for (const stored of [undefined, '{not json', '"nope"']) {
    const context = bootWith(stored);
    assert.equal(context.document.title, 'FlareMail');
    assert.equal(context.attributes.get('var:--brand-logo'), undefined);
    assert.equal(context.attributes.get('icon:href'), undefined);
  }
});

test('the boot script refuses asset URLs that cannot be safely inlined into CSS', () => {
  // localStorage is writable by anything on the origin, so the values are not trusted.
  const context = bootWith(JSON.stringify({
    title: 'Acme Mail',
    logoUrl: '"/></style><script>alert(1)</script>',
    faviconUrl: 'javascript:alert(1)',
  }));

  assert.equal(context.document.title, 'Acme Mail');
  assert.equal(context.attributes.get('var:--brand-logo'), undefined);
  assert.equal(context.attributes.get('icon:href'), undefined);
});

test('the built-in sign-in card copy follows the interface language', () => {
  // The other seven defaults stay English on purpose: the built-in copy is the deployer's
  // voice, and only these two were Chinese by accident.
  try {
    setBrandLocale('en')
    const english = defaultLoginCopy()
    assert.equal(english.cardTitle, 'Sign in')
    assert.doesNotMatch(english.cardSubtitle, /[\u4e00-\u9fff]/)
    assert.equal(english.subtitle, 'Private mailbox')

    setBrandLocale('zh')
    const chinese = defaultLoginCopy()
    assert.equal(chinese.cardTitle, '登录服务')
    assert.equal(chinese.cardSubtitle, '轻启一扇窗，静候每封来信')
    // Only the two localised fields differ.
    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort())
    for (const key of Object.keys(chinese)) {
      if (!['cardTitle', 'cardSubtitle'].includes(key)) assert.equal(chinese[key], english[key], key)
    }
  } finally {
    setBrandLocale('zh')
  }
})

test('an unsupported locale falls back instead of leaving copy undefined', () => {
  setBrandLocale('de')
  assert.equal(defaultLoginCopy().cardTitle, '登录服务')
  setBrandLocale('zh')
})

test('normalizeBrand fills a missing field from the active locale', () => {
  setBrandLocale('en')
  assert.equal(normalizeBrand({ loginCopy: { subtitle: 'Acme' } }).loginCopy.cardTitle, 'Sign in')
  assert.equal(normalizeBrand({ loginCopy: { subtitle: 'Acme' } }).loginCopy.subtitle, 'Acme')
  setBrandLocale('zh')
  assert.equal(normalizeBrand({}).loginCopy.cardTitle, '登录服务')
})
