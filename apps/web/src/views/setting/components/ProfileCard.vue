<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">
          <Icon icon="solar:user-id-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('profile') }}</h3>
          <p class="card-desc">{{ $t('profileCardDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <!-- 用户名行 -->
      <div class="setting-row">
        <div class="row-meta">
          <span class="row-label">{{ $t('username') }}</span>
          <span class="row-hint">{{ $t('profileNameHint') }}</span>
        </div>
        <div class="row-action">
          <template v-if="setNameShow">
            <div class="inline-form">
              <el-input v-model="accountName" size="default" class="profile-name-input" :placeholder="$t('profileNamePlaceholder')" @keyup.enter="setName" />
              <el-button type="primary" size="default" class="arc-btn" @click="setName">{{ $t('save') }}</el-button>
              <el-button size="default" text @click="setNameShow = false">{{ $t('cancel') }}</el-button>
            </div>
          </template>
          <template v-else>
            <div class="user-display">
              <span class="user-val font-semibold">{{ userStore.user.name }}</span>
              <el-button size="small" type="primary" plain class="arc-btn mini-btn" @click="showSetName">{{ $t('change') }}</el-button>
            </div>
          </template>
        </div>
      </div>

      <!-- 邮箱行 -->
      <div class="setting-row">
        <div class="row-meta">
          <span class="row-label">{{ $t('emailAccount') }}</span>
          <span class="row-hint">{{ $t('profileEmailHint') }}</span>
        </div>
        <div class="row-action">
          <span class="user-val">{{ userStore.user.email }}</span>
        </div>
      </div>

      <!-- 密码行 -->
      <div class="setting-row">
        <div class="row-meta">
          <span class="row-label">{{ $t('password') }}</span>
          <span class="row-hint">{{ $t('profilePasswordHint') }}</span>
        </div>
        <div class="row-action">
          <el-button
            type="primary"
            plain
            size="default"
            class="arc-btn mini-btn"
            :loading="passwordLoading"
            @click="$emit('openPwd')"
          >
            <Icon icon="solar:key-linear" width="16" height="16" style="margin-right: 4px;" />
            {{ $t('changePwdBtn') }}
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Icon } from "@iconify/vue"
import { useUserStore } from "@/store/user.js"
import { useAccountStore } from "@/store/account.js"
import { accountSetName } from "@/request/account.js"
import { ElMessage } from 'element-plus'
import { useI18n } from "vue-i18n"

const emit = defineEmits(['openPwd'])
defineProps({
  passwordLoading: { type: Boolean, default: false }
})
const { t } = useI18n()
const userStore = useUserStore()
const accountStore = useAccountStore()
const setNameShow = ref(false)
const accountName = ref(null)

function showSetName() {
  accountName.value = userStore.user.name
  setNameShow.value = true
}

async function setName() {
  const name = accountName.value?.trim()
  if (!name) {
    ElMessage({ message: t('emptyUserNameMsg'), type: 'error', plain: true })
    return
  }
  if (name === userStore.user.name) {
    setNameShow.value = false
    return
  }
  try {
    await accountSetName(userStore.user.account.accountId, name)
    userStore.user.name = name
    accountStore.changeUserAccountName = name
    setNameShow.value = false
    ElMessage({ message: t('saveSuccessMsg'), type: 'success', plain: true })
  } catch (e) {
    console.error(e)
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
  }
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);

  &:last-child {
    border-bottom: none;
    padding-bottom: 4px;
  }

  &:first-child {
    padding-top: 18px;
  }

  .row-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;

    .row-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-strong);
    }

    .row-hint {
      font-size: 12px;
      color: var(--muted);
    }
  }

  .row-action {
    display: flex;
    align-items: center;

    .user-display {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .user-val {
      font-size: 13.5px;
      color: var(--text);

      &.font-semibold {
        font-weight: 600;
        color: var(--text-strong);
      }
    }

    .mini-btn {
      padding: 6px 14px;
      font-size: 12.5px;
      border-radius: 6px;
    }
  }

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;

    .row-meta {
      width: 100%;
    }

    .row-action {
      width: 100%;
      justify-content: space-between;

      .user-display {
        width: 100%;
        justify-content: space-between;
      }

      .inline-form {
        width: 100%;
        .profile-name-input {
          flex: 1;
          min-width: 130px;
          width: auto;
        }
      }

      .mini-btn {
        margin-left: auto;
      }
    }
  }
}

.inline-form {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;

  .profile-name-input {
    width: 200px;
  }
}
</style>
