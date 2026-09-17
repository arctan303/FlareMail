<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon">
          <Icon icon="solar:settings-minimalistic-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysCoreTitle') }}</h3>
          <p class="card-desc">{{ $t('sysCoreDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <div class="switches-grid">
        <div class="switch-item">
          <div class="switch-meta">
            <span class="switch-title">{{ $t('sysReceiveTitle') }}</span>
            <span class="switch-desc">{{ $t('sysReceiveDesc') }}</span>
          </div>
          <el-switch v-model="form.receive" :active-value="0" :inactive-value="1" />
        </div>

        <div class="switch-item">
          <div class="switch-meta">
            <span class="switch-title">{{ $t('sysSendTitle') }}</span>
            <span class="switch-desc">{{ $t('sysSendDesc') }}</span>
          </div>
          <el-switch v-model="form.send" :active-value="0" :inactive-value="1" />
        </div>

        <div class="switch-item">
          <div class="switch-meta">
            <span class="switch-title">{{ $t('sysLoginDomainTitle') }}</span>
            <span class="switch-desc">{{ $t('sysLoginDomainDesc') }}</span>
          </div>
          <el-switch v-model="form.loginDomain" :active-value="0" :inactive-value="1" />
        </div>
      </div>

      <div class="form-fields-stack">
        <div class="field-item">
          <label class="field-label">{{ $t('sysR2DomainLabel') }}</label>
          <el-input
            v-model="form.r2Domain"
            :placeholder="$t('sysR2DomainPlaceholder')"
            class="field-input input-standard"
          />
          <span class="field-hint">{{ $t('sysR2DomainHint') }}</span>
        </div>
      </div>

      <!-- 状态提示栏 -->
      <div class="status-notices">
        <div class="notice-banner">
          <Icon :icon="form.storageType === 'R2' ? 'solar:check-circle-linear' : 'solar:danger-triangle-linear'" width="16" height="16" />
          <span>{{ storageMessage }}</span>
        </div>
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'

const props = defineProps({
  form: { type: Object, required: true },
})

const { t } = useI18n()
const storageMessage = computed(() => props.form.storageType === 'R2'
  ? t('sysStorageR2')
  : t('sysStorageKv'))
</script>

<style lang="scss" scoped>
@use './card' as *;

.switches-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
}

.form-fields-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--line-subtle, var(--line));
}
</style>
