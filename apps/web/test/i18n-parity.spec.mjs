import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zh from '../src/i18n/zh.js';
import en from '../src/i18n/en.js';
import { createI18n } from 'vue-i18n';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

// Matches $t('key'), t('key') and i18n.global.t('key'). The leading \b keeps
// unrelated calls such as format('x') out of the results.
const KEY_PATTERN = /\bt\(\s*'([A-Za-z][A-Za-z0-9_]*)'/g;
// <i18n-t keypath="key"> references messages without calling t().
const KEYPATH_PATTERN = /keypath="([A-Za-z][A-Za-z0-9_]*)"/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(vue|js)$/.test(entry)) out.push(full);
  }
  return out;
}

function usedKeys() {
  const keys = new Set();
  for (const file of walk(srcRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of [KEY_PATTERN, KEYPATH_PATTERN]) {
      for (const match of source.matchAll(pattern)) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

function placeholders(value) {
  return (String(value ?? '').match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join(',');
}

test('every key referenced in source exists in both locales', () => {
  const keys = usedKeys();
  const missingZh = keys.filter(key => !Object.hasOwn(zh, key));
  const missingEn = keys.filter(key => !Object.hasOwn(en, key));
  assert.deepEqual(missingZh, [], `keys missing from zh.js: ${missingZh.join(', ')}`);
  assert.deepEqual(missingEn, [], `keys missing from en.js: ${missingEn.join(', ')}`);
});

test('en.js declares no key that zh.js does not define', () => {
  const orphans = Object.keys(en).filter(key => !Object.hasOwn(zh, key)).sort();
  assert.deepEqual(orphans, [], `en-only keys: ${orphans.join(', ')}`);
});

test('both locales agree on interpolation placeholders', () => {
  const mismatched = Object.keys(en)
    .filter(key => placeholders(zh[key]) !== placeholders(en[key]))
    .sort();
  assert.deepEqual(mismatched, [], `placeholder mismatch: ${mismatched.join(', ')}`);
});

test('zh.js declares no duplicate keys that silently shadow an earlier value', () => {
  const source = readFileSync(new URL('../src/i18n/zh.js', import.meta.url), 'utf8');
  const declared = [...source.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):/gm)].map(match => match[1]);
  const duplicates = [...new Set(declared.filter((key, index) => declared.indexOf(key) !== index))].sort();
  assert.deepEqual(duplicates, [], `duplicate keys in zh.js: ${duplicates.join(', ')}`);
});

test('all message entries in zh.js and en.js compile cleanly with vue-i18n', () => {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { zh, en }
  });

  const errors = [];
  for (const [locale, messages] of [['zh', zh], ['en', en]]) {
    i18n.global.locale.value = locale;
    for (const key of Object.keys(messages)) {
      try {
        i18n.global.t(key);
      } catch (err) {
        errors.push(`[${locale}] ${key}: ${err.message}`);
      }
    }
  }
  assert.deepEqual(errors, [], `vue-i18n message compilation errors:\n${errors.join('\n')}`);
});

