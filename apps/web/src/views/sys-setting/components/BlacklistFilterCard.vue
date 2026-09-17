<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon">
          <Icon icon="solar:shield-cross-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysFilterTitle') }}</h3>
          <p class="card-desc">{{ $t('sysFilterDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <div class="form-grid">
        <div class="field-item">
          <label class="field-label">{{ $t('sysBlackFromLabel') }}</label>
          <el-input v-model="form.blackFrom" placeholder="spammer.com,sender@example.com" />
          <span class="field-hint">{{ $t('sysBlackFromHint') }}</span>
        </div>

        <div class="field-item">
          <label class="field-label">{{ $t('sysBlackSubjectLabel') }}</label>
          <el-input v-model="form.blackSubject" :placeholder="$t('sysBlackSubjectPlaceholder')" />
          <span class="field-hint">{{ $t('sysBlackSubjectHint') }}</span>
        </div>

        <div class="field-item field-wide">
          <label class="field-label">{{ $t('sysBlackContentLabel') }}</label>
          <el-input v-model="form.blackContent" :placeholder="$t('sysBlackContentPlaceholder')" />
          <span class="field-hint">{{ $t('sysBlackContentHint') }}</span>
        </div>
      </div>


    </div>
    <slot name="footer" />
  </div>
</template>

<script setup>
import { Icon } from '@iconify/vue'

defineProps({
  form: { type: Object, required: true }
})
</script>

<style lang="scss" scoped>
@use './card' as *;

.blacklist-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
