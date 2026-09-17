<template>
  <div class="brand-preview-page">
    <div class="bg-paper-texture"></div>
    <div class="bg-ink-ambient"></div>

    <header class="preview-toolbar">
      <div class="toolbar-left">
        <el-button text @click="exit">
          <Icon icon="solar:alt-arrow-down-linear" width="16" height="16" class="back-icon" style="margin-right: 4px" />
          {{ $t('backToSettings') }}
        </el-button>
        <span class="toolbar-title">{{ $t('brandPreview') }}</span>
      </div>

      <div class="toolbar-right">
        <el-button-group>
          <el-button size="small" :type="width === 'desktop' ? 'primary' : 'default'" @click="width = 'desktop'">{{ $t('desktopPreview') }}</el-button>
          <el-button size="small" :type="width === 'mobile' ? 'primary' : 'default'" @click="width = 'mobile'">{{ $t('mobilePreview') }}</el-button>
        </el-button-group>
        <el-button size="small" @click="openDark($event)">
          <Icon :icon="uiStore.dark ? 'solar:sun-2-linear' : 'solar:moon-linear'" width="15" height="15" />
        </el-button>
        <el-button size="small" :disabled="saving || !baseline || isDefault" @click="resetDefaults">{{ $t('restoreDefaults') }}</el-button>
        <el-button type="primary" size="small" :loading="saving" :disabled="!baseline || !dirty" @click="save">{{ $t('save') }}</el-button>
      </div>
    </header>

    <main class="preview-stage" v-loading="loading" :inert="saving || !baseline ? '' : null">
      <div class="preview-panes" :class="`is-${width}`">
        <LoginHero
          :title="title"
          :copy="copy"
          editable
          is-preview
          @update:copy="onCopyChange"
        />

        <LoginCard :title="title" :subtitle="copy.subtitle || defaults.subtitle">
          <template #header>
            <LoginCardHead
              :title="copy.cardTitle || defaults.cardTitle"
              :desc="copy.cardSubtitle || defaults.cardSubtitle"
              :copy="copy"
              editable
              @update:copy="onCopyChange"
            />
          </template>

          <div class="form-item">
            <label class="item-label">{{ $t('mailboxAccountLabel') }}</label>
            <el-input disabled :placeholder="$t('emailAccount')" class="arc-modern-input">
              <template #prefix><Icon icon="solar:letter-linear" width="16" height="16" class="field-icon" /></template>
              <template #append>@example.com</template>
            </el-input>
          </div>

          <div class="form-item">
            <label class="item-label">{{ $t('loginPasswordLabel') }}</label>
            <el-input disabled type="password" show-password :placeholder="$t('password')" class="arc-modern-input">
              <template #prefix><Icon icon="solar:lock-keyhole-linear" width="16" height="16" class="field-icon" /></template>
            </el-input>
          </div>

          <el-button class="btn arc-submit-btn" type="primary" disabled>{{ $t('loginBtn') }}</el-button>

          <div class="oauth-divider">
            <span class="oauth-divider-line"></span>
            <span class="oauth-divider-text">{{ $t('or') }}</span>
            <span class="oauth-divider-line"></span>
          </div>

          <button type="button" class="oauth-btn" disabled>
            <svg class="google-g" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span>Google</span>
          </button>
        </LoginCard>
      </div>
    </main>

    <footer class="preview-footer">
      <span>{{ $t('brandPreviewHint') }}</span>
      <span v-if="feedback" :class="['feedback', feedbackType]">{{ feedback }}</span>
    </footer>


  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { Icon } from '@iconify/vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import LoginHero from '@/components/login-hero/index.vue'
import LoginCardHead from '@/components/login-card-head/index.vue'
import LoginCard from '@/components/login-card/index.vue'
import { settingQuery, settingSet } from '@/request/setting.js'
import { useUiStore } from '@/store/ui.js'
import { useSettingStore } from '@/store/setting.js'
import { hasPerm } from '@/perm/perm.js'
import { openDark } from '@/utils/theme.js'
import { defaultLoginCopy } from '@/utils/brand.js'

defineOptions({ name: 'brand-preview' })

const router = useRouter()
const uiStore = useUiStore()
const settingStore = useSettingStore()

const loading = ref(false)
const saving = ref(false)
const width = ref('desktop')
const title = ref('')
// Reactive so the fallback copy follows a language switch without a reload.
const defaults = computed(() => defaultLoginCopy())
const copy = ref(defaultLoginCopy())
const baseline = ref(null)
const feedback = ref('')
const feedbackType = ref('')

const dirty = computed(() => Boolean(baseline.value) && JSON.stringify(copy.value) !== JSON.stringify(baseline.value))
const isDefault = computed(() => JSON.stringify(copy.value) === JSON.stringify(defaultLoginCopy()))

function setFeedback(message, type = 'error') {
  feedback.value = message
  feedbackType.value = type
}

function clearFeedback() {
  feedback.value = ''
  feedbackType.value = ''
}

function onCopyChange(next) {
  copy.value = next
  clearFeedback()
}

function resetDefaults() {
  copy.value = defaultLoginCopy()
  setFeedback(t('brandRestoredMsg'), 'success')
}

async function load() {
  loading.value = true
  try {
    const data = await settingQuery()
    title.value = data?.title || settingStore.settings?.title || 'FlareMail'
    copy.value = data?.loginCopy && typeof data.loginCopy === 'object'
      ? { ...defaultLoginCopy(), ...data.loginCopy }
      : defaultLoginCopy()
    baseline.value = JSON.parse(JSON.stringify(copy.value))
  } catch (error) {
    setFeedback(error?.message || t('brandLoadFailedMsg'))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!baseline.value || saving.value || !dirty.value) return
  clearFeedback()
  saving.value = true
  try {
    await settingSet({ loginCopy: copy.value })
    baseline.value = JSON.parse(JSON.stringify(copy.value))
    setFeedback(t('brandSavedMsg'), 'success')
  } catch (error) {
    setFeedback(error?.message || t('saveRetryMsg'))
  } finally {
    saving.value = false
  }
}

function exit() {
  router.replace({ name: 'sys-setting', query: { tab: 'brand' } })
}

async function confirmLeave() {
  if (saving.value) return false
  if (!dirty.value) return true
  try { await ElMessageBox.confirm(t('brandUnsavedConfirm'), t('leavePreviewTitle'), { confirmButtonText: t('discardAndLeave'), cancelButtonText: t('continueEditing') }); return true } catch { return false }
}
onBeforeRouteLeave(confirmLeave)
function warnBeforeUnload(event) { if (dirty.value || saving.value) { event.preventDefault(); event.returnValue = '' } }
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload))
onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeUnload)
  if (!hasPerm('setting:query')) {
    ElMessage({ message: t('noSysSettingPermMsg'), type: 'error', plain: true })
    router.replace({ name: 'email' })
    return
  }
  load()
})

</script>

<style lang="scss" scoped>
.brand-preview-page {
  min-height: 100vh;
  width: 100vw;
  position: relative;
  overflow-x: hidden;
  background-color: var(--paper);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.bg-paper-texture {
  position: fixed;
  inset: 0;
  background-image: radial-gradient(var(--line) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.4;
  pointer-events: none;
}

.bg-ink-ambient {
  position: fixed;
  top: -20vh;
  right: -10vw;
  width: 60vw;
  height: 60vw;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%);
  pointer-events: none;
}

.preview-toolbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: blur(6px);
  flex-wrap: wrap;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.back-icon {
  transform: rotate(90deg);
}

.toolbar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-strong);
}

.preview-stage {
  position: relative;
  z-index: 5;
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 24px;
  box-sizing: border-box;
}

.preview-panes {
  width: 100%;
  display: grid;
  grid-template-columns: 1.15fr 0.95fr;
  gap: 60px;
  align-items: center;
  transition: max-width 0.2s ease;

  &.is-desktop {
    max-width: 1060px;
  }

  &.is-mobile {
    max-width: 460px;
    grid-template-columns: 1fr;
    gap: 32px;
  }
}

.preview-footer {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
}

.feedback {
  color: #dc2626;

  &.success {
    color: #059669;
  }
}
@media (max-width: 767px) {
  .preview-stage { padding: 20px 16px; }
  .preview-panes.is-desktop { grid-template-columns: 1fr; gap: 24px; }
  .preview-footer { flex-wrap: wrap; line-height: 1.6; }
}
</style>
