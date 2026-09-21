<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon">
          <Icon icon="solar:key-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysGoogleTitle') }}</h3>
          <p class="card-desc">{{ $t('sysGoogleDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <div class="switch-item">
        <div class="switch-meta">
          <span class="switch-title">{{ $t('sysGoogleSwitch') }}</span>
          <span class="switch-desc">{{ $t('sysGoogleSwitchDesc') }}</span>
        </div>
        <el-switch :model-value="Number(form.googleOauthEnabled) === 1 ? 1 : 0" :active-value="1" :inactive-value="0" @update:model-value="val => form.googleOauthEnabled = val" />
      </div>

      <div class="field-hint" role="status">
        <Icon :icon="hasGoogleSecret ? 'solar:check-circle-linear' : 'solar:danger-triangle-linear'" width="16" height="16" />
        <span>{{ hasGoogleSecret ? $t('sysGoogleSecretReady') : $t('sysGoogleSecretMissing') }}</span>
      </div>
      <div class="form-fields-stack">
        <div class="field-item">
          <label class="field-label">{{ $t('sysGoogleClientId') }}</label>
          <el-input
            v-model="form.googleClientId"
            :placeholder="$t('sysGoogleClientIdPlaceholder')"
            class="field-input input-standard"
          />
        </div>

        <div class="field-item">
          <label class="field-label">{{ $t('sysGoogleClientSecret') }}</label>
          <el-input
            v-model="modelGoogleClientSecret"
            type="password"
            show-password
            :placeholder="form.googleClientSecret ? $t('sysKeepExistingSecret') : 'GOCSPX-...'"
            class="field-input input-standard"
          />
        </div>

        <details class="help-details google-redirect-callout">
          <summary>{{ $t('sysGoogleRedirectSummary') }}</summary>
          <Icon icon="solar:info-circle-linear" width="16" height="16" class="callout-icon" />
          <div class="callout-content">
            <p><strong>{{ $t('sysGoogleConsoleTitle') }}</strong>{{ $t('sysGoogleConsoleBody') }}</p>
            <div class="callback-snippets">
              <span class="field-label">{{ $t('sysGoogleLoginCallback') }}</span>
              <div class="code-snippet-row">
                <span class="code-text">{{ callbackLoginUrl }}</span>
                <el-button size="small" link type="primary" class="copy-btn" @click="copyText(callbackLoginUrl, $t('sysGoogleLoginCallbackUrl'))">{{ $t('copy') }}</el-button>
              </div>
              <span class="field-label">{{ $t('sysGoogleBindCallback') }}</span>
              <div class="code-snippet-row">
                <span class="code-text">{{ callbackBindUrl }}</span>
                <el-button size="small" link type="primary" class="copy-btn" @click="copyText(callbackBindUrl, $t('sysGoogleBindCallbackUrl'))">{{ $t('copy') }}</el-button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  form: { type: Object, required: true },
  googleClientSecret: { type: String, default: '' }
})

const emit = defineEmits(['update:googleClientSecret'])
const { t } = useI18n()

const hasGoogleSecret = computed(() => Boolean(props.form.googleClientSecret))

const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'
const callbackLoginUrl = `${currentOrigin}/login/oauth/callback`
const callbackBindUrl = `${currentOrigin}/oauth/bind/callback`

function copyText(text, label) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      ElMessage({ message: t('sysGoogleCopiedLabel', { label }), type: 'success', plain: true })
    }).catch(() => {
      fallbackCopy(text)
    })
  } else {
    fallbackCopy(text)
  }
}

function fallbackCopy(text) {
  const el = document.createElement('textarea')
  el.value = text
  document.body.appendChild(el)
  el.select()
  let copied = false
  try { copied = document.execCommand('copy') } catch {}
  document.body.removeChild(el)
  ElMessage({ message: copied ? t('copiedToClipboard') : t('sysGoogleCopyManual'), type: copied ? 'success' : 'warning', plain: true })
}

const modelGoogleClientSecret = computed({
  get: () => props.googleClientSecret,
  set: (val) => emit('update:googleClientSecret', val)
})
</script>

<style lang="scss" scoped>
@use './card' as *;

.form-fields-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.google-redirect-callout {
  margin-top: 4px;
}

.callback-snippets {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
</style>
