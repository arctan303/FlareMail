<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">
          <Icon icon="solar:key-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('loginMethod') }}</h3>
          <p class="card-desc">{{ $t('googleCardDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <template v-if="isBound">
        <div class="bound-row">
          <div class="bound-info">
            <svg class="google-g" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span class="bound-email">{{ userStore.user.googleEmail }}</span>
            <span class="bound-tag">{{ $t('bound') }}</span>
          </div>
          <div class="bound-actions">
            <el-button text :loading="bindLoading" :disabled="unbindLoading" @click="startBind">{{ $t('replace') }}</el-button>
            <el-button text type="danger" :loading="unbindLoading" :disabled="bindLoading" @click="doUnbind">{{ $t('unbind') }}</el-button>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="unbound-block">
          <p class="unbound-desc">{{ $t('googleNotBoundDesc') }}</p>
          <el-button class="arc-btn bind-btn" type="primary" :loading="bindLoading" @click="startBind">
            <svg class="google-g" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span>{{ $t('bindGoogleAccount') }}</span>
          </el-button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/store/user.js'
import { oauthBindStart, oauthUnbind } from '@/request/oauth.js'
import router from '@/router'
import { setAuthenticatedSession } from '@/utils/session-state.js'
import { invalidateUserScopedStateAcrossTabs } from '@/utils/sensitive-state.js'
import { runConfirmedAction } from '@/utils/recent-auth.js'

const { t } = useI18n()

const props = defineProps({
  runSensitive: { type: Function, required: true }
})

const userStore = useUserStore()
const isBound = computed(() => !!userStore.user.googleEmail)
const bindLoading = ref(false)
const unbindLoading = ref(false)

onMounted(() => {
  const query = router.currentRoute.value.query
  if (query.oauth === 'bound') {
    ElMessage({ message: t('googleBindSuccessMsg'), type: 'success', plain: true })
    cleanQuery(['oauth', 'oauth_err'])
  } else if (query.oauth_err) {
    const err = query.oauth_err
    if (err === 'already_bound') {
      ElMessage({ message: t('googleBoundByOtherMsg'), type: 'error', plain: true })
    } else if (err === 'access_denied') {
      ElMessage({ message: t('googleAuthCancelledMsg'), type: 'info', plain: true })
    } else if (err === 'expired') {
      ElMessage({ message: t('googleBindTimeoutMsg'), type: 'error', plain: true })
    } else if (err === 'reauth_required') {
      ElMessage({ message: t('googleBindExpiredMsg'), type: 'warning', plain: true })
    } else {
      ElMessage({ message: t('googleBindFailedMsg'), type: 'error', plain: true })
    }
    cleanQuery(['oauth', 'oauth_err'])
  }
})

function cleanQuery(keys) {
  const currentQuery = { ...router.currentRoute.value.query }
  let changed = false
  for (const k of keys) {
    if (k in currentQuery) {
      delete currentQuery[k]
      changed = true
    }
  }
  if (changed) {
    router.replace({ query: currentQuery })
  }
}

function showActionError(error, fallback) {
  if (Number(error?.code) === 401) return
  ElMessage({
    message: Number(error?.code) === 428
      ? t('authStateExpiredMsg')
      : (error?.message || fallback),
    type: 'error',
    plain: true
  })
}

async function startBind() {
  if (bindLoading.value || unbindLoading.value) return
  bindLoading.value = true
  try {
    await props.runSensitive(isBound.value ? t('changeGoogleAccount') : t('bindGoogleAccount'), async () => {
      const response = await oauthBindStart({ noMsg: true })
      const target = new URL(response?.url || '')
      if (target.origin !== 'https://accounts.google.com') {
        throw new Error(t('googleInvalidAuthUrl'))
      }
      window.location.assign(target.href)
    })
  } catch (error) {
    showActionError(error, t('googleBindStartFailedMsg'))
  } finally {
    bindLoading.value = false
  }
}

async function doUnbind() {
  if (unbindLoading.value || bindLoading.value) return
  unbindLoading.value = true
  try {
    await props.runSensitive(t('unbindGoogleAccount'), () => runConfirmedAction(
      () => ElMessageBox.confirm(
        t('googleUnbindConfirm'),
        t('notice'),
        { confirmButtonText: t('confirmUnbind'), cancelButtonText: t('cancel'), type: 'warning' }
      ),
      async () => {
        await oauthUnbind({ noMsg: true })
        setAuthenticatedSession(false)
        invalidateUserScopedStateAcrossTabs()
        window.location.replace('/login')
      }
    ))
  } catch (error) {
    showActionError(error, t('googleUnbindFailedMsg'))
  } finally {
    unbindLoading.value = false
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

.google-g {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.bound-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;

  .bound-info {
    display: flex;
    align-items: center;
    gap: 10px;

    .bound-email {
      font-size: 13.5px;
      font-weight: 500;
      color: var(--text-strong);
    }

    .bound-tag {
      font-size: 12px;
      font-weight: 600;
      color: #16a34a;
      background: rgba(22, 163, 74, 0.12);
      padding: 2px 10px;
      border-radius: 999px;
    }
  }

  .bound-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.unbound-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;

  .unbound-desc {
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
    flex: 1;
    min-width: 220px;
  }

  .bind-btn {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
</style>
