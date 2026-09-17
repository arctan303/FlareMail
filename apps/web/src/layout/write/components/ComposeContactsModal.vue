<template>
  <el-dialog
    top="10vh"
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    @closed="handleClosed"
    width="580px"
    class="compose-contacts-dialog arc-card"
    :title="t('contacts')"
    append-to-body
  >
    <div class="modal-body">
      <!-- 双 Tab 切换 -->
      <el-tabs v-model="activeTab" class="contacts-tabs">
        <!-- Tab 1: 通讯录联系人 -->
        <el-tab-pane :label="t('contacts')" name="contacts">
          <div class="tab-content">
            <!-- 搜索与分组过滤栏 -->
            <div class="filter-bar">
              <el-input
                v-model="contactSearch"
                :placeholder="t('searchContactsPlaceholder')"
                clearable
                size="default"
                class="search-input"
              >
                <template #prefix>
                  <Icon icon="ri:search-line" width="15" height="15" style="color: var(--el-text-color-secondary)" />
                </template>
              </el-input>

              <el-select
                v-if="groups.length > 0"
                v-model="selectedGroup"
                size="default"
                class="group-select"
                :placeholder="$t('all')"
              >
                <el-option :label="$t('allGroups')" value="ALL" />
                <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
              </el-select>
            </div>

            <!-- 联系人表格 -->
            <div class="table-wrap">
              <el-table
                ref="contactsTableRef"
                :data="filteredContactList"
                row-key="email"
                height="340px"
                @selection-change="onContactSelectionChange"
                stripe
              >
                <el-table-column type="selection" width="40" />
                <el-table-column :label="t('contactName')" min-width="140">
                  <template #default="{ row }">
                    <div class="name-cell">
                      <div class="mini-avatar" :style="{ backgroundColor: getAvatarColor(row.name) }">
                        {{ getInitials(row.name) }}
                      </div>
                      <span class="cell-name">{{ row.name }}</span>
                      <span class="cell-group-badge" v-if="row.groupName">{{ row.groupName }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column property="email" :label="t('contactEmail')" min-width="180">
                  <template #default="{ row }">
                    <span class="cell-email">{{ row.email }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <!-- Tab 2: 最近发件记录 -->
        <el-tab-pane :label="t('recentContacts')" name="recent">
          <div class="tab-content">
            <!-- 搜索与清空工具栏 -->
            <div class="filter-bar">
              <el-input
                v-model="recentSearch"
                :placeholder="$t('searchRecentRecipients')"
                clearable
                size="default"
                class="search-input"
              >
                <template #prefix>
                  <Icon icon="ri:search-line" width="15" height="15" style="color: var(--el-text-color-secondary)" />
                </template>
              </el-input>

              <el-button
                v-if="recentList.length > 0"
                type="danger"
                plain
                size="default"
                @click="handleClearAllRecent"
              >
                {{ t('clearRecentHistory') }}
              </el-button>
            </div>

            <!-- 最近联系人表格 -->
            <div class="table-wrap">
              <el-table
                ref="recentTableRef"
                :data="filteredRecentList"
                row-key="email"
                height="340px"
                @selection-change="onRecentSelectionChange"
                stripe
              >
                <el-table-column type="selection" width="40" />
                <el-table-column property="email" :label="t('emailAccount')" min-width="240">
                  <template #default="{ row }">
                    <div class="recent-row">
                      <Icon icon="solar:history-line-duotone" width="16" height="16" style="color: var(--el-text-color-secondary); margin-right: 6px;" />
                      <span class="cell-email">{{ row.email }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column width="60" align="center">
                  <template #default="{ row }">
                    <el-tooltip :content="$t('deleteThisRecord')" placement="top">
                      <el-button link type="danger" @click.stop="$emit('deleteRecent', row.email)">
                        <Icon icon="ep:delete" width="14" height="14" />
                      </el-button>
                    </el-tooltip>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 底部操作栏 -->
    <template #footer>
      <div class="modal-footer">
        <div class="selected-summary">
          <span v-if="totalSelectedCount > 0" class="summary-text">
            <i18n-t keypath="selectedCount" scope="global">
              <template #count><strong class="count-num">{{ totalSelectedCount }}</strong></template>
            </i18n-t>
          </span>
          <span v-else class="summary-text text-muted">{{ $t('selectContactsHint') }}</span>
        </div>
        <div class="footer-btns">
          <el-button @click="$emit('update:visible', false)">{{ t('cancel') }}</el-button>
          <el-button
            type="primary"
            class="arc-btn"
            :disabled="totalSelectedCount === 0"
            @click="confirmSelection"
          >
            {{ t('addRecipients') }} {{ totalSelectedCount > 0 ? `(${totalSelectedCount})` : '' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import { ElMessageBox } from 'element-plus';

const props = defineProps({
  visible: Boolean,
  contacts: {
    type: Array,
    default: () => []
  },
  recentRecipients: {
    type: Array,
    default: () => []
  },
  currentRecipients: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['update:visible', 'closed', 'select', 'deleteRecent', 'clearRecent']);
const { t } = useI18n();

const activeTab = ref('contacts');
const contactSearch = ref('');
const selectedGroup = ref('ALL');
const recentSearch = ref('');

const contactsTableRef = ref(null);
const recentTableRef = ref(null);

const selectedContactRows = ref([]);
const selectedRecentRows = ref([]);

const groups = computed(() => {
  const set = new Set();
  props.contacts.forEach(c => {
    if (c.groupName && c.groupName.trim()) set.add(c.groupName.trim());
  });
  return Array.from(set);
});

const filteredContactList = computed(() => {
  return props.contacts.filter(item => {
    if (selectedGroup.value !== 'ALL' && item.groupName !== selectedGroup.value) {
      return false;
    }
    if (contactSearch.value && contactSearch.value.trim() !== '') {
      const kw = contactSearch.value.trim().toLowerCase();
      const nMatch = (item.name || '').toLowerCase().includes(kw);
      const eMatch = (item.email || '').toLowerCase().includes(kw);
      return nMatch || eMatch;
    }
    return true;
  });
});

const recentList = computed(() => {
  return props.recentRecipients.map(email => ({ email }));
});

const filteredRecentList = computed(() => {
  if (!recentSearch.value || recentSearch.value.trim() === '') {
    return recentList.value;
  }
  const kw = recentSearch.value.trim().toLowerCase();
  return recentList.value.filter(item => item.email.toLowerCase().includes(kw));
});

function onContactSelectionChange(selection) {
  selectedContactRows.value = selection;
}

function onRecentSelectionChange(selection) {
  selectedRecentRows.value = selection;
}

const totalSelectedCount = computed(() => {
  const set = new Set();
  selectedContactRows.value.forEach(r => set.add(r.email));
  selectedRecentRows.value.forEach(r => set.add(r.email));
  return set.size;
});

function confirmSelection() {
  const set = new Set();
  selectedContactRows.value.forEach(r => set.add(r.email));
  selectedRecentRows.value.forEach(r => set.add(r.email));
  emit('select', Array.from(set));
  emit('update:visible', false);
}

function handleClearAllRecent() {
  ElMessageBox.confirm(
    t('confirmClearRecentRecipients'),
    t('clearHistoryTitle'),
    {
      confirmButtonText: t('confirm'),
      cancelButtonText: t('cancel'),
      type: 'warning'
    }
  ).then(() => {
    emit('clearRecent');
  }).catch(() => {});
}

function handleClosed() {
  selectedContactRows.value = [];
  selectedRecentRows.value = [];
  contactSearch.value = '';
  recentSearch.value = '';
  emit('closed');
}

// When opening, pre-check if any current recipients exist
watch(() => props.visible, (val) => {
  if (val) {
    nextTick(() => {
      if (contactsTableRef.value) {
        contactsTableRef.value.clearSelection();
        filteredContactList.value.forEach(row => {
          if (props.currentRecipients.includes(row.email)) {
            contactsTableRef.value.toggleRowSelection(row, true);
          }
        });
      }
      if (recentTableRef.value) {
        recentTableRef.value.clearSelection();
        filteredRecentList.value.forEach(row => {
          if (props.currentRecipients.includes(row.email)) {
            recentTableRef.value.toggleRowSelection(row, true);
          }
        });
      }
    });
  }
});

function getInitials(name) {
  if (!name) return 'U';
  return name.trim().slice(0, 1).toUpperCase();
}

const AVATAR_COLORS = [
  '#4f46e5', '#2563eb', '#0891b2', '#0d9488',
  '#059669', '#d97706', '#dc2626', '#7c3aed'
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
</script>

<style scoped lang="scss">
.compose-contacts-dialog {
  :deep(.el-dialog__body) {
    padding: 10px 20px 16px 20px;
  }
}

.contacts-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 12px;
  }
}

.tab-content {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .filter-bar {
    display: flex;
    align-items: center;
    gap: 10px;

    .search-input {
      flex: 1;
    }

    .group-select {
      width: 140px;
    }
  }

  .table-wrap {
    border-radius: 8px;
    border: 1px solid var(--el-border-color-lighter, #e2e8f0);
    overflow: hidden;
  }
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;

  .mini-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .cell-name {
    font-weight: 500;
    color: var(--el-text-color-primary, #0f172a);
  }

  .cell-group-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 8px;
    background-color: var(--el-fill-color, #f1f5f9);
    color: var(--el-text-color-secondary, #64748b);
  }
}

.cell-email {
  font-size: 13px;
  color: var(--el-text-color-regular, #334155);
}

.recent-row {
  display: flex;
  align-items: center;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-top: 10px;

  .selected-summary {
    .summary-text {
      font-size: 13px;
      color: var(--el-text-color-regular, #475569);

      .count-num {
        color: var(--accent, #6366f1);
        font-size: 14px;
      }

      &.text-muted {
        color: var(--el-text-color-secondary, #94a3b8);
      }
    }
  }

  .footer-btns {
    display: flex;
    gap: 10px;
  }
}
</style>
