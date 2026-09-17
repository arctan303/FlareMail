<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon"><Icon icon="solar:server-square-linear" width="20" height="20" /></div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysDomainsTitle') }}</h3>
          <p class="card-desc">{{ $t('sysDomainsDesc') }}</p>
        </div>
      </div>
    </div>
    <div class="card-body">
      <div v-if="loading" class="domain-loading">{{ $t('sysDomainsLoading') }}</div>
      <p v-else-if="error" class="domain-error">{{ error }}</p>
      <div v-else-if="domains.length" class="domain-list">
        <span v-for="domain in domains" :key="domain" class="domain-chip">@{{ domain }}</span>
      </div>
      <p v-else class="domain-empty">{{ $t('sysDomainsEmpty') }}</p>
      <div class="domain-add-row">
        <el-input :disabled="loading || saving" :aria-label="$t('sysDomainsInputLabel')" v-model="newDomain" :placeholder="$t('sysDomainsPlaceholder')" class="input-standard" @keyup.enter="$emit('add', newDomain)" />
        <el-button type="primary" class="arc-btn add-domain-btn" :loading="saving" :disabled="loading || saving || !newDomain.trim()" @click="$emit('add', newDomain)">{{ $t('sysDomainsAdd') }}</el-button>
      </div>
      <div class="info-callout domain-callout">
        <Icon icon="solar:info-circle-linear" width="16" height="16" class="callout-icon" />
        <div class="callout-content">
          <p>{{ $t('sysDomainsCallout') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup>
import { ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
const props = defineProps({
  domains: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' }
})
defineEmits(['add'])
const newDomain = ref('')
watch(() => props.domains, domains => { if (domains.includes(newDomain.value.trim().replace(/^@/, '').toLowerCase())) newDomain.value = '' })
</script>
<style scoped lang="scss">
@use './card' as *;

.domain-list { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:0; }
.domain-chip {
  padding: 6px 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--line));
  border-radius: 8px;
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 500;
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.domain-empty,.domain-loading { color:var(--muted); font-size:12.5px; margin:0 0 16px; }
.domain-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 600px;
}
.add-domain-btn {
  flex-shrink: 0;
}
.domain-callout {
  margin-top: 0;
}
@media (max-width: 560px) {
  .domain-add-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 100%;
  }
}
</style>
