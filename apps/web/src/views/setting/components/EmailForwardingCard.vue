<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">
          <Icon icon="solar:plain-2-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('emailForwarding') }}</h3>
          <p class="card-desc">{{ $t('forwardingCardDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <div class="forward-notice">
        <Icon icon="solar:info-circle-linear" width="16" height="16" class="notice-icon" />
        <span>{{ $t('forwardingHint') }}</span>
      </div>
      
      <div class="forward-target-block">
        <label class="block-label">{{ $t('forwardingTargetLabel') }}</label>
        <div class="inline-form">
          <el-input
              v-model="forwardForm.forwardEmail"
              :placeholder="$t('forwardingTargetPlaceholder')"
              style="max-width: 380px;"
          />
          <el-button type="primary" class="arc-btn" :loading="forwardLoading" @click="saveForwardEmail">{{ $t('saveForwardingTarget') }}</el-button>
        </div>
      </div>

      <div class="alias-forward-list">
        <div class="alias-forward-item">
          <div class="alias-info">
            <span class="alias-email">{{ userStore.user.email }}</span>
          </div>
          <div class="alias-action">
            <span class="switch-label">{{ $t('enableForwarding') }}</span>
            <el-switch v-model="forwardForm.mainForwardStatus" :active-value="0" :inactive-value="1" @change="saveMainForwardStatus"/>
          </div>
        </div>

        <div class="alias-forward-item" v-for="acc in aliasForwardList" :key="acc.accountId">
          <div class="alias-info">
            <span class="alias-email">{{ acc.email }}</span>
          </div>
          <div class="alias-action">
            <span class="switch-label">{{ $t('enableForwarding') }}</span>
            <el-switch v-model="acc.forwardStatus" :active-value="0" :inactive-value="1" @change="saveAccountForwardStatus(acc)"/>
            <el-button type="danger" text @click="doDeleteAccount(acc.accountId)" style="margin-left: 12px;">{{ $t('deleteAlias') }}</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { Icon } from "@iconify/vue"
import { useUserStore } from "@/store/user.js"
import { setForward } from "@/request/my.js"
import { accountDelete, accountSetForward } from "@/request/account.js"
import { useAccountStore } from "@/store/account.js"
import { isEmail } from "@/utils/verify-utils.js"
import { ElMessageBox, ElMessage } from 'element-plus'
import { useI18n } from "vue-i18n"

const { t } = useI18n()
const userStore = useUserStore()
const accountStore = useAccountStore()

const forwardLoading = ref(false)

// 主账号有专用行（mainForwardStatus 控制），别名列表排除主账号避免重复渲染
const aliasForwardList = computed(() => {
  const main = userStore.user.email?.toLowerCase()
  const list = (accountStore.accountList?.length ? accountStore.accountList : userStore.user.accountList) || []
  return list.filter(acc => acc.email?.toLowerCase() !== main)
})

const forwardForm = reactive({
  forwardStatus: userStore.user.forwardStatus ?? 1,
  mainForwardStatus: userStore.user.mainForwardStatus ?? 1,
  forwardEmail: userStore.user.forwardEmail || ''
})

async function saveForwardEmail() {
  const email = forwardForm.forwardEmail.trim().toLowerCase()
  if (email && email === userStore.user.email.toLowerCase()) {
    ElMessage({ message: t('forwardingSameAsPrimaryMsg'), type: 'error', plain: true })
    return
  }
  if (email && !isEmail(email)) {
    ElMessage({ message: t('notEmailMsg'), type: 'error', plain: true })
    return
  }
  forwardLoading.value = true
  try {
    await setForward(forwardForm.forwardStatus, forwardForm.mainForwardStatus, email)
    userStore.user.forwardEmail = email
    ElMessage({ message: t('saveSuccessMsg'), type: 'success', plain: true })
  } finally {
    forwardLoading.value = false
  }
}

async function saveMainForwardStatus() {
  try {
    await setForward(forwardForm.forwardStatus, forwardForm.mainForwardStatus, forwardForm.forwardEmail)
    userStore.user.mainForwardStatus = forwardForm.mainForwardStatus
    ElMessage({ message: t('saveSuccessMsg'), type: 'success', plain: true })
  } catch {
    forwardForm.mainForwardStatus = userStore.user.mainForwardStatus
  }
}

async function saveAccountForwardStatus(acc) {
  try {
    await accountSetForward(acc.accountId, acc.forwardStatus)
    ElMessage({ message: t('saveSuccessMsg'), type: 'success', plain: true })
  } catch {
    acc.forwardStatus = acc.forwardStatus === 0 ? 1 : 0
  }
}

async function doDeleteAccount(accountId) {
  try {
    await ElMessageBox.confirm(t('deleteAliasConfirm'), t('notice'), {
      confirmButtonText: t('confirmDelete'),
      cancelButtonText: t('cancel'),
      type: 'warning'
    })
    await accountDelete(accountId)
    userStore.user.accountList = (userStore.user.accountList || []).filter(a => a.accountId !== accountId)
    userStore.user.accountCount = (userStore.user.accountList || []).length
    ElMessage({ message: t('aliasDeletedMsg'), type: 'success', plain: true })
  } catch (e) {
    if (e !== 'cancel') console.error(e)
  }
}
</script>

<style scoped lang="scss">
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

    .header-left {
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

.forward-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--paper-soft) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;

  .notice-icon {
    flex-shrink: 0;
    color: var(--accent);
    margin-top: 2px;
  }
}

.inline-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.forward-target-block {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .block-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-strong);
  }
}

.alias-forward-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 4px;

  .alias-forward-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    background: var(--surface);
    border-bottom: 1px solid var(--line);

    &:last-child {
      border-bottom: none;
    }

    .alias-info {
      display: flex;
      align-items: center;
      gap: 10px;

      .alias-email {
        font-size: 13.5px;
        font-weight: 500;
        color: var(--text-strong);
      }
    }

    .alias-action {
      display: flex;
      align-items: center;

      .switch-label {
        font-size: 12px;
        color: var(--muted);
        margin-right: 8px;
      }
    }
  }

  @media (max-width: 640px) {
    .alias-forward-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;

      .alias-info {
        width: 100%;
        word-break: break-all;
      }

      .alias-action {
        width: 100%;
        justify-content: space-between;
      }
    }
  }
}

@media (max-width: 640px) {
  .forward-target-block .inline-form {
    flex-direction: column;
    align-items: stretch;

    .el-input {
      max-width: 100% !important;
      width: 100%;
    }

    .arc-btn {
      width: 100%;
      justify-content: center;
    }
  }
}
</style>
