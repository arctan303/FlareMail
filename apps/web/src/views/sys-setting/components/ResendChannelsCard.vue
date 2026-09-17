<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon">
          <Icon icon="solar:plain-2-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysResendTitle') }}</h3>
          <p class="card-desc">{{ $t('sysResendDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <p v-if="upgradeRequired" class="notice-banner" role="status">{{ $t('sysMailProviderPending') }}</p>
      <div class="field-item">
        <span id="mail-provider-label" class="field-label">{{ $t('sysMailProvider') }}</span>
        <el-radio-group :model-value="provider" :disabled="upgradeRequired" aria-labelledby="mail-provider-label" class="provider-picker" @update:model-value="$emit('update:provider', $event)">
          <el-radio value="resend" class="provider-option">
            <span class="provider-option-title">Resend</span>
            <span class="provider-option-desc">{{ $t('sysMailResendDesc') }}</span>
          </el-radio>
          <el-radio value="cloudflare" class="provider-option">
            <span class="provider-option-title">Cloudflare <el-tag size="small" type="warning">Beta</el-tag></span>
            <span class="provider-option-desc">{{ $t('sysMailCloudflareDesc') }}</span>
          </el-radio>
        </el-radio-group>
      </div>
      <div v-if="provider === 'cloudflare'" class="cloudflare-details">
        <span :class="['status-pill', hasCfEmail ? 'ready' : 'missing']">{{ hasCfEmail ? $t('sysResendCfBound') : $t('sysMailCfNotBound') }}</span>
        <div class="info-callout">
          <Icon icon="solar:info-circle-linear" width="18" height="18" class="callout-icon" />
          <div class="callout-content">
            <strong>{{ $t('sysMailCfBeta') }}</strong>
            <p>{{ $t('sysMailCfSetup') }}</p>
            <p>{{ $t('sysMailCfLimits') }}</p>
            <p>{{ $t('sysMailCfBinding') }}</p>
            <a href="https://developers.cloudflare.com/email-service/get-started/send-emails/" target="_blank" rel="noopener noreferrer">{{ $t('sysMailCfDocs') }}</a>
          </div>
        </div>
      </div>
      <div v-else class="resend-tokens-stack">
        <p v-if="!domains.length" class="field-hint">{{ $t('sysResendNoDomain') }}</p>
        <div class="info-callout">
          <Icon icon="solar:info-circle-linear" width="16" height="16" class="callout-icon" />
          <div class="callout-content">
            <p>{{ $t('sysResendHint') }}</p>
          </div>
        </div>
        <div v-for="domain in domains" :key="domain" class="field-item">
          <div class="token-head">
            <label class="field-label">{{ domain }}</label>
            <span :class="['status-pill', existingTokens?.[domain] ? 'ready' : 'missing']">{{ existingTokens?.[domain] ? $t('sysConfigured') : $t('sysNotConfigured') }}</span>
          </div>
          <el-input
            v-model="resendTokens[domain]"
            type="password"
            show-password
            class="input-standard"
            :placeholder="existingTokens?.[domain] ? $t('sysKeepExistingSecret') : 're_...'"
          />
        </div>
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>

<script setup>
import { Icon } from '@iconify/vue'

defineEmits(['update:provider'])

defineProps({
  provider: { type: String, default: 'resend' },
  upgradeRequired: { type: Boolean, default: false },
  hasCfEmail: { type: Boolean, default: false },
  domains: { type: Array, default: () => [] },
  resendTokens: { type: Object, required: true },
  existingTokens: { type: Object, default: () => ({}) }
})
</script>

<style lang="scss" scoped>
@use './card' as *;

.provider-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}
.provider-option {
  margin: 0;
  height: auto;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  align-items: flex-start;
  white-space: normal;
  &.is-checked { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
  :deep(.el-radio__input) { margin-top: 3px; }
  :deep(.el-radio__label) { min-width: 0; }
}
.provider-option-title { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.provider-option-desc { display: block; margin-top: 6px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.cloudflare-details { display: grid; gap: 14px; }
@media (max-width: 640px) { .provider-picker { grid-template-columns: 1fr; } }


.resend-tokens-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.token-head {
  display: flex;
  align-items: center;
  gap: 8px;
}</style>
