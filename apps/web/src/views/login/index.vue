<template>
  <div id="login-box">
    <!-- Classical Background Texture -->
    <div class="bg-paper-texture"></div>
    <div class="bg-ink-ambient"></div>

    <!-- Top Right Floating Toolbar (Theme Switcher with View Transition) -->
    <div class="top-toolbar">
      <button class="theme-toggle-btn" @click="openDark($event)" :title="uiStore.dark ? $t('switchToLight') : $t('switchToDark')">
        <Icon :icon="uiStore.dark ? 'solar:sun-2-linear' : 'solar:moon-linear'" width="18" height="18" />
      </button>
    </div>

    <!-- Main Left-Right Dual-Pane Layout -->
    <main class="dual-pane-layout">
      <!-- Left Side: Literary Brand Showcase (左侧雅致书信意境) -->
      <LoginHero :title="brand.title" :copy="brand.loginCopy" />

      <!-- Right Side: Comfortable Stationery Login Card (右侧舒展信笺卡片) -->
      <LoginCard :title="brand.title" :subtitle="brand.loginCopy.subtitle">
        <template #header>
          <LoginCardHead :title="cardTitle" :desc="cardDesc" />
        </template>
          <div v-if="isInitialSetup" class="setup-tip-banner"><span v-if="upgradeSupported">{{ $t('setupIntroBanner') }}</span><span v-else>{{ $t('upgradeUnsupportedBanner') }}</span></div>
          <template v-if="isInitialSetup"><template v-if="upgradeSupported">
              <div class="setup-steps" :aria-label="$t('setupStepsLabel')"><span v-for="(label, index) in setupStepLabels" :key="label" :class="{ active: setupStep === index, done: setupStep > index }">{{ index + 1 }}. {{ label }}</span></div>
              <div v-if="setupStep === 0" class="setup-step"><div class="form-item"><label class="item-label">{{ $t('setupSecretLabel') }}</label><el-input v-model="setupForm.setupSecret" :placeholder="$t('setupSecretPlaceholder')" type="password" autocomplete="off" show-password class="arc-modern-input" @keyup.enter="verifySetupSecret"><template #prefix><Icon icon="solar:key-linear" width="16" height="16" class="field-icon" /></template></el-input></div><p class="setup-step-hint">{{ $t('setupSecretHint') }}</p><el-button class="btn arc-submit-btn" type="primary" @click="verifySetupSecret" :loading="setupLoading">{{ $t('verifyAndContinue') }}</el-button></div>
              <div v-else-if="setupStep === 1" class="setup-step"><div class="form-item"><label class="item-label">{{ $t('setupDomainsLabel') }}</label><el-input v-model="setupForm.domainsText" type="textarea" :rows="3" :placeholder="$t('setupDomainsPlaceholder')" class="arc-modern-input" /></div><p class="setup-step-hint">{{ $t('setupDomainsHint') }}</p><div class="setup-actions"><el-button text @click="setupStep = 0">{{ $t('back') }}</el-button><el-button class="btn arc-submit-btn" type="primary" @click="prepareDomains">{{ $t('continueLabel') }}</el-button></div></div>
              <div v-else-if="setupStep === 2" class="setup-step"><div class="form-item"><label class="item-label">{{ $t('setupAdminPrefixLabel') }}</label><el-input v-model="setupForm.adminPrefix" :placeholder="$t('setupAdminPrefixPlaceholder')" autocomplete="username" class="arc-modern-input"><template #prefix><Icon icon="solar:letter-linear" width="16" height="16" class="field-icon" /></template><template #append>@</template></el-input></div><div class="form-item"><label class="item-label">{{ $t('mailboxDomainLabel') }}</label><el-select v-model="setupForm.adminDomain" class="arc-modern-input" style="width: 100%"><el-option v-for="domain in setupForm.domains" :key="domain" :label="domain" :value="domain" /></el-select></div><div class="form-item"><label class="item-label">{{ $t('setupAdminPasswordLabel') }}</label><el-input v-model="setupForm.password" :placeholder="$t('setupAdminPasswordPlaceholder')" type="password" autocomplete="new-password" show-password class="arc-modern-input" /></div><div class="form-item"><label class="item-label">{{ $t('confirmAdminPasswordLabel') }}</label><el-input v-model="setupForm.confirmPassword" :placeholder="$t('confirmPasswordPlaceholder')" type="password" autocomplete="new-password" show-password class="arc-modern-input" @keyup.enter="prepareAdmin" /></div><div class="setup-actions"><el-button text @click="setupStep = 1">{{ $t('back') }}</el-button><el-button class="btn arc-submit-btn" type="primary" @click="prepareAdmin">{{ $t('reviewConfirm') }}</el-button></div></div>
              <div v-else class="setup-step"><div class="setup-confirm"><div><span>{{ $t('setupDomainsLabel') }}</span><strong>{{ setupForm.domains.join(', ') }}</strong></div><div><span>{{ $t('setupAdminAccountLabel') }}</span><strong>{{ setupEmail }}</strong></div></div><p class="setup-step-hint">{{ $t('setupConfirmHint') }}</p><div class="setup-actions"><el-button text @click="setupStep = 2">{{ $t('backToEdit') }}</el-button><el-button class="btn arc-submit-btn" type="primary" @click="submitSetup" :loading="setupLoading">{{ $t('confirmAndInstall') }}</el-button></div></div>
          </template></template>
          <template v-else-if="isDatabaseUpgrade"><div class="setup-tip-banner"><span v-if="upgradeSupported">{{ $t('upgradeIntroBanner') }}</span><span v-else>{{ $t('upgradeManualBanner') }}</span></div><template v-if="upgradeSupported"><div class="form-item"><label class="item-label">{{ $t('upgradeTokenLabel') }}</label><el-input v-model="upgradeToken" :placeholder="$t('setupSecretPlaceholder')" type="password" autocomplete="off" show-password class="arc-modern-input" @keyup.enter="submitUpgrade"><template #prefix><Icon icon="solar:key-linear" width="16" height="16" class="field-icon" /></template></el-input></div><el-button class="btn arc-submit-btn" type="primary" @click="submitUpgrade" :loading="upgradeLoading">{{ $t('upgradeDatabase') }}</el-button></template></template>
          <!-- Normal Login Form -->
            <template v-else>
              <div class="form-item">
                <label class="item-label">{{ $t('mailboxAccountLabel') }}</label>
                <el-input
                  :class="!hideLoginDomain ? 'email-input arc-modern-input' : 'arc-modern-input'"
                  v-model="form.email"
                  type="text"
                  :placeholder="$t('emailAccount')"
                  autocomplete="username"
                  @keyup.enter="submit()"
                >
                  <template #prefix>
                    <Icon icon="solar:letter-linear" width="16" height="16" class="field-icon" />
                  </template>
                  <template #append v-if="!hideLoginDomain">
                    <div @click.stop="openSelect" class="domain-select-wrapper">
                      <el-select ref="mySelect" v-model="suffix" class="select hidden-select">
                        <el-option v-for="item in domainList" :key="item" :label="item" :value="item"/>
                      </el-select>
                      <div class="domain-display">
                        <span>{{ suffix }}</span>
                        <Icon class="setting-icon" icon="solar:alt-arrow-down-linear" width="16" height="16"/>
                      </div>
                    </div>
                  </template>
                </el-input>
              </div>

              <div class="form-item">
                <label class="item-label">{{ $t('loginPasswordLabel') }}</label>
                <el-input
                  v-model="form.password"
                  :placeholder="$t('password')"
                  type="password"
                  autocomplete="current-password"
                  show-password
                  class="arc-modern-input"
                  @keyup.enter="submit()"
                >
                  <template #prefix>
                    <Icon icon="solar:lock-keyhole-linear" width="16" height="16" class="field-icon" />
                  </template>
                </el-input>
              </div>

              <div v-show="turnstileRequired" ref="turnstileRef" class="login-turnstile"></div>

              <el-button class="btn arc-submit-btn" type="primary" @click="submit()" :loading="loginLoading">
                {{ $t('loginBtn') }}
              </el-button>

              <div v-if="oauthEnabled" class="oauth-divider">
                <span class="oauth-divider-line"></span>
                <span class="oauth-divider-text">{{ $t('or') }}</span>
                <span class="oauth-divider-line"></span>
              </div>

              <button v-if="oauthEnabled" type="button" class="oauth-btn" @click="startGoogleLogin">
                <svg class="google-g" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                <span>Google</span>
              </button>
            </template>
      </LoginCard>
    </main>
  </div>
</template>

<script setup>
import {computed, nextTick, onMounted, reactive, ref} from 'vue'
import {Icon} from '@iconify/vue'
import {useI18n} from 'vue-i18n'
import {useRouter, useRoute} from 'vue-router'
import { isBlockingUpgrade } from '@/utils/setup-gate.js'
import {login, loginSecurity, setupAdmin, setupStatus, setupUpgrade, setupVerify} from '@/request/login.js'
import {websiteConfig} from '@/request/setting.js'
import {loginUserInfo} from '@/request/my.js'
import {isDomain, isEmail} from '@/utils/verify-utils.js'
import {permsToRouter} from '@/perm/perm.js'
import {useSettingStore} from '@/store/setting.js'
import {useAccountStore} from '@/store/account.js'
import {useUserStore} from '@/store/user.js'
import {useUiStore} from '@/store/ui.js'
import {openDark} from '@/utils/theme.js'
import {setAuthenticatedSession} from '@/utils/session-state.js'
import {clearSetupSession, getSetupSession, hasSetupSession, setSetupSession} from '@/utils/setup-session.js'
import {resolveSetupFailure} from '@/utils/setup-recovery.js'
import {invalidateUserScopedStateAcrossTabs} from '@/utils/sensitive-state.js'
import {safeAuthorizationReturn} from '@/utils/oauth-return.js'
import {ElMessage} from 'element-plus'
import {normalizeBrand, applyBrandToDocument} from '@/utils/brand.js'
import LoginHero from '@/components/login-hero/index.vue'
import LoginCardHead from '@/components/login-card-head/index.vue'
import LoginCard from '@/components/login-card/index.vue'

const router = useRouter()
const route = useRoute()
const {t} = useI18n()
const settingStore = useSettingStore()
const accountStore = useAccountStore()
const userStore = useUserStore()
const uiStore = useUiStore()
const brand = computed(() => normalizeBrand(settingStore.settings))
const loginLoading = ref(false)
const setupLoading = ref(false)
const setupStep = ref(0)
const setupCompleted = ref(false)
// Computed so the step labels follow a language switch.
const setupStepLabels = computed(() => [
  t('setupStepVerify'),
  t('setupStepDomains'),
  t('setupStepAdmin'),
  t('setupStepConfirm'),
])
const upgradeLoading = ref(false)
const upgradeToken = ref('')
const turnstileRequired = ref(false)
const oauthEnabled = ref(false)
const turnstileRef = ref()
const mySelect = ref()
const suffix = ref(settingStore.domainList?.[0] || '')
const domainList = computed(() => settingStore.domainList || [])
const form = reactive({email: '', password: ''})
const setupForm = reactive({setupSecret: '', domainsText: '', domains: [], adminPrefix: '', adminDomain: '', password: '', confirmPassword: ''})
let turnstileId = null
let turnstileToken = ''
let turnstileScriptPromise = null

const isInitialSetup = computed(() => settingStore.settings?.setupRequired === true)
const setupEmail = computed(() => setupForm.adminPrefix.trim() && setupForm.adminDomain ? setupForm.adminPrefix.trim() + '@' + setupForm.adminDomain : '')
const isDatabaseUpgrade = computed(() => isBlockingUpgrade(settingStore.settings))
const upgradeSupported = computed(() => settingStore.settings?.upgradeSupported !== false)

// 正常登录态使用可自定义文案；安装/升级属于系统状态提示，保持固定。
const cardTitle = computed(() => (
  isInitialSetup.value
    ? (setupCompleted.value ? t('setupDoneTitle') : t('serviceInitTitle'))
    : (isDatabaseUpgrade.value ? t('upgradeServiceTitle') : brand.value.loginCopy.cardTitle)
))
const cardDesc = computed(() => (
  setupCompleted.value
    ? t('setupDoneDesc')
    : (isInitialSetup.value
      ? t('setupIntroDesc')
      : (isDatabaseUpgrade.value ? t('upgradeIntroDesc') : brand.value.loginCopy.cardSubtitle))
))
const requiresManualRecovery = computed(() =>
  (isInitialSetup.value || isDatabaseUpgrade.value) && !upgradeSupported.value
)
const hideLoginDomain = computed(() => settingStore.settings?.loginDomain === 1)

const securitySiteKey = ref('')

onMounted(async () => {
  if (isInitialSetup.value || isDatabaseUpgrade.value) return

  try {
    await refreshWebsiteConfig()
  } catch (e) {
    console.error('Failed to load website config:', e)
  }

  const query = router.currentRoute.value.query
  if (query.oauth_err || query.oauth === 'unbound') {
    const err = query.oauth_err || (query.oauth === 'unbound' ? 'unbound' : '')
    if (err === 'unbound') {
      ElMessage({ message: t('googleLoginUnboundMsg'), type: 'error', duration: 5000, plain: true })
    } else if (err === 'access_denied') {
      ElMessage({ message: t('googleLoginCancelledMsg'), type: 'info', plain: true })
    } else if (err === 'expired') {
      ElMessage({ message: t('googleLoginTimeoutMsg'), type: 'error', plain: true })
    } else {
      ElMessage({ message: t('googleLoginFailedMsg'), type: 'error', plain: true })
    }
    const currentQuery = { ...query }
    delete currentQuery.oauth
    delete currentQuery.oauth_err
    router.replace({ query: currentQuery })
  }
  try {
    const security = await loginSecurity()
    oauthEnabled.value = !!security.oauthEnabled
    if (security.siteKey) {
      securitySiteKey.value = security.siteKey
    }
    if (security.turnstileRequired) {
      turnstileRequired.value = true
      await renderTurnstile()
    }
  } catch {
    // The status check is optional; the login request remains authoritative.
  }
})

function startGoogleLogin() {
	const target = new URL('/login/oauth/start', window.location.origin)
	const returnTo = safeAuthorizationReturn(route.query?.redirect, window.location.origin)
	if (returnTo) target.searchParams.set('return_to', returnTo)
	window.location.href = target.toString()
}

function openSelect() {
  mySelect.value?.toggleMenu()
}

async function verifySetupSecret() {
  if (setupLoading.value) return
  if (!setupForm.setupSecret.trim()) { ElMessage({message: t('setupSecretRequiredMsg'), type: 'warning', plain: true}); return }
  setupLoading.value = true
  try {
    const result = await setupVerify(setupForm.setupSecret.trim())
    if (!result?.setupSession) throw new Error(t('setupSessionInvalidMsg'))
    setSetupSession(result.setupSession, result.expiresAt)
    setupForm.setupSecret = ''
    setupStep.value = 1
  } catch (error) {
    if (Number(error?.code) === 409) await refreshSetupStatus()
  } finally { setupLoading.value = false }
}

function normalizeSetupDomains(value) {
  const unique = [...new Set(String(value || '').split(/[,\uFF0C\s]+/).map(item => item.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))]
  if (!unique.length || unique.some(item => !isDomain(item))) return null
  return unique
}

function prepareDomains() {
  const domains = normalizeSetupDomains(setupForm.domainsText)
  if (!domains) { ElMessage({message: t('setupDomainRequiredMsg'), type: 'error', plain: true}); return }
  setupForm.domains = domains
  setupForm.adminDomain = domains.includes(setupForm.adminDomain) ? setupForm.adminDomain : domains[0]
  setupStep.value = 2
}

function prepareAdmin() {
  const prefix = setupForm.adminPrefix.trim()
  if (!prefix || !isEmail(prefix + '@' + setupForm.adminDomain)) { ElMessage({message: t('setupAdminPrefixInvalidMsg'), type: 'error', plain: true}); return }
  if (Array.from(setupForm.password).length < 12) { ElMessage({message: t('setupAdminPasswordTooShortMsg'), type: 'error', plain: true}); return }
  if (setupForm.password !== setupForm.confirmPassword) { ElMessage({message: t('confirmPwdFailMsg'), type: 'error', plain: true}); return }
  setupStep.value = 3
}

async function refreshSetupStatus() {
  try {
    const status = await setupStatus()
    if (status.setupRequired !== true) { settingStore.settings.setupRequired = false; setupCompleted.value = true; clearSetupSession(); clearSetupCredentials() }
  } catch {}
}

function clearSetupCredentials() {
  setupForm.setupSecret = ''
  setupForm.password = ''
  setupForm.confirmPassword = ''
  form.password = ''
}

async function submitSetup() {
  if (setupLoading.value) return
  if (!hasSetupSession()) { setupStep.value = 0; ElMessage({message: t('setupSessionExpiredMsg'), type: 'warning', plain: true}); return }
  const {setupSession, expiresAt} = getSetupSession()
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    clearSetupSession()
    setupStep.value = 0
    ElMessage({message: t('setupSessionTimeoutMsg'), type: 'warning', plain: true})
    return
  }
  const email = setupEmail.value
  const password = setupForm.password
  setupLoading.value = true
  try {
    const result = await setupAdmin(setupSession, email, password, setupForm.domains)
    clearSetupSession()
    settingStore.settings.setupRequired = false
    setupCompleted.value = true
    form.email = email
    form.password = password
    const loggedIn = await submit(email)
    clearSetupCredentials()
    if (!loggedIn) ElMessage({message: result?.adminEmail ? t('setupSuccessLoginMsg') : t('setupSuccessBackMsg'), type: 'success', plain: true})
  } catch (error) {
    let status = null
    try { status = await setupStatus() } catch {}
    const failure = resolveSetupFailure(error?.code, status)
    if (failure === 'installed') {
      clearSetupSession()
      clearSetupCredentials()
      settingStore.settings.setupRequired = false
      setupCompleted.value = true
      form.email = email
      try { await refreshWebsiteConfig() } catch {}
      ElMessage({message: t('setupCompletedMsg'), type: 'success', plain: true})
    } else if (failure === 'credentials') {
      clearSetupSession()
      clearSetupCredentials()
      setupStep.value = 0
      ElMessage({message: t('setupSessionExpiredMsg'), type: 'warning', plain: true})
    }
  } finally { setupLoading.value = false }
}

async function submitUpgrade() {
  if (upgradeLoading.value || !upgradeSupported.value) return
  if (!upgradeToken.value) {
    ElMessage({message: t('upgradeTokenRequiredMsg'), type: 'warning', plain: true})
    return
  }

  upgradeLoading.value = true
  try {
    await setupUpgrade(upgradeToken.value)
    upgradeToken.value = ''
    ElMessage({message: t('upgradeDoneMsg'), type: 'success', plain: true})
    window.location.reload()
  } finally {
    upgradeLoading.value = false
  }
}

async function submit(emailOverride) {
  if (loginLoading.value) return
  const rawEmail = (typeof emailOverride === 'string' ? emailOverride : form.email).trim()
  let finalEmail = rawEmail
  if (!finalEmail.includes('@') && !hideLoginDomain.value && suffix.value) {
    finalEmail += suffix.value
  }

  if (!rawEmail || !isEmail(finalEmail)) {
    ElMessage({message: t('notEmailMsg'), type: 'error', plain: true})
    return
  }
  if (!form.password) {
    ElMessage({message: t('emptyPwdMsg'), type: 'error', plain: true})
    return
  }
  if (turnstileRequired.value && !turnstileToken) {
    ElMessage({message: t('completeBotVerifyMsg'), type: 'warning', plain: true})
    return
  }

  loginLoading.value = true
  try {
    await login(finalEmail, form.password, turnstileToken)
    const user = await loginUserInfo()
    setAuthenticatedSession(true)
    accountStore.currentAccountId = user.account?.accountId
    accountStore.currentAccount = user.account
    userStore.user = user
    invalidateUserScopedStateAcrossTabs()
    permsToRouter(user.permKeys).forEach(routeData => router.addRoute('layout', routeData))
    await refreshWebsiteConfig()

    const oauthReturn = safeAuthorizationReturn(route.query?.redirect, window.location.origin)
    if (oauthReturn) {
      window.location.replace(oauthReturn)
      return
    }
    const redirectUrl = typeof route.query?.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//')
      ? route.query.redirect
      : '/inbox'
    try {
      await router.replace(redirectUrl)
    } catch {
      window.location.href = redirectUrl
    }

    return true

  } catch (error) {
    if (error?.code === 428) {
      turnstileRequired.value = true
      await renderTurnstile(true)
    } else if (turnstileRequired.value) {
      await renderTurnstile(true)
    }
    return false
  } finally {
    loginLoading.value = false
  }
}

async function renderTurnstile(forceRecreate = false) {
  turnstileRequired.value = true
  await nextTick()

  const sitekey = settingStore.settings?.siteKey || securitySiteKey.value || '3x00000000000000000000FF'

  try {
    await loadTurnstile()
  } catch (e) {
    console.warn('Failed to load turnstile script:', e)
    ElMessage({message: t('botVerifyLoadFailedMsg'), type: 'error', plain: true})
    return
  }
  if (!window.turnstile || !turnstileRef.value) return

  turnstileToken = ''

  // 如果已经有有效子节点且不强制重建，尝试 reset
  if (!forceRecreate && turnstileId !== null && turnstileRef.value.children.length > 0) {
    try {
      window.turnstile.reset(turnstileId)
      return
    } catch {
      // reset 失败则 fallback 重建
    }
  }

  try {
    if (turnstileId !== null) {
      try {
        window.turnstile.remove(turnstileId)
      } catch {}
      turnstileId = null
    }
    turnstileRef.value.innerHTML = ''
    turnstileId = window.turnstile.render(turnstileRef.value, {
      sitekey,
      theme: uiStore.dark ? 'dark' : 'light',
      callback: token => {
        turnstileToken = token
      },
      'expired-callback': () => {
        turnstileToken = ''
      },
      'error-callback': () => {
        turnstileToken = ''
      }
    })
  } catch (renderError) {
    console.error('Turnstile render failed:', renderError)
  }
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')
    if (existing) {
      existing.addEventListener('load', resolve)
      existing.addEventListener('error', reject)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = resolve
    script.onerror = () => {
      turnstileScriptPromise = null
      reject(new Error('Turnstile script failed to load'))
    }
    document.head.appendChild(script)
  })
  return turnstileScriptPromise
}

async function refreshWebsiteConfig() {
  const setting = await websiteConfig()
  settingStore.applyPublicBrand(setting)
  settingStore.domainList = setting.domainList
  suffix.value ||= setting.domainList?.[0] || ''
  applyBrandToDocument(setting, t('loginPageTitle'))
}
</script>

<style lang="scss" scoped>
#login-box {
  width: 100vw;
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
  background-color: var(--paper);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  box-sizing: border-box;
}

/* Background Atmosphere */
.bg-paper-texture {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-image: radial-gradient(var(--line) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.4;
  pointer-events: none;
}

.bg-ink-ambient {
  position: fixed;
  top: -20vh;
  right: -10vw;
  width: 65vw;
  height: 65vw;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 8%, transparent) 0%, transparent 70%);
  filter: blur(60px);
  pointer-events: none;
}

/* Top Right Toolbar */
.top-toolbar {
  position: absolute;
  top: 24px;
  right: 28px;
  z-index: 20;

  .theme-toggle-btn {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      background: var(--paper-soft);
      border-color: var(--accent);
      color: var(--accent);
      transform: translateY(-1px);
    }
  }
}

/* Main Dual Pane Layout */
.dual-pane-layout {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 1060px;
  display: grid;
  grid-template-columns: 1.15fr 0.95fr;
  gap: 60px;
  align-items: center;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
    gap: 32px;
    max-width: 460px;
  }
}

/* 安装/升级状态提示条（卡片外壳与表单样式已抽到 components/login-card） */
.setup-tip-banner {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--accent);
  line-height: 1.5;
}


.setup-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin: 2px 0 4px;
}
.setup-steps span {
  flex: 1;
  min-width: 80px;
  padding: 7px 8px;
  border-bottom: 2px solid var(--line);
  color: var(--faint);
  font-size: 11px;
  text-align: center;
}
.setup-steps span.active { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.setup-steps span.done { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); color: var(--muted); }
@media (max-width: 480px) { .setup-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.setup-step { display: flex; flex-direction: column; gap: 12px; }
.setup-step-hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
.setup-actions { display: flex; align-items: center; gap: 10px; }
.setup-actions .arc-submit-btn { flex: 1; }
.setup-confirm { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper-soft); }
.setup-confirm div { display: flex; flex-direction: column; gap: 4px; }
.setup-confirm span { color: var(--muted); font-size: 12px; }
.setup-confirm strong { color: var(--text-strong); font-size: 14px; word-break: break-word; }

.arc-serif-title {
  font-family: "Noto Serif SC", "Songti SC", "SimSun", "STSong", serif, -apple-system, sans-serif;
}
</style>
