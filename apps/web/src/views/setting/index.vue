<template>
  <el-scrollbar class="setting-scroll">
    <div class="setting-page">
      <!-- 页面头部：跟随当前分区 -->
      <div class="page-header">
        <div class="page-title-group">
          <h2 class="page-title arc-serif-title">{{ $t(activeSectionMeta.label) }}</h2>
          <p class="page-desc">{{ $t(activeSectionMeta.desc) }}</p>
        </div>
      </div>

      <!-- 分区 1: 个人资料与偏好 -->
      <transition name="tab-fade">
        <div v-show="activeSection === 'profile'" class="section-panel">
          <ProfileCard :password-loading="passwordGateLoading" @open-pwd="openPasswordDialog" />
          <LanguageCard />
        </div>
      </transition>

      <!-- 分区 2: 外观设置 -->
      <transition name="tab-fade">
        <div v-show="activeSection === 'appearance'" class="section-panel">
          <ThemeCard />
        </div>
      </transition>

      <!-- 分区 3: 邮箱与别名管理 -->
      <transition name="tab-fade">
        <div v-show="activeSection === 'mailboxes'" class="section-panel">
          <AliasManagerCard :run-sensitive="runSensitive" />
          <EmailForwardingCard />
        </div>
      </transition>

      <!-- 分区 4: 安全与凭证 -->
      <transition name="tab-fade">
        <div v-show="activeSection === 'security'" class="section-panel">
          <GoogleOauthCard :run-sensitive="runSensitive" />
          <CliTokenCard :run-sensitive="runSensitive" />
        </div>
      </transition>

      <!-- 密码修改独立弹窗 -->
      <PasswordChangeDialog v-model="pwdShow" :run-sensitive="runSensitive" />

      <RecentAuthDialog
        ref="recentAuthDialog"
        :model-value="recentAuthVisible"
        :purpose="recentAuthPurpose"
        :window-minutes="recentAuthWindowMinutes"
        :loading="recentAuthLoading"
        :error-message="recentAuthError"
        @submit="submitRecentAuth"
        @cancel="cancelRecentAuth"
        @clear-error="recentAuthError = ''"
      />
    </div>
  </el-scrollbar>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import ProfileCard from './components/ProfileCard.vue'
import LanguageCard from './components/LanguageCard.vue'
import ThemeCard from './components/ThemeCard.vue'
import AliasManagerCard from './components/AliasManagerCard.vue'
import EmailForwardingCard from './components/EmailForwardingCard.vue'
import CliTokenCard from './components/CliTokenCard.vue'
import GoogleOauthCard from './components/GoogleOauthCard.vue'
import PasswordChangeDialog from './components/PasswordChangeDialog.vue'
import RecentAuthDialog from './components/RecentAuthDialog.vue'
import { recentAuthPassword, recentAuthStatus } from '@/request/my.js'
import { createRecentAuthCoordinator } from '@/utils/recent-auth.js'
import { getUserSettingSection, resolveUserSettingSection } from './sections.js'

const { t } = useI18n()
const route = useRoute()
const activeSection = computed(() => resolveUserSettingSection(route.query.tab))
const activeSectionMeta = computed(() => getUserSettingSection(activeSection.value))
const pwdShow = ref(false)
const passwordGateLoading = ref(false)
const recentAuthDialog = ref()
const recentAuthVisible = ref(false)
const recentAuthPurpose = ref(t('recentAuthDefaultPurpose'))
const recentAuthWindowMinutes = ref(1440)
const recentAuthLoading = ref(false)
const recentAuthError = ref('')
let recentAuthResolve = null
let recentAuthRequestEpoch = 0
let disposed = false

function requestRecentAuthentication(purpose, status) {
  recentAuthWindowMinutes.value = status?.windowMinutes || 1440
  if (disposed) return Promise.resolve(false)
  return new Promise(resolve => {
    recentAuthResolve = resolve
    recentAuthPurpose.value = purpose || t('recentAuthDefaultPurpose')
    recentAuthError.value = ''
    recentAuthVisible.value = true
  })
}

function settleRecentAuthentication(verified) {
  recentAuthRequestEpoch += 1
  const resolve = recentAuthResolve
  recentAuthResolve = null
  recentAuthVisible.value = false
  recentAuthLoading.value = false
  recentAuthError.value = ''
  resolve?.(verified === true)
}

async function submitRecentAuth(password) {
  if (!recentAuthResolve || recentAuthLoading.value) return
  const requestEpoch = ++recentAuthRequestEpoch
  recentAuthLoading.value = true
  recentAuthError.value = ''
  try {
    const status = await recentAuthPassword(password)
    if (requestEpoch !== recentAuthRequestEpoch || !recentAuthResolve) return
    if (status?.valid !== true) {
      recentAuthError.value = t('reauthNotEffectiveMsg')
      await recentAuthDialog.value?.clearAndFocus()
      return
    }
    settleRecentAuthentication(true)
  } catch (error) {
    if (requestEpoch !== recentAuthRequestEpoch || !recentAuthResolve) return
    if (Number(error?.code) === 403) {
      recentAuthError.value = t('currentPwdIncorrectMsg')
    } else if (Number(error?.code) === 429) {
      recentAuthError.value = t('tooManyAttemptsMsg')
    } else if (Number(error?.code) !== 401) {
      recentAuthError.value = error?.message || t('reauthFailedMsg')
    }
    await recentAuthDialog.value?.clearAndFocus()
  } finally {
    if (requestEpoch === recentAuthRequestEpoch && recentAuthResolve) {
      recentAuthLoading.value = false
    }
  }
}

function cancelRecentAuth() {
  settleRecentAuthentication(false)
}

const recentAuthCoordinator = createRecentAuthCoordinator({
  getStatus: recentAuthStatus,
  requestAuthentication: requestRecentAuthentication
})

function runSensitive(purpose, action) {
  return recentAuthCoordinator.run(purpose, async () => {
    if (disposed) return
    return action()
  })
}

async function openPasswordDialog() {
  if (passwordGateLoading.value) return
  passwordGateLoading.value = true
  try {
    await runSensitive(t('changePassword'), async () => {
      pwdShow.value = true
    })
  } catch (error) {
    if (Number(error?.code) !== 401) {
      ElMessage({ message: error?.message || t('verifyIdentityFailedMsg'), type: 'error', plain: true })
    }
  } finally {
    passwordGateLoading.value = false
  }
}

onBeforeUnmount(() => {
  disposed = true
  settleRecentAuthentication(false)
})
</script>

<style lang="scss" scoped>
.setting-scroll {
  height: 100%;
  width: 100%;
  background: var(--bg);
}

.setting-page {
  padding: 32px 40px 80px;
  max-width: 900px;
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
  padding: 4px 4px 10px;

  .page-title-group {
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
}

.arc-serif-title {
  font-family: "Noto Serif SC", "Songti SC", "SimSun", "STSong", serif, -apple-system, sans-serif;
}

.section-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;

  @media (max-width: 767px) {
    gap: 16px;
  }
}
</style>
