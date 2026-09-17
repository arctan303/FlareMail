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
      <!-- 架构版本状态对比区 -->
      <div class="version-overview-grid" v-loading="schemaLoading">
        <div class="version-stat-item">
          <span class="stat-label">{{ $t('sysDbCurrentVersion') }}</span>
          <div class="stat-value">
            <span v-if="schemaData?.currentVersion" class="version-chip current">
              {{ schemaData.currentVersion.label }}
              <small class="version-id">({{ $t('sysDbPatchTag') }} {{ schemaData.currentVersion.id }})</small>
            </span>
            <span v-else class="version-empty">-</span>
          </div>
        </div>

        <div class="version-stat-item">
          <span class="stat-label">{{ $t('sysDbLatestVersion') }}</span>
          <div class="stat-value">
            <span v-if="schemaData?.latestVersion" class="version-chip latest">
              {{ schemaData.latestVersion.label }}
              <small class="version-id">({{ $t('sysDbPatchTag') }} {{ schemaData.latestVersion.id }})</small>
            </span>
            <span v-else class="version-empty">-</span>
          </div>
        </div>

        <div class="version-stat-item">
          <span class="stat-label">{{ $t('sysDbStatus') }}</span>
          <div class="stat-value">
            <el-tag v-if="!isPending" type="success" size="small" effect="plain" class="status-badge">
              <Icon icon="fluent:checkmark-circle-16-regular" width="14" height="14" class="status-badge-icon" />
              {{ $t('sysDbStatusUpToDate') }}
            </el-tag>
            <el-tag v-else type="warning" size="small" effect="plain" class="status-badge">
              <Icon icon="fluent:alert-16-regular" width="14" height="14" class="status-badge-icon" />
              {{ $t('sysDbStatusPending') }}
            </el-tag>
          </div>
        </div>
      </div>

      <!-- 待升级补丁说明 (若有) -->
      <div v-if="pendingPatches.length" class="notice-banner warning">
        <Icon icon="solar:info-circle-linear" width="16" height="16" />
        <div class="pending-patches-content">
          <p class="pending-title"><strong>{{ $t('sysDbPendingPatchesTitle') }}</strong></p>
          <ul class="pending-list">
            <li v-for="patch in pendingPatches" :key="patch.version">
              <strong>{{ patch.label }} ({{ $t('sysDbPatchTag') }} {{ patch.version }})</strong>: {{ $t(patch.descKey) }}
            </li>
          </ul>
        </div>
      </div>

      <div class="field-hint">
        <Icon icon="solar:info-circle-linear" width="16" height="16" />
        <span>{{ $t('sysDbMaintenanceHint') }}</span>
      </div>

      <!-- 操作与刷新按钮 -->
      <div class="actions-row">
        <el-button
          class="arc-btn"
          type="primary"
          plain
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

      <p v-if="result || error" :class="['feedback', { success: !error }]" role="status">{{ error || result }}</p>
      <p v-if="schemaError" class="feedback" role="status">{{ schemaError }}</p>

      <!-- 折叠面板：只读历史补丁记录 -->
      <details v-if="schemaData?.history?.length" class="help-details patch-history-details">
        <summary class="history-summary">
          <Icon icon="fluent:history-16-regular" width="15" height="15" style="margin-right: 6px;" />
          {{ $t('sysDbPatchHistoryTitle') }} ({{ schemaData.history.length }})
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  padding: 14px 16px;
  background: var(--paper-soft);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.version-stat-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-label {
  font-size: 12px;
  color: var(--muted);
  font-weight: 500;
}

.stat-value {
  display: flex;
  align-items: center;
  min-height: 24px;
}

.version-empty {
  font-size: 13px;
  color: var(--muted);
}

.version-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);

  .version-id {
    font-size: 11px;
    font-weight: 400;
    color: var(--muted);
  }
}

.status-badge {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;

  .status-badge-icon {
    margin-right: 4px;
  }
}

.actions-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.reload-btn {
  font-size: 12px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  &:hover {
    color: var(--text);
  }
}

.pending-patches-content {
  flex: 1;
  min-width: 0;

  .pending-title {
    margin: 0 0 6px;
    font-size: 12px;
  }

  .pending-list {
    margin: 0;
    padding-left: 18px;
    font-size: 12px;
    line-height: 1.6;
  }
}

.patch-history-details {
  border-top: 1px solid var(--line);
  padding-top: 14px;

  .history-summary {
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-strong);
    cursor: pointer;
    user-select: none;

    &:hover {
      color: var(--accent);
    }
  }

  .history-table-wrapper {
    margin-top: 12px;
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
  }

  .patch-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;

    th {
      position: sticky;
      top: 0;
      background: var(--surface);
      color: var(--muted);
      font-weight: 500;
      padding: 8px 12px;
      border-bottom: 1px solid var(--line);
      z-index: 1;
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--line);
      color: var(--text);
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .col-version {
      width: 150px;
      white-space: nowrap;
    }

    .patch-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--paper-soft);
      font-weight: 600;
      color: var(--text-strong);
      border: 1px solid var(--line);
    }

    .patch-id {
      margin-left: 6px;
      font-size: 11px;
      color: var(--muted);
    }

    .col-desc {
      color: var(--text);
    }

    .col-time {
      width: 160px;
      white-space: nowrap;
      color: var(--muted);
      font-size: 11px;
    }
  }
}
</style>
