<template>
  <footer class="settings-save-bar">
    <div class="save-status" :class="{ 'has-error': error, 'is-dirty': dirty && !error }" :role="error ? 'alert' : 'status'" aria-live="polite">
      {{ saving ? $t('sysSaving') : error || (dirty ? $t('sysUnsavedChanges') : message || $t('sysSaved')) }}
    </div>
    <div class="save-actions">
      <el-button v-if="dirty && resettable" text :disabled="saving" @click="$emit('reset')">{{ $t('sysDiscardChanges') }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="disabled || !dirty" @click="$emit('save')">{{ label || $t('sysSaveChanges') }}</el-button>
    </div>
  </footer>
</template>
<script setup>
defineProps({
  dirty: Boolean, saving: Boolean, disabled: Boolean,
  error: { type: String, default: '' }, message: { type: String, default: '' },
  label: { type: String, default: '' }, resettable: { type: Boolean, default: true },
})
defineEmits(['save', 'reset'])
</script>
<style scoped lang="scss">
.settings-save-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 24px; border-top:1px solid var(--line); background:color-mix(in srgb, var(--paper) 35%, var(--surface)); }
.save-status { min-width:0; font-size:12px; line-height:1.5; color:var(--muted); overflow-wrap:anywhere; }
.save-status.is-dirty { color:var(--text); }
.save-status.has-error { color:var(--el-color-danger); }
.save-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.save-actions :deep(.el-button) { margin:0; min-height:36px; font-size:13px; border-radius:8px; }
@media(max-width:640px) { .settings-save-bar { padding:12px 16px; flex-wrap:wrap; } .save-actions { margin-left:auto; } }
</style>
