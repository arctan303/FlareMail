<template>
  <div class="settings-aside">
    <el-scrollbar class="settings-scroll">
      <div>
        <div class="back-btn-wrapper">
          <el-button type="primary" class="back-btn arc-btn" @click="goBack">
            <Icon icon="solar:alt-arrow-down-linear" width="17" height="17" class="back-icon" style="margin-right: 6px" />
            <span>{{ $t('backToPrevious') }}</span>
          </el-button>
        </div>

        <div class="aside-nav-group">
          <div class="nav-section-header">
            <span>{{ $t(titleKey) }}</span>
          </div>

          <div
            v-for="section in sections"
            :key="section.id"
            class="nav-item"
            :class="{ active: section.id === activeSection }"
            @click="selectSection(section.id)"
          >
            <div class="nav-icon-box">
              <Icon :icon="section.icon" width="16" height="16" />
            </div>
            <span class="nav-label">{{ $t(section.label) }}</span>
          </div>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { useUiStore } from "@/store/ui.js";
import {
  SYS_SETTING_SECTIONS,
  resolveSysSettingSection,
} from "@/views/sys-setting/sections.js";
import {
  USER_SETTING_SECTIONS,
  resolveUserSettingSection,
} from "@/views/setting/sections.js";

defineOptions({ name: 'SettingsAside' })

const route = useRoute();
const router = useRouter();
const uiStore = useUiStore();

const isSysSetting = computed(() => route.name === 'sys-setting');
const titleKey = computed(() => isSysSetting.value ? 'SystemSettings' : 'userSettings');
const sections = computed(() => isSysSetting.value ? SYS_SETTING_SECTIONS : USER_SETTING_SECTIONS);
const activeSection = computed(() => {
  if (isSysSetting.value) {
    return resolveSysSettingSection(route.query.tab);
  }
  return resolveUserSettingSection(route.query.tab);
});

function closeAsideIfMobile() {
  if (window.innerWidth < 1025) {
    uiStore.asideShow = false;
  }
}

function selectSection(id) {
  closeAsideIfMobile();
  if (id === activeSection.value) return;
  const targetRoute = isSysSetting.value ? 'sys-setting' : 'setting';
  router.replace({ name: targetRoute, query: { ...route.query, tab: id } });
}

function goBack() {
  closeAsideIfMobile();
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push({ name: 'email' });
  }
}
</script>

<style lang="scss" scoped>
.settings-aside {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 260px;
  background: var(--paper);
  box-sizing: border-box;
}

.settings-scroll {
  flex: 1;
  min-height: 0;
}


.back-btn-wrapper {
  padding: 8px 14px 0;
  margin-bottom: 12px;

  .back-btn {
    width: 100%;
    height: 40px;
    border-radius: 10px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 25%, transparent);
    transition: all var(--motion-fast) var(--ease-standard);

    .back-icon {
      /* 复用向下的箭头图标，旋转为向左 */
      transform: rotate(90deg);
    }
  }
}

.aside-nav-group {
  padding: 0 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.nav-section-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.06em;
  padding: 14px 10px 6px;
  user-select: none;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 9px;
  cursor: pointer;
  color: var(--text, var(--el-text-color-regular));
  font-size: 13px;
  font-weight: 500;
  border: 1px solid transparent;
  transition: all var(--motion-fast) var(--ease-standard);
  user-select: none;

  .nav-icon-box {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--line) 45%, transparent);
    color: var(--muted);
    flex-shrink: 0;
    transition: all var(--motion-fast) var(--ease-standard);
  }

  .nav-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    background: var(--base-fill);
    border-color: color-mix(in srgb, var(--line) 60%, transparent);
    color: var(--text-strong);

    .nav-icon-box {
      background: color-mix(in srgb, var(--surface) 85%, transparent);
      color: var(--text-strong);
    }
  }

  &.active {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
    font-weight: 600;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 10%, transparent);

    .nav-icon-box {
      background: color-mix(in srgb, var(--accent) 20%, transparent);
      color: var(--accent);
    }
  }
}

html.dark .nav-item.active {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--accent);

  .nav-icon-box {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    color: var(--accent);
  }
}
</style>
