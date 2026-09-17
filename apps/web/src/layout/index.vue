<template>
  <div class="layout" :class="{ 'is-aside-collapsed': !uiStore.asideShow }">
    <header class="layout-topbar">
      <div class="navigation-heading">
        <Hamburger
          :is-active="!uiStore.asideShow"
          :aria-expanded="uiStore.asideShow"
          aria-controls="main-sidebar"
          @toggle-click="uiStore.asideShow = !uiStore.asideShow"
        />
        <router-link
          v-if="uiStore.asideShow && !isMobile"
          class="brand-link arc-serif-title"
          :to="{ name: 'email' }"
          :title="brand.title"
        >
          <img class="brand-logo" :src="brand.logoUrl" alt="" />
          <span class="brand-text">{{ brand.title }}</span>
        </router-link>
      </div>
      <div class="topbar-content">
        <Header />
      </div>
    </header>
    <div class="layout-body">
      <el-aside
        id="main-sidebar"
        class="aside"
        :class="uiStore.asideShow ? 'aside-show' : 'el-aside-hide'"
        :inert="!uiStore.asideShow"
        :aria-hidden="!uiStore.asideShow"
      >
        <Transition name="aside-swap" mode="out-in">
          <SettingsAside v-if="isSettingsRoute" key="settings" />
          <Aside v-else key="main" />
        </Transition>
      </el-aside>
      <div
        class="aside-overlay"
        :class="{ 'is-visible': uiStore.asideShow && isMobile }"
        @click="uiStore.asideShow = false"
      ></div>
      <el-main class="main-container">
        <Main />
      </el-main>
    </div>
  </div>
  <writer ref="writerRef" />
  <ShortcutsHelpModal />
</template>

<script setup>
import Aside from '@/layout/aside/index.vue'
import SettingsAside from '@/layout/aside/SettingsAside.vue'
import Header from '@/layout/header/index.vue'
import Hamburger from '@/components/hamburger/index.vue'
import { useSettingStore } from '@/store/setting.js'
import { normalizeBrand } from '@/utils/brand.js'
import Main from '@/layout/main/index.vue'
import ShortcutsHelpModal from '@/components/ShortcutsHelpModal.vue'
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from "@/store/ui.js";
import writer from '@/layout/write/index.vue'

const uiStore = useUiStore();
const settingStore = useSettingStore();
const brand = computed(() => normalizeBrand(settingStore.settings));
const route = useRoute();
const writerRef = ref({})
const isMobile = ref(window.innerWidth < 1025)
const isSettingsRoute = computed(() => route.name === 'sys-setting')

let touchStartX = 0;
let touchStartY = 0;
let isTrackingTouch = false;

const handleTouchStart = (e) => {
  if (!isMobile.value) return;
  if (!e.touches || e.touches.length !== 1) return;

  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;

  // 如果侧边栏未打开，只有从屏幕左边缘(<= 32px)开始的滑动才响应唤出手势
  if (!uiStore.asideShow && touchStartX > 32) {
    isTrackingTouch = false;
    return;
  }
  isTrackingTouch = true;
};

const handleTouchEnd = (e) => {
  if (!isMobile.value || !isTrackingTouch) return;
  isTrackingTouch = false;

  if (!e.changedTouches || e.changedTouches.length !== 1) return;
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;

  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;

  // 确保横向滑动意图明显，避免垂直滚动时误触
  if (Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
    if (!uiStore.asideShow && touchStartX <= 32 && deltaX > 50) {
      // 从左边缘右滑唤出侧边栏
      uiStore.asideShow = true;
    } else if (uiStore.asideShow && deltaX < -50) {
      // 侧边栏打开时左滑收起
      uiStore.asideShow = false;
    }
  }
};

const handleResize = () => {
  const nextMobile = window.innerWidth < 1025
  if (nextMobile !== isMobile.value) {
    uiStore.asideShow = !nextMobile
  }
  isMobile.value = nextMobile
}

watch(() => route.fullPath, () => {
  if (window.innerWidth < 1025) {
    uiStore.asideShow = false
  }
})

onMounted(() => {
  uiStore.writerRef = writerRef

  window.addEventListener('resize', handleResize)
  window.addEventListener('touchstart', handleTouchStart, { passive: true })
  window.addEventListener('touchend', handleTouchEnd, { passive: true })
  uiStore.asideShow = !isMobile.value
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('touchstart', handleTouchStart)
  window.removeEventListener('touchend', handleTouchEnd)
})
</script>

<style lang="scss" scoped>
$sidebar-w: 260px;
$sidebar-w-mobile: 280px;
$duration: 340ms;
$ease-out: cubic-bezier(0.22, 1, 0.36, 1);

.layout {
  --navigation-width: #{$sidebar-w};
  --topbar-height: 64px;
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--paper);

  &.is-aside-collapsed {
    --navigation-width: 56px;
  }
}

.layout-topbar,
.layout-body {
  display: grid;
  grid-template-columns: var(--navigation-width) minmax(0, 1fr);
  min-width: 0;
  transition: grid-template-columns $duration $ease-out;
}

.layout-topbar {
  height: var(--topbar-height);
  flex-shrink: 0;
  position: relative;
  z-index: 102;
  background: var(--paper);
}

.navigation-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 8px;
  overflow: hidden;

  :deep(.hamburger-btn) {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-strong);
  text-decoration: none;
  font-size: 17px;
  font-weight: 700;
}

.brand-logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}

.brand-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.topbar-content {
  min-width: 0;

}

.layout-body {
  flex: 1;
  min-height: 0;
}

.aside {
  grid-column: 1;
  grid-row: 1;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--paper);
  transition: opacity 180ms ease;
}

.el-aside-hide {
  opacity: 0;
  pointer-events: none;
}

.aside-show {
  opacity: 1;
}

.aside-swap-enter-active,
.aside-swap-leave-active {
  transition: opacity 180ms ease, transform 180ms $ease-out;
}

.aside-swap-enter-from,
.aside-swap-leave-to {
  opacity: 0;
  transform: translateX(-14px);
}

.main-container {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  background: var(--paper);
}

.aside-overlay {
  position: fixed;
  inset: var(--topbar-height) 0 0;
  z-index: 99;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;

  &.is-visible {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (max-width: 1024px) {
  .layout {
    --navigation-width: 56px;
  }

  .aside {
    width: $sidebar-w-mobile;
    position: fixed;
    top: var(--topbar-height);
    bottom: 0;
    left: 0;
    z-index: 101;
    opacity: 1;
    transition: transform $duration $ease-out;

    :deep(.aside-layout),
    :deep(.settings-aside) {
      width: 100%;
    }
  }

  .el-aside-hide {
    transform: translateX(-100%);
  }

  .aside-show {
    transform: translateX(0);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  }
}

@media (max-width: 767px) {
  .layout-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .main-container {
    grid-column: 1;
  }

}

@media (prefers-reduced-motion: reduce) {
  .layout-topbar,
  .layout-body,
  .aside,
  .aside-overlay,
  .aside-swap-enter-active,
  .aside-swap-leave-active {
    transition: none;
  }
}
</style>
