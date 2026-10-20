<template>
  <div class="setting-card arc-card">
    <div class="card-header"><div class="header-left-group">
      <div class="header-icon"><Icon icon="solar:server-square-linear" width="20" height="20" /></div>
      <div><h3 class="card-title arc-serif-title">{{ $t('sysDomainsTitle') }}</h3><p class="card-desc">{{ $t('sysDomainsDesc') }}</p></div>
    </div></div>
    <div class="card-body">
      <div v-if="loading" class="domain-loading" role="status">{{ $t('sysDomainsLoading') }}</div>
      <p v-else-if="error" class="domain-error" role="alert">{{ error }} <el-button link :disabled="loading || saving || busy" @click="$emit('reload')">{{ $t('sysReload') }}</el-button></p>
      <div v-else-if="entries.length" class="domain-list">
        <div v-for="entry in entries" :key="entry.domain" class="domain-row">
          <div class="domain-identity"><span class="domain-name">@{{ entry.domain }}</span><span class="domain-status" :class="{ disabled: !entry.enabled }">{{ $t(entry.enabled ? 'domainManagement.enabled' : 'domainManagement.disabled') }}</span></div>
          <div class="domain-actions">
            <el-button link type="primary" :disabled="unavailable || !managementReady" @click="openAction('rename', entry)">{{ $t('domainManagement.rename') }}</el-button>
            <el-button link type="primary" :disabled="unavailable || !managementReady" @click="openAction('migrate', entry)">{{ $t('domainManagement.migrate') }}</el-button>
            <el-button link :disabled="unavailable || !managementReady" @click="openAction('setEnabled', entry)">{{ $t(entry.enabled ? 'domainManagement.disable' : 'domainManagement.enable') }}</el-button>
            <el-button link type="danger" :disabled="unavailable || !managementReady" @click="openAction('delete', entry)">{{ $t('delete') }}</el-button>
          </div>
        </div>
      </div>
      <p v-else class="domain-empty">{{ $t('sysDomainsEmpty') }}</p>
      <p v-if="!loading && !error && !managementReady" class="domain-hint">{{ $t('domainManagement.upgradeRequired') }}</p>
      <div class="domain-add-row">
        <el-input :disabled="unavailable" :aria-label="$t('sysDomainsInputLabel')" v-model="newDomain" :placeholder="$t('sysDomainsPlaceholder')" class="input-standard" @keyup.enter="addDomain" />
        <el-button type="primary" class="arc-btn" :loading="saving" :disabled="unavailable || !newDomain.trim()" @click="addDomain">{{ $t('sysDomainsAdd') }}</el-button>
      </div>
      <div class="info-callout"><Icon icon="solar:info-circle-linear" width="16" height="16" class="callout-icon" /><div class="callout-content"><p>{{ $t('sysDomainsCallout') }}</p></div></div>
    </div>
    <el-dialog v-model="dialogOpen" :title="actionTitle" width="min(760px, calc(100vw - 24px))" top="6vh" append-to-body :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="closeDialog">
      <div class="domain-dialog-body" :aria-busy="busy">
        <p class="domain-action-source">{{ $t('domainManagement.source') }} <strong>@{{ draft.domain }}</strong></p>
        <p class="domain-hint">{{ actionHint }}</p>
        <template v-if="draft.action === 'rename' || draft.action === 'migrate'">
          <label class="domain-field-label" for="domain-management-target">{{ $t('domainManagement.target') }}</label>
          <el-input v-if="draft.action === 'rename'" id="domain-management-target" v-model="draft.targetDomain" :disabled="busy" :placeholder="$t('sysDomainsPlaceholder')" @keyup.enter="runPreview" />
          <el-select v-else id="domain-management-target" v-model="draft.targetDomain" :disabled="busy" :placeholder="$t('domainManagement.chooseTarget')" class="domain-target-select"><el-option v-for="entry in migrationTargets" :key="entry.domain" :label="'@' + entry.domain" :value="entry.domain" /></el-select>
          <p v-if="draft.action === 'migrate' && !migrationTargets.length" class="domain-error">{{ $t('domainManagement.noMigrationTarget') }}</p>
          <p v-else-if="draft.targetDomain && !request" class="domain-error" role="alert">{{ validationError }}</p>
        </template>
        <el-button class="arc-btn domain-preview-button" :loading="previewLoading" :disabled="busy || !request" @click="runPreview">{{ $t('domainManagement.preview') }}</el-button>
        <p v-if="actionError" class="domain-error" role="alert">{{ actionError }}</p>
        <div v-if="preview" class="domain-preview" aria-live="polite">
          <dl class="domain-counts">
            <div><dt>{{ $t('domainManagement.accounts') }}</dt><dd>{{ preview.accountCount }}</dd></div>
            <div><dt>{{ $t('domainManagement.users') }}</dt><dd>{{ preview.userCount }}</dd></div>
            <div><dt>{{ $t('domainManagement.emails') }}</dt><dd>{{ preview.emailCount }}</dd></div>
            <div><dt>{{ $t('domainManagement.attachments') }}</dt><dd>{{ preview.attachmentCount }}</dd></div>
          </dl>
          <div v-if="preview.accounts?.length" class="domain-account-scroll"><table class="domain-account-table">
            <thead><tr><th>{{ $t('domainManagement.currentAddress') }}</th><th>{{ $t('domainManagement.newAddress') }}</th></tr></thead>
            <tbody><tr v-for="account in preview.accounts" :key="account.accountId"><td>{{ account.source }} <span v-if="account.isPrimary" class="domain-account-note">{{ $t('primaryMailbox') }}</span><span v-if="account.isDel" class="domain-account-note">{{ $t('domainManagement.deletedAccount') }}</span></td><td>{{ account.target || account.source }}</td></tr></tbody>
          </table></div>
          <p v-if="preview.accountCount > (preview.accounts?.length || 0)" class="domain-hint">{{ $t('domainManagement.sample', { shown: preview.accounts?.length || 0, total: preview.accountCount }) }}</p>
          <div v-if="preview.conflicts?.length || preview.blockers?.length" class="domain-problems" role="alert"><p>{{ $t('domainManagement.blocked') }}</p><ul><li v-for="(conflict, index) in preview.conflicts || []" :key="'conflict-' + index">{{ conflict.email }} — {{ describeReason(conflict.reason) }}</li><li v-for="(blocker, index) in preview.blockers || []" :key="'blocker-' + index">{{ describeReason(blocker) }}</li></ul></div>
          <p v-else-if="!canApply" class="domain-error">{{ $t('domainManagement.stalePreview') }}</p>
          <p v-else class="domain-hint">{{ $t('domainManagement.ready') }}</p>
        </div>
        <div class="domain-notices"><p v-if="draft.action === 'rename' || draft.action === 'migrate'">{{ $t('domainManagement.dataPreserved') }}</p><p>{{ $t('domainManagement.externalSetup') }}</p><p>{{ $t('domainManagement.inFlight') }}</p></div>
      </div>
      <template #footer><div class="domain-dialog-actions"><el-button :disabled="busy" @click="closeDialog()">{{ $t('cancel') }}</el-button><el-button :type="draft.action === 'delete' ? 'danger' : 'primary'" :loading="applying" :disabled="busy || !canApply" @click="runApply">{{ $t('domainManagement.confirm') }}</el-button></div></template>
    </el-dialog>
  </div>
</template>
<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { buildDomainActionRequest, buildDomainApplyRequest, canApplyDomainPreview, normalizeManagedDomain } from '@/utils/domain-management.js'
const props = defineProps({
  domains: { type: Array, default: () => [] }, entries: { type: Array, default: () => [] }, revision: { type: Number, default: null }, managementReady: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }, saving: { type: Boolean, default: false }, error: { type: String, default: '' }, previewAction: { type: Function, required: true }, applyAction: { type: Function, required: true },
})
const emit = defineEmits(['add', 'busy', 'dirty-change', 'applied', 'reload'])
const { t, te } = useI18n()
const newDomain = ref(''), dialogOpen = ref(false), preview = ref(null), actionError = ref(''), previewLoading = ref(false), applying = ref(false)
const draft = reactive({ action: '', domain: '', targetDomain: '', enabled: false })
let previewEpoch = 0
const busy = computed(() => previewLoading.value || applying.value)
const unavailable = computed(() => props.loading || props.saving || busy.value || !!props.error)
const request = computed(() => { try { return buildDomainActionRequest(draft, props) } catch { return null } })
const validationError = computed(() => { try { buildDomainActionRequest(draft, props); return '' } catch (error) { return t(error.message) } })
const canApply = computed(() => canApplyDomainPreview(preview.value, request.value))
const migrationTargets = computed(() => props.entries.filter(entry => entry.enabled && entry.domain !== draft.domain))
const actionKey = computed(() => draft.action === 'setEnabled' ? (draft.enabled ? 'enable' : 'disable') : draft.action)
const actionTitle = computed(() => t('domainManagement.' + (actionKey.value || 'rename')))
const actionHint = computed(() => t('domainManagement.' + (actionKey.value || 'rename') + 'Hint'))
watch(() => props.domains, domains => { if (domains.includes(normalizeManagedDomain(newDomain.value))) newDomain.value = '' })
watch(() => draft.targetDomain, () => { preview.value = null; actionError.value = '' })
watch(() => props.revision, () => { if (dialogOpen.value && preview.value) { preview.value = null; actionError.value = t('domainManagement.stalePreview') } })
watch(dialogOpen, open => emit('dirty-change', open))
function addDomain() { if (!unavailable.value && newDomain.value.trim()) emit('add', newDomain.value) }
function describeReason(reason) { const key = 'domainManagement.reasons.' + String(reason || ''); return te(key) ? t(key) : t('domainManagement.unknownBlocker') }
function openAction(action, entry) {
  if (unavailable.value || !props.managementReady) return
  previewEpoch++; preview.value = null; actionError.value = ''
  Object.assign(draft, { action, domain: entry.domain, targetDomain: '', enabled: !entry.enabled }); dialogOpen.value = true
}
function closeDialog(done) {
  if (busy.value) return
  previewEpoch++; preview.value = null; actionError.value = ''; dialogOpen.value = false
  if (typeof done === 'function') done()
}
async function runPreview() {
  if (busy.value || !request.value) return
  const payload = { ...request.value }, epoch = ++previewEpoch
  previewLoading.value = true; emit('busy', true); preview.value = null; actionError.value = ''
  try {
    const result = await props.previewAction(payload)
    if (epoch !== previewEpoch || !dialogOpen.value) return
    preview.value = result
    if (JSON.stringify(payload) !== JSON.stringify(request.value)) actionError.value = t('domainManagement.stalePreview')
  } catch (error) {
    if (epoch === previewEpoch) actionError.value = Number(error?.code) === 409 ? t('domainManagement.stalePreview') : error?.message || t('domainManagement.failed')
  } finally { previewLoading.value = false; emit('busy', false) }
}
async function runApply() {
  if (busy.value || !canApply.value) return
  const payload = buildDomainApplyRequest(preview.value, request.value)
  applying.value = true; emit('busy', true); actionError.value = ''
  let applied
  try {
    const result = await props.applyAction(payload)
    if (result?.status === 'completed') { applied = result.value; dialogOpen.value = false; preview.value = null; emit('dirty-change', false) }
  } catch (error) {
    if (Number(error?.code) === 409) preview.value = null
    actionError.value = Number(error?.code) === 409 ? t('domainManagement.stalePreview') : error?.message || t('domainManagement.failed')
  } finally { applying.value = false; emit('busy', false) }
  if (applied) emit('applied', applied)
}
</script>
<style scoped lang="scss">
@use './card' as *;
.domain-list { display:flex; flex-direction:column; }
.domain-row { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px 16px; padding:12px 0; border-bottom:1px solid var(--line); }
.domain-identity,.domain-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px; min-width:0; }
.domain-name { color:var(--text-strong); font-weight:500; font-size:14px; overflow-wrap:anywhere; }
.domain-status { color:var(--accent); font-size:12px; }.domain-status.disabled,.domain-account-note { color:var(--muted); }
.domain-actions :deep(.el-button) { margin-left:0; min-height:36px; font-size:13px; }
.domain-empty,.domain-loading,.domain-hint { color:var(--muted); font-size:12.5px; line-height:1.65; margin:0; }
.domain-error,.domain-problems { color:var(--el-color-danger); font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.domain-add-row { display:flex; align-items:center; gap:10px; max-width:600px; }.domain-add-row :deep(.el-button) { flex-shrink:0; }
.domain-dialog-body { display:flex; flex-direction:column; gap:12px; max-height:65vh; overflow:auto; padding:0 2px; }
.domain-action-source { margin:0; color:var(--text-strong); overflow-wrap:anywhere; }.domain-field-label { color:var(--text-strong); font-size:13px; }.domain-target-select { width:100%; }.domain-preview-button { align-self:flex-start; }
.domain-preview { display:flex; flex-direction:column; gap:12px; border-top:1px solid var(--line); padding-top:14px; }
.domain-counts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:0; }.domain-counts dt { color:var(--muted); font-size:12px; }.domain-counts dd { margin:4px 0 0; color:var(--text-strong); font-size:18px; }
.domain-account-scroll { overflow:auto; max-height:240px; }.domain-account-table { width:100%; border-collapse:collapse; font-size:12.5px; text-align:left; }.domain-account-table th,.domain-account-table td { padding:8px; border-bottom:1px solid var(--line); overflow-wrap:anywhere; min-width:130px; }.domain-account-note { display:block; font-size:11.5px; }
.domain-notices { padding-top:12px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; line-height:1.65; }.domain-notices p { margin:0 0 6px; }.domain-dialog-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:8px; }.domain-dialog-actions :deep(.el-button) { margin-left:0; }
@media(max-width:560px) { .domain-add-row { flex-direction:column; align-items:stretch; }.domain-counts { grid-template-columns:repeat(2,minmax(0,1fr)); }.domain-actions { width:100%; gap:8px 16px; } }
</style>
