<template>
  <!-- 模式 1：最小化挂起状态（Dock 胶囊条） -->
  <div
    v-if="isMinimized"
    class="compose-minimized-bar"
    @click="$emit('toggleMinimize')"
    :title="$t('restoreComposeWindow')"
  >
    <div class="mini-left">
      <div class="mini-icon-circle">
        <Icon icon="solar:pen-new-square-linear" width="15" height="15" />
      </div>
      <span class="mini-title-text">{{ subject || $t('newDraftTitle') }}</span>
    </div>
    <div class="mini-actions" @click.stop>
      <button
        type="button"
        class="mini-btn"
        @click="$emit('toggleMinimize')"
        :title="$t('expandWindow')"
      >
        <Icon icon="solar:maximize-square-linear" width="15" height="15" />
      </button>
      <button
        type="button"
        class="mini-btn close-btn"
        @click="$emit('close')"
        :title="$t('closeDraft')"
      >
        <Icon icon="solar:close-circle-bold" width="16" height="16" />
      </button>
    </div>
  </div>

  <!-- 模式 2：全尺寸编辑状态（标准顶栏） -->
  <div v-else class="compose-full-header">
    <div class="header-left">
      <div class="header-icon-wrap">
        <Icon icon="solar:pen-new-square-linear" width="18" height="18" />
      </div>
      <div class="sender-select-group">
        <span class="sender-label">{{ $t('sender') }}:</span>
        <el-select
          :model-value="modelValue"
          @change="$emit('update:modelValue', $event); $emit('change', $event)"
          size="default"
          class="sender-dropdown"
        >
          <el-option
            v-for="acc in accountOptions"
            :key="acc.accountId"
            :label="acc.name ? `${acc.name} <${acc.email}>` : acc.email"
            :value="acc.accountId"
          />
        </el-select>
      </div>
    </div>

    <div class="header-actions">
      <button
        type="button"
        class="action-icon-btn"
        @click="$emit('toggleMinimize')"
        :title="$t('minimizeToCorner')"
      >
        <Icon icon="solar:minimize-square-linear" width="17" height="17" />
      </button>
      <button
        type="button"
        class="action-icon-btn close"
        @click="$emit('close')"
        :title="$t('closeWindowEsc')"
      >
        <Icon icon="solar:close-circle-bold" width="18" height="18" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { Icon } from "@iconify/vue";
import { useI18n } from "vue-i18n";

const props = defineProps({
  modelValue: [String, Number],
  accountOptions: {
    type: Array,
    default: () => []
  },
  subject: {
    type: String,
    default: ''
  },
  isMinimized: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue', 'change', 'toggleMinimize', 'close']);
const { t } = useI18n();
</script>

<style scoped lang="scss">
/* 最小化挂起胶囊条样式 */
.compose-minimized-bar {
  width: 100%;
  height: 100%;
  padding: 0 8px 0 10px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  user-select: none;
  cursor: pointer;
  overflow: hidden;

  .mini-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
    overflow: hidden;

    .mini-icon-circle {
      width: 22px;
      height: 22px;
      border-radius: 5px;
      background: color-mix(in srgb, var(--accent) 12%, var(--surface));
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .mini-title-text {
      font-size: 12px;
      font-weight: 550;
      color: var(--text-strong);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
  }

  .mini-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    margin-left: 6px;

    .mini-btn {
      width: 22px;
      height: 22px;
      border: none;
      background: transparent;
      border-radius: 4px;
      color: var(--muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      transition: all 0.15s ease;

      &:hover {
        background: var(--paper-soft);
        color: var(--text-strong);
      }

      &.close-btn:hover {
        color: var(--el-color-danger, #ef4444);
        background: color-mix(in srgb, var(--el-color-danger, #ef4444) 10%, transparent);
      }
    }
  }
}

/* 全尺寸写信顶栏 */
.compose-full-header {
  height: 52px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  flex-shrink: 0;

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;

    .header-icon-wrap {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--accent) 12%, var(--surface));
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sender-select-group {
      display: flex;
      align-items: center;
      gap: 8px;

      .sender-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-strong);
        white-space: nowrap;
      }

      .sender-dropdown {
        min-width: 240px;
        max-width: 360px;
      }
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;

    .action-icon-btn {
      width: 30px;
      height: 30px;
      border: none;
      background: transparent;
      border-radius: 6px;
      color: var(--muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;

      &:hover {
        background: var(--paper-soft);
        color: var(--text-strong);
      }

      &.close:hover {
        color: var(--el-color-danger, #ef4444);
        background: color-mix(in srgb, var(--el-color-danger, #ef4444) 10%, transparent);
      }
    }
  }
}
</style>
