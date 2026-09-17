<template>
  <div class="docs-page">
    <header class="docs-header">
      <div class="docs-header-left">
        <button
          class="docs-mobile-toggle"
          type="button"
          :aria-expanded="menuOpen"
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

    <div class="docs-container">
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
          <Transition name="doc-fade" mode="out-in">
            <article v-if="current && source" :key="slug + '-' + lang" class="docs-article">
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
            <article v-else key="not-found" class="docs-article">
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
  </div>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Icon } from '@iconify/vue';
import { useSettingStore } from '@/store/setting.js';
import { useUiStore } from '@/store/ui.js';
import { setThemeMode } from '@/utils/theme.js';
import { applyBrandToDocument, normalizeBrand } from '@/utils/brand.js';
import { DOC_GROUPS, DOC_ITEMS, getDoc } from './docs.js';
import { renderMarkdown } from './markdown.js';
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
        if (rect.top - containerTop <= 80) {
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

watch(
  () => route.fullPath,
  async () => {
    settings.setLang(lang.value);
    menuOpen.value = false;
    applyBrandToDocument(settings.settings, (current.value?.[lang.value] || '404') + ' · ' + (en.value ? 'Docs' : '文档'));
    await nextTick();
    if (route.hash) {
      const id = route.hash.slice(1);
      activeHeadingId.value = id;
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    } else {
      reading.value?.scrollTo({ top: 0 });
      activeHeadingId.value = tocItems.value[0]?.id || '';
    }
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
  /* 纯白现代极简文档调色板（彻底剥离青蓝偏色） */
  --docs-bg: #ffffff;
  --docs-header-bg: #ffffff;
  --docs-sidebar-bg: #ffffff;
  --docs-border: #e4e4e7;
  --docs-border-subtle: #f4f4f5;
  --docs-border-strong: #d4d4d8;

  --docs-text-primary: #09090b;
  --docs-text-body: #27272a;
  --docs-text-muted: #71717a;
  --docs-text-faint: #a1a1aa;

  --docs-hover: #f4f4f5;
  --docs-active: #f4f4f5;

  --docs-code-bg: #fafafa;
  --docs-code-header-bg: #f4f4f5;
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
  --docs-sidebar-bg: #09090b;
  --docs-border: #27272a;
  --docs-border-subtle: #18181b;
  --docs-border-strong: #3f3f46;

  --docs-text-primary: #fafafa;
  --docs-text-body: #d4d4d8;
  --docs-text-muted: #a1a1aa;
  --docs-text-faint: #71717a;

  --docs-hover: #18181b;
  --docs-active: #18181b;

  --docs-code-bg: #121214;
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
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.docs-brand-text {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: .02em;
  text-transform: uppercase;
  font-family: var(--font-sans);
  color: var(--docs-text-primary);
  white-space: nowrap;
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
  gap: 8px;
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
  transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
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

.docs-lang-btn:active {
  transform: scale(0.94);
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

.docs-theme-btn svg,
.docs-theme-btn .iconify {
  transition: transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.docs-theme-btn:active svg,
.docs-theme-btn:active .iconify {
  transform: rotate(36deg) scale(0.88);
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

.docs-mailbox-btn:active {
  transform: translateY(0);
}

/* 主结构 */
.docs-container {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  overflow: hidden;
  position: relative;
}

/* 侧边栏（纯净目录树） */
.docs-sidebar {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 20px 14px 28px;
  border-right: 1px solid var(--docs-border);
  background: var(--docs-sidebar-bg);
  box-sizing: border-box;
  transition: background-color 220ms ease, border-color 220ms ease;
}

.docs-nav {
  flex: 1;
}

.docs-group {
  margin-top: 22px;
}

.docs-group:first-child {
  margin-top: 0;
}

.docs-group-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  margin: 0 8px 6px;
  color: var(--docs-text-muted);
  user-select: none;
  transition: color 220ms ease;
}

.docs-group-items a {
  display: block;
  margin: 1px 0;
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
  transform: translateX(2px);
}

.docs-group-items a.active {
  background: var(--docs-active);
  color: var(--docs-text-primary);
  font-weight: 600;
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
  max-width: 1120px;
  margin: 0 auto;
  padding: 36px 36px 48px;
  box-sizing: border-box;
  gap: 40px;
}

.docs-article {
  flex: 1;
  min-width: 0;
  max-width: 800px;
}

/* 文章与中英切换过渡动效 */
.doc-fade-enter-active {
  transition: opacity 200ms ease-out, transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.doc-fade-leave-active {
  transition: opacity 120ms ease-in, transform 120ms ease-in;
}

.doc-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.doc-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 右侧大纲 */
.docs-toc {
  width: 190px;
  flex-shrink: 0;
  position: sticky;
  top: 36px;
  align-self: flex-start;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  padding-left: 14px;
  border-left: 1px solid var(--docs-border);
  transition: border-color 220ms ease;
}

.docs-toc-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  color: var(--docs-text-muted);
  margin-bottom: 10px;
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
  line-height: 1.5;
  color: var(--docs-text-muted);
  text-decoration: none;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 4px;
  transition: color 150ms ease, background-color 150ms ease, transform 150ms ease;
}

.docs-toc-link.depth-3 {
  padding-left: 16px;
  font-size: 12px;
}

.docs-toc-link:hover {
  color: var(--docs-text-primary);
  transform: translateX(2px);
}

.docs-toc-link.active {
  color: var(--docs-text-primary);
  font-weight: 600;
  background: var(--docs-hover);
}

/* 焦点可见轮廓 */
.docs-sidebar a:focus-visible,
.docs-reading a:focus-visible,
.docs-mobile-toggle:focus-visible,
.docs-code button:focus-visible,
.docs-theme-btn:focus-visible,
.docs-lang-btn:focus-visible,
.docs-mailbox-btn:focus-visible {
  outline: 2px solid var(--docs-text-primary);
  outline-offset: 2px;
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

/* 正文排版 */
.docs-body {
  font-size: 15px;
  line-height: 1.85;
  color: var(--docs-text-body);
  overflow-wrap: anywhere;
}

.docs-body h1 {
  font-size: 30px;
  line-height: 1.3;
  font-weight: 750;
  color: var(--docs-text-primary);
  margin: 0 0 24px;
  letter-spacing: -.02em;
}

.docs-body h2 {
  font-size: 20px;
  line-height: 1.45;
  font-weight: 650;
  color: var(--docs-text-primary);
  margin: 36px 0 16px;
  padding-top: 14px;
  border-top: 1px solid var(--docs-border);
}

.docs-body h3 {
  font-size: 16px;
  line-height: 1.5;
  font-weight: 600;
  margin: 26px 0 12px;
  color: var(--docs-text-primary);
}

.docs-body p {
  margin: 14px 0;
}

.docs-body a,
.docs-footer a {
  color: var(--docs-text-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color var(--duration-fast, 150ms) ease;
}

.docs-body a:hover,
.docs-footer a:hover {
  color: var(--docs-link-hover);
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
  padding: 2px 5px;
  background: var(--docs-hover);
  border: 1px solid var(--docs-border);
  color: var(--docs-text-primary);
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
  padding: 6px 12px;
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

/* 代码语法高亮（清爽自然，去偏色） */
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
  padding: 10px 12px;
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
  margin: 30px 0;
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
  padding: 14px 16px;
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

/* 响应式断点 */
@media (max-width: 1024px) {
  .docs-toc {
    display: none;
  }
  .docs-reading-container {
    padding: 32px 24px;
  }
}

@media (max-width: 767px) {
  .docs-header {
    padding: 0 14px;
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
    font-size: 24px;
  }
  .docs-body h2 {
    font-size: 18px;
  }
  .docs-code pre {
    font-size: 11.5px;
  }
  .docs-pagination {
    gap: 10px;
  }
}
</style>
