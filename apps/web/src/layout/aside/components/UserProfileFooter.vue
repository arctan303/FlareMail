<template>
  <div class="aside-user-footer">
    <div class="user-footer-divider"></div>
    <el-dropdown
      ref="dropdownRef"
      trigger="click"
      placement="top-start"
      :teleported="true"
      popper-class="aside-user-dropdown"
      @visible-change="handleVisibleChange"
    >
      <div class="user-card-trigger" :class="{ 'is-active': isDropdownVisible, 'is-page-active': route.meta.name === 'setting' || route.name === 'setting' }">
        <div class="user-avatar-badge">
          {{ formatName(userStore.user.email) }}
        </div>
        <div class="user-card-meta">
          <div class="user-name-row">
            <span class="user-primary-name">
              {{ userStore.user.name || userStore.user.email?.split('@')[0] || $t('unnamedUser') }}
            </span>
            <span class="user-role-badge" :class="userStore.user.type === 0 ? 'role-admin' : 'role-user'">
              {{ userStore.user.type === 0 ? $t('admin') : $t('user') }}
            </span>
          </div>
          <div class="user-secondary-info">
            <span class="user-email-text">{{ userStore.user.email }}</span>
          </div>
        </div>
        <Icon icon="solar:alt-arrow-up-linear" width="16" height="16" class="user-expand-icon" />
      </div>

      <template #dropdown>
        <div class="aside-user-panel">
          <!-- 额度配额统计信息 -->
          <div class="panel-stats" v-if="sendCount">
            <div class="stat-item">
              <span class="stat-label">{{ $t('sendCount') }}</span>
              <span class="stat-value">{{ sendCount }}</span>
            </div>
          </div>

          <!-- 快捷操作列表 -->
          <div class="panel-menu">
            <div class="menu-action-item" @click="handleNav('setting')">
              <Icon icon="solar:settings-minimalistic-linear" width="16" height="16" />
              <span>{{ $t('settings') }}</span>
            </div>
            <div class="menu-action-item" @click="openShortcuts">
              <Icon icon="solar:keyboard-linear" width="16" height="16" />
              <span>{{ $t('keyboardShortcuts') }}</span>
              <kbd class="menu-kbd">?</kbd>
            </div>
          </div>

          <div class="panel-divider"></div>

          <!-- 外观选择器 (带平滑滑动滑块) -->
          <div class="theme-section">
            <div class="theme-title">{{ $t('appearanceSettings') }}</div>
            <div class="theme-segmented">
              <div class="theme-slider-thumb" :style="themeSliderStyle"></div>

              <button
                type="button"
                class="theme-segment-item"
                :class="{ 'is-selected': uiStore.themeMode === 'light' }"
                @click.stop="handleThemeSelect('light', $event)"
                :title="$t('lightAppearance')"
              >
                <Icon icon="solar:sun-2-linear" width="14" height="14" />
                <span>{{ $t('light') }}</span>
              </button>
              <button
                type="button"
                class="theme-segment-item"
                :class="{ 'is-selected': uiStore.themeMode === 'dark' }"
                @click.stop="handleThemeSelect('dark', $event)"
                :title="$t('darkAppearance')"
              >
                <Icon icon="solar:moon-linear" width="14" height="14" />
                <span>{{ $t('dark') }}</span>
              </button>
              <button
                type="button"
                class="theme-segment-item"
                :class="{ 'is-selected': uiStore.themeMode === 'system' }"
                @click.stop="handleThemeSelect('system', $event)"
                :title="$t('systemAppearance')"
              >
                <Icon icon="solar:laptop-linear" width="14" height="14" />
                <span>{{ $t('system') }}</span>
              </button>
            </div>
          </div>

          <div class="panel-divider"></div>

          <!-- 退出登录按钮 -->
          <div class="panel-footer">
            <el-button
              type="danger"
              plain
              class="logout-btn"
              :loading="logoutLoading"
              @click="clickLogout"
            >
              <Icon icon="solar:logout-2-linear" width="15" height="15" style="margin-right: 6px;" />
              {{ $t('logOut') }}
            </el-button>
          </div>
        </div>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useUserStore } from '@/store/user.js'
import { useSettingStore } from '@/store/setting.js'
import { useUiStore } from '@/store/ui.js'
import { hasPerm } from '@/perm/perm.js'
import { logout } from '@/request/login.js'
import { setAuthenticatedSession } from '@/utils/session-state.js'
import { invalidateUserScopedStateAcrossTabs } from '@/utils/sensitive-state.js'
import { setThemeMode } from '@/utils/theme.js'
import { isShortcutsHelpVisible } from '@/utils/shortcuts.js'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const settingStore = useSettingStore()
const uiStore = useUiStore()

const dropdownRef = ref(null)
const isDropdownVisible = ref(false)
const logoutLoading = ref(false)

const sendCount = computed(() => {
  if (!hasPerm('email:send')) {
    return null
  }
  if (settingStore.settings.send === 1) {
    return null
  }
  if (userStore.user.type === 0) {
    return userStore.user.sendCount + '/' + t('unlimited')
  }
  return userStore.user.sendCount + '/' + (userStore.user.sendLimit || t('unlimited'))
})

const themeSliderIndex = computed(() => {
  if (uiStore.themeMode === 'light') return 0
  if (uiStore.themeMode === 'dark') return 1
  return 2
})

const themeSliderStyle = computed(() => ({
  transform: `translateX(${themeSliderIndex.value * 100}%)`
}))

function handleVisibleChange(visible) {
  isDropdownVisible.value = visible
}

function closeDropdown() {
  try {
    if (dropdownRef.value) {
      if (typeof dropdownRef.value.handleClose === 'function') {
        dropdownRef.value.handleClose()
      }
      if (dropdownRef.value.popperRef?.hide) {
        dropdownRef.value.popperRef.hide()
      }
    }
  } catch (e) {
    console.error(e)
  }
}

function formatName(email) {
  return typeof email === 'string' ? (email[0]?.toUpperCase() || '') : ''
}

function handleNav(name) {
  closeDropdown()
  if (window.innerWidth < 1025) {
    uiStore.asideShow = false
  }
  router.push({ name })
}

function handleThemeSelect(mode, e) {
  setThemeMode(mode, e)
}

function openShortcuts() {
  closeDropdown()
  isShortcutsHelpVisible.value = !isShortcutsHelpVisible.value
}

async function clickLogout() {
	closeDropdown()
	logoutLoading.value = true
	try {
		await logout()
  } catch (e) {
    console.warn('Logout request failed, clearing local session anyway:', e)
  } finally {
    setAuthenticatedSession(false)
    invalidateUserScopedStateAcrossTabs()
    userStore.user = {}
    logoutLoading.value = false
		window.location.replace('/login')
  }
}
</script>

<style lang="scss" scoped>
.aside-user-footer {
  padding: 0 10px 10px 10px;
  background: transparent;
  flex-shrink: 0;
  box-sizing: border-box;

  .user-footer-divider {
    height: 1px;
    background: var(--line);
    margin: 0 4px 8px 4px;
  }

  :deep(.el-dropdown) {
    width: 100%;
    display: block;
  }
}

.user-card-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 9px;
  cursor: pointer;
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  border: 1px solid transparent;
  transition: all var(--motion-fast) var(--ease-standard);

  &:hover,
  &.is-active {
    background: var(--base-fill);
    border-color: color-mix(in srgb, var(--line) 60%, transparent);
  }

  &.is-page-active {
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .user-avatar-badge {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    font-weight: 700;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--accent) 15%, var(--surface));
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    flex-shrink: 0;
  }

  .user-card-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;

    .user-name-row {
      display: flex;
      align-items: center;
      gap: 6px;
      line-height: 1.2;
      min-width: 0;

      .user-primary-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-strong);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .user-role-badge {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 4px;
        font-weight: 500;
        flex-shrink: 0;
        line-height: 1.3;

        &.role-admin {
          background: color-mix(in srgb, var(--el-color-danger) 15%, transparent);
          color: var(--el-color-danger);
        }

        &.role-user {
          background: color-mix(in srgb, var(--muted) 15%, transparent);
          color: var(--muted);
        }
      }
    }

    .user-secondary-info {
      display: flex;
      align-items: center;
      font-size: 11px;
      color: var(--muted);
      line-height: 1.2;
      overflow: hidden;
      white-space: nowrap;

      .user-email-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  .user-expand-icon {
    color: var(--muted);
    flex-shrink: 0;
    transition: transform var(--motion-fast) var(--ease-standard);
  }

  &.is-active .user-expand-icon {
    transform: rotate(180deg);
  }
}
</style>

<style lang="scss">
.aside-user-dropdown.el-dropdown__popper {
  --el-dropdown-menuItem-hover-fill: var(--base-fill);
  border-radius: 12px !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15) !important;
  border: 1px solid var(--line-strong, var(--line)) !important;
  background: var(--surface) !important;
  padding: 0 !important;

  .el-dropdown__popper-content {
    background: var(--surface);
    border-radius: 12px;
  }

  .aside-user-panel {
    width: 230px;
    padding: 6px;
    box-sizing: border-box;

    .panel-stats {
      background: var(--base-fill);
      border-radius: 8px;
      padding: 6px 10px;
      margin-bottom: 4px;
      display: flex;
      flex-direction: column;
      gap: 4px;

      .stat-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;

        .stat-label {
          color: var(--muted);
        }

        .stat-value {
          color: var(--text-strong);
          font-weight: 600;
        }
      }
    }

    .panel-divider {
      height: 1px;
      background: var(--line);
      margin: 4px 0;
    }

    .panel-menu {
      display: flex;
      flex-direction: column;
      gap: 2px;

      .menu-action-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        border-radius: 8px;
        font-size: 13px;
        color: var(--text-strong);
        cursor: pointer;
        transition: all var(--motion-fast) var(--ease-standard);

        &:hover {
          background: var(--base-fill);
          color: var(--accent);
        }

        .menu-kbd {
          margin-left: auto;
          font-family: var(--font-mono);
          font-size: 11px;
          padding: 1px 5px;
          border-radius: 4px;
          background: color-mix(in srgb, var(--muted) 15%, transparent);
          color: var(--muted);
          border: 1px solid color-mix(in srgb, var(--muted) 20%, transparent);
        }
      }
    }

    .theme-section {
      padding: 2px 2px 4px;

      .theme-title {
        font-size: 11px;
        font-weight: 600;
        color: var(--muted);
        padding: 2px 8px 4px;
      }

      .theme-segmented {
        position: relative;
        display: flex;
        background: var(--base-fill);
        padding: 3px;
        border-radius: 8px;
        border: 1px solid var(--line);
        overflow: hidden;

        .theme-slider-thumb {
          position: absolute;
          top: 3px;
          bottom: 3px;
          left: 3px;
          width: calc((100% - 6px) / 3);
          border-radius: 6px;
          background: var(--surface);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
          pointer-events: none;
          z-index: 1;
          transition: transform 0.28s cubic-bezier(0.25, 1, 0.5, 1);
        }

        .theme-segment-item {
          position: relative;
          z-index: 2;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          height: 26px;
          border: none;
          background: transparent;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          color: var(--muted);
          cursor: pointer;
          transition: color 0.2s ease;

          &:hover {
            color: var(--text-strong);
          }

          &.is-selected {
            color: var(--accent);
            font-weight: 600;
          }
        }
      }
    }

    .panel-footer {
      padding: 4px 2px 2px;

      .logout-btn {
        width: 100%;
        height: 32px;
        border-radius: 8px;
        font-size: 13px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
    }
  }
}

html.dark .aside-user-dropdown.el-dropdown__popper .theme-segmented .theme-slider-thumb {
  background: var(--surface);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
</style>
