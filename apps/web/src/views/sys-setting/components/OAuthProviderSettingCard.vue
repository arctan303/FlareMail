<template>
  <section class="setting-card oauth-provider-card">
    <div class="card-header">
      <div><h3 class="card-title">{{ $t('sysOauthTitle') }}</h3><p class="card-desc">{{ $t('sysOauthDesc') }}</p></div>
      <el-button text :loading="loading" :disabled="clientsSaving || enabledSaving || externalBusy" @click="loadProvider()">{{ $t('sysOauthRefresh') }}</el-button>
    </div>
    <div class="card-body">
      <div class="switch-item authorization-switch">
        <div class="switch-meta"><span class="switch-title">{{ $t('sysOauthEnableSwitch') }} <span class="immediate-label">{{ $t('sysOauthImmediate') }}</span></span><span class="switch-desc">{{ $t('sysOauthEnableDesc') }}</span></div>
        <el-switch :model-value="provider.enabled" :loading="enabledSaving" :disabled="!loaded || loading || clientsSaving || externalBusy" :aria-label="$t('sysOauthEnableAria')" @change="changeEnabled" />
      </div>
      <p v-if="switchFeedback" class="feedback" :class="{ success: switchFeedbackType === 'success' }" role="status">{{ switchFeedback }}</p>
      <fieldset class="settings-fields provider-fields" :disabled="!loaded || clientsSaving || externalBusy" :inert="!loaded || clientsSaving || externalBusy ? '' : null">
        <slot name="credentials" />
        <div class="sites-section">
          <div class="clients-heading"><div><h4 class="form-subsection-title">{{ $t('sysOauthSitesHeading') }} <span class="site-count">{{ clients.length }} / 32</span></h4><p class="field-hint">{{ $t('sysOauthSitesHint') }}</p></div><el-button :disabled="clients.length >= 32" @click="addClient"><Icon icon="solar:add-circle-linear" width="16" />{{ $t('sysOauthAddSite') }}</el-button></div>
          <div v-if="clientsConflict" class="conflict-notice" role="alert"><p>{{ $t('sysOauthConflict') }}</p><el-button @click="loadProvider({ discardLocal: true })">{{ $t('sysOauthDiscardDraft') }}</el-button></div>
          <div v-if="!clients.length" class="empty-state"><span>{{ $t('sysOauthEmpty') }}</span><p class="field-hint">{{ $t('sysOauthEmptyHint') }}</p></div>
          <details v-for="(client, clientIndex) in clients" :key="clientKey(client)" :id="'oauth-site-' + clientKey(client)" class="site-editor" :open="expandedSites.has(clientKey(client))" @toggle="setSiteOpen(client, $event.target.open)">
            <summary class="site-summary"><Icon icon="solar:alt-arrow-right-linear" width="16" class="site-chevron" /><span class="site-identity"><strong>{{ client.displayName || $t('sysOauthUnnamedSite') }}</strong><span>{{ client.clientId || $t('sysOauthNoClientId') }}</span></span><span class="site-summary-meta"><span v-if="siteDirty(client)" class="draft-badge">{{ $t('sysOauthUnsaved') }}</span><span class="status-pill" :class="client.enabled ? 'ready' : 'missing'">{{ client.enabled ? $t('enable') : $t('sysDisable') }}</span><span>{{ $t('sysOauthRedirectCount', { count: client.redirects.length }) }}</span></span></summary>
            <div class="site-edit-body">
              <div class="site-edit-tools"><label class="site-enabled"><span>{{ $t('sysOauthAllowSite') }}</span><el-switch v-model="client.enabled" :aria-label="$t('sysOauthAllowSiteAria', { name: client.displayName || $t('sysOauthThisSite') })" /></label><el-button text type="danger" @click="removeClient(clientIndex)">{{ $t('sysOauthRemoveSite') }}</el-button></div>
              <div class="field-item"><label class="field-label" :for="clientKey(client) + '-name'">{{ $t('sysOauthSiteName') }}</label><el-input :id="clientKey(client) + '-name'" v-model="client.displayName" maxlength="80" :placeholder="$t('sysOauthSiteNamePlaceholder')" /></div>
              <div class="field-item"><label class="field-label" :for="clientKey(client) + '-id'">{{ $t('sysOauthClientId') }}</label><el-input :id="clientKey(client) + '-id'" v-model="client.clientId" maxlength="128" :disabled="client.__persisted === true" :placeholder="$t('sysOauthClientIdPlaceholder')" /><p class="field-hint">{{ client.__persisted ? $t('sysOauthClientIdLocked') : $t('sysOauthClientIdHint') }}</p></div>
              <div class="redirects-section">
                <div class="redirect-heading"><h5>{{ $t('sysOauthRedirectsHeading') }}</h5><el-button text :disabled="client.redirects.length >= 16" @click="addRedirect(client)">{{ $t('sysOauthAddRedirect') }}</el-button></div>
                <p class="field-hint">{{ $t('sysOauthRedirectsHint') }}</p>
                <div v-for="(redirect, redirectIndex) in client.redirects" :key="redirectIndex" class="redirect-item">
                  <div class="redirect-label-row"><label class="field-label" :for="clientKey(client) + '-redirect-' + redirectIndex">{{ $t('sysOauthRedirectLabel', { index: redirectIndex + 1 }) }}</label><el-button text type="danger" :disabled="client.redirects.length <= 1" @click="removeRedirect(client, redirectIndex)">{{ $t('sysOauthRemoveRedirect') }}</el-button></div>
                  <el-input :id="clientKey(client) + '-redirect-' + redirectIndex" v-model="redirect.redirectUri" maxlength="2048" placeholder="https://app.example.com/oauth/callback" />
                  <details class="help-details" :open="Boolean(redirect.silentFrameAncestor)"><summary>{{ $t('sysOauthSilentSummary') }}</summary><div class="field-item"><label class="field-label" :for="clientKey(client) + '-silent-' + redirectIndex">{{ $t('sysOauthSilentLabel') }}</label><el-input :id="clientKey(client) + '-silent-' + redirectIndex" v-model="redirect.silentFrameAncestor" maxlength="255" placeholder="https://app.example.com" /><p class="field-hint">{{ $t('sysOauthSilentHint') }}</p></div></details>
                </div>
                <p class="field-hint">{{ $t('sysOauthSchemeHint') }}</p>
              </div>
              <p v-if="validationClientIndex === clientIndex && validationError" class="feedback" role="alert">{{ validationError }}</p>
            </div>
          </details>
        </div>
      </fieldset>
    </div>
    <SettingsSaveBar :dirty="clientsDirty || credentialsDirty" :saving="clientsSaving" :disabled="!loaded || loading || enabledSaving || externalBusy || clientsConflict || !credentialsReady" :error="feedbackType === 'error' ? feedback : ''" :message="feedbackType === 'success' ? feedback : ''" :label="$t('sysOauthSave')" @save="saveClients" @reset="resetAllDrafts" />
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import SettingsSaveBar from './SettingsSaveBar.vue'
import { oauthProviderConfig, oauthProviderSetClients, oauthProviderSetEnabled } from '@/request/setting.js'

const props = defineProps({
  runSensitive: { type: Function, required: true },
  credentialsDirty: Boolean, credentialsReady: Boolean, externalBusy: Boolean,
  saveCredentials: { type: Function, required: true },
})

const emit = defineEmits(['dirty-change', 'reset-credentials', 'busy'])
const { t } = useI18n()
const loaded = ref(false)
const expandedSites = ref(new Set())
const validationClientIndex = ref(-1)
const validationError = ref('')
const switchFeedback = ref('')
const switchFeedbackType = ref('')
const loading = ref(false)
const enabledSaving = ref(false)
const clientsSaving = ref(false)
const clientsConflict = ref(false)
const feedback = ref('')
const feedbackType = ref('')
const provider = reactive({ enabled: false, revision: 0, issuerReady: false, secretReady: false, clients: [] })
const clients = ref([])
const serverClients = ref([])
const localClientKeys = new WeakMap()
let localClientKeyCounter = 0

const clientsDirty = computed(() => JSON.stringify(clients.value) !== JSON.stringify(serverClients.value))

watch(clientsDirty, value => emit('dirty-change', value), { immediate: true })
watch(() => clientsSaving.value || enabledSaving.value, value => emit('busy', value))
function setSiteOpen(client, open) { const key = clientKey(client); open ? expandedSites.value.add(key) : expandedSites.value.delete(key) }
function siteDirty(client) { const saved = serverClients.value.find(item => item.clientId === client.clientId); return !saved || JSON.stringify(client) !== JSON.stringify(saved) }
function resetAllDrafts() {
  if (clientsSaving.value || props.externalBusy) return
  clients.value = clone(serverClients.value); validationError.value = ''; validationClientIndex.value = -1
  clearFeedback(); emit('reset-credentials')
}
function clone(value) {
  return JSON.parse(JSON.stringify(value ?? []))
}

function normalizeProjection(data) {
  const source = data?.data && typeof data.data === 'object' ? data.data : data
  return {
    enabled: source?.enabled === true,
    revision: Number.isInteger(source?.revision) ? source.revision : Number(source?.revision || 0),
    issuerReady: source?.issuerReady === true,
    secretReady: source?.secretReady === true,
    clients: Array.isArray(source?.clients) ? source.clients.map(normalizeClient) : [],
  }
}

function normalizeClient(client = {}) {
  return {
    clientId: String(client.clientId || ''),
    displayName: String(client.displayName || ''),
    enabled: client.enabled === true,
    __persisted: true,
    redirects: Array.isArray(client.redirects) ? client.redirects.map(redirect => ({
      redirectUri: String(redirect?.redirectUri || ''),
      silentFrameAncestor: String(redirect?.silentFrameAncestor || ''),
    })) : [],
  }
}

function applyProjection(data, { replaceLocal = false } = {}) {
  const next = normalizeProjection(data)
  provider.enabled = next.enabled
  provider.revision = next.revision
  provider.issuerReady = next.issuerReady
  provider.secretReady = next.secretReady
  provider.clients = clone(next.clients)
  serverClients.value = clone(next.clients)
  if (replaceLocal) { clients.value = clone(next.clients); clientsConflict.value = false }
}

function setFeedback(message, type = 'error') {
  feedback.value = message
  feedbackType.value = type
}

function clearFeedback() {
  feedback.value = ''
  feedbackType.value = ''
}


function applyRuntimeReadiness(value) {
  const source = value?.oauth || value?.data?.oauth
  if (!source || typeof source !== 'object') return
  provider.issuerReady = typeof source.issuer === 'string' && source.issuer.length > 0
  provider.secretReady = source.secretConfigured === true
}

async function loadProvider({ discardLocal = false } = {}) {
  if (loading.value || clientsSaving.value || enabledSaving.value || props.externalBusy) return
  loading.value = true
  clearFeedback()
  try {
    const data = await oauthProviderConfig()
    loaded.value = true
    if (clientsDirty.value && !discardLocal) {
      const next = normalizeProjection(data)
      provider.enabled = next.enabled
      provider.issuerReady = next.issuerReady
      provider.secretReady = next.secretReady
      if (JSON.stringify(next.clients) !== JSON.stringify(serverClients.value)) {
        clientsConflict.value = true
        setFeedback(t('sysOauthOtherSessionChanged'))
      } else {
        provider.revision = next.revision
        provider.clients = clone(next.clients)
        clientsConflict.value = false
        setFeedback(t('sysOauthRefreshed'), 'success')
      }
    } else {
      applyProjection(data, { replaceLocal: true })
    }
  } catch (error) {
    setFeedback(errorMessage(error, t('sysOauthLoadFailed')))
  } finally {
    loading.value = false
  }
}

function errorMessage(error, fallback) {
  if (Number(error?.code) === 409) return t('sysOauthConflictRetry')
  return error?.message || fallback
}

async function changeEnabled(value) {
  const enabled = value === true
  if (!loaded.value || enabledSaving.value || clientsSaving.value || props.externalBusy) return
  switchFeedback.value = ''
  enabledSaving.value = true
  try {
    const result = await props.runSensitive(enabled ? t('sysOauthEnablePurpose') : t('sysOauthDisablePurpose'), () => oauthProviderSetEnabled(enabled, provider.revision))
    if (result?.status === 'cancelled' || result?.status === 'busy') return
    applyProjection(result?.value ?? result, { replaceLocal: false })
    switchFeedback.value = enabled ? t('sysOauthEnabledMsg') : t('sysOauthDisabledMsg')
    switchFeedbackType.value = 'success'
  } catch (error) {
    switchFeedback.value = errorMessage(error, enabled ? t('sysOauthEnableFailed') : t('sysOauthDisableFailed'))
    switchFeedbackType.value = 'error'
  } finally {
    enabledSaving.value = false
  }
}

function validateClients() {
  if (clients.value.length > 32) throw new Error(t('sysOauthTooManyClients'))
  const ids = new Set()
  for (const [index, client] of clients.value.entries()) {
    validationClientIndex.value = index
    const id = String(client.clientId || '').trim()
    const name = String(client.displayName || '').trim()
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(id) || ids.has(id)) throw new Error(t('sysOauthErrId', { index: index + 1 }))
    if (name.length < 1 || name.length > 80) throw new Error(t('sysOauthErrName', { index: index + 1 }))
    if (!Array.isArray(client.redirects) || client.redirects.length < 1 || client.redirects.length > 16) throw new Error(t('sysOauthErrRedirectRequired', { index: index + 1 }))
    ids.add(id)
    const redirects = new Set()
    for (const [redirectIndex, redirect] of client.redirects.entries()) {
      const value = String(redirect.redirectUri || '').trim()
      let url
      try { url = new URL(value) } catch { throw new Error(t('sysOauthErrRedirectUrl', { index: index + 1, redirect: redirectIndex + 1 })) }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || value.length > 2048 || /\*/.test(value) || redirects.has(value)) {
        throw new Error(t('sysOauthErrRedirectExact', { index: index + 1, redirect: redirectIndex + 1 }))
      }
      const local = url.hostname === '127.0.0.1'
      if (url.protocol !== 'https:' && !local) throw new Error(t('sysOauthErrRedirectHttps', { index: index + 1 }))
      const silent = String(redirect.silentFrameAncestor || '').trim()
      if (silent) {
        let origin
        try { origin = new URL(silent) } catch { throw new Error(t('sysOauthErrSilentOrigin', { index: index + 1 })) }
        if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.port && !/^\d+$/.test(origin.port)) {
          throw new Error(t('sysOauthErrSilentStrict', { index: index + 1 }))
        }
      }
      redirects.add(value)
      redirect.redirectUri = value
      redirect.silentFrameAncestor = silent
    }
    client.clientId = id
    client.displayName = name
  }
  validationClientIndex.value = -1
  return clients.value.map(client => ({
    clientId: client.clientId,
    displayName: client.displayName,
    enabled: client.enabled === true,
    redirects: client.redirects.map(redirect => ({
      redirectUri: redirect.redirectUri,
      ...(redirect.silentFrameAncestor ? { silentFrameAncestor: redirect.silentFrameAncestor } : {}),
    })),
  }))
}

function addClient() {
  if (clients.value.length >= 32) return
  clients.value.push({ __persisted: false, clientId: '', displayName: '', enabled: true, redirects: [{ redirectUri: '', silentFrameAncestor: '' }] })
  const client = clients.value[clients.value.length - 1]
  expandedSites.value.add(clientKey(client))
  nextTick(() => document.getElementById(clientKey(client) + '-name')?.focus())
}

function removeClient(index) {
  clients.value.splice(index, 1)
}

function addRedirect(client) {
  if (client.redirects.length < 16) client.redirects.push({ redirectUri: '', silentFrameAncestor: '' })
}

function removeRedirect(client, index) {
  if (client.redirects.length > 1) client.redirects.splice(index, 1)
}

function clientKey(client, index) {
  if (!localClientKeys.has(client)) localClientKeys.set(client, 'client-' + (++localClientKeyCounter))
  return localClientKeys.get(client)
}

async function saveClients() {
  if (!loaded.value || clientsSaving.value || enabledSaving.value || props.externalBusy || clientsConflict.value) return
  clearFeedback(); validationError.value = ''; validationClientIndex.value = -1
  const sitesChanged = clientsDirty.value
  let payload
  if (sitesChanged) {
    try { payload = validateClients() } catch (error) {
      validationError.value = error.message
      const client = clients.value[validationClientIndex.value]
      if (client) { expandedSites.value.add(clientKey(client)); await nextTick(); document.getElementById('oauth-site-' + clientKey(client))?.scrollIntoView({ block: 'nearest' }) }
      setFeedback(error.message); return
    }
  }
  clientsSaving.value = true
  let credentialsSaved = false
  try {
    if (props.credentialsDirty) {
      const result = await props.saveCredentials()
      if (result?.status !== 'completed') {
        if (result?.status === 'failed') setFeedback(result.message || t('sysOauthCredentialsFirst'))
        return
      }
      credentialsSaved = true
    }
    if (sitesChanged) {
      const result = await props.runSensitive(t('sysOauthSavePurpose'), () => oauthProviderSetClients(provider.revision, payload))
      if (result?.status === 'cancelled' || result?.status === 'busy') {
        if (credentialsSaved) setFeedback(t('sysOauthCredentialsSavedSitesPending'))
        return
      }
      applyProjection(result?.value ?? result, { replaceLocal: true })
    }
    setFeedback(t('sysOauthSaved'), 'success')
  } catch (error) {
    setFeedback((credentialsSaved ? t('sysOauthCredentialsSavedSitesFailed') : '') + errorMessage(error, t('sysOauthSitesSaveFailed')))
  } finally { clientsSaving.value = false }
}

onMounted(loadProvider)
defineExpose({ loadProvider, applyRuntimeReadiness })
</script>

<style lang="scss" scoped>
@use './card' as *;
.authorization-switch { padding-bottom:18px !important; border-bottom:1px solid var(--line) !important; }
.immediate-label { margin-left:8px; font-size:11px; font-weight:400; color:var(--muted); }
.provider-fields { display:flex; flex-direction:column; gap:24px; }
.sites-section { display:flex; flex-direction:column; gap:12px; padding-top:22px; border-top:1px solid var(--line); }
.clients-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:4px; }
.clients-heading > div { display:flex; flex-direction:column; gap:4px; }
.clients-heading :deep(.el-button > span) { gap:6px; }
.site-count { margin-left:6px; font-size:12px; color:var(--muted); font-weight:400; }
.site-editor { border:1px solid var(--line); border-radius:8px; min-width:0; overflow:hidden; }
.site-summary { display:flex; align-items:center; gap:12px; padding:14px 16px; cursor:pointer; list-style:none; background:var(--paper-soft); }
.site-summary::-webkit-details-marker { display:none; }
.site-chevron { flex-shrink:0; color:var(--muted); }
.site-editor[open] > .site-summary .site-chevron { transform:rotate(90deg); }
.site-identity { display:flex; flex-direction:column; gap:3px; flex:1; min-width:0; }
.site-identity strong { color:var(--text-strong); font-size:14px; font-weight:600; overflow-wrap:anywhere; }
.site-identity > span { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.site-summary-meta { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; color:var(--muted); font-size:12px; }
.draft-badge { font-size:11px; color:var(--text); }
.site-edit-body { display:flex; flex-direction:column; gap:18px; padding:0 20px 20px; border-top:1px solid var(--line); }
.site-edit-tools { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; padding:12px 0; border-bottom:1px solid var(--line); }
.site-enabled { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--text); }
.redirects-section { display:flex; flex-direction:column; gap:10px; padding-top:18px; border-top:1px solid var(--line); }
.redirect-heading, .redirect-label-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.redirect-heading h5 { margin:0; color:var(--text-strong); font-size:14px; font-weight:500; }
.redirect-item { display:flex; flex-direction:column; gap:8px; padding:12px 0 18px; max-width:600px; }
.redirect-item + .redirect-item { border-top:1px solid var(--line); }
.empty-state { padding:24px 16px; display:flex; flex-direction:column; align-items:center; gap:8px; color:var(--muted); font-size:13px; background:var(--paper-soft); border-radius:8px; text-align:center; }
.conflict-notice { padding:12px 14px; color:var(--el-color-warning); border-left:2px solid currentColor; font-size:12px; line-height:1.6; }
.conflict-notice p { margin:0 0 10px; }
@container(max-width:560px) { .site-summary { flex-wrap:wrap; gap:10px; padding:12px; } .site-summary-meta { width:100%; padding-left:26px; justify-content:flex-start; } .site-edit-body { padding:0 12px 16px; } }
</style>
