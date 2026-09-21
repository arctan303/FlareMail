<template>
  <div class="setting-card arc-card db-maintenance-card">
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
      <div class="header-right-actions">
        <el-button
          link
          type="info"
          :loading="schemaLoading"
          class="reload-btn"
          :title="$t('sysDbReloadSchema')"
          @click="loadSchema"
        >
          <Icon icon="solar:restart-linear" width="15" height="15" class="reload-icon" :class="{ 'is-spinning': schemaLoading }" />
          <span class="reload-text">{{ $t('sysDbReloadSchema') }}</span>
        </el-button>
      </div>
    </div>

    <div class="card-body db-maintenance-body" v-loading="schemaLoading">
      <!-- 核心升级中枢面板 (Hero Status Banner) -->
      <div class="maintenance-hero-panel" :class="{ 'is-pending': isPending }">
        <div class="hero-left-content">
          <!-- 版本流向与状态标签 -->
          <div class="version-flow-container">
            <div class="version-flow">
              <div class="version-node">
                <span class="node-label">{{ $t('sysDbCurrentVersion') }}</span>
                <span class="node-badge current">
                  {{ schemaData?.currentVersion?.label || '-' }}
                  <small v-if="schemaData?.currentVersion?.id">#{{ schemaData.currentVersion.id }}</small>
                </span>
              </div>

              <div class="version-connector" v-if="isPending && schemaData?.latestVersion">
                <Icon icon="solar:alt-arrow-right-linear" width="16" height="16" />
              </div>

              <div class="version-node" v-if="isPending && schemaData?.latestVersion">
                <span class="node-label">{{ $t('sysDbLatestVersion') }}</span>
                <span class="node-badge target">
                  {{ schemaData.latestVersion.label }}
                  <small>#{{ schemaData.latestVersion.id }}</small>
                </span>
              </div>
            </div>

            <div class="status-indicator-pill" :class="isPending ? 'pending' : 'up-to-date'">
              <span class="status-dot"></span>
              <span class="status-text">{{ isPending ? $t('sysDbStatusPending') : $t('sysDbStatusUpToDate') }}</span>
            </div>
          </div>

          <!-- 安全与维护说明 -->
          <div class="hero-hint">
            <Icon icon="solar:shield-check-linear" width="16" height="16" class="hint-icon" />
            <span class="hint-text">{{ $t('sysDbMaintenanceHint') }}</span>
          </div>
        </div>

        <!-- 主操作行动区 -->
        <div class="hero-actions">
          <el-button
            class="arc-btn upgrade-cta-btn"
            type="primary"
            :loading="upgradeLoading"
            @click="$emit('upgrade')"
          >
            <Icon icon="fluent:arrow-sync-20-regular" width="16" height="16" class="btn-icon" />
            <span>{{ (upgradePending || isPending) ? $t('upgradeDatabase') : $t('sysDbCheckUpgrade') }}</span>
          </el-button>
        </div>
      </div>

      <!-- 待升级补丁清单 (若有) -->
      <div v-if="pendingPatches.length" class="pending-section">
        <div class="section-title-row">
          <div class="title-left">
            <Icon icon="solar:info-circle-linear" width="16" height="16" class="section-icon" />
            <span class="section-title">{{ $t('sysDbPendingPatchesTitle') }}</span>
            <span class="count-badge">{{ pendingPatches.length }}</span>
          </div>
        </div>

        <div class="pending-patch-list">
          <div v-for="patch in pendingPatches" :key="patch.version" class="pending-patch-item">
            <div class="patch-badge-wrap">
              <span class="patch-version-tag">{{ patch.label }}</span>
              <span class="patch-id-tag">#{{ patch.version }}</span>
            </div>
            <div class="patch-desc-content">
              <span class="patch-desc-text">{{ $t(patch.descKey) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 反馈结果提示 -->
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="feedback-alert" />
      <el-alert v-else-if="result" type="success" :closable="false" show-icon :title="result" class="feedback-alert" />
      <el-alert v-if="schemaError" type="warning" :closable="false" show-icon :title="schemaError" class="feedback-alert" />

      <!-- 折叠面板：只读历史补丁记录 -->
      <details v-if="schemaData?.history?.length" class="patch-history-details">
        <summary class="history-summary">
          <div class="summary-left">
            <Icon icon="fluent:history-16-regular" width="16" height="16" class="history-icon" />
            <span class="history-title">{{ $t('sysDbPatchHistoryTitle') }}</span>
            <span class="history-count-badge">{{ schemaData.history.length }}</span>
          </div>
          <Icon icon="solar:alt-arrow-down-linear" width="14" height="14" class="chevron-icon" />
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

.db-maintenance-card {
  .header-right-actions {
    display: flex;
    align-items: center;

    .reload-btn {
      font-size: 13px;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 10px;
      border-radius: 6px;
      transition: all 0.15s ease;

      &:hover {
        color: var(--accent);
        background: var(--paper-soft);
      }

      .reload-icon {
        flex-shrink: 0;
      }
    }
  }
}

.db-maintenance-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 1. 核心升级中枢面板 */
.maintenance-hero-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px;
  border-radius: 12px;
  background: var(--paper-soft);
  border: 1px solid var(--line);
  transition: all 0.2s ease;

  &.is-pending {
    background: color-mix(in srgb, var(--accent) 5%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 20%, var(--line));
    box-shadow: 0 2px 12px color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .hero-left-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .version-flow-container {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .version-flow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .version-node {
    display: flex;
    flex-direction: column;
    gap: 4px;

    .node-label {
      font-size: 11.5px;
      color: var(--muted);
      font-weight: 500;
      letter-spacing: 0.02em;
    }

    .node-badge {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.2;

      small {
        font-size: 11px;
        font-weight: 500;
        font-family: var(--font-mono, monospace);
        opacity: 0.7;
      }

      &.current {
        background: var(--surface);
        border: 1px solid var(--line);
        color: var(--text-strong);
      }

      &.target {
        background: color-mix(in srgb, var(--accent) 12%, var(--surface));
        border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
        color: var(--accent);
      }
    }
  }

  .version-connector {
    color: var(--muted);
    display: flex;
    align-items: center;
    margin-top: 16px;
  }

  .status-indicator-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 9999px;
    font-size: 12px;
    font-weight: 600;
    margin-top: 14px;

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }

    &.up-to-date {
      background: color-mix(in srgb, #10b981 12%, transparent);
      color: #059669;

      .status-dot {
        background: #10b981;
      }
    }

    &.pending {
      background: color-mix(in srgb, #f59e0b 14%, transparent);
      color: #d97706;

      .status-dot {
        background: #f59e0b;
        animation: pulse-dot 2s infinite;
      }
    }
  }

  .hero-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.45;

    .hint-icon {
      flex-shrink: 0;
      color: var(--accent);
      opacity: 0.8;
    }
  }

  .hero-actions {
    flex-shrink: 0;

    .upgrade-cta-btn {
      min-height: 40px;
      padding: 0 22px;
      font-weight: 600;
      font-size: 13.5px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 25%, transparent);

      .btn-icon {
        flex-shrink: 0;
      }
    }
  }

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    padding: 16px;

    .hero-actions {
      .upgrade-cta-btn {
        width: 100%;
        justify-content: center;
      }
    }
  }
}

/* 2. 待升级补丁清单 */
.pending-section {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .title-left {
      display: flex;
      align-items: center;
      gap: 6px;

      .section-icon {
        color: var(--accent);
      }

      .section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-strong);
      }

      .count-badge {
        font-size: 11px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 9999px;
        background: color-mix(in srgb, var(--accent) 15%, transparent);
        color: var(--accent);
      }
    }
  }

  .pending-patch-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pending-patch-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    transition: all 0.15s ease;

    &:hover {
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
    }

    .patch-badge-wrap {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;

      .patch-version-tag {
        font-weight: 700;
        font-size: 12px;
        color: var(--text-strong);
        background: var(--paper-soft);
        padding: 2px 7px;
        border-radius: 5px;
        border: 1px solid var(--line);
      }

      .patch-id-tag {
        font-size: 11px;
        color: var(--muted);
        font-family: var(--font-mono, monospace);
      }
    }

    .patch-desc-content {
      flex: 1;
      font-size: 13px;
      color: var(--text);
      line-height: 1.4;
    }
  }
}

/* 3. 历史记录折叠 */
.patch-history-details {
  border-top: 1px solid var(--line);
  padding-top: 16px;

  .history-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-strong);
    cursor: pointer;
    user-select: none;
    padding: 6px 0;
    transition: color 0.15s ease;

    &:hover {
      color: var(--accent);
    }

    .summary-left {
      display: flex;
      align-items: center;
      gap: 8px;

      .history-icon {
        color: var(--muted);
      }

      .history-count-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 9999px;
        background: var(--paper-soft);
        color: var(--muted);
        border: 1px solid var(--line);
      }
    }

    .chevron-icon {
      color: var(--muted);
      transition: transform 0.2s ease;
    }
  }

  &[open] .history-summary .chevron-icon {
    transform: rotate(180deg);
  }

  .history-table-wrapper {
    margin-top: 12px;
    max-height: 360px;
    overflow-x: auto;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
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
      width: 140px;
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

.feedback-alert {
  border-radius: 8px;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}
</style>
