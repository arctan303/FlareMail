<template>
  <el-select
    v-if="hasPerm('account:query')"
    v-model="accountStore.mailboxFilterId"
    class="mailbox-filter"
    popper-class="mailbox-filter-menu"
    :aria-label="$t('mailboxFilter')"
    :title="$t('mailboxFilter')"
    :fit-input-width="false"
    :show-arrow="false"
    @visible-change="handleVisibleChange"
  >
    <template #prefix>
      <Icon
        icon="solar:alt-arrow-down-linear"
        class="filter-arrow"
        :class="{ 'is-open': isOpen }"
        width="14"
        height="14"
      />
    </template>
    <el-option :value="0" :label="$t('allMailboxes')" />
    <el-option
      v-for="account in accounts"
      :key="account.accountId"
      :value="account.accountId"
      :label="account.email"
      :title="account.email"
    />
  </el-select>
</template>
<script setup>
import { computed, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { useAccountStore } from '@/store/account.js';
import { useUserStore } from '@/store/user.js';
import { accountList } from '@/request/account.js';
import { hasPerm } from '@/perm/perm.js';

const accountStore = useAccountStore(), userStore = useUserStore(), loading = ref(false);
const isOpen = ref(false);
const accounts = computed(() => [...new Map([userStore.user.account, ...accountStore.accountList].filter(Boolean).map(a => [a.accountId, a])).values()]);

function handleVisibleChange(visible) {
  isOpen.value = visible;
  if (visible) load();
}

async function load() {
  if (loading.value || !hasPerm('account:query')) return;
  loading.value = true;
  try {
    const list = [];
    let cursor = 0, lastSort;
    while (true) {
      const page = await accountList(cursor, 100, lastSort);
      list.push(...page);
      if (page.length < 100) break;
      const last = page.at(-1);
      if (last.accountId === cursor && last.sort === lastSort) break;
      cursor = last.accountId;
      lastSort = last.sort;
    }
    accountStore.accountList = list;
    if (accountStore.mailboxFilterId && !list.some(a => a.accountId === accountStore.mailboxFilterId)) accountStore.mailboxFilterId = 0;
  } catch {
    /* The request layer reports errors; reopening retries loading. */
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<style scoped>
.mailbox-filter {
  width: 170px;
  max-width: 100%;
}
.mailbox-filter :deep(.el-select__wrapper) {
  min-height: 32px;
  padding: 4px 8px 4px 6px;
  border-radius: 8px;
  background: transparent;
  box-shadow: none !important;
  border: none !important;
  font-size: 13px;
  cursor: pointer;
  transition: background-color .15s ease, color .15s ease;
}
.mailbox-filter :deep(.el-select__wrapper:hover),
.mailbox-filter :deep(.el-select__wrapper.is-hovering) {
  background: var(--paper-soft);
  box-shadow: none !important;
}
.mailbox-filter :deep(.el-select__wrapper.is-focused) {
  background: var(--paper-soft);
  box-shadow: none !important;
}
.mailbox-filter :deep(.el-select__prefix) {
  margin-right: 4px;
  display: inline-flex;
  align-items: center;
}
.mailbox-filter :deep(.el-select__suffix) {
  display: none !important;
}
.mailbox-filter :deep(.el-select__selected-item) {
  color: var(--text-strong);
  font-weight: 500;
}
.filter-arrow {
  color: var(--muted);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.15s ease;
  flex-shrink: 0;
}
.filter-arrow.is-open {
  transform: rotate(180deg);
  color: var(--text-strong);
}
@media (max-width: 767px) {
  .mailbox-filter {
    width: 130px;
  }
}
</style>
<style>
.mailbox-filter-menu.el-popper{border:1px solid var(--line);border-radius:12px;background:var(--surface-elevated);box-shadow:0 8px 24px rgb(0 0 0 / .12);overflow:hidden;}
.mailbox-filter-menu .el-select-dropdown{min-width:min(240px,calc(100vw - 32px)) !important;max-width:min(360px,calc(100vw - 32px));}
.mailbox-filter-menu .el-select-dropdown__list{padding:6px;}
.mailbox-filter-menu .el-select-dropdown__item{height:36px;line-height:36px;padding:0 12px;border-radius:7px;color:var(--text);font-size:13px;}
.mailbox-filter-menu .el-select-dropdown__item.is-hovering{background:var(--paper-soft);}
.mailbox-filter-menu .el-select-dropdown__item.is-selected{background:var(--accent-light);color:var(--accent);font-weight:600;}
</style>
