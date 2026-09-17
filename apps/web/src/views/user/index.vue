<template>
  <el-scrollbar class="page-scroll">
    <div class="user-page">
      <!-- 页面头部 -->
      <div class="page-header">
        <div class="header-left">
          <h2 class="page-title arc-serif-title">{{ $t('userList') }}</h2>
          <p class="page-desc">{{ $t('userPageDesc') }}</p>
        </div>
        <div class="header-actions-right">
          <el-button type="primary" class="arc-btn add-btn" @click="showAdd = true">
            <Icon icon="solar:user-plus-linear" width="16" height="16" style="margin-right: 6px;" />
            {{ $t('addUser') }}
          </el-button>
        </div>
      </div>

      <!-- 用户数据卡片 -->
      <div class="setting-card arc-card user-main-card">
        <!-- 筛选与搜索工具条 -->
        <div class="table-toolbar">
          <div class="search-box">
            <el-input
                v-model="params.email"
                class="search-input"
                :placeholder="$t('searchByEmail')"
                clearable
                @keyup.enter="search"
                @clear="search"
            >
              <template #prefix>
                <Icon icon="solar:magnifer-linear" width="15" height="15" style="color: var(--muted);" />
              </template>
            </el-input>
          </div>

          <el-select v-model="params.status" :placeholder="$t('statusFilter')" class="status-select"
                     :style="`width: ${locale === 'en' ? 110 : 100 }px`"
                     @change="search">
            <el-option :key="-1" :label="$t('all')" :value="-1"/>
            <el-option :key="0" :label="$t('active')" :value="0"/>
            <el-option :key="1" :label="$t('banned')" :value="1"/>
            <el-option :key="-2" :label="$t('deleted')" :value="-2"/>
          </el-select>

          <div class="toolbar-tools">
            <button class="tool-icon-btn" :title="params.timeSort === 1 ? $t('sortByCreatedAsc') : $t('sortByCreatedDesc')" @click="changeTimeSort">
              <Icon icon="solar:sort-from-top-to-bottom-linear" width="16" height="16"/>
            </button>
            <button class="tool-icon-btn" :title="$t('refreshList')" @click="refresh">
              <Icon icon="solar:restart-linear" width="16" height="16"/>
            </button>
            <button class="tool-icon-btn danger" :title="$t('deleteSelectedUsers')" @click="delUser">
              <Icon icon="solar:trash-bin-trash-linear" width="16" height="16"/>
            </button>
          </div>
        </div>

        <div class="table-wrapper">
          <div class="loading" :class="tableLoading ? 'loading-show' : 'loading-hide'"
               :style="first ? 'background: transparent' : ''">
            <loading/>
          </div>
          <el-table
              @filter-change="tableFilter"
              :empty-text="first ? '' : null"
              :data="users"
              :preserve-expanded-content="preserveExpanded"
              style="width: 100%;"
              ref="tableRef"
              class="user-table"
              @cell-contextmenu="handleContextmenu"
              :cell-class-name="cellClassName"
          >
            <el-table-column :width="expandWidth" type="selection" :selectable="row => row.type !== 0" />
            <el-table-column show-overflow-tooltip :tooltip-formatter="tableRowFormatter" :label="$t('tabEmailAddress')"
                             :min-width="emailWidth">
              <template #default="props">
                <div style="display: flex;gap: 5px">
                  <div class="email-row">{{ props.row.email }}</div>
                </div>
              </template>
            </el-table-column>
            <el-table-column :formatter="formatterReceive" label-class-name="receive" column-key="receive"
                             :filtered-value="filteredValue" :filters="filters" :width="receiveWidth"
                             :label="$t('tabReceived')"
                             prop="receiveEmailCount"/>
            <el-table-column :formatter="formatterSend" label-class-name="send" column-key="send"
                             :filtered-value="filteredValue" :filters="filters" v-if="sendNumShow" :label="$t('tabSent')"
                             prop="sendEmailCount"/>
            <el-table-column :formatter="formatterAccount" label-class-name="account" column-key="account"
                             :filtered-value="filteredValue" :filters="filters" v-if="accountNumShow"
                             :label="$t('tabMailboxes')"
                             prop="accountCount"/>
            <el-table-column v-if="createTimeShow" :label="$t('tabRegisteredAt')" min-width="160" prop="createTime">
              <template #default="props">
                {{ tzDayjs(props.row.createTime).format('YYYY-MM-DD HH:mm') }}
              </template>
            </el-table-column>
            <el-table-column v-if="statusShow" min-width="70px" :label="$t('tabStatus')" prop="status">
              <template #default="props">
                <span v-if="props.row.isDel === 1" class="user-status-pill is-deleted">{{ $t('deleted') }}</span>
                <span v-else-if="props.row.status === 0" class="user-status-pill is-active">{{ $t('active') }}</span>
                <span v-else-if="props.row.status === 1" class="user-status-pill is-banned">{{ $t('banned') }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="$t('tabSetting')" :width="settingWidth">
              <template #default="props">
                <div v-if="(props.row.type === 0 && userStore.user.type !== 0)" class="admin-shield-badge">{{ $t('administrator') }}</div>
                <el-dropdown v-else trigger="click">
                  <button class="user-action-btn">
                    <span>{{ $t('action') }}</span>
                    <Icon icon="solar:alt-arrow-down-linear" width="13" height="13" />
                  </button>
                  <template #dropdown>
                    <el-dropdown-menu class="user-action-dropdown">
                      <el-dropdown-item @click="openSetPwd(props.row)">
                        <Icon icon="solar:key-linear" width="14" height="14" style="margin-right: 6px;" />
                        {{ $t('chgPwd') }}
                      </el-dropdown-item>
                      <template v-if="props.row.type !== 0">
                        <el-dropdown-item v-if="props.row.isDel !== 1" @click="setStatus(props.row)">
                          <Icon :icon="props.row.status === 0 ? 'solar:user-block-linear' : 'solar:user-check-linear'" width="14" height="14" style="margin-right: 6px;" />
                          {{ setStatusName(props.row) }}
                        </el-dropdown-item>
                        <el-dropdown-item v-else @click="restore(props.row)">
                          <Icon icon="solar:restart-linear" width="14" height="14" style="margin-right: 6px;" />
                          {{ $t('restore') }}
                        </el-dropdown-item>
                        <el-dropdown-item @click="openSetSendLimit(props.row)">
                          <Icon icon="solar:plain-linear" width="14" height="14" style="margin-right: 6px;" />
                          {{ $t('setSendLimit') }}
                        </el-dropdown-item>
                        <el-dropdown-item @click="openSetAccountLimit(props.row)">
                          <Icon icon="solar:letter-linear" width="14" height="14" style="margin-right: 6px;" />
                          {{ $t('setMailboxLimit') }}
                        </el-dropdown-item>
                      </template>
                      <el-dropdown-item @click="openAccountList(props.row.userId)">
                        <Icon icon="solar:users-group-rounded-linear" width="14" height="14" style="margin-right: 6px;" />
                        {{ $t('account') }}
                      </el-dropdown-item>
                      <el-dropdown-item @click="openDetails(props.row)">
                        <Icon icon="solar:info-circle-linear" width="14" height="14" style="margin-right: 6px;" />
                        {{ $t('details') }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </el-table-column>
          </el-table>
          <div class="pagination" v-if="total > 0">
            <el-pagination
                :size="pageSize"
                :current-page="params.num"
                :page-size="params.size"
                :pager-count="pagerCount"
                :page-sizes="[10, 15, 20, 25, 30, 50]"
                background
                :layout="layout"
                :total="total"
                @size-change="sizeChange"
                @current-change="numChange"
            />
            <el-pagination
                v-if="phonePageShow"
                :size="pageSize"
                :current-page="params.num"
                :page-size="params.size"
                :pager-count="pagerCount"
                :page-sizes="[10, 15, 20, 25, 30, 50]"
                background
                layout="sizes, total"
                :total="total"
                @size-change="sizeChange"
                @current-change="numChange"
            />
          </div>
        </div>
      </div>

      <!-- 模块化抽离的弹窗组件 -->
      <UserPasswordDialog v-model="setPwdShow" :user-id="selectedUserId" @success="getUserList(false)" />
      <UserSendLimitDialog v-model="setSendLimitShow" :user-id="selectedUserId" :initial-limit="selectedSendLimit" @success="handleSendLimitSuccess" />
      <UserAccountLimitDialog v-model="setAccountLimitShow" :user-id="selectedUserId" :initial-limit="selectedAccountLimit" @success="handleAccountLimitSuccess" />
      <UserAddDialog v-model="showAdd" :domain-list="domainList" @success="getUserList(false)" />
      <UserAccountsDialog v-model="accountShow" :user-id="selectedUserId" :domain-list="domainList" @change="getUserList(false)" />
      <UserDetailsDialog
          v-model="detailsShow"
          :user-details="userDetails"
          :send-num-show="sendNumShow"
          :account-num-show="accountNumShow"
          :create-time-show="createTimeShow"
          :type-show="typeShow"
          :status-show="statusShow"
          @reset-send-count="getUserList(false)"
      />

      <!-- 右键快捷菜单 -->
      <el-dropdown
          :show-timeout="0"
          :hide-timeout="0"
          ref="dropdownRef"
          @visible-change="visibleChange"
          :virtual-ref="triggerRef"
          :show-arrow="false"
          :popper-options="{
            modifiers: [{ name: 'offset', options: { offset: [0, 0] } }],
          }"
          virtual-triggering
          trigger="contextmenu"
          placement="bottom-start"
      >
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="openSetPwd(rightClickUser)">
              <div class="right-dropdown-item">
                <Icon icon="ri:lock-password-line" width="16" height="16" />
                <span>{{ $t('chgPwd') }}</span>
              </div>
            </el-dropdown-item>
            <template v-if="rightClickUser.type !== 0">
              <el-dropdown-item v-if="rightClickUser.isDel !== 1" @click="setStatus(rightClickUser)">
                <div class="right-dropdown-item">
                  <Icon icon="solar:user-block-linear" width="16" height="16" />
                  <span>{{ setStatusName(rightClickUser) }}</span>
                </div>
              </el-dropdown-item>
              <el-dropdown-item v-else @click="restore(rightClickUser)">
                <div class="right-dropdown-item">
                  <Icon icon="solar:restart-linear" width="16" height="16" />
                  <span>{{ $t('restore') }}</span>
                </div>
              </el-dropdown-item>
              <el-dropdown-item @click="openSetSendLimit(rightClickUser)">
                <div class="right-dropdown-item">
                  <Icon icon="solar:letter-linear" width="16" height="16" />
                  <span>{{ $t('setSendLimit') }}</span>
                </div>
              </el-dropdown-item>
              <el-dropdown-item @click="openSetAccountLimit(rightClickUser)">
                <div class="right-dropdown-item">
                  <Icon icon="solar:mailbox-linear" width="16" height="16" />
                  <span>{{ $t('setMailboxLimit') }}</span>
                </div>
              </el-dropdown-item>
            </template>
            <el-dropdown-item @click="openAccountList(rightClickUser.userId)">
              <div class="right-dropdown-item">
                <Icon icon="solar:users-group-two-rounded-linear" width="16" height="16" />
                <span>{{ $t('account') }}</span>
              </div>
            </el-dropdown-item>
            <el-dropdown-item @click="openDetails(rightClickUser)">
              <div class="right-dropdown-item">
                <Icon icon="solar:info-circle-linear" width="16" height="16" />
                <span>{{ $t('details') }}</span>
              </div>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </el-scrollbar>
</template>

<script setup>
import { computed, reactive, ref, watch, h } from "vue";
import { Icon } from "@iconify/vue";
import { userList, userSetStatus, userDelete, userRestore } from "@/request/user.js";
import { useUserStore } from "@/store/user.js";
import { useI18n } from "vue-i18n";
import { tzDayjs } from "@/utils/day.js";
import { ElMessage, ElMessageBox } from "element-plus";
import Loading from "@/components/loading/index.vue";

import UserPasswordDialog from "./components/UserPasswordDialog.vue";
import UserSendLimitDialog from "./components/UserSendLimitDialog.vue";
import UserAccountLimitDialog from "./components/UserAccountLimitDialog.vue";
import UserAddDialog from "./components/UserAddDialog.vue";
import UserAccountsDialog from "./components/UserAccountsDialog.vue";
import UserDetailsDialog from "./components/UserDetailsDialog.vue";

const { t, locale } = useI18n();
const userStore = useUserStore();

// 弹窗状态与选中用户
const setPwdShow = ref(false);
const setSendLimitShow = ref(false);
const setAccountLimitShow = ref(false);
const showAdd = ref(false);
const accountShow = ref(false);
const detailsShow = ref(false);

const selectedUserId = ref(0);
const selectedSendLimit = ref(50);
const selectedAccountLimit = ref(10);
const userDetails = ref({});

// 响应式布局状态
const statusShow = ref(true);
const createTimeShow = ref(true);
const accountNumShow = ref(true);
const sendNumShow = ref(true);
const typeShow = ref(true);
const emailWidth = ref(null);
const settingWidth = ref(null);
const expandWidth = ref(35);
const receiveWidth = ref(null);
const layout = ref('prev, pager, next,sizes, total');
const phonePageShow = ref(false);
const pageSize = ref('');
const pagerCount = ref(10);

const tableRef = ref({});
const scrollbarRef = ref(null);
const tableLoading = ref(true);
const first = ref(true);
const users = ref([]);
const total = ref(0);

const triggerRef = ref({
  getBoundingClientRect: () => position.value,
});
const position = ref(DOMRect.fromRect({ x: 0, y: 0 }));
const dropdownRef = ref({});
const dropdownShow = ref(false);
const rightClickUser = ref({});
const domainList = computed(() => userStore.user.domainList || []);

const params = reactive({
  email: '',
  num: 1,
  size: 20,
  timeSort: 0,
  status: -1,
});

const paramsStar = localStorage.getItem('user-params');
if (paramsStar) {
  const localParams = JSON.parse(paramsStar);
  params.num = localParams.num || 1;
  params.size = localParams.size || 20;
  params.timeSort = localParams.timeSort || 0;
  params.status = localParams.status ?? -1;
}

watch(params, () => {
  localStorage.setItem('user-params', JSON.stringify(params));
}, { deep: true });

watch(() => userStore.refreshList, () => {
  getUserList(false);
});

getUserList();

const filterItem = reactive({
  send: ['normal', 'del'],
  account: ['normal', 'del'],
  receive: ['normal', 'del']
});

const filters = [
  { text: t('normal'), value: 'normal' },
  { text: t('deleted'), value: 'del' },
];

const filteredValue = ['normal', 'del'];

function setStatusName(user) {
  return user.status ? t('active') : t('banned');
}

function openSetPwd(user) {
  selectedUserId.value = user.userId;
  setPwdShow.value = true;
}

function openSetSendLimit(user) {
  selectedUserId.value = user.userId;
  selectedSendLimit.value = user.sendLimit ?? 50;
  setSendLimitShow.value = true;
}

function handleSendLimitSuccess(newLimit) {
  const target = users.value.find(u => u.userId === selectedUserId.value);
  if (target) target.sendLimit = newLimit;
}

function openSetAccountLimit(user) {
  selectedUserId.value = user.userId;
  selectedAccountLimit.value = user.accountLimit ?? 10;
  setAccountLimitShow.value = true;
}

function handleAccountLimitSuccess(newLimit) {
  const target = users.value.find(u => u.userId === selectedUserId.value);
  if (target) target.accountLimit = newLimit;
}

function openAccountList(userId) {
  selectedUserId.value = userId;
  accountShow.value = true;
}

function openDetails(user) {
  userDetails.value = user;
  detailsShow.value = true;
}

function setStatus(user) {
  let status = user.status ? 0 : 1;
  userSetStatus({ status, userId: user.userId }).then(() => {
    user.status = status;
    ElMessage({
      message: t('saveSuccessMsg'),
      type: "success",
      plain: true
    });
  });
}

function restore(user) {
  const type = ref(0);
  ElMessageBox.confirm(null, {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    message: () => h('div', [
      h('div', { class: 'mb-2' }, t('restoreConfirm', { msg: user.email }))
    ]),
    type: 'warning'
  }).then(() => {
    userRestore(user.userId, type.value).then(() => {
      user.isDel = 0;
      ElMessage({ message: t('restoreSuccessMsg'), type: "success", plain: true });
    });
  });
}

function delUser() {
  const rows = tableRef.value.getSelectionRows();
  const userIds = rows.map(row => row.userId);
  if (userIds.length === 0) return;
  ElMessageBox.confirm(t('delUsersConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    userDelete(userIds).then(() => {
      ElMessage({ message: t('delSuccessMsg'), type: "success", plain: true });
      getUserList(true);
    });
  });
}

function tableFilter(e) {
  if (e.send) filterItem.send = e.send;
  if (e.account) filterItem.account = e.account;
  if (e.receive) filterItem.receive = e.receive;
}

function formatterSend(e) {
  if (filterItem.send.length === 2) return e.sendEmailCount + e.delSendEmailCount;
  if (filterItem.send.includes('normal')) return e.sendEmailCount;
  if (filterItem.send.includes('del')) return e.delSendEmailCount;
  return 0;
}

function formatterAccount(e) {
  if (filterItem.account.length === 2) return e.accountCount + e.delAccountCount;
  if (filterItem.account.includes('normal')) return e.accountCount;
  if (filterItem.account.includes('del')) return e.delAccountCount;
  return 0;
}

function formatterReceive(e) {
  if (filterItem.receive.length === 2) return e.receiveEmailCount + e.delReceiveEmailCount;
  if (filterItem.receive.includes('normal')) return e.receiveEmailCount;
  if (filterItem.receive.includes('del')) return e.delReceiveEmailCount;
  return 0;
}

function cellClassName({ row }) {
  return row.checkedClass;
}

const handleContextmenu = (row, column, cell, event) => {
  if (row.type === 0 && userStore.user.type !== 0) return;
  rightClickUser.value.checkedClass = '';
  const { clientX, clientY } = event;
  position.value = DOMRect.fromRect({ x: clientX, y: clientY });
  event.preventDefault();
  dropdownRef.value?.handleOpen();
  row.checkedClass = 'checked-row';
  rightClickUser.value = row;
};

function visibleChange(e) {
  dropdownShow.value = e;
  if (!e && rightClickUser.value) {
    rightClickUser.value.checkedClass = '';
  }
}

function search() {
  params.num = 1;
  getUserList();
}

function refresh() {
  params.email = '';
  params.num = 1;
  params.status = -1;
  params.timeSort = 0;
  getUserList();
}

function changeTimeSort() {
  params.num = 1;
  params.timeSort = params.timeSort ? 0 : 1;
  getUserList();
}

function numChange(num) {
  params.num = num;
  getUserList();
}

function sizeChange(size) {
  params.size = size;
  getUserList();
}

function getUserList(loading = true) {
  tableLoading.value = loading;
  const newParams = { ...params };
  if (newParams.status === -2) {
    delete newParams.status;
    newParams.isDel = 1;
  }
  userList(newParams).then(data => {
    users.value = data.list.map(item => ({ ...item, checkedClass: '' }));
    total.value = data.total;
    scrollbarRef.value?.setScrollTop(0);
  }).finally(() => {
    tableLoading.value = false;
    setTimeout(() => {
      first.value = false;
    }, 200);
  });
}

function adjustWidth() {
  const width = window.innerWidth;
  statusShow.value = width > 1090;
  createTimeShow.value = width > 1367;
  accountNumShow.value = width > 650;
  sendNumShow.value = width > 685;
  typeShow.value = width > 767;
  emailWidth.value = width > 480 ? 230 : null;
  settingWidth.value = width < 480 ? (locale.value === 'en' ? 85 : 75) : null;
  expandWidth.value = width < 480 ? 30 : 35;
  pagerCount.value = width < 768 ? 7 : 11;
  receiveWidth.value = width < 480 ? 90 : null;
  layout.value = width < 768 ? 'pager' : 'prev, pager, next,sizes, total';
  phonePageShow.value = width < 768;
  pageSize.value = width < 380 ? 'small' : '';
}

window.onresize = adjustWidth;
adjustWidth();
</script>

<style>
.el-message-box__container {
  align-items: start !important;
}
.el-message-box__message {
  word-break: break-all;
}
.el-table-filter__content {
  min-width: 0;
}

.user-action-dialog.el-dialog,
.user-add-dialog.el-dialog {
  width: 420px !important;
  border-radius: 14px;
}

.user-accounts-dialog.el-dialog,
.account-dialog.el-dialog,
.user-details-dialog.el-dialog {
  width: 580px !important;
  border-radius: 14px;
}

.user-status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.4;

  &.is-active {
    background: color-mix(in srgb, #10b981 12%, transparent);
    color: #059669;
  }

  &.is-banned {
    background: color-mix(in srgb, #ef4444 12%, transparent);
    color: #dc2626;
  }

  &.is-deleted {
    background: var(--paper-soft);
    color: var(--muted);
  }
}

.admin-shield-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 600;
}

.user-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-strong);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;

  &:hover {
    background: var(--paper-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
}

@media (max-width: 600px) {
  .user-accounts-dialog.el-dialog,
  .account-dialog.el-dialog,
  .user-details-dialog.el-dialog {
    width: calc(100% - 32px) !important;
    margin-right: 16px !important;
    margin-left: 16px !important;
  }
}

@media (max-width: 480px) {
  .user-action-dialog.el-dialog,
  .user-add-dialog.el-dialog {
    width: calc(100% - 32px) !important;
    margin-right: 16px !important;
    margin-left: 16px !important;
  }
}
</style>
<style lang="scss" scoped>
@use './user.scss';
</style>
