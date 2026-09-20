<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon">
          <Icon icon="solar:server-square-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysDbMaintenanceTitle') }}</h3>
          <p class="card-desc">{{ $t('sysDbMaintenanceDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body db-maintenance-body">
      <!-- 架构版本状态对比区 (3 个精致 Metric 卡片) -->
      <div class="version-overview-grid" v-loading="schemaLoading">
        <div class="stat-card">
          <div class="stat-head">
            <Icon icon="solar:server-square-linear" width="16" height="16" class="stat-icon" />
            <span class="stat-label">{{ $t('sysDbCurrentVersion') }}</span>
          </div>
          <div class="stat-body">
            <span v-if="schemaData?.currentVersion" class="version-val">
              {{ schemaData.currentVersion.label }}
              <span class="version-patch-id">#{{ schemaData.currentVersion.id }}</span>
            </span>
            <span v-else class="version-empty">-</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-head">
            <Icon icon="solar:refresh-circle-linear" width="16" height="16" class="stat-icon" />
            <span class="stat-label">{{ $t('sysDbLatestVersion') }}</span>
          </div>
          <div class="stat-body">
            <span v-if="schemaData?.latestVersion" class="version-val">
              {{ schemaData.latestVersion.label }}
              <span class="version-patch-id">#{{ schemaData.latestVersion.id }}</span>
            </span>
            <span v-else class="version-empty">-</span>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-head">
            <Icon icon="solar:shield-check-linear" width="16" height="16" class="stat-icon" />
            <span class="stat-label">{{ $t('sysDbStatus') }}</span>
          </div>
          <div class="stat-body">
            <span v-if="!isPending" class="status-chip success">
              <Icon icon="fluent:checkmark-circle-16-regular" width="15" height="15" />
              {{ $t('sysDbStatusUpToDate') }}
            </span>
            <span v-else class="status-chip warning">
              <Icon icon="fluent:alert-16-regular" width="15" height="15" />
              {{ $t('sysDbStatusPending') }}
            </span>
          </div>
        </div>
      </div>

      <!-- 待升级补丁说明 (若有) -->
      <div v-if="pendingPatches.length" class="pending-patches-card">
        <div class="pending-head">
          <Icon icon="solar:info-circle-linear" width="18" height="18" class="pending-icon" />
          <span class="pending-title">{{ $t('sysDbPendingPatchesTitle') }} ({{ pendingPatches.length }})</span>
        </div>
        <div class="pending-list">
          <div v-for="patch in pendingPatches" :key="patch.version" class="pending-item">
            <span class="patch-badge">{{ patch.label }} <small>#{{ patch.version }}</small></span>
            <span class="patch-desc">{{ $t(patch.descKey) }}</span>
          </div>
        </div>
      </div>

      <!-- 安全与操作提示 -->
      <div class="info-callout">
        <Icon icon="solar:info-circle-linear" width="16" height="16" class="callout-icon" />
        <div class="callout-content">
          <p>{{ $t('sysDbMaintenanceHint') }}</p>
        </div>
      </div>

      <!-- 操作与刷新按钮 -->
      <div class="actions-row">
        <el-button
          class="arc-btn upgrade-btn"
          type="primary"
          :loading="upgradeLoading"
          @click="$emit('upgrade')"
        >
          <Icon icon="fluent:arrow-sync-20-regular" width="16" height="16" style="margin-right: 6px;" />
          {{ (upgradePending || isPending) ? $t('upgradeDatabase') : $t('sysDbCheckUpgrade') }}
        </el-button>

        <el-button
          link
          type="info"
          :loading="schemaLoading"
          class="reload-btn"
          @click="loadSchema"
        >
          <Icon icon="solar:refresh-linear" width="15" height="15" style="margin-right: 4px;" />
          {{ $t('sysDbReloadSchema') }}
        </el-button>
      </div>

      <!-- 反馈提示：使用规范的 el-alert 呈现 -->
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="feedback-alert" />
      <el-alert v-else-if="result" type="success" :closable="false" show-icon :title="result" class="feedback-alert" />
      <el-alert v-if="schemaError" type="warning" :closable="false" show-icon :title="schemaError" class="feedback-alert" />

      <!-- 折叠面板：只读历史补丁记录 -->
      <details v-if="schemaData?.history?.length" class="help-details patch-history-details">
        <summary class="history-summary">
          <Icon icon="fluent:history-16-regular" width="16" height="16" style="margin-right: 8px;" />
          <span>{{ $t('sysDbPatchHistoryTitle') }} ({{ schemaData.history.length }})</span>
        </summary>
        <div class="history-table-wrapper">
          <table class="patch-table">
            <thead>
              <tr>
                <th class="col-version">{{ $t('sysDbPatchVersion') }}</th>
                <th class="col-desc">{{ $t('sysDbPatchDescription') }}</th>
                <th class="col-time">{{ $t('sysDbPatchAppliedTime') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="patch in schemaData.history" :key="patch.version">
                <td class="col-version">
                  <span class="patch-badge">{{ patch.label }}</span>
                  <span class="patch-id">#{{ patch.version }}</span>
                </td>
                <td class="col-desc">{{ $t(patch.descKey) }}</td>
                <td class="col-time">{{ patch.appliedTime || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { adminSchemaStatus } from '@/request/setting.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  upgradeLoading: { type: Boolean, default: false },
  upgradePending: { type: Boolean, default: false },
  result: { type: String, default: '' },
  error: { type: String, default: '' }
})

defineEmits(['upgrade'])

const schemaData = ref(null)
const schemaLoading = ref(false)
const schemaError = ref('')

const isPending = computed(() => {
  return props.upgradePending || schemaData.value?.upgradeRequired === true
})

const pendingPatches = computed(() => {
  return schemaData.value?.pendingPatches || []
})

async function loadSchema() {
  if (schemaLoading.value) return
  schemaLoading.value = true
  schemaError.value = ''
  try {
    const res = await adminSchemaStatus()
    schemaData.value = res?.data || res || null
  } catch (err) {
    schemaError.value = err?.message || t('sysDbLoadSchemaFailed')
  } finally {
    schemaLoading.value = false
  }
}

watch(() => props.result, (newVal) => {
  if (newVal) {
    loadSchema()
  }
})

watch(() => props.upgradeLoading, (loading, prev) => {
  if (prev && !loading && !props.error) {
    loadSchema()
  }
})

onMounted(() => {
  loadSchema()
})
</script>

<style lang="scss" scoped>
@use './card' as *;

.version-overview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: var(--paper-soft);
  border: 1px solid var(--line);
  border-radius: 10px;
  transition: all 0.15s ease;

  .stat-head {
    display: flex;
    align-items: center;
    gap: 8px;

    .stat-icon {
      color: var(--muted);
      flex-shrink: 0;
    }

    .stat-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
    }
  }

  .stat-body {
    display: flex;
    align-items: baseline;
    min-height: 28px;
  }

  .version-val {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-strong);
    display: inline-flex;
    align-items: baseline;
    gap: 6px;

    .version-patch-id {
      font-size: 11.5px;
      font-weight: 500;
      color: var(--muted);
      font-family: var(--font-mono, monospace);
    }
  }

  .version-empty {
    font-size: 14px;
    color: var(--muted);
  }

  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;

    &.success {
      background: color-mix(in srgb, #10b981 12%, transparent);
      color: #059669;
    }

    &.warning {
      background: color-mix(in srgb, #f59e0b 15%, transparent);
      color: #d97706;
    }
  }
}

.pending-patches-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--el-color-warning) 8%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--el-color-warning) 25%, transparent);

  .pending-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--el-color-warning);

    .pending-icon {
      flex-shrink: 0;
    }

    .pending-title {
      font-size: 13.5px;
      font-weight: 600;
    }
  }

  .pending-list {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .pending-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 12.5px;
      line-height: 1.5;

      .patch-badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 5px;
        background: var(--surface);
        border: 1px solid color-mix(in srgb, var(--el-color-warning) 30%, transparent);
        font-weight: 600;
        font-size: 11.5px;
        color: var(--text-strong);

        small {
          color: var(--muted);
          font-family: var(--font-mono, monospace);
        }
      }

      .patch-desc {
        color: var(--text);
      }
    }
  }
}

.actions-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 4px;

  .upgrade-btn {
    min-height: 38px;
    padding: 0 20px;
    font-weight: 600;
  }

  .reload-btn {
    font-size: 12.5px;
    color: var(--muted);
    display: inline-flex;
    align-items: center;

    &:hover {
      color: var(--accent);
    }
  }

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;

    .upgrade-btn {
      width: 100%;
      justify-content: center;
    }

    .reload-btn {
      justify-content: center;
    }
  }
}

.feedback-alert {
  margin-top: -6px;
  border-radius: 8px;
}

.patch-history-details {
  border-top: 1px solid var(--line);
  padding-top: 16px;

  .history-summary {
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-strong);
    cursor: pointer;
    user-select: none;
    padding: 4px 0;
    transition: color 0.15s ease;

    &:hover {
      color: var(--accent);
    }
  }

  .history-table-wrapper {
    margin-top: 12px;
    max-height: 360px;
    overflow-x: auto;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .patch-table {
    width: 100%;
    min-width: 520px;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;

    th {
      position: sticky;
      top: 0;
      background: var(--paper-soft);
      color: var(--muted);
      font-weight: 600;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      z-index: 1;
    }

    td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      color: var(--text);
    }

    tr:last-child td {
      border-bottom: 0;
    }

    tr:hover td {
      background: color-mix(in srgb, var(--paper-soft) 50%, transparent);
    }

    .col-version {
      width: 150px;
      white-space: nowrap;
    }

    .patch-badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 5px;
      background: var(--paper-soft);
      font-weight: 600;
      color: var(--text-strong);
      border: 1px solid var(--line);
    }

    .patch-id {
      margin-left: 6px;
      font-size: 11px;
      color: var(--muted);
      font-family: var(--font-mono, monospace);
    }

    .col-desc {
      color: var(--text);
      line-height: 1.5;
    }

    .col-time {
      width: 160px;
      white-space: nowrap;
      color: var(--muted);
      font-size: 11.5px;
    }
  }
}
</style>
