<template>
  <div class="account-box">
    <div class="head-opt">
      <button class="account-tool-btn" @click="refresh" :title="$t('refreshAccountList')">
        <Icon icon="solar:restart-linear" width="16" height="16" />
      </button>
      <button class="account-tool-btn" @click="openAdd" :title="$t('addAccount')">
        <Icon icon="solar:add-circle-linear" width="17" height="17" />
      </button>
    </div>
    <el-scrollbar class="scrollbar" ref="scrollbarRef">
      <div v-infinite-scroll="getAccountList" :infinite-scroll-distance="600" :infinite-scroll-immediate="false">
        <div class="item" :class="itemBg(item.accountId)" v-for="(item, index) in accounts" :key="item.accountId"
             @click="changeAccount(item)">
          <div class="account">
            {{ item.email }}
          </div>
          <div class="opt">
            <div class="send-email" @click.stop>
              <el-tooltip :content="item.allReceive ? $t('receiveAllOn') : $t('receiveAllOffHint')" placement="top">
                <button
                  type="button"
                  class="receive-tag-btn"
                  :class="{ 'is-active': item.allReceive }"
                  @click="setAllReceive(item)"
                >
                  <Icon :icon="item.allReceive ? 'solar:inbox-in-linear' : 'solar:letter-linear'" width="15" height="15" />
                  <span>{{ item.allReceive ? $t('receiveAll') : $t('receiveSeparate') }}</span>
                </button>
              </el-tooltip>
            </div>
            <div class="settings" @click.stop>
              <button type="button" class="action-icon-btn" @click.stop="copyAccount(item.email)" :title="$t('copyMailbox')">
                <Icon icon="solar:copy-linear" width="15" height="15" />
              </button>
              <div v-if="showNullSetting(item)"></div>
              <el-dropdown v-else trigger="click">
                <button type="button" class="action-icon-btn" :title="$t('moreActions')">
                  <Icon icon="solar:menu-dots-bold" width="15" height="15" />
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-if="hasPerm('email:send')" @click="openSetName(item)">{{ $t('rename') }}</el-dropdown-item>
                    <el-dropdown-item v-if="item.accountId !== userStore.user.account.accountId" @click="setAsTop(item, index)">{{ $t('pin') }}</el-dropdown-item>
                    <el-dropdown-item v-if="item.accountId !== userStore.user.account.accountId && hasPerm('account:delete')"
                                      @click="remove(item)">{{ $t('delete') }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </div>

        <!-- Initial Loading Skeleton -->
        <template v-if="loading">
          <el-skeleton v-for="i in skeletonRows" :key="i" animated>
            <template #template>
              <el-card class="item">
                <el-skeleton-item variant="p" style="width: 70%; height: 20px; margin-bottom: 25px"/>
                <div style="display: flex; justify-content: space-between">
                  <el-skeleton-item variant="text" style="width: 20px"/>
                  <el-skeleton-item variant="text" style="width: 20px"/>
                </div>
              </el-card>
            </template>
          </el-skeleton>
        </template>

        <!-- Follow Loading Skeleton -->
        <template v-if="accounts.length > 0 && !noLoading">
          <el-skeleton animated>
            <template #template>
              <el-card class="item">
                <el-skeleton-item variant="p" style="width: 70%; height: 20px; margin-bottom: 20px"/>
                <div style="display: flex; justify-content: space-between">
                  <el-skeleton-item variant="text" style="width: 20px"/>
                  <el-skeleton-item variant="text" style="width: 20px"/>
                </div>
              </el-card>
            </template>
          </el-skeleton>
        </template>

        <div class="noLoading" v-if="noLoading && accounts.length > 0">
          <div>{{ $t('noMoreData') }}</div>
        </div>
        <div class="empty" v-if="noLoading && accounts.length === 0">
          <el-empty :description="$t('noMessagesFound')"/>
        </div>
      </div>

    </el-scrollbar>
    <el-dialog v-model="setNameShow" :title="$t('changeUserName')">
      <div class="container">
        <el-input v-model="accountName" type="text" :placeholder="$t('username')" autocomplete="off">
        </el-input>
        <el-button class="btn" type="primary" @click="setName" :loading="setNameLoading"
        >{{ $t('save') }}
        </el-button>
      </div>
    </el-dialog>
    <el-dialog v-model="addShow" :title="$t('addAccount')" @closed="resetAddForm">
      <div class="container">
        <el-input v-model="addForm.localPart" type="text" :placeholder="$t('emailPrefix')" autocomplete="off"
                  @keyup.enter="addAccount">
          <template #append>
            <el-select v-model="addForm.suffix" class="select" :placeholder="$t('select')">
              <el-option v-for="item in domainList" :key="item" :label="item" :value="item"/>
            </el-select>
          </template>
        </el-input>
        <div class="limit-hint" v-if="userStore.user.accountLimit">
          {{ $t('mailboxUsage', { used: userStore.user.accountCount || 0, limit: userStore.user.accountLimit }) }}
        </div>
        <div class="limit-hint" v-else>{{ $t('unlimited') }}</div>
        <el-button class="btn" type="primary" @click="addAccount" :loading="addLoading">{{ $t('add') }}</el-button>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import {Icon} from "@iconify/vue";
import {computed, reactive, ref, watch} from "vue";
import {
  accountList,
  accountAdd,
  accountDelete,
  accountSetName,
  accountSetAllReceive,
  accountSetAsTop
} from "@/request/account.js";
import {sleep} from "@/utils/time-utils.js"
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import {useUserStore} from "@/store/user.js";
import {hasPerm} from "@/perm/perm.js"
import {useI18n} from "vue-i18n";
import {AccountAllReceiveEnum} from "@/enums/account-enum.js";
import {isEmail} from "@/utils/verify-utils.js";

const {t} = useI18n();
const userStore = useUserStore();
const accountStore = useAccountStore();
const emailStore = useEmailStore();
const accounts = reactive([])
accountStore.accountList = accounts
const domainList = computed(() => userStore.user.domainList || [])
const noLoading = ref(false)
const loading = ref(false)
const followLoading = ref(false);
const setNameShow = ref(false)
const addShow = ref(false)
const addLoading = ref(false)
const addForm = reactive({localPart: '', suffix: ''})
const setNameLoading = ref(false)
const accountName = ref(null)
const scrollbarRef = ref({})
let account = null
let first = true
let skeletonRows = 10
const queryParams = {
  size: 30
}

if (hasPerm('account:query')) {
  getAccountList()
}

watch(() => accountStore.changeUserAccountName, () => {
  accounts[0].name = accountStore.changeUserAccountName
})

watch(domainList, list => {
  if (!addForm.suffix && list.length) addForm.suffix = list[0]
}, {immediate: true})

function openAdd() {
  addForm.suffix ||= domainList.value[0] || ''
  addShow.value = true
}

function resetAddForm() {
  addForm.localPart = ''
  addForm.suffix = domainList.value[0] || ''
}

async function addAccount() {
  const input = addForm.localPart.trim().toLowerCase()
  const email = input.includes('@') ? input : input + addForm.suffix
  if (!isEmail(email) || !domainList.value.includes(`@${email.split('@')[1]}`)) {
    ElMessage({message: t('notEmailMsg'), type: 'error', plain: true})
    return
  }
  addLoading.value = true
  try {
    const created = await accountAdd(email)
    userStore.user.accountCount = created.accountCount
    addShow.value = false
    refresh()
    ElMessage({message: t('addSuccessMsg'), type: 'success', plain: true})
  } catch {
    // API interceptor displays the quota/domain error; keep it handled in Vue.
  } finally {
    addLoading.value = false
  }
}

function getSkeletonRows() {
  if (accounts.length > 20) return skeletonRows = 20
  if (accounts.length === 0) return skeletonRows = 1
  skeletonRows = accounts.length
}

function setName() {

  let name = accountName.value

  if (name === account.name) {
    setNameShow.value = false
    return
  }

  if (!name) {
    ElMessage({
      message: t('emptyUserNameMsg'),
      type: 'error',
      plain: true,
    })
    return;
  }

  setNameLoading.value = true
  accountSetName(account.accountId, name).then(() => {
    account.name = name
    setNameShow.value = false

    if (account.accountId === userStore.user.account.accountId) {
      userStore.user.name = name
    }

    ElMessage({
      message: t('saveSuccessMsg'),
      type: "success",
      plain: true
    })
  }).finally(() => {
    setNameLoading.value = false
  })
}

function openSetName(accountItem) {
  accountName.value = accountItem.name
  account = accountItem
  setNameShow.value = true
}

function setAllReceive(account) {
  let allReceiveAccount = accounts.find(account => account.allReceive === AccountAllReceiveEnum.ENABLED);
  if (allReceiveAccount && allReceiveAccount.accountId !== account.accountId) allReceiveAccount.allReceive = AccountAllReceiveEnum.DISABLED;
  account.allReceive = account.allReceive === AccountAllReceiveEnum.DISABLED ? AccountAllReceiveEnum.ENABLED : AccountAllReceiveEnum.DISABLED;
  accountSetAllReceive(account.accountId).catch(() => {
    account.allReceive = account.allReceive === AccountAllReceiveEnum.DISABLED ? AccountAllReceiveEnum.ENABLED : AccountAllReceiveEnum.DISABLED;
    if (allReceiveAccount) allReceiveAccount.allReceive = AccountAllReceiveEnum.ENABLED;
  }).then(() => {
    if (account.allReceive === AccountAllReceiveEnum.ENABLED) {
      ElMessage({
        message: t('setSuccess'),
        type: 'success',
        plain: true,
      })
    }
    changeAccount(account);
    emailStore.emailScroll?.refreshList();
    emailStore.sendScroll?.refreshList();
  })
}


function showNullSetting(item) {
  return !hasPerm('email:send') && !(item.accountId !== userStore.user.account.accountId && hasPerm('account:delete'))
}

function itemBg(accountId) {
  return accountStore.currentAccountId === accountId ? 'item-choose' : ''
}



function remove(account) {
  ElMessageBox.confirm(t('delConfirm', {msg: account.email}), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    accountDelete(account.accountId).then(() => {
      const index = accounts.findIndex(item => item.accountId === account.accountId);
      accounts.splice(index, 1);
      userStore.user.accountCount = Math.max(1, (userStore.user.accountCount || 1) - 1)
      if (accounts.length < queryParams.size) {
        getAccountList()
      }
      ElMessage({
        message: t('delSuccessMsg'),
        type: 'success',
        plain: true,
      })
    })
  });
}

function refresh() {
  if (loading.value) {
    return
  }
  loading.value = false
  followLoading.value = false
  noLoading.value = false
  queryParams.accountId = 0
  queryParams.lastSort = null
  getSkeletonRows();
  scrollbarRef.value.setScrollTop(0)
  accounts.splice(0, accounts.length)
  getAccountList()
}

function changeAccount(account) {
  accountStore.currentAccountId = account.accountId
  accountStore.currentAccount = account
  if (window.innerWidth < 768) {
    uiStore.accountShow = false
  }
}

function setAsTop(account, index) {
  accountSetAsTop(account.accountId).then(() => {
    ElMessage({
      message: t('setSuccess'),
      type: 'success',
      plain: true,
    })

    const [item] = accounts.splice(index, 1);
    accounts.splice(1, 0, item);

  });
}

async function copyAccount(account) {
  try {
    await navigator.clipboard.writeText(account);
    ElMessage({
      message: t('copySuccessMsg'),
      type: 'success',
      plain: true,
    })
  } catch (err) {
    console.error(`${t('copyFailMsg')}:`, err);
    ElMessage({
      message: t('copyFailMsg'),
      type: 'error',
      plain: true,
    })
  }
}

function getAccountList() {

  if (loading.value || followLoading.value || noLoading.value) return;

  if (accounts.length === 0) {
    loading.value = true
  } else {
    followLoading.value = true
  }

  let start = Date.now();

  const accountId = accounts.length > 0 ? accounts.at(-1).accountId : 0;
  const lastSort = accounts.length > 0 ? accounts.at(-1).sort : null;

  accountList(accountId, queryParams.size, lastSort).then(async list => {

    let end = Date.now();
    let duration = end - start;
    if (duration < 300) {
      await sleep(300 - duration)
    }

    if (list.length < queryParams.size) {
      noLoading.value = true
    }
    if (accounts.length === 0) {
      accountStore.currentAccount = list[0]
    }

    accounts.push(...list)

    loading.value = false
    followLoading.value = false
    first = false
  }).catch(() => {
    loading.value = false
    followLoading.value = false
  })
}


</script>
<style>
path[fill="#ffdda1"] {
  fill: #ffdd7d;
}
</style>
<style scoped lang="scss">
.account-box {
  border-right: 1px solid var(--line) !important;
  background-color: var(--paper);
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  .head-opt {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    height: 44px;
    padding: 0 12px;
    border-bottom: 1px solid var(--line-subtle);

    .account-tool-btn {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm, 6px);
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all var(--duration-fast, 150ms) var(--ease-smooth, ease);

      &:hover {
        background: var(--paper-soft);
        color: var(--text-strong);
      }
    }
  }

  .scrollbar {
    flex: 1;
    width: 100%;
    overflow: auto;

    .empty {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100%;
    }

    .noLoading {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 10px 0;
      color: var(--faint);
      font-size: 12px;
    }
  }

  .btn {
    width: 100%;
    margin-top: 15px;
  }

  .limit-hint {
    margin-top: 10px;
    color: var(--muted);
    font-size: 12px;
  }

  .item {
    background-color: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg, 12px);
    padding: 10px 12px;
    margin: 8px 10px;
    cursor: pointer;
    box-shadow: var(--shadow-xs);
    transition: all var(--duration-fast, 150ms) var(--ease-smooth, ease);

    &:hover {
      border-color: var(--line-strong);
      box-shadow: var(--shadow-sm);
    }

    .account {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-strong);
      margin-bottom: 10px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .opt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;

      .receive-tag-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        padding: 2px 7px;
        border-radius: var(--radius-full, 9999px);
        border: 1px solid var(--line);
        background: var(--paper-soft);
        color: var(--muted);
        cursor: pointer;
        transition: all var(--duration-fast, 150ms) var(--ease-smooth, ease);

        &:hover {
          color: var(--text-strong);
          border-color: var(--line-strong);
        }

        &.is-active {
          background: var(--accent-light, #eaf1f8);
          color: var(--accent);
          border-color: color-mix(in srgb, var(--accent) 25%, transparent);
          font-weight: 500;
        }
      }

      .settings {
        display: flex;
        align-items: center;
        gap: 6px;

        .action-icon-btn {
          width: 26px;
          height: 26px;
          border-radius: var(--radius-sm, 6px);
          border: none;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all var(--duration-fast, 150ms) var(--ease-smooth, ease);

          &:hover {
            background: var(--paper-soft);
            color: var(--text-strong);
          }
        }
      }
    }
  }

  .item-choose {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    box-shadow: var(--shadow-sm);

    .account {
      color: var(--accent);
    }
  }
}

:deep(.el-dialog) {
  width: 400px !important;
  @media (max-width: 440px) {
    width: calc(100% - 40px) !important;
    margin-right: 20px !important;
    margin-left: 20px !important;
  }
}
</style>
