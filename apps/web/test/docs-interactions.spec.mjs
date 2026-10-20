import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, compileScript } from 'vue/compiler-sfc';
import { ref, reactive, computed, nextTick, watch, markRaw } from 'vue';
import { renderMarkdown } from '../src/playground/markdown.js';
import { buildDocSearchIndex, searchDocs } from '../src/playground/docs-search.js';

// Run the component's actual setup, with navigation and browser boundaries
// controlled. The handlers and indexing implementation are not duplicated here.
async function mountDocs() {
  const source = await readFile(new URL('../src/playground/Docs.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const { scriptSetupAst } = compileScript(descriptor, { id: 'docs-interaction-test' });
  let script = descriptor.scriptSetup.content;
  for (const node of [...scriptSetupAst].reverse()) if (node.type === 'ImportDeclaration') script = script.slice(0, node.start) + script.slice(node.end);
  const route = reactive({ params: { lang: 'en', slug: 'first' }, query: {}, hash: '', fullPath: '/docs/en/first' });
  const mounted = [], unmounted = [], navigation = [], copied = [];
  const document = { activeElement: null, getElementById: () => null };
  const control = name => markRaw({ name, disabled: false, isConnected: true, focus() { document.activeElement = this; } });
  const opener = control('opener'), input = control('input'), close = control('close');
  opener.focus();
  const noOp = () => {};
  const env = {
    computed, ref, nextTick, watch,
    onMounted: callback => mounted.push(callback), onBeforeUnmount: callback => unmounted.push(callback),
    useRoute: () => route, useRouter: () => ({ push: value => navigation.push(value), replace: value => navigation.push(value) }),
    useSettingStore: () => ({ settings: {}, setLang: noOp }), useUiStore: () => ({ dark: false }),
    normalizeBrand: () => ({ title: 'FlareMail', logoUrl: '/logo.png' }), setThemeMode: noOp, applyBrandToDocument: noOp,
    DOC_GROUPS: [], DOC_ITEMS: [{ slug: 'first', en: 'First', group: { en: 'Group' } }, { slug: 'second', en: 'Second', group: { en: 'Group' } }],
    getDoc: (_lang, slug) => '# ' + slug + '\n\n## Section\n\nneedle content', renderMarkdown, buildDocSearchIndex, searchDocs,
    applyMetadata: noOp, docMetadata: noOp, previewMetadata: noOp, PUBLIC_ORIGIN: 'https://example.org',
    normalizeInstanceOrigin: () => '', personalizeCliDocs: text => text, CLI_EXAMPLE_ORIGIN: 'https://mail.example.org',
    document, window: { addEventListener: noOp, removeEventListener: noOp }, CSS: { escape: value => value },
    navigator: { clipboard: { writeText: async text => copied.push(text) } },
    ElMessage: { success: noOp, warning: noOp }, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame: noOp,
  };
  const api = new Function(...Object.keys(env), `${script}\nreturn { searchOpen, searchQuery, searchInputRef, searchDialogRef, selectedResultIndex, searchResults, openSearch, closeSearch, handleSearchKeydown, handleGlobalKeydown, navigateResults, goToResult, syncArticleScroll, reading, activeHeadingId, handleArticleClick };`)(...Object.values(env));
  api.searchInputRef.value = input;
  api.searchDialogRef.value = { querySelectorAll: () => [input, close], contains: element => [input, close].includes(element), querySelector: () => null };
  await nextTick();
  return { ...api, route, document, opener, input, close, navigation, copied, mounted, unmounted, control };
}

function key(key, shiftKey = false) {
  return { key, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
}

test('search focuses its input, traps Tab both ways and Escape restores the invoking control', async () => {
  const docs = await mountDocs();
  docs.openSearch();
  await nextTick();
  assert.equal(docs.searchOpen.value, true);
  assert.equal(docs.document.activeElement, docs.input);
  const backwards = key('Tab', true);
  docs.handleSearchKeydown(backwards);
  assert.equal(backwards.prevented, true);
  assert.equal(docs.document.activeElement, docs.close);
  const forwards = key('Tab');
  docs.handleSearchKeydown(forwards);
  assert.equal(forwards.prevented, true);
  assert.equal(docs.document.activeElement, docs.input);
  docs.searchQuery.value = 'needle';
  const escape = key('Escape');
  docs.handleSearchKeydown(escape);
  await nextTick();
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(docs.searchOpen.value, false);
  assert.equal(docs.searchQuery.value, '');
  assert.equal(docs.document.activeElement, docs.opener);
});

test('keyboard result selection scrolls into view and navigates to its matching rendered section', async () => {
  const docs = await mountDocs();
  docs.searchQuery.value = 'needle';
  await nextTick();
  const scrolled = [];
  const result = docs.control('result');
  result.scrollIntoView = options => scrolled.push(options);
  docs.searchDialogRef.value.querySelector = () => result;
  docs.navigateResults(1, true);
  assert.equal(docs.selectedResultIndex.value, 1);
  assert.equal(docs.document.activeElement, result);
  assert.deepEqual(scrolled, [{ block: 'nearest' }]);
  const selected = docs.searchResults.value[1];
  docs.goToResult(selected);
  assert.deepEqual(docs.navigation[0], { name: 'docs', params: { lang: 'en', slug: 'second' }, query: {}, hash: '#section-1' });
});

test('hash scroll waits for the article matching the new route instead of scrolling the leaving transition', async () => {
  const docs = await mountDocs();
  const scrolls = [];
  const heading = { scrollIntoView: options => scrolls.push(options) };
  const article = { dataset: { docKey: 'first-en' }, querySelector: () => heading };
  docs.reading.value = { querySelector: () => article, scrollTo: options => scrolls.push(options) };
  docs.route.params.slug = 'second';
  docs.route.hash = '#section-1';
  docs.route.fullPath = '/docs/en/second#section-1';
  await nextTick();
  assert.deepEqual(scrolls, []);
  article.dataset.docKey = 'second-en';
  docs.syncArticleScroll();
  assert.deepEqual(scrolls, [{ block: 'start' }]);
  assert.equal(docs.activeHeadingId.value, 'section-1');
});

test('copy code uses visible code text, preserving literal HTML and command quoting', async () => {
  const docs = await mountDocs();
  const original = 'curl --data \'{"text":"<span> & \\\"quoted\\\""}\'';
  const button = { closest: () => ({ querySelector: () => ({ textContent: original }) }) };
  await docs.handleArticleClick({ target: { closest: selector => selector === '[data-copy-code]' ? button : null } });
  assert.deepEqual(docs.copied, [original]);
});
