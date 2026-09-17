<template>
  <div class="runtime-groups">
    <p v-if="loadError" class="feedback" role="alert">{{ loadError }} <el-button link :loading="loading" @click="load">{{ $t('sysReload') }}</el-button></p>
    <OAuthProviderSettingCard ref="providerRef" :run-sensitive="runSensitive" :credentials-dirty="dirty.oauth" :credentials-ready="loaded" :external-busy="Boolean(saving || loading)" :save-credentials="() => saveGroup('oauth')" @reset-credentials="resetGroup('oauth')" @dirty-change="sitesDirty = $event" @busy="providerBusy = $event">
      <template #credentials>
        <div class="credential-fields" :inert="!loaded ? '' : null">
          <div class="section-heading"><h4>{{ $t('sysCredSection') }}</h4><span class="status-pill" :class="runtime.oauth.secretConfigured ? 'ready' : 'missing'">{{ runtime.oauth.secretConfigured ? $t('sysSecretReady') : $t('sysSecretMissing') }}</span></div>
          <div class="field-item"><label class="field-label" for="oauth-issuer">{{ $t('sysIssuerLabel') }}</label><el-input id="oauth-issuer" v-model="draft.oauth.issuer" placeholder="https://mail.example.com" /><div class="field-aux"><span class="field-hint">{{ $t('sysIssuerHint') }}</span><el-button text :disabled="!suggestedOrigin" @click="draft.oauth.issuer = suggestedOrigin">{{ $t('sysUseCurrentOrigin') }}</el-button></div></div>
          <div class="field-item"><label class="field-label" for="oauth-shared-secret">{{ $t('sysSharedSecretLabel') }}</label><el-input id="oauth-shared-secret" v-model="draft.oauth.secretInput" type="password" show-password :placeholder="runtime.oauth.secretConfigured ? $t('sysKeepExistingSecret') : $t('sysSecretPlaceholderOauth')" @input="draft.oauth.secretAction = 'keep'" /><div class="field-actions"><el-button @click="generateSecret">{{ $t('sysGenerateSecret') }}</el-button><el-button :disabled="!runtime.oauth.secretConfigured" @click="openReveal">{{ $t('sysViewSavedSecret') }}</el-button><el-button text type="danger" :disabled="!runtime.oauth.secretConfigured" @click="clearSecret('oauth')">{{ $t('sysClearConfig') }}</el-button></div></div>
          <p v-if="draft.oauth.secretInput" class="change-warning">{{ $t('sysReplaceSecretWarning') }}</p>
          <p v-if="draft.oauth.secretAction === 'clear'" class="change-warning">{{ $t('sysClearOauthWarning') }}<el-button link @click="draft.oauth.secretAction = 'keep'">{{ $t('sysUndoClear') }}</el-button></p>
          <p v-if="errors.oauth" class="feedback" role="alert">{{ errors.oauth }}</p>
        </div>
      </template>
    </OAuthProviderSettingCard>
    <section class="setting-card">
      <div class="card-header"><div><h3 class="card-title">{{ $t('sysTurnstileTitle') }}</h3><p class="card-desc">{{ $t('sysTurnstileDesc') }}</p></div><span class="status-pill" :class="runtime.turnstile.secretConfigured ? 'ready' : 'missing'">{{ runtime.turnstile.secretConfigured ? $t('sysConfigured') : $t('sysNotConfigured') }}</span></div>
      <div class="card-body" :inert="!loaded || working ? '' : null">
        <div class="field-item"><label class="field-label" for="turnstile-site-key">{{ $t('sysTurnstileSiteKey') }}</label><el-input id="turnstile-site-key" v-model="draft.turnstile.siteKey" placeholder="0x4AAAA..." /></div>
        <div class="field-item"><label class="field-label" for="turnstile-secret">{{ $t('sysTurnstileSecretKey') }}</label><el-input id="turnstile-secret" v-model="draft.turnstile.secretInput" type="password" show-password :placeholder="runtime.turnstile.secretConfigured ? $t('sysKeepExistingSecret') : $t('sysTurnstileSecretPlaceholder')" @input="draft.turnstile.secretAction = 'keep'" /><p class="field-hint">{{ $t('sysTurnstileHint') }}</p><div class="field-actions"><el-button text type="danger" :disabled="!runtime.turnstile.secretConfigured" @click="clearSecret('turnstile')">{{ $t('sysTurnstileClear') }}</el-button></div></div>
        <p v-if="draft.turnstile.secretAction === 'clear'" class="change-warning">{{ $t('sysTurnstileClearWarning') }}<el-button link @click="draft.turnstile.secretAction = 'keep'">{{ $t('sysUndoClear') }}</el-button></p>
      </div>
      <SettingsSaveBar :dirty="dirty.turnstile" :saving="saving === 'turnstile'" :disabled="!loaded || working" :error="errors.turnstile" :label="$t('sysTurnstileSave')" @save="saveGroup('turnstile')" @reset="resetGroup('turnstile')" />
    </section>
    <section class="setting-card">
      <details class="advanced-origins">
        <summary class="advanced-heading"><span>{{ $t('sysOriginsTitle') }}</span><span class="advanced-summary">{{ dirty.origins ? $t('sysOriginsDirty') : runtime.allowedOrigins.length ? $t('sysOriginsCount', { count: runtime.allowedOrigins.length }) : $t('sysOriginsDefault') }}</span></summary>
        <div class="card-body" :inert="!loaded || working ? '' : null"><div class="field-item"><label class="field-label" for="extra-origins">{{ $t('sysOriginsLabel') }}</label><el-input id="extra-origins" v-model="allowedOriginsText" type="textarea" :rows="4" placeholder="https://app.example.com" /><p class="field-hint">{{ $t('sysOriginsHint') }}</p></div></div>
        <SettingsSaveBar :dirty="dirty.origins" :saving="saving === 'origins'" :disabled="!loaded || working" :error="errors.origins" :label="$t('sysOriginsSave')" @save="saveGroup('origins')" @reset="resetGroup('origins')" />
      </details>
    </section>
    <div class="refresh-row"><span>{{ $t('sysRefreshHint') }}</span><el-button text :disabled="anyDirty || working" :loading="loading" @click="load">{{ $t('sysRefreshStatus') }}</el-button></div>
    <el-dialog v-model="revealVisible" :title="$t('sysRevealTitle')" width="min(420px, calc(100vw - 32px))" append-to-body destroy-on-close @closed="clearRevealState">
      <div class="reveal-body"><p class="field-hint">{{ $t('sysRevealHint') }}</p>
        <div v-if="!revealedSecret" class="field-item"><label class="field-label" for="runtime-reveal-password">{{ $t('sysRevealPasswordLabel') }}</label><el-input id="runtime-reveal-password" v-model="revealPassword" type="password" show-password autocomplete="current-password" :disabled="revealLoading" @keyup.enter="reveal" /></div>
        <div v-else class="field-item"><label class="field-label">{{ $t('sysRevealSecretLabel') }}</label><el-input :model-value="revealedSecret" readonly type="password" show-password /><el-button @click="copyReveal">{{ $t('sysCopySecret') }}</el-button></div>
        <p v-if="revealError" class="feedback" role="alert">{{ revealError }}</p><p v-if="revealNotice" class="field-hint" role="status">{{ revealNotice }}</p>
        <div class="dialog-actions"><el-button @click="revealVisible = false">{{ $t('close') }}</el-button><el-button v-if="!revealedSecret" type="primary" :loading="revealLoading" @click="reveal">{{ $t('sysVerifyAndView') }}</el-button></div>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { revealOauthSecret, runtimeConfigQuery, runtimeConfigSet } from '@/request/setting.js'
import { buildRuntimePatch, currentOrigin, generateRuntimeSecret, normalizeRuntimeConfig } from '@/utils/runtime-config.js'
import OAuthProviderSettingCard from './OAuthProviderSettingCard.vue'
import SettingsSaveBar from './SettingsSaveBar.vue'
const props = defineProps({ runSensitive: { type: Function, required: true } })
const emit = defineEmits(['dirty-change', 'busy'])
const { t } = useI18n()
const SAVE_LABELS = { oauth: 'sysSaveOauthCredentials', turnstile: 'sysTurnstileSave', origins: 'sysOriginsSave' }
const providerRef = ref()
const runtime = reactive({ revision: 0, allowedOrigins: [], turnstile: { siteKey: '', secretConfigured: false }, oauth: { issuer: '', secretConfigured: false } })
const draft = reactive({ turnstile: { siteKey: '', secretInput: '', secretAction: 'keep' }, oauth: { issuer: '', secretInput: '', secretAction: 'keep' } })
const baseline = ref(null)
const allowedOriginsText = ref('')
const loading = ref(false)
const saving = ref('')
const loaded = ref(false)
const loadError = ref('')
const errors = reactive({ oauth: '', turnstile: '', origins: '' })
const sitesDirty = ref(false)
const providerBusy = ref(false)
const working = computed(() => Boolean(saving.value || providerBusy.value || loading.value))
const suggestedOrigin = computed(() => currentOrigin())
const clone = value => JSON.parse(JSON.stringify(value))
function patchFor(group) {
  if (!baseline.value) return null
  const candidate = {
    allowedOrigins: group === 'origins' ? allowedOriginsText.value : baseline.value.allowedOrigins,
    turnstile: group === 'turnstile' ? draft.turnstile : { siteKey: baseline.value.turnstile.siteKey },
    oauth: group === 'oauth' ? draft.oauth : { issuer: baseline.value.oauth.issuer },
  }
  return buildRuntimePatch(candidate, baseline.value)
}
function isDirty(group) { try { return Boolean(patchFor(group)) } catch { return true } }
const dirty = computed(() => ({ oauth: isDirty('oauth'), turnstile: isDirty('turnstile'), origins: isDirty('origins') }))
const anyDirty = computed(() => sitesDirty.value || Object.values(dirty.value).some(Boolean))
watch(anyDirty, value => emit('dirty-change', value), { immediate: true })
watch(working, value => emit('busy', value))
function resetGroup(group) {
  if (!baseline.value || saving.value) return
  if (group === 'origins') allowedOriginsText.value = baseline.value.allowedOrigins.join('\n')
  else if (group === 'oauth') Object.assign(draft.oauth, { issuer: baseline.value.oauth.issuer, secretInput: '', secretAction: 'keep' })
  else Object.assign(draft.turnstile, { siteKey: baseline.value.turnstile.siteKey, secretInput: '', secretAction: 'keep' })
  errors[group] = ''
}
function applyConfig(value, group = null) {
  const next = normalizeRuntimeConfig(value)
  if (!next) throw new Error(t('sysInvalidConfigResponse'))
  const preserve = group ? Object.keys(dirty.value).filter(key => key !== group && dirty.value[key]) : []
  Object.assign(runtime, clone(next)); baseline.value = clone(next)
  const previousSaving = saving.value; saving.value = ''
  for (const key of ['oauth', 'turnstile', 'origins']) if (!preserve.includes(key)) resetGroup(key)
  saving.value = previousSaving
  loaded.value = true; loadError.value = ''
  providerRef.value?.applyRuntimeReadiness(next)
}
async function load() {
  if (working.value || anyDirty.value) return
  loading.value = true
  try { applyConfig(await runtimeConfigQuery()) }
  catch (error) { loaded.value = false; loadError.value = error?.message || t('sysConfigLoadFailed') }
  finally { loading.value = false }
}
function generateSecret() { draft.oauth.secretInput = generateRuntimeSecret(); draft.oauth.secretAction = 'replace'; errors.oauth = '' }
function clearSecret(group) { draft[group].secretInput = ''; draft[group].secretAction = 'clear'; errors[group] = '' }
async function saveGroup(group) {
  if (!loaded.value || saving.value) return { status: 'busy' }
  errors[group] = ''
  try {
    const payload = patchFor(group)
    if (!payload) return { status: 'completed' }
    saving.value = group
    const result = await props.runSensitive(t(SAVE_LABELS[group]), () => runtimeConfigSet(payload))
    if (result?.status === 'cancelled' || result?.status === 'busy') return result
    applyConfig(result?.value ?? result, group)
    return { status: 'completed' }
  } catch (error) {
    errors[group] = Number(error?.code) === 409 ? t('sysConfigConflict') : error?.message || t('sysSaveFailedKept')
    return { status: 'failed', message: errors[group] }
  } finally { saving.value = '' }
}
const revealVisible = ref(false)
const revealLoading = ref(false)
const revealPassword = ref('')
const revealedSecret = ref('')
const revealError = ref('')
const revealNotice = ref('')
let revealEpoch = 0
let disposed = false
function openReveal() {
  clearRevealState()
  revealVisible.value = true
}

async function reveal() {
  if (revealLoading.value || !revealPassword.value.trim()) { revealError.value = t('sysEnterAdminPassword'); return }
  const epoch = ++revealEpoch
  revealLoading.value = true
  revealError.value = ''
  try {
    const result = await revealOauthSecret(revealPassword.value)
    if (disposed || epoch !== revealEpoch || !revealVisible.value) return
    revealedSecret.value = String(result?.secret || '')
    if (!revealedSecret.value) revealError.value = t('sysNoSecretReturned')
  } catch (error) {
    if (!disposed && epoch === revealEpoch && revealVisible.value) revealError.value = Number(error?.code) === 403 ? t('sysAdminPasswordIncorrect') : error?.message || t('sysSecretRevealFailed')
  } finally {
    if (epoch === revealEpoch) { revealLoading.value = false; revealPassword.value = '' }
  }
}

async function copyReveal() {
  if (!revealedSecret.value || !navigator.clipboard?.writeText) { revealError.value = t('sysClipboardUnsupported'); return }
  try { await navigator.clipboard.writeText(revealedSecret.value); revealNotice.value = t('sysSecretCopied') }
  catch { revealError.value = t('sysCopyFailedManual') }
}

function clearRevealState() {
  revealEpoch += 1
  revealPassword.value = ''
  revealedSecret.value = ''
  revealError.value = ''
  revealNotice.value = ''
  revealLoading.value = false
}


onMounted(load)
onBeforeUnmount(() => { disposed = true; clearRevealState() })
</script>
<style scoped lang="scss">
@use './card' as *;
.runtime-groups { display:flex; flex-direction:column; gap:20px; min-width:0; }
.credential-fields { display:flex; flex-direction:column; gap:18px; min-width:0; }
.section-heading { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
.section-heading h4 { margin:0; font-size:14px; font-weight:500; color:var(--text-strong); }
.field-aux { display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px; }
.field-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:3px; }
.field-actions :deep(.el-button), .field-aux :deep(.el-button) { margin:0; }
.change-warning { max-width:600px; margin:0; color:var(--el-color-warning); font-size:12px; line-height:1.6; }
.advanced-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:20px 24px; cursor:pointer; color:var(--text-strong); font-size:14px; font-weight:500; }
.advanced-summary { font-size:12px; font-weight:400; color:var(--muted); }
.advanced-origins[open] > summary { border-bottom:1px solid var(--line); }
.refresh-row { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; font-size:12px; color:var(--muted); }
.reveal-body { display:flex; flex-direction:column; gap:16px; }
.dialog-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; }
@media(max-width:640px) { .advanced-heading { padding:16px; } }
</style>
