<template>
  <transition name="slide-up">
    <div class="floating-batch-bar arc-card" v-if="selectedCount > 0">
      <div class="batch-count-info">
        <span class="selected-num">{{ selectedCount }}</span>
        <span>{{ $t('messagesSelected') }}</span>
      </div>
      <div class="batch-actions">
        <el-button size="small" type="primary" plain class="arc-btn batch-btn" @click="$emit('markRead')">
          <Icon icon="ion:mail-open-outline" width="14" height="14" class="btn-icon" />
          <span class="btn-text-full">{{ $t('markAsReadBatch') }}</span>
          <span class="btn-text-short">{{ $t('readShort') }}</span>
        </el-button>
        <el-button size="small" type="warning" plain class="arc-btn batch-btn" @click="$emit('markStar')">
          <Icon icon="solar:star-line-duotone" width="14" height="14" class="btn-icon" />
          <span class="btn-text-full">{{ $t('markAsStarred') }}</span>
          <span class="btn-text-short">{{ $t('star') }}</span>
        </el-button>
        <el-button size="small" type="danger" plain class="arc-btn batch-btn" @click="$emit('deleteMails')">
          <Icon icon="ep:delete" width="14" height="14" class="btn-icon" />
          <span class="btn-text-full">{{ showDelete ? $t('deleteForever') : $t('moveToTrash') }}</span>
          <span class="btn-text-short">{{ $t('delete') }}</span>
        </el-button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { Icon } from "@iconify/vue"

const props = defineProps({
  selectedCount: Number,
  showDelete: Boolean
})

const emit = defineEmits(['markRead', 'markStar', 'deleteMails'])
</script>

<style scoped lang="scss">
.floating-batch-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
  max-width: calc(100% - 24px);
  box-sizing: border-box;

  .batch-count-info {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-strong);
    white-space: nowrap;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;

    .selected-num {
      font-weight: 700;
      color: var(--accent);
      margin-right: 3px;
    }
  }

  .batch-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;

    .batch-btn {
      margin-left: 0 !important;
      display: inline-flex;
      align-items: center;

      .btn-icon {
        margin-right: 4px;
        flex-shrink: 0;
      }
    }
  }

  .btn-text-short {
    display: none;
  }

  @media (max-width: 640px) {
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    gap: 8px;
    padding: 6px 10px;

    .batch-count-info {
      font-size: 12px;
    }

    .batch-actions {
      gap: 6px;

      .batch-btn {
        padding: 4px 8px !important;
        font-size: 12px;
        height: 28px;
      }
    }
  }

  @media (max-width: 480px) {
    gap: 6px;
    padding: 5px 8px;

    .btn-text-full {
      display: none;
    }
    .btn-text-short {
      display: inline;
    }

    .batch-actions {
      gap: 4px;

      .batch-btn {
        padding: 3px 6px !important;
        font-size: 11px;
        height: 26px;

        .btn-icon {
          margin-right: 2px;
        }
      }
    }
  }
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px) scale(0.95);
}
</style>
