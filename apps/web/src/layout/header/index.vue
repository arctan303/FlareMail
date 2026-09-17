<template>
  <div class="header" :class="{ 'is-mobile-searching': isMobileSearchActive }">
    <!-- 移动端展开全宽搜索状态 -->
    <div class="mobile-search-bar" v-if="isMobile && isMobileSearchActive">
      <button class="mobile-search-back-btn" @click="closeMobileSearch" :title="$t('back')">
        <Icon icon="solar:arrow-left-linear" width="20" height="20" />
      </button>
      <div class="mobile-search-input-box">
        <Icon icon="solar:magnifer-linear" width="16" height="16" class="search-leading-icon" />
        <input
          ref="mobileSearchInputRef"
          type="text"
          class="search-input"
          :placeholder="searchPlaceholder"
          v-model="searchInput"
          @keydown.esc="closeMobileSearch"
        />
        <button
          v-if="searchInput"
          class="search-clear-btn"
          type="button"
          @mousedown.prevent
          @click.stop="handleClearSearch"
          :title="$t('clearSearch')"
        >
          <Icon icon="solar:close-circle-bold" width="16" height="16" />
        </button>
      </div>
    </div>

    <!-- 常规头部（桌面端常驻 + 移动端默认） -->
    <template v-else>
      <div class="header-left" v-if="isMobile">
        <span class="breadcrumb-item mobile-title">{{ headerTitle }}</span>
      </div>

      <!-- 桌面端靠左搜索栏（仅大屏展示） -->
      <div class="header-center" v-if="showSearch && !isMobile">
        <div class="header-search-wrapper desktop-search">
          <div class="header-search-box" :class="{ 'is-focused': isSearchFocused, 'has-content': !!searchInput }">
            <Icon icon="solar:magnifer-linear" width="16" height="16" class="search-leading-icon" />
            <input
              ref="searchInputRef"
              type="text"
              class="search-input"
              :placeholder="searchPlaceholder"
              v-model="searchInput"
              @focus="isSearchFocused = true"
              @blur="isSearchFocused = false"
              @keydown.esc="handleClearSearch"
            />
            <button
              v-if="searchInput"
              class="search-clear-btn"
              type="button"
              @mousedown.prevent
              @click.stop="handleClearSearch"
              :title="$t('clearSearchEsc')"
            >
              <Icon icon="solar:close-circle-bold" width="15" height="15" />
            </button>
            <div class="search-kbd-badge" v-else>
              <kbd class="kbd-key">{{ isMac ? '⌘' : 'Ctrl' }}</kbd>
              <kbd class="kbd-key">K</kbd>
            </div>
          </div>
        </div>
      </div>

      <div class="toolbar">
        <!-- 移动端专属搜索触发按钮（仅移动端渲染，大屏绝对不出现） -->
        <div
          v-if="showSearch && isMobile"
          class="mobile-search-trigger icon-item"
          @click="openMobileSearch"
          :class="{ 'has-query': !!searchInput }"
          :title="$t('search')"
        >
          <Icon icon="solar:magnifer-linear" width="20" height="20" />
        </div>

        <div v-if="uiStore.dark" class="sun-icon icon-item" @click="openDark($event)" :title="$t('toggleAppearance')">
          <Icon icon="solar:sun-2-linear" width="18" height="18" />
        </div>
        <div v-else class="dark-icon icon-item" @click="openDark($event)" :title="$t('toggleAppearance')">
          <Icon icon="solar:moon-linear" width="18" height="18" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { Icon } from "@iconify/vue"
import { useUiStore } from "@/store/ui.js"
import { useEmailStore } from "@/store/email.js"
import { useRoute } from "vue-router"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { openDark, switchDark } from "@/utils/theme.js"
import { initShortcuts, destroyShortcuts, registerShortcut } from "@/utils/shortcuts.js"

const { t } = useI18n()
const route = useRoute()
const uiStore = useUiStore()
const emailStore = useEmailStore()

const searchInputRef = ref(null)
const mobileSearchInputRef = ref(null)
const isSearchFocused = ref(false)
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < 768 : false)
const isMobileSearchActive = ref(false)
const searchInput = ref(emailStore.searchKeyword || '')
const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

const showSearch = computed(() => {
  const name = String(route.name || route.meta?.name || '').toLowerCase()
  return ['email', 'inbox', 'star', 'starred', 'send', 'sent', 'draft', 'drafts', 'contact', 'contacts', 'content'].includes(name)
})

const searchPlaceholder = computed(() => {
  const name = route.name || route.meta?.name || ''
  if (name === 'contacts' || name === 'contact') {
    return t('searchContacts')
  }
  return t('searchEmails')
})

let debounceTimer = null
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    emailStore.setSearchKeyword(val)
  }, 150)
})

watch(() => emailStore.searchKeyword, (val) => {
  if (val !== searchInput.value) {
    searchInput.value = val || ''
  }
})

function handleClearSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchInput.value = ''
  emailStore.clearSearch()
}

function openMobileSearch() {
  isMobileSearchActive.value = true
  nextTick(() => {
    mobileSearchInputRef.value?.focus()
  })
}

function closeMobileSearch() {
  isMobileSearchActive.value = false
}

// Route meta titles are i18n keys, so the title dictionary that used to be duplicated
// here (and again in router/index.js) is gone.
const headerTitle = computed(() => {
  const rawKey = route.meta?.title || route.meta?.name || route.name
  return rawKey ? t(rawKey) : t('inbox')
})

let themeMediaQuery

const handleSystemThemeChange = (event) => {
  if (uiStore.themeMode === 'system') {
    switchDark(event.matches, document.documentElement, 'system')
  }
}

const handleResize = () => {
  isMobile.value = window.innerWidth < 768
  if (!isMobile.value) {
    isMobileSearchActive.value = false
  }
}

const handleGlobalKeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (isMobile.value) {
      openMobileSearch()
    } else {
      searchInputRef.value?.focus()
      searchInputRef.value?.select()
    }
  } else if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    e.preventDefault()
    if (isMobile.value) {
      openMobileSearch()
    } else {
      searchInputRef.value?.focus()
    }
  }
}

onMounted(() => {
  uiStore.dark = document.documentElement.classList.contains('dark')
  themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  themeMediaQuery.addEventListener('change', handleSystemThemeChange)
  window.addEventListener('resize', handleResize)

  initShortcuts()
  registerShortcut('c', () => openSend())

  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  themeMediaQuery?.removeEventListener('change', handleSystemThemeChange)
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('resize', handleResize)
  destroyShortcuts()
  if (debounceTimer) clearTimeout(debounceTimer)
})

function openSend() {
  const target = uiStore.writerRef?.value || uiStore.writerRef
  if (target?.open) {
    target.open()
  }
}
</script>

<style lang="scss" scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 0 16px 0 8px;
  background: var(--paper);
  gap: 16px;
  box-sizing: border-box;
  position: relative;
}

.header-left {
  display: flex;
  align-items: center;
  height: 100%;
  min-width: 32px;
  flex: 0 0 auto;
  gap: 8px;

  @media (max-width: 767px) {
    min-width: 0;
    flex: 1;
  }
}

.breadcrumb-item.mobile-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-strong);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 桌面端靠左搜索栏 */
.header-center {
  flex: 1;
  display: flex;
  justify-content: flex-start;
  align-items: center;
  min-width: 0;
  max-width: 720px;
  margin-right: auto;
}

.header-search-wrapper.desktop-search {
  width: 100%;
  max-width: 640px;
  display: flex;
  align-items: center;
  transition: max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1);

  &:focus-within {
    max-width: 640px;
  }
}

.header-search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 44px;
  background: color-mix(in srgb, var(--surface) 85%, var(--paper));
  border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  border-radius: 24px;
  padding: 0 14px 0 16px;
  box-sizing: border-box;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.01);
  transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    border-color: color-mix(in srgb, var(--text) 22%, transparent);
    background: var(--surface);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  }

  &.is-focused {
    border-color: var(--accent);
    background: var(--surface);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), 0 4px 14px rgba(0, 0, 0, 0.06);

    .search-leading-icon {
      color: var(--accent);
      transform: scale(1.05);
    }
  }

  .search-leading-icon {
    color: var(--muted);
    flex-shrink: 0;
    margin-right: 8px;
    transition: all 0.2s ease;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13px;
    color: var(--text-strong);

    &::placeholder {
      color: var(--muted);
      font-weight: 400;
      opacity: 0.85;
    }
  }

  .search-clear-btn {
    border: none;
    background: transparent;
    padding: 2px;
    cursor: pointer;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: all 0.18s ease;

    &:hover {
      color: var(--text-strong);
      background: color-mix(in srgb, var(--text) 10%, transparent);
      transform: scale(1.1);
    }
  }

  .search-kbd-badge {
    display: flex;
    align-items: center;
    gap: 3px;
    user-select: none;
    flex-shrink: 0;

    .kbd-key {
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      color: var(--muted);
      background: color-mix(in srgb, var(--paper-soft) 85%, transparent);
      border: 1px solid color-mix(in srgb, var(--line) 85%, transparent);
      border-radius: 5px;
      padding: 1px 5px;
      line-height: 1.3;
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04);
      transition: all 0.15s ease;
    }
  }
}

:global(html.dark) .header-search-box {
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  border-color: color-mix(in srgb, var(--line) 90%, transparent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);

  &:hover {
    border-color: color-mix(in srgb, var(--text) 30%, transparent);
    background: var(--surface);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  }

  &.is-focused {
    background: var(--surface);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent), 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .search-kbd-badge .kbd-key {
    background: color-mix(in srgb, var(--surface) 70%, var(--paper));
    border-color: color-mix(in srgb, var(--line) 90%, transparent);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
}

/* 移动端搜索触发图标 */
.toolbar .mobile-search-trigger {
  display: flex;

  &.has-query {
    color: var(--accent);
    position: relative;

    &::after {
      content: '';
      position: absolute;
      top: 6px;
      right: 6px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
    }
  }
}

/* 移动端全宽展开搜索栏 */
.mobile-search-bar {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  padding: 0 10px 0 6px;
  gap: 8px;
  background: var(--paper);
  animation: searchSlideIn 0.15s ease-out;

  .mobile-search-back-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-strong);
    cursor: pointer;
    flex-shrink: 0;

    &:active {
      background: var(--base-fill);
    }
  }

  .mobile-search-input-box {
    flex: 1;
    height: 34px;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: 17px;
    display: flex;
    align-items: center;
    padding: 0 10px 0 12px;
    box-sizing: border-box;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent);

    .search-leading-icon {
      color: var(--accent);
      flex-shrink: 0;
      margin-right: 6px;
    }

    .search-input {
      flex: 1;
      min-width: 0;
      height: 100%;
      border: none;
      outline: none;
      background: transparent;
      font-size: 13px;
      color: var(--text-strong);

      &::placeholder {
        color: var(--faint);
      }
    }

    .search-clear-btn {
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: center;

      &:active {
        color: var(--text-strong);
      }
    }
  }
}

@keyframes searchSlideIn {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.toolbar {
  margin-left: auto;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;

  @media (max-width: 767px) {
    gap: 8px;
  }

  .icon-item {
    align-self: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--muted);
    transition: all var(--motion-fast) var(--ease-standard);

    &:hover {
      background: var(--base-fill);
      color: var(--text-strong);
    }
  }

  .dark-icon {
    font-size: 20px;
  }

  .sun-icon {
    font-size: 22px;
  }
}
</style>
