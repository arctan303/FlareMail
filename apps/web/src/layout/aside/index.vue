<template>
  <div class="aside-layout">
    <el-scrollbar class="aside-scroll">
      <div>
        <div class="write-btn-wrapper">
          <el-button
            type="primary"
            class="write-btn arc-btn"
            @click="openWriteModal"
            v-perm="'email:send'"
          >
            <Icon icon="solar:pen-new-square-linear" width="17" height="17" style="margin-right: 6px" />
            <span>{{ $t('composeNewMail') }}</span>
            <kbd class="shortcut-tip">C</kbd>
          </el-button>
        </div>

        <div class="aside-nav-group">
          <div class="nav-section-header">
            <span>{{ $t('mailSection') }}</span>
          </div>

          <div
            class="nav-item"
            :class="{ active: ['email', 'star', 'content'].includes(route.name) }"
            @click="nav('email')"
          >
            <div class="nav-icon-box">
              <Icon icon="solar:mailbox-linear" width="16" height="16" />
            </div>
            <span class="nav-label">{{ $t('inbox') }}</span>
          </div>

          <div
            class="nav-item"
            :class="{ active: route.meta.name === 'send' || route.name === 'send' }"
            @click="nav('send')"
            v-perm="'email:send'"
          >
            <div class="nav-icon-box">
              <Icon icon="solar:plain-2-linear" width="16" height="16" />
            </div>
            <span class="nav-label">{{ $t('sent') }}</span>
          </div>

          <div
            class="nav-item"
            :class="{ active: route.meta.name === 'draft' || route.name === 'draft' }"
            @click="nav('draft')"
            v-perm="'email:send'"
          >
            <div class="nav-icon-box">
              <Icon icon="solar:document-text-linear" width="16" height="16" />
            </div>
            <span class="nav-label">{{ $t('drafts') }}</span>
          </div>


          <div
            class="nav-item"
            :class="{ active: route.meta.name === 'contact' || route.name === 'contact' }"
            @click="nav('contact')"
          >
            <div class="nav-icon-box">
              <Icon icon="solar:users-group-rounded-linear" width="16" height="16" />
            </div>
            <span class="nav-label">{{ $t('contacts') }}</span>
          </div>

          <template v-if="hasPerm(['user:query','setting:query'])">
            <div class="nav-section-divider"></div>
            <div class="nav-section-header">
              <span>{{ $t('manage') }}</span>
            </div>

            <div
              class="nav-item"
              :class="{ active: route.meta.name === 'user' || route.name === 'user' }"
              @click="nav('user')"
              v-perm="'user:query'"
            >
              <div class="nav-icon-box">
                <Icon icon="solar:user-id-linear" width="16" height="16" />
              </div>
              <span class="nav-label">{{ $t('allUsers') }}</span>
            </div>

            <div
              class="nav-item"
              :class="{ active: route.meta.name === 'sys-setting' || route.name === 'sys-setting' }"
              @click="nav('sys-setting')"
              v-perm="'setting:query'"
            >
              <div class="nav-icon-box">
                <Icon icon="solar:settings-minimalistic-linear" width="16" height="16" />
              </div>
              <span class="nav-label">{{ $t('SystemSettings') }}</span>
            </div>
          </template>
        </div>
      </div>
    </el-scrollbar>

    <UserProfileFooter />
  </div>
</template>

<script setup>
import { useRoute, useRouter } from "vue-router";
import { Icon } from "@iconify/vue";
import { useUiStore } from "@/store/ui.js";
import { hasPerm } from "@/perm/perm.js";
import UserProfileFooter from "./components/UserProfileFooter.vue";

const uiStore = useUiStore();
const router = useRouter();
const route = useRoute();

function closeAsideIfMobile() {
  if (window.innerWidth < 1025) {
    uiStore.asideShow = false;
  }
}

function nav(name) {
  closeAsideIfMobile();
  router.push({ name });
}

function openWriteModal() {
  closeAsideIfMobile();
  const target = uiStore.writerRef?.value || uiStore.writerRef;
  if (target?.open) {
    target.open();
  }
}
</script>

<style lang="scss" scoped>
.aside-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 260px;
  background: var(--paper);
  box-sizing: border-box;
}

.aside-scroll {
  flex: 1;
  min-height: 0;
}

.write-btn-wrapper {
  padding: 8px 14px 0;
  margin-bottom: 12px;

  .write-btn {
    width: 100%;
    height: 40px;
    border-radius: 10px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 25%, transparent);
    transition: all var(--motion-fast) var(--ease-standard);

    .shortcut-tip {
      margin-left: 10px;
      padding: 1px 6px;
      font-size: 11px;
      font-family: var(--font-mono);
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.35);
      color: #ffffff;
      line-height: 1.2;
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
  padding: 8px 10px 4px;
  user-select: none;
}

.nav-section-divider {
  height: 1px;
  background: var(--line);
  margin: 8px 10px;
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
