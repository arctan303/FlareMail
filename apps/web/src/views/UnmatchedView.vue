<template>
  <el-scrollbar class="page-scroll">
    <div class="unmatched-page" v-loading="loading">
      <!-- 页面头部 -->
      <div class="page-header">
        <div class="header-left">
          <h2 class="page-title arc-serif-title">{{ $t('unmatchedTitle') }}</h2>
          <p class="page-desc">{{ $t('unmatchedDesc') }}</p>
        </div>
        <div class="header-actions">
          <el-button type="primary" plain class="arc-btn" :loading="loading" @click="loadList">
            <Icon icon="solar:restart-linear" width="16" height="16" style="margin-right: 6px;" />
            {{ $t('refreshList') }}
          </el-button>
        </div>
      </div>

      <!-- 主卡片 -->
      <div class="setting-card arc-card">
        <div class="card-header">
          <div class="header-left-group">
            <div class="header-icon">
              <Icon icon="solar:shield-check-linear" width="20" height="20" />
            </div>
            <div>
              <h3 class="card-title arc-serif-title">{{ $t('unmatchedListTitle') }}</h3>
              <p class="card-desc"><i18n-t keypath="unmatchedListDesc" scope="global"><template #total>{{ total }}</template></i18n-t></p>
            </div>
          </div>
        </div>

        <div class="card-body">
          <div class="notice-banner warning">
            <Icon icon="solar:danger-triangle-linear" width="16" height="16" class="notice-icon" />
            <span>{{ $t('unmatchedNotice') }}</span>
          </div>

          <div class="table-wrapper">
            <el-table :data="tableData" class="unmatched-table" style="width: 100%">
              <el-table-column prop="emailId" label="ID" width="75" />
              <el-table-column prop="sendEmail" ":label="$t('sender')" min-width="190">
                <template #default="{ row }">
                  <div class="sender-cell">
                    <span class="sender-name font-semibold" v-if="row.name">{{ row.name }}</span>
                    <span class="sender-email">&lt;{{ row.sendEmail }}&gt;</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="toEmail" ":label="$t('targetDeliveryAddress')" min-width="160">
                <template #default="{ row }">
                  <el-tag size="small" disable-transitions class="to-tag">{{ row.toEmail }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="subject" ":label="$t('subject')" min-width="200" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="subject-cell">{{ row.subject || $t('noSubjectParens') }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="createTime" ":label="$t('receivedAt')" width="165" />
              <el-table-column ":label="$t('action')" width="140" fixed="right">
                <template #default="{ row }">
                  <el-button type="primary" link size="small" @click="viewDetail(row)">{{ $t('viewContent') }}</el-button>
                  <el-button type="danger" link size="small" @click="handleDelete(row)">{{ $t('deletePermanently') }}</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="pagination-bar" v-if="total > 0">
            <el-pagination
                v-model:current-page="page"
                v-model:page-size="size"
                :total="total"
                background
                layout="total, prev, pager, next"
                @current-change="loadList"
            />
          </div>
        </div>
      </div>

      <!-- 详情弹窗 -->
      <el-dialog v-model="detailVisible" ":title="$t('unmatchedDetailTitle')" width="680px" class="arc-card">
        <div v-if="currentDetail" class="detail-box">
          <div class="detail-meta-grid">
            <div class="meta-item">
              <span class="meta-label">{{ $t('subjectLabel') }}</span>
              <span class="meta-value font-semibold">{{ currentDetail.subject || $t('noSubjectParens') }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ $t('senderLabel') }}</span>
              <span class="meta-value">{{ currentDetail.name ? `${currentDetail.name} <${currentDetail.sendEmail}>` : currentDetail.sendEmail }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ $t('recipientLabel') }}</span>
              <span class="meta-value">{{ currentDetail.toEmail }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ $t('receivedAtLabel') }}</span>
              <span class="meta-value">{{ currentDetail.createTime }}</span>
            </div>
          </div>
          <el-divider style="margin: 14px 0;" />
          <div class="mail-content-container">
            <div class="mail-html-preview" v-if="currentDetail.content" v-html="currentDetail.content"></div>
            <pre v-else class="mail-plain-text">{{ currentDetail.text }}</pre>
          </div>
        </div>
      </el-dialog>
    </div>
  </el-scrollbar>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { unmatchedList, unmatchedDetail, unmatchedDelete } from '@/request/unmatched.js';
import { ElMessage, ElMessageBox } from 'element-plus';

const loading = ref(false);
const tableData = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(15);
const detailVisible = ref(false);
const currentDetail = ref(null);

onMounted(loadList);

async function loadList() {
  loading.value = true;
  try {
    const res = await unmatchedList(page.value, size.value);
    tableData.value = res.list || [];
    total.value = res.total || 0;
  } catch (e) {
    ElMessage({ message: e.message || t('unmatchedLoadFailedMsg'), type: 'error', plain: true });
  } finally {
    loading.value = false;
  }
}

async function viewDetail(row) {
  try {
    const res = await unmatchedDetail(row.emailId);
    currentDetail.value = res;
    detailVisible.value = true;
  } catch (e) {
    ElMessage({ message: e.message || t('detailLoadFailedMsg'), type: 'error', plain: true });
  }
}

function handleDelete(row) {
  ElMessageBox.confirm(t('unmatchedDeleteConfirm'), t('deleteConfirmTitle'), {
    confirmButtonText: t('confirmDelete'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    try {
      await unmatchedDelete(row.emailId);
      ElMessage({ message: t('unmatchedDeletedMsg'), type: 'success', plain: true });
      await loadList();
    } catch (e) {
      ElMessage({ message: e.message || t('deleteFailedMsg'), type: 'error', plain: true });
    }
  });
}
</script>

<style scoped lang="scss">
.page-scroll {
  height: 100%;
  width: 100%;
  background: var(--bg);
}

.unmatched-page {
  padding: 32px 40px 80px;
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;

  @media (max-width: 767px) {
    padding: 16px 16px 60px;
    gap: 16px;
  }
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 10px;

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 4px;

    .page-title {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-strong);
      margin: 0;
      letter-spacing: -0.02em;
    }

    .page-desc {
      font-size: 13.5px;
      color: var(--muted);
      margin: 0;
    }
  }

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;

    .header-actions {
      width: 100%;
      button {
        width: 100%;
      }
    }
  }
}

.setting-card {
  padding: 24px 28px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--line);

    .header-left-group {
      display: flex;
      align-items: center;
      gap: 12px;

      .header-icon {
        width: 36px;
        height: 36px;
        border-radius: 9px;
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .card-title {
        font-size: 16.5px;
        font-weight: 600;
        color: var(--text-strong);
        margin: 0 0 2px 0;
      }

      .card-desc {
        font-size: 12.5px;
        color: var(--muted);
        margin: 0;
      }
    }
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-top: 18px;
  }
}

.notice-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;

  &.warning {
    background: color-mix(in srgb, #f59e0b 12%, transparent);
    border: 1px solid color-mix(in srgb, #f59e0b 30%, transparent);
    color: #d97706;
  }

  .notice-icon {
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.table-wrapper {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface);

  .unmatched-table {
    --el-table-border-color: var(--line);
    --el-table-header-bg-color: color-mix(in srgb, var(--paper-soft) 80%, transparent);
    --el-table-bg-color: var(--surface);
    --el-table-tr-bg-color: var(--surface);
    --el-table-row-hover-bg-color: color-mix(in srgb, var(--paper-soft) 60%, transparent);
  }

  .sender-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;

    .sender-name {
      font-size: 13.5px;
      color: var(--text-strong);
    }
    .sender-email {
      font-size: 12px;
      color: var(--muted);
    }
  }

  .to-tag {
    font-family: monospace;
    font-size: 12px;
  }

  .subject-cell {
    font-weight: 500;
    color: var(--text-strong);
  }
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.detail-box {
  .detail-meta-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .meta-item {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 13.5px;

      .meta-label {
        width: 75px;
        color: var(--muted);
        flex-shrink: 0;
      }
      .meta-value {
        color: var(--text-strong);
      }
    }
  }

  .mail-content-container {
    max-height: 380px;
    overflow-y: auto;
    padding: 14px;
    background: color-mix(in srgb, var(--paper-soft) 60%, transparent);
    border-radius: 8px;
    border: 1px solid var(--line);

    .mail-plain-text {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      margin: 0;
      font-size: 13.5px;
      color: var(--text);
      line-height: 1.6;
    }
  }
}
</style>
