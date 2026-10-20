<template>
  <div class="docs-page">
    <header class="docs-header" :inert="searchOpen">
      <div class="docs-header-left">
        <button
          class="docs-mobile-toggle"
          type="button"
          :aria-expanded="menuOpen"
          :aria-label="en ? 'Toggle documentation directory' : '展开或收起文档目录'"
          aria-controls="docs-directory"
          @click="menuOpen = !menuOpen"
        >
          <Icon v-if="!menuOpen" icon="ic:round-list" width="20" height="20" />
          <Icon v-else icon="material-symbols-light:close-rounded" width="20" height="20" />
        </button>
        <router-link :to="docLocation('introduction')" class="docs-brand-link" :title="brand.title">
          <img class="docs-brand-logo" :src="brand.logoUrl" alt="" />
          <span class="docs-brand-text">{{ brand.title }}</span>
        </router-link>
        <span class="docs-badge">{{ en ? 'Docs' : '文档' }}</span>
      </div>

      <div class="docs-header-right">
        <!-- 快速搜索按钮 -->
        <button
          type="button"
          class="docs-search-btn"
          :title="en ? 'Search documentation (Ctrl+K)' : '搜索文档 (Ctrl+K)'"
          @click="openSearch"
        >
          <Icon icon="solar:magnifer-linear" width="15" height="15" />
          <span class="docs-search-label">{{ en ? 'Search docs...' : '搜索文档...' }}</span>
          <kbd class="docs-search-kbd">Ctrl K</kbd>
        </button>

        <div class="docs-lang-switch" :aria-label="en ? 'Language selection' : '语言选择'">
          <button
            type="button"
            class="docs-lang-btn"
            :class="{ active: !en }"
            @click="setLanguage('zh')"
          >
            中
          </button>
          <button
            type="button"
            class="docs-lang-btn"
            :class="{ active: en }"
            @click="setLanguage('en')"
          >
            EN
          </button>
        </div>

        <button
          type="button"
          class="docs-theme-btn"
          :title="en ? (ui.dark ? 'Switch to light mode' : 'Switch to dark mode') : (ui.dark ? '切换为浅色模式' : '切换为深色模式')"
          @click="toggleTheme($event)"
        >
          <Icon :icon="ui.dark ? 'mingcute:sun-fill' : 'solar:moon-linear'" width="16" height="16" />
        </button>

        <a
          href="https://github.com/arctan303/FlareMail"
          target="_blank"
          rel="noopener noreferrer"
          class="docs-github-btn"
          title="GitHub"
        >
          <Icon icon="codicon:github-inverted" width="16" height="16" />
        </a>

        <router-link to="/inbox" class="docs-mailbox-btn" :title="en ? 'Open Mailbox Demo' : '在线体验邮箱'">
          <Icon icon="solar:inbox-linear" width="15" height="15" />
          <span>{{ en ? 'Mailbox' : '体验邮箱' }}</span>
        </router-link>
      </div>
    </header>

    <div class="docs-container" :inert="searchOpen">
      <div v-if="menuOpen" class="docs-backdrop" @click="menuOpen = false"></div>
      <aside id="docs-directory" class="docs-sidebar" :class="{ open: menuOpen }">
        <nav class="docs-nav" :aria-label="en ? 'Documentation directory' : '文档目录'">
          <section v-for="group in DOC_GROUPS" :key="group.en" class="docs-group">
            <h2 class="docs-group-title">{{ group[lang] }}</h2>
            <div class="docs-group-items">
              <router-link
                v-for="item in group.items"
                :key="item.slug"
                :to="docLocation(item.slug)"
                :aria-current="slug === item.slug ? 'page' : undefined"
                :class="{ active: slug === item.slug }"
                @click="menuOpen = false"
              >
                {{ item[lang] }}
              </router-link>
            </div>
          </section>
        </nav>
      </aside>

      <main ref="reading" class="docs-reading" @scroll="handleScroll" @click="handleArticleClick">
        <div class="docs-reading-container">
          <Transition name="doc-fade" mode="out-in" @after-enter="syncArticleScroll">
            <article v-if="current && source" :key="slug + '-' + lang" :data-doc-key="slug + '-' + lang" class="docs-article">
              <p class="docs-breadcrumb">{{ en ? 'Docs' : '文档' }} <span>/</span> {{ current.group[lang] }}</p>
              <form v-if="slug === 'cli'" class="docs-instance" @submit.prevent="applyInstance">
                <label for="cli-instance">{{ en ? 'Your mailbox URL' : '你的邮箱站点地址' }}</label>
                <div class="docs-instance-row">
                  <input
                    id="cli-instance"
                    v-model="instanceInput"
                    type="url"
                    spellcheck="false"
                    autocomplete="off"
                    :placeholder="CLI_EXAMPLE_ORIGIN"
                    :aria-invalid="instanceInvalid"
                    aria-describedby="cli-instance-hint"
                  />
                  <button type="submit">{{ en ? 'Apply' : '应用' }}</button>
                </div>
                <p id="cli-instance-hint" :class="{ invalid: instanceInvalid }">
                  {{
                    instanceInvalid
                      ? (en ? 'Enter an HTTP(S) origin without a path or credentials.' : '请输入 HTTP(S) 站点地址，不包含路径或账号密码。')
                      : (instanceOrigin
                        ? (en ? 'Examples below use your mailbox address.' : '以下接口与命令已使用你的邮箱地址。')
                        : (en ? 'Using an example address. Replace it with your deployed mailbox.' : '当前使用示例地址，请填入已部署的邮箱站点。'))
                  }}
                </p>
                <code>{{ apiBaseUrl }}</code>
              </form>
              <div class="docs-body" v-html="rendered.html"></div>
              <nav class="docs-pagination" :aria-label="en ? 'Previous and next article' : '前后文档'">
                <router-link v-if="previous" :to="docLocation(previous.slug)">
                  <span>← {{ en ? 'Previous' : '上一篇' }}</span>
                  <strong>{{ previous[lang] }}</strong>
                </router-link>
                <router-link v-if="next" :to="docLocation(next.slug)" class="next">
                  <span>{{ en ? 'Next' : '下一篇' }} →</span>
                  <strong>{{ next[lang] }}</strong>
                </router-link>
              </nav>
              <footer class="docs-footer">
                <a
                  :href="'https://github.com/arctan303/FlareMail/blob/main/apps/web/docs/' + lang + '/' + slug + '.md'"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ en ? 'View source ↗' : '查看文档源文件 ↗' }}
                </a>
                <span>{{ brand.title }}</span>
              </footer>
            </article>
            <article v-else key="not-found" :data-doc-key="slug + '-' + lang" class="docs-article">
              <h1>{{ en ? 'Document not found' : '找不到这篇文档' }}</h1>
              <router-link :to="docLocation('introduction')">{{ en ? 'Back to introduction' : '返回项目介绍' }}</router-link>
            </article>
          </Transition>
          <aside v-if="tocItems.length" class="docs-toc">
            <div class="docs-toc-title">{{ en ? 'On this page' : '本页目录' }}</div>
            <nav class="docs-toc-list" :aria-label="en ? 'Table of contents' : '本页目录'">
              <a
                v-for="item in tocItems"
                :key="item.id"
                :href="'#' + item.id"
                :class="['docs-toc-link', 'depth-' + item.depth, { active: activeHeadingId === item.id }]"
                @click.prevent="scrollToHeading(item.id)"
              >
                {{ item.text }}
              </a>
            </nav>
          </aside>
        </div>
      </main>
    </div>

    <!-- 快速搜索浮层 -->
      <Transition name="search-fade">
        <div v-if="searchOpen" class="docs-search-modal" @click.self="closeSearch">
          <div ref="searchDialogRef" class="docs-search-dialog" role="dialog" aria-modal="true" :aria-label="en ? 'Search documentation' : '搜索文档'" @keydown="handleSearchKeydown">
            <div class="docs-search-bar">
              <Icon icon="solar:magnifer-linear" class="docs-search-bar-icon" width="18" height="18" />
              <input
                ref="searchInputRef"
                v-model="searchQuery"
                type="text"
                class="docs-search-input"
                :placeholder="en ? 'Search documentation...' : '搜索文档标题与内容...'"
                autocomplete="off"
                spellcheck="false"
                role="combobox"
                :aria-label="en ? 'Search documentation' : '搜索文档'"
                aria-autocomplete="list"
                aria-controls="docs-search-results"
                :aria-expanded="searchResults.length > 0"
                :aria-activedescendant="searchResults.length ? 'docs-search-result-' + selectedResultIndex : undefined"
                @keydown.down.prevent="navigateResults(1)"
                @keydown.up.prevent="navigateResults(-1)"
                @keydown.enter.prevent="selectResult"
              />
              <button
                v-if="searchQuery"
                type="button"
                class="docs-search-clear"
                :title="en ? 'Clear' : '清空'"
                @click="searchQuery = ''; searchInputRef?.focus()"
              >
                <Icon icon="material-symbols-light:close-rounded" width="16" height="16" />
              </button>
              <button type="button" class="docs-search-esc-hint" :aria-label="en ? 'Close search' : '关闭搜索'" @click="closeSearch">ESC</button>
            </div>

            <div class="docs-search-results">
              <div v-if="!searchQuery.trim()" class="docs-search-empty-prompt">
                <p>{{ en ? 'Type keywords to search across all topics and sections.' : '输入关键词，即时检索全部文档及小节。' }}</p>
                <div class="docs-search-shortcuts">
                  <span><kbd>↑</kbd> <kbd>↓</kbd> {{ en ? 'navigate' : '选择' }}</span>
                  <span><kbd>↵</kbd> {{ en ? 'select' : '打开' }}</span>
                  <span><kbd>ESC</kbd> {{ en ? 'close' : '退出' }}</span>
                </div>
              </div>

              <div v-else-if="searchResults.length === 0" class="docs-search-no-results">
                <Icon icon="solar:magnifer-linear" width="28" height="28" />
                <p>{{ en ? 'No matching documentation found.' : '未找到相关文档内容。' }}</p>
              </div>

              <ul v-else id="docs-search-results" class="docs-search-list" role="listbox" :aria-label="en ? 'Search results' : '搜索结果'">
                <li
                  v-for="(result, idx) in searchResults"
                  :key="result.key"
                  role="presentation"
                >
                  <button
                    :id="'docs-search-result-' + idx"
                    type="button"
                    role="option"
                    class="docs-search-item"
                    :class="{ active: selectedResultIndex === idx }"
                    :aria-selected="selectedResultIndex === idx"
                    @mouseenter="selectedResultIndex = idx"
                    @focus="selectedResultIndex = idx"
                    @keydown.down.prevent="navigateResults(1, true)"
                    @keydown.up.prevent="navigateResults(-1, true)"
                    @click="goToResult(result)"
                  >
                  <div class="docs-search-item-header">
                    <span class="docs-search-item-badge">{{ result.groupName }}</span>
                    <span class="docs-search-item-title">{{ result.docTitle }}</span>
                    <span v-if="result.headingText" class="docs-search-item-heading">
                      <span class="docs-search-sep">/</span>
                      {{ result.headingText }}
                    </span>
                  </div>
                  <div v-if="result.snippet" class="docs-search-item-snippet" v-html="result.snippet"></div>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Transition>
  </div>
</template>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Icon } from '@iconify/vue';
import { useSettingStore } from '@/store/setting.js';
import { useUiStore } from '@/store/ui.js';
import { setThemeMode } from '@/utils/theme.js';
import { applyBrandToDocument, normalizeBrand } from '@/utils/brand.js';
import { DOC_GROUPS, DOC_ITEMS, getDoc } from './docs.js';
import { renderMarkdown } from './markdown.js';
import { buildDocSearchIndex, searchDocs } from './docs-search.js';
import { applyMetadata, docMetadata, previewMetadata, PUBLIC_ORIGIN } from './seo.js';
import { normalizeInstanceOrigin, personalizeCliDocs, CLI_EXAMPLE_ORIGIN } from '@/utils/cli-docs.js';

const route = useRoute(), router = useRouter(), settings = useSettingStore(), ui = useUiStore();
const brand = computed(() => normalizeBrand(settings.settings));

function setLanguage(targetLang) {
  if (lang.value === targetLang) return;
  router.push({ name: 'docs', params: { lang: targetLang, slug: slug.value }, query: instanceQuery.value, hash: route.hash });
}

function toggleTheme(event) {
  setThemeMode(ui.dark ? 'light' : 'dark', event);
}

const lang = computed(() => (route.params.lang === 'en' ? 'en' : 'zh'));
const en = computed(() => lang.value === 'en');
const slug = computed(() => route.params.slug || 'introduction');
const current = computed(() => DOC_ITEMS.find((item) => item.slug === slug.value));
const index = computed(() => DOC_ITEMS.findIndex((item) => item.slug === slug.value));
const previous = computed(() => DOC_ITEMS[index.value - 1]);
const next = computed(() => (index.value >= 0 ? DOC_ITEMS[index.value + 1] : null));

const instanceOrigin = computed(() => normalizeInstanceOrigin(route.query.instance));
const instanceQuery = computed(() => (instanceOrigin.value ? { instance: instanceOrigin.value } : {}));
const instanceInput = ref('');
const instanceInvalid = ref(false);
const apiBaseUrl = computed(() => (instanceOrigin.value || CLI_EXAMPLE_ORIGIN) + '/api');

watch(
  () => route.query.instance,
  (value) => {
    instanceInput.value = typeof value === 'string' ? value : '';
    instanceInvalid.value = value !== undefined && !normalizeInstanceOrigin(value);
  },
  { immediate: true }
);

function docLocation(article) {
  return { name: 'docs', params: { lang: lang.value, slug: article }, query: instanceQuery.value };
}

function applyInstance() {
  const raw = instanceInput.value.trim();
  const origin = normalizeInstanceOrigin(raw);
  if (raw && !origin) {
    instanceInvalid.value = true;
    return;
  }
  instanceInvalid.value = false;
  router.replace({ name: 'docs', params: { lang: lang.value, slug: slug.value }, query: origin ? { instance: origin } : {}, hash: route.hash });
}

const source = computed(() => {
  const text = getDoc(lang.value, slug.value);
  return slug.value === 'cli' ? personalizeCliDocs(text, instanceOrigin.value, lang.value) : text;
});

const rendered = computed(() => renderMarkdown(source.value, lang.value));

const tocItems = computed(() => {
  if (!rendered.value?.headings) return [];
  return rendered.value.headings.filter((h) => h.depth === 2 || h.depth === 3);
});

const activeHeadingId = ref('');

function scrollToHeading(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    activeHeadingId.value = id;
    router.replace({ name: 'docs', params: { lang: lang.value, slug: slug.value }, query: instanceQuery.value, hash: '#' + id });
  }
}

let scrollTimer = null;
function handleScroll() {
  if (!reading.value || !tocItems.value.length) return;
  if (scrollTimer) return;
  scrollTimer = requestAnimationFrame(() => {
    scrollTimer = null;
    const containerTop = reading.value.getBoundingClientRect().top;
    let currentId = '';
    for (const item of tocItems.value) {
      const el = document.getElementById(item.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top - containerTop <= 90) {
          currentId = item.id;
        }
      }
    }
    if (currentId) {
      activeHeadingId.value = currentId;
    } else if (tocItems.value.length) {
      activeHeadingId.value = tocItems.value[0].id;
    }
  });
}

const menuOpen = ref(false);
const reading = ref(null);

/* 快捷搜索状态与逻辑 */
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref(null);
const searchDialogRef = ref(null);
const selectedResultIndex = ref(0);
let searchOpener = null;

function openSearch() {
  if (searchOpen.value) return;
  searchOpener = document.activeElement;
  searchOpen.value = true;
  selectedResultIndex.value = 0;
  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function closeSearch() {
  searchOpen.value = false;
  searchQuery.value = '';
  nextTick(() => {
    if (searchOpener?.isConnected) searchOpener.focus();
    searchOpener = null;
  });
}

const searchIndex = computed(() => buildDocSearchIndex(DOC_ITEMS, getDoc, lang.value));
const searchResults = computed(() => searchDocs(searchIndex.value, searchQuery.value));

watch(searchQuery, () => {
  selectedResultIndex.value = 0;
});

function navigateResults(delta, focusResult = false) {
  if (!searchResults.value.length) return;
  const len = searchResults.value.length;
  selectedResultIndex.value = (selectedResultIndex.value + delta + len) % len;
  const result = searchDialogRef.value?.querySelector('#docs-search-result-' + selectedResultIndex.value);
  result?.scrollIntoView({ block: 'nearest' });
  if (focusResult) result?.focus();
}

function handleSearchKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeSearch();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [...searchDialogRef.value.querySelectorAll('input, button, a[href], [tabindex="0"]')].filter(control => !control.disabled);
  const first = controls[0], last = controls[controls.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !searchDialogRef.value.contains(active))) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && (active === last || !searchDialogRef.value.contains(active))) {
    event.preventDefault();
    first?.focus();
  }
}

function selectResult() {
  const item = searchResults.value[selectedResultIndex.value];
  if (item) goToResult(item);
}

function goToResult(item) {
  closeSearch();
  router.push({
    name: 'docs',
    params: { lang: lang.value, slug: item.slug },
    query: instanceQuery.value,
    hash: item.headingId ? '#' + item.headingId : ''
  });
}

function handleGlobalKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (searchOpen.value) closeSearch();
    else openSearch();
  } else if (e.key === 'Escape' && searchOpen.value) {
    closeSearch();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
  nextTick(syncArticleScroll);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  if (scrollTimer) cancelAnimationFrame(scrollTimer);
});

function syncArticleScroll() {
  const article = reading.value?.querySelector('.docs-article');
  if (article?.dataset.docKey !== slug.value + '-' + lang.value) return;
  if (route.hash) {
    const id = route.hash.slice(1);
    const heading = article.querySelector('[id="' + CSS.escape(id) + '"]');
    activeHeadingId.value = heading ? id : '';
    heading?.scrollIntoView({ block: 'start' });
  } else {
    reading.value.scrollTo({ top: 0 });
    activeHeadingId.value = tocItems.value[0]?.id || '';
  }
}

watch(
  () => route.fullPath,
  async () => {
    settings.setLang(lang.value);
    menuOpen.value = false;
    applyBrandToDocument(settings.settings, (current.value?.[lang.value] || '404') + ' · ' + (en.value ? 'Docs' : '文档'));
    await nextTick();
    applyMetadata(current.value && source.value
      ? docMetadata({lang:lang.value, slug:slug.value, rendered:renderMarkdown(getDoc(lang.value, slug.value), lang.value), origin:PUBLIC_ORIGIN})
      : previewMetadata(lang.value, PUBLIC_ORIGIN), document);
    syncArticleScroll();
  },
  { immediate: true }
);

async function handleArticleClick(event) {
  const button = event.target.closest('[data-copy-code]');
  if (button) {
    const text = button.closest('.docs-code')?.querySelector('code')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      ElMessage.success(en.value ? 'Copied' : '已复制');
    } catch {
      ElMessage.warning(en.value ? 'Select and copy the code manually.' : '请选中代码手动复制。');
    }
    return;
  }
  const anchor = event.target.closest('a[href^="#"]');
  if (anchor) {
    event.preventDefault();
    router.push({ query: instanceQuery.value, hash: anchor.getAttribute('href') });
  }
}
</script>
<style>
.docs-page {
  /* 现代文档站纯净极简调色板 */
  --docs-bg: #ffffff;
  --docs-header-bg: #ffffff;
  --docs-sidebar-bg: #fafafa;
  --docs-border: #e4e4e7;
  --docs-border-subtle: #f4f4f5;
  --docs-border-strong: #d4d4d8;

  --docs-text-primary: #09090b;
  --docs-text-body: #27272a;
  --docs-text-muted: #71717a;
  --docs-text-faint: #a1a1aa;

  --docs-hover: #f4f4f5;
  --docs-active: #e4e4e7;

  --docs-code-bg: #f8fafc;
  --docs-code-header-bg: #f1f5f9;
  --docs-link: #09090b;
  --docs-link-hover: #2563eb;

  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--docs-bg);
  color: var(--docs-text-body);
  overflow: hidden;
  transition: background-color 220ms ease, color 220ms ease;
}

.dark .docs-page {
  --docs-bg: #09090b;
  --docs-header-bg: #09090b;
  --docs-sidebar-bg: #0c0c0e;
  --docs-border: #27272a;
  --docs-border-subtle: #18181b;
  --docs-border-strong: #3f3f46;

  --docs-text-primary: #fafafa;
  --docs-text-body: #d4d4d8;
  --docs-text-muted: #a1a1aa;
  --docs-text-faint: #71717a;

  --docs-hover: #18181b;
  --docs-active: #27272a;

  --docs-code-bg: #111113;
  --docs-code-header-bg: #18181b;
  --docs-link: #fafafa;
  --docs-link-hover: #60a5fa;
}

/* 顶部导航 */
.docs-header {
  height: 58px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--docs-border);
  background: var(--docs-header-bg);
  box-sizing: border-box;
  z-index: 20;
  transition: background-color 220ms ease, border-color 220ms ease;
}

.docs-header-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  margin-right: 12px;
}

.docs-mobile-toggle {
  display: none;
}

.docs-brand-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  text-decoration: none;
  color: var(--docs-text-primary);
  transition: opacity 150ms ease;
}

.docs-brand-link:hover {
  opacity: 0.88;
}

.docs-brand-logo {
  width: 30px;
  height: 30px;
  object-fit: contain;
  flex-shrink: 0;
}

.docs-brand-text {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: .02em;
  text-transform: uppercase;
  font-family: var(--font-sans);
  color: var(--docs-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 220ms ease;
}

.docs-badge {
  font-size: 11.5px;
  font-weight: 600;
  padding: 2.5px 8px;
  border-radius: 5px;
  background: var(--docs-hover);
  color: var(--docs-text-muted);
  border: 1px solid var(--docs-border);
  margin-left: 10px;
  flex-shrink: 0;
  transition: background-color 220ms ease, border-color 220ms ease, color 220ms ease;
}

.docs-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* 顶栏快速搜索触发按钮 */
.docs-search-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--docs-border);
  background: var(--docs-hover);
  color: var(--docs-text-muted);
  cursor: pointer;
  font-size: 12.5px;
  line-height: 1.2;
  transition: all 180ms ease;
}

.docs-search-btn:hover {
  border-color: var(--docs-border-strong);
  color: var(--docs-text-primary);
  background: var(--docs-bg);
}

.docs-search-kbd {
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  padding: 1.5px 5px;
  border-radius: 4px;
  border: 1px solid var(--docs-border);
  background: var(--docs-bg);
  color: var(--docs-text-muted);
}

.docs-lang-switch {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid var(--docs-border);
  background: var(--docs-hover);
  gap: 2px;
  transition: background-color 220ms ease, border-color 220ms ease;
}

.docs-lang-btn {
  border: 0;
  background: transparent;
  padding: 3px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--docs-text-muted);
  border-radius: 4px;
  cursor: pointer;
  line-height: 1.2;
  transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
}

.docs-lang-btn:hover:not(.active) {
  color: var(--docs-text-primary);
}

.docs-lang-btn.active {
  background: var(--docs-bg);
  color: var(--docs-text-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.docs-theme-btn,
.docs-github-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--docs-border);
  background: var(--docs-bg);
  color: var(--docs-text-body);
  cursor: pointer;
  text-decoration: none;
  transition: border-color 180ms ease, background-color 180ms ease, color 180ms ease;
}

.docs-theme-btn:hover,
.docs-github-btn:hover {
  border-color: var(--docs-border-strong);
  color: var(--docs-text-primary);
  background: var(--docs-hover);
}

.docs-mailbox-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--docs-border);
  background: var(--docs-bg);
  color: var(--docs-text-primary);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: all 180ms ease;
}

.docs-mailbox-btn:hover {
  background: var(--docs-hover);
  border-color: var(--docs-border-strong);
  transform: translateY(-1px);
}

/* 主结构：自适应三栏布局 */
.docs-container {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  overflow: hidden;
  position: relative;
}

/* 侧边栏（目录树） */
.docs-sidebar {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 24px 16px 36px;
  border-right: 1px solid var(--docs-border);
  background: var(--docs-sidebar-bg);
  box-sizing: border-box;
  transition: background-color 220ms ease, border-color 220ms ease;
}

.docs-nav {
  flex: 1;
}

.docs-group {
  margin-top: 24px;
}

.docs-group:first-child {
  margin-top: 0;
}

.docs-group-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  margin: 0 10px 8px;
  color: var(--docs-text-muted);
  user-select: none;
  transition: color 220ms ease;
}

.docs-group-items a {
  position: relative;
  display: block;
  margin: 2px 0;
  padding: 7px 12px;
  border-radius: 6px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--docs-text-body);
  text-decoration: none;
  transition: background-color 160ms ease, color 160ms ease, transform 160ms ease;
}

.docs-group-items a:hover {
  background: var(--docs-hover);
  color: var(--docs-text-primary);
}

.docs-group-items a.active {
  background: var(--docs-hover);
  color: var(--docs-link-hover);
  font-weight: 600;
}

/* 主流文档站经典：当前活动项左侧垂直强调色条 */
.docs-group-items a.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 2px;
  background: var(--docs-link-hover);
}

/* 正文阅读区与大纲 */
.docs-reading {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  scroll-behavior: auto;
}

.docs-reading-container {
  display: flex;
  justify-content: center;
  width: 100%;
  max-width: 1260px;
  margin: 0 auto;
  padding: 36px 40px 64px;
  box-sizing: border-box;
  gap: 48px;
}

.docs-article {
  flex: 1;
  min-width: 0;
  max-width: 820px;
}

/* 文章过渡动画 */
.doc-fade-enter-active {
  transition: opacity 180ms ease-out, transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.doc-fade-leave-active {
  transition: opacity 100ms ease-in;
}

.doc-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.doc-fade-leave-to {
  opacity: 0;
}

/* 右侧本页大纲 TOC */
.docs-toc {
  width: 220px;
  flex-shrink: 0;
  position: sticky;
  top: 36px;
  align-self: flex-start;
  max-height: calc(100vh - 90px);
  overflow-y: auto;
  padding-left: 16px;
  border-left: 1px solid var(--docs-border);
  transition: border-color 220ms ease;
}

.docs-toc-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .06em;
  color: var(--docs-text-muted);
  margin-bottom: 12px;
  text-transform: uppercase;
  user-select: none;
  transition: color 220ms ease;
}

.docs-toc-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.docs-toc-link {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--docs-text-muted);
  text-decoration: none;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 8px 4px 14px;
  border-left: 2px solid transparent;
  margin-left: -17px;
  border-radius: 0 4px 4px 0;
  transition: color 150ms ease, border-color 150ms ease;
}

.docs-toc-link.depth-3 {
  padding-left: 24px;
  font-size: 12px;
}

.docs-toc-link:hover {
  color: var(--docs-text-primary);
}

/* 主流文档 TOC 经典：活动标题左侧亮色条与品牌文字高亮 */
.docs-toc-link.active {
  color: var(--docs-link-hover);
  font-weight: 600;
  border-left-color: var(--docs-link-hover);
  background: transparent;
}

/* 面包屑 */
.docs-breadcrumb {
  margin: 0 0 24px;
  font-size: 12.5px;
  color: var(--docs-text-muted);
}

.docs-breadcrumb span {
  padding: 0 8px;
  color: var(--docs-border);
}

/* CLI 个性化实例配置卡片 */
.docs-instance {
  margin: 0 0 28px;
  padding: 16px;
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  background: var(--docs-bg);
  font-size: 13px;
  transition: background-color 220ms ease, border-color 220ms ease;
}

.docs-instance label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--docs-text-primary);
}

.docs-instance-row {
  display: flex;
  gap: 8px;
}

.docs-instance input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: var(--docs-bg);
  color: var(--docs-text-primary);
  font: inherit;
  outline: none;
}

.docs-instance input:focus {
  border-color: var(--docs-text-primary);
}

.docs-instance button {
  padding: 8px 14px;
  border: 1px solid var(--docs-border);
  border-radius: 6px;
  background: var(--docs-text-primary);
  color: var(--docs-bg);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  transition: opacity var(--duration-fast, 150ms) ease;
}

.docs-instance button:hover {
  opacity: 0.9;
}

.docs-instance p {
  margin: 8px 0;
  color: var(--docs-text-muted);
  line-height: 1.6;
  font-size: 12px;
}

.docs-instance p.invalid {
  color: var(--el-color-danger);
}

.docs-instance code {
  font-size: 12px;
  color: var(--docs-text-primary);
  background: var(--docs-hover);
  padding: 2px 6px;
  border-radius: 4px;
}

/* 正文排版 */
.docs-body {
  font-size: 15px;
  line-height: 1.85;
  color: var(--docs-text-body);
  overflow-wrap: anywhere;
}

.docs-body h1 {
  font-size: 32px;
  line-height: 1.3;
  font-weight: 750;
  color: var(--docs-text-primary);
  margin: 0 0 24px;
  letter-spacing: -.02em;
}

.docs-body h2 {
  font-size: 21px;
  line-height: 1.45;
  font-weight: 650;
  color: var(--docs-text-primary);
  margin: 40px 0 16px;
  padding-top: 16px;
  border-top: 1px solid var(--docs-border);
}

.docs-body h3 {
  font-size: 16.5px;
  line-height: 1.5;
  font-weight: 600;
  margin: 28px 0 12px;
  color: var(--docs-text-primary);
}

/* 标题悬停锚点 */
.docs-heading {
  position: relative;
}

.docs-anchor {
  position: absolute;
  left: -22px;
  top: 0;
  opacity: 0;
  color: var(--docs-link-hover) !important;
  text-decoration: none !important;
  font-weight: 600;
  padding-right: 6px;
  transition: opacity 160ms ease;
  user-select: none;
}

.docs-heading:hover .docs-anchor {
  opacity: 1;
}

.docs-body p {
  margin: 14px 0;
}

.docs-body a,
.docs-footer a {
  color: var(--docs-link-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color var(--duration-fast, 150ms) ease;
}

.docs-body a:hover,
.docs-footer a:hover {
  opacity: 0.85;
}

.docs-body li {
  margin: 6px 0;
}

.docs-body ul,
.docs-body ol {
  padding-left: 24px;
}

.docs-body blockquote {
  margin: 20px 0;
  padding: 8px 16px;
  border-left: 3px solid var(--docs-border-strong);
  background: var(--docs-code-bg);
  border-radius: 0 6px 6px 0;
  color: var(--docs-text-body);
}

.docs-body :not(pre) > code {
  font-family: var(--font-mono, monospace);
  font-size: .86em;
  border-radius: 4px;
  padding: 2px 6px;
  background: var(--docs-hover);
  border: 1px solid var(--docs-border);
  color: var(--docs-text-primary);
}

/* 现代文档 Callout (Admonition) 提示块 */
.docs-callout {
  margin: 22px 0;
  padding: 14px 18px;
  border-radius: 8px;
  border-left: 4px solid;
  font-size: 14px;
  line-height: 1.75;
}

.docs-callout-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 600;
  font-size: 14px;
}

.docs-callout-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.docs-callout-body {
  color: var(--docs-text-body);
}

.docs-callout-body p {
  margin: 8px 0;
}

.docs-callout-body p:first-child {
  margin-top: 0;
}

.docs-callout-body p:last-child {
  margin-bottom: 0;
}

.docs-callout-note,
.docs-callout-important {
  border-left-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
}
.docs-callout-note .docs-callout-header,
.docs-callout-important .docs-callout-header {
  color: #2563eb;
}

.docs-callout-tip {
  border-left-color: #10b981;
  background: rgba(16, 185, 129, 0.08);
}
.docs-callout-tip .docs-callout-header {
  color: #059669;
}

.docs-callout-warning {
  border-left-color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
}
.docs-callout-warning .docs-callout-header {
  color: #d97706;
}

.docs-callout-caution {
  border-left-color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}
.docs-callout-caution .docs-callout-header {
  color: #dc2626;
}

.dark .docs-callout-note,
.dark .docs-callout-important {
  border-left-color: #60a5fa;
  background: rgba(59, 130, 246, 0.12);
}
.dark .docs-callout-note .docs-callout-header,
.dark .docs-callout-important .docs-callout-header {
  color: #93c5fd;
}

.dark .docs-callout-tip {
  border-left-color: #34d399;
  background: rgba(16, 185, 129, 0.12);
}
.dark .docs-callout-tip .docs-callout-header {
  color: #6ee7b7;
}

.dark .docs-callout-warning {
  border-left-color: #fbbf24;
  background: rgba(245, 158, 11, 0.12);
}
.dark .docs-callout-warning .docs-callout-header {
  color: #fde68a;
}

.dark .docs-callout-caution {
  border-left-color: #f87171;
  background: rgba(239, 68, 68, 0.14);
}
.dark .docs-callout-caution .docs-callout-header {
  color: #fca5a5;
}

/* 代码块 */
.docs-code {
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 20px 0;
  background: var(--docs-code-bg);
  transition: background-color 220ms ease, border-color 220ms ease;
}

.docs-code-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  border-bottom: 1px solid var(--docs-border);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--docs-text-muted);
  background: var(--docs-code-header-bg);
  transition: background-color 220ms ease, border-color 220ms ease, color 220ms ease;
}

.docs-code button {
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--docs-text-muted);
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  transition: all var(--duration-fast, 150ms) ease;
}

.docs-code button:hover {
  background: var(--docs-hover);
  color: var(--docs-text-primary);
}

.docs-code pre {
  margin: 0;
  padding: 16px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.75;
  font-family: var(--font-mono, monospace);
  tab-size: 2;
  color: var(--docs-text-primary);
}

/* 语法高亮 */
.hl-cmd { color: #b45309; font-weight: 600; }
.hl-flag { color: #475569; }
.hl-string { color: #15803d; }
.hl-key { color: #18181b; font-weight: 600; }
.hl-number { color: #7c3aed; }
.hl-comment { color: #9ca3af; font-style: italic; }
.hl-var { color: #c026d3; }
.hl-method { color: #09090b; font-weight: 700; }
.hl-url { color: var(--docs-text-primary); text-decoration: underline; }

.dark .hl-cmd { color: #fbbf24; }
.dark .hl-flag { color: #94a3b8; }
.dark .hl-string { color: #4ade80; }
.dark .hl-key { color: #f4f4f5; }
.dark .hl-number { color: #c084fc; }
.dark .hl-comment { color: #71717a; }
.dark .hl-var { color: #f472b6; }
.dark .hl-method { color: #fafafa; }

/* 表格与分割线 */
.docs-body table {
  display: block;
  max-width: 100%;
  overflow: auto;
  border-collapse: collapse;
  margin: 20px 0;
  font-size: 13px;
  line-height: 1.7;
}

.docs-body th,
.docs-body td {
  border: 1px solid var(--docs-border);
  padding: 10px 14px;
  text-align: left;
  min-width: 90px;
}

.docs-body th {
  background: var(--docs-code-header-bg);
  font-weight: 600;
  color: var(--docs-text-primary);
}

.docs-body hr {
  border: 0;
  border-top: 1px solid var(--docs-border);
  margin: 32px 0;
}

.docs-body [id] {
  scroll-margin-top: 24px;
}

/* 底部前后翻页卡片 */
.docs-pagination {
  display: flex;
  gap: 16px;
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--docs-border);
}

.docs-pagination a {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--docs-border);
  border-radius: 8px;
  padding: 14px 18px;
  text-decoration: none;
  min-width: 0;
  transition: border-color 180ms ease, background-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
}

.docs-pagination a:hover {
  border-color: var(--docs-border-strong);
  background: var(--docs-hover);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.docs-pagination span {
  font-size: 12px;
  color: var(--docs-text-muted);
}

.docs-pagination strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--docs-text-primary);
}

.docs-pagination .next {
  text-align: right;
  margin-left: auto;
}

.docs-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--docs-text-muted);
  font-size: 12px;
  padding: 26px 0 0;
}

.docs-footer a {
  text-decoration: none;
}

.docs-backdrop {
  display: none;
}

/* 搜索浮层与模态框 */
.docs-search-modal {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  box-sizing: border-box;
}

.docs-search-dialog {
  width: 100%;
  max-width: 600px;
  margin: 0 16px;
  background: var(--docs-bg);
  border: 1px solid var(--docs-border-strong);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 70vh;
}

.docs-search-bar {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--docs-border);
  gap: 12px;
}

.docs-search-bar-icon {
  color: var(--docs-text-muted);
  flex-shrink: 0;
}

.docs-search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: 15px;
  color: var(--docs-text-primary);
  outline: none;
  font-family: inherit;
}

.docs-search-clear {
  border: 0;
  background: transparent;
  color: var(--docs-text-muted);
  cursor: pointer;
  padding: 4px;
  display: flex;
  border-radius: 4px;
}

.docs-search-clear:hover {
  color: var(--docs-text-primary);
  background: var(--docs-hover);
}

.docs-search-esc-hint {
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--docs-border);
  background: var(--docs-hover);
  color: var(--docs-text-muted);
  cursor: pointer;
}

.docs-search-results {
  overflow-y: auto;
  padding: 8px;
  flex: 1;
}

.docs-search-empty-prompt {
  padding: 36px 16px;
  text-align: center;
  color: var(--docs-text-muted);
  font-size: 13.5px;
}

.docs-search-shortcuts {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-top: 14px;
  font-size: 12px;
}

.docs-search-shortcuts kbd {
  border: 1px solid var(--docs-border);
  background: var(--docs-hover);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
}

.docs-search-no-results {
  padding: 36px 16px;
  text-align: center;
  color: var(--docs-text-muted);
  font-size: 13.5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.docs-search-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.docs-search-item {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  padding: 10px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 140ms ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.docs-search-item:hover,
.docs-search-item.active {
  background: var(--docs-hover);
}

.docs-page button:focus-visible,
.docs-page a:focus-visible,
.docs-search-input:focus-visible {
  outline: 2px solid var(--docs-link-hover);
  outline-offset: 2px;
}

.docs-search-item-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  overflow-wrap: anywhere;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--docs-text-primary);
}

.docs-search-item-badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--docs-border);
  color: var(--docs-text-muted);
}

.docs-search-item-heading {
  color: var(--docs-link-hover);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.docs-search-sep {
  color: var(--docs-text-muted);
  opacity: 0.6;
}

.docs-search-item-snippet {
  max-width: 100%;
  font-size: 12.5px;
  color: var(--docs-text-muted);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docs-search-item-snippet mark {
  background: rgba(37, 99, 235, 0.15);
  color: var(--docs-link-hover);
  font-weight: 600;
  border-radius: 2px;
  padding: 0 2px;
}

.search-fade-enter-active,
.search-fade-leave-active {
  transition: opacity 180ms ease;
}

.search-fade-enter-from,
.search-fade-leave-to {
  opacity: 0;
}

/* 响应式断点 */
@media (max-width: 1080px) {
  .docs-toc {
    display: none;
  }
  .docs-reading-container {
    padding: 32px 28px;
  }
}

@media (max-width: 767px) {
  .docs-header {
    padding: 0 14px;
  }
  .docs-header-right {
    gap: 6px;
  }
  .docs-badge {
    display: none;
  }
  .docs-mobile-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    color: var(--docs-text-primary);
    padding: 4px;
    cursor: pointer;
    margin-right: 8px;
  }
  .docs-search-label,
  .docs-search-kbd {
    display: none;
  }
  .docs-search-btn {
    padding: 6px 8px;
  }
  .docs-mailbox-btn span {
    display: none;
  }
  .docs-mailbox-btn {
    padding: 6px 9px;
  }
  .docs-github-btn {
    display: none;
  }
  .docs-container {
    display: flex;
    flex-direction: column;
  }
  .docs-backdrop {
    display: block;
    position: fixed;
    inset: 58px 0 0 0;
    z-index: 9;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
  }
  .docs-sidebar {
    display: none;
    position: fixed;
    top: 58px;
    bottom: 0;
    left: 0;
    width: 260px;
    z-index: 10;
    box-shadow: 12px 0 30px rgba(0, 0, 0, 0.15);
  }
  .docs-sidebar.open {
    display: flex;
  }
  .docs-reading-container {
    padding: 24px 16px;
  }
  .docs-article {
    padding: 0;
  }
  .docs-body {
    font-size: 14px;
  }
  .docs-body h1 {
    font-size: 26px;
  }
  .docs-body h2 {
    font-size: 18.5px;
  }
  .docs-code pre {
    font-size: 11.5px;
  }
  .docs-pagination {
    gap: 10px;
  }
  .docs-search-modal {
    padding-top: 6vh;
  }
}
</style>
