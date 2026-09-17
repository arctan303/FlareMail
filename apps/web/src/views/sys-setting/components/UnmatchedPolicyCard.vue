<template>
  <div class="setting-card arc-card" v-loading="policyLoading">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon">
          <Icon icon="solar:shield-check-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysUnmatchedTitle') }}</h3>
          <p class="card-desc">{{ $t('sysUnmatchedDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <div v-if="policyError" class="notice-banner error">
        <Icon icon="solar:close-circle-linear" width="16" height="16" />
        <span>{{ $t('sysUnmatchedLoadFailed') }}</span>
        <el-button size="small" type="primary" link @click="$emit('reload')" style="margin-left: 8px;">{{ $t('sysRetryLoad') }}</el-button>
      </div>

      <div v-else class="policy-radio-group" role="radiogroup" :aria-label="$t('sysUnmatchedGroupLabel')" :aria-busy="policySaving">
        <label v-for="option in options" :key="option.value" class="policy-card" :class="{ active: unmatchedPolicy === option.value }">
          <input type="radio" name="unmatched-policy" :value="option.value" :checked="unmatchedPolicy === option.value" :disabled="policyLoading || policySaving" @change="$emit('change', option.value)" />
          <span class="policy-info"><span class="policy-name">{{ option.label }}</span><span class="policy-desc">{{ option.desc }}</span></span>
        </label>
      </div>
      <p class="field-hint" role="status">{{ policySaving ? $t('sysUnmatchedSaving') : $t('sysUnmatchedInstant') }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'

defineProps({
  unmatchedPolicy: { type: String, default: '' },
  policyLoading: { type: Boolean, default: false },
  policyError: { type: Boolean, default: false },
  policySaving: { type: Boolean, default: false }
})

defineEmits(['change', 'reload'])
const { t } = useI18n()
// The radio values are protocol values, so only the labels follow the language.
const options = computed(() => [
  { value: 'reject', label: t('sysUnmatchedReject'), desc: t('sysUnmatchedRejectDesc') },
  { value: 'drop', label: t('sysUnmatchedDrop'), desc: t('sysUnmatchedDropDesc') },
  { value: 'quarantine', label: t('sysUnmatchedQuarantine'), desc: t('sysUnmatchedQuarantineDesc') },
])
</script>

<style lang="scss" scoped>
@use './card' as *;
.policy-radio-group { display:flex; flex-direction:column; }
.policy-card { display:flex; align-items:flex-start; gap:12px; padding:14px 0; border-bottom:1px solid var(--line); cursor:pointer; }
.policy-card:first-child { padding-top:0; }
.policy-card:last-child { border-bottom:0; padding-bottom:0; }
.policy-card input { margin:4px 0 0; width:16px; height:16px; accent-color:var(--accent); flex-shrink:0; }
.policy-info { display:flex; flex-direction:column; gap:4px; }
.policy-name { color:var(--text-strong); font-size:14px; font-weight:500; }
.policy-desc { color:var(--muted); font-size:12px; line-height:1.6; }
</style>
