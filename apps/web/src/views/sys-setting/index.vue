<template>
  <el-scrollbar class="page-scroll">
    <div class="sys-setting-page" v-loading="loading">
      <!-- 页面头部：跟随当前分区 -->
      <div class="page-header">
        <div class="header-left">
          <h2 class="page-title arc-serif-title">{{ $t(activeSectionMeta.label) }}</h2>
          <p class="page-desc">{{ $t(activeSectionMeta.desc) }}</p>
        </div>
      </div>

      <el-alert v-if="upgradePending" type="info" :closable="false" show-icon>
        <template #title>{{ $t('sysUpgradePendingTitle') }}</template>
        <span>{{ $t('sysUpgradePendingDesc') }}</span>
        <el-button v-if="activeSection !== 'maintenance'" link type="primary" @click="router.push({ query: { tab: 'maintenance' } })">{{ $t('sysGoToMaintenance') }}</el-button>
      </el-alert>
      <p v-if="loadError" class="load-error" role="alert">{{ loadError }} <el-button link @click="load">{{ $t('sysReload') }}</el-button></p>
      <div class="setting-cards-grid" :inert="!initialized || savingGroup ? '' : null">
        <div v-show="activeSection === 'core'" class="section-panel">
          <CoreSwitchesCard :form="form">
            <template #footer><SettingsSaveBar v-bind="saveBar('core')" @save="save('core')" @reset="resetGroup('core')" /></template>
          </CoreSwitchesCard>
        </div>

        <div v-show="activeSection === 'brand'" class="section-panel">
          <BrandSettingsCard ref="brandCardRef" :form="brandForm" :saving="savingGroup === 'brand'" :dirty="saveBar('brand').dirty" @saved="onAssetSaved" @busy="brandUploading = $event">
            <template #footer><SettingsSaveBar v-bind="saveBar('brand')" :disabled="!initialized || brandUploading" @save="save('brand')" @reset="resetGroup('brand')" /></template>
          </BrandSettingsCard>
        </div>

        <div v-show="activeSection === 'domains'" class="section-panel">
          <ManagedDomainsCard :domains="managedDomains" :loading="domainsLoading" :saving="domainsSaving" :error="domainsError" @add="addManagedDomain" />
          <UnmatchedPolicyCard
            :unmatched-policy="unmatchedPolicy"
            :policy-loading="policyLoading"
            :policy-error="policyError"
            :policy-saving="policySaving"
            @change="onUnmatchedPolicyChange"
            @reload="loadUnmatchedPolicy"
          />
        </div>

        <div v-show="activeSection === 'mail'" class="section-panel">
          <BlacklistFilterCard :form="form">
            <template #footer><SettingsSaveBar v-bind="saveBar('filters')" @save="save('filters')" @reset="resetGroup('filters')" /></template>
          </BlacklistFilterCard>
          <ResendChannelsCard
            :has-cf-email="form.hasCfEmail"
            v-model:provider="form.mailProvider"
            :upgrade-required="form.mailProviderUpgradeRequired"
            :domains="domains"
            :resend-tokens="resendTokens"
            :existing-tokens="form.resendTokens"
          >
            <template #footer><SettingsSaveBar v-bind="saveBar('channels')" @save="save('channels')" @reset="resetGroup('channels')" /></template>
          </ResendChannelsCard>
        </div>

        <div v-show="activeSection === 'auth'" class="section-panel">
          <ConfirmationSettingsCard v-if="!upgradePending" :run-sensitive="runSensitive" @dirty-change="childDirty.confirmation = $event" @busy="childBusy.confirmation = $event" />
          <GoogleOAuthSettingCard
            :form="form"
            v-model:google-client-secret="googleClientSecret"
          >
            <template #footer><SettingsSaveBar v-bind="saveBar('google')" @save="save('google')" @reset="resetGroup('google')" /></template>
          </GoogleOAuthSettingCard>
          <RuntimeConfigCard :run-sensitive="runSensitive" @dirty-change="childDirty.runtime = $event" @busy="childBusy.runtime = $event" />
        </div>

        <div v-show="activeSection === 'maintenance'" class="section-panel">
          <DatabaseMaintenanceCard
            :upgrade-loading="upgradeLoading"
            :upgrade-pending="upgradePending"
            :result="upgradeResult" :error="upgradeError"
            @upgrade="runUpgrade"
          />
        </div>
      </div>
      <RecentAuthDialog
        ref="recentAuthDialog"
        :model-value="recentAuthVisible"
        :purpose="recentAuthPurpose"
        :window-minutes="recentAuthWindowMinutes"
        :loading="recentAuthLoading"
        :error-message="recentAuthError"
        @submit="submitRecentAuth"
        @cancel="cancelRecentAuth"
        @clear-error="recentAuthError = ''"
      />
    </div>
  </el-scrollbar>
</template>

<script setup>
import { computed, onActivated, onDeactivated, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { setupStatus } from '@/request/login.js'
import { settingsConfirmationStatus, adminDomains, adminDomainsAdd, settingQuery, settingSet, websiteConfig, upgradeDatabase } from '@/request/setting.js'
import { unmatchedGetPolicy, unmatchedSetPolicy } from '@/request/unmatched.js'
import { useSettingStore } from '@/store/setting.js'
import { ElMessage, ElMessageBox } from 'element-plus'
import BrandSettingsCard from './components/BrandSettingsCard.vue'
import RuntimeConfigCard from './components/RuntimeConfigCard.vue'
import ConfirmationSettingsCard from './components/ConfirmationSettingsCard.vue'
import { buildSettingPatch, needsSettingConfirmation } from '@/utils/setting-patch.js'
import CoreSwitchesCard from './components/CoreSwitchesCard.vue'
import GoogleOAuthSettingCard from './components/GoogleOAuthSettingCard.vue'
import UnmatchedPolicyCard from './components/UnmatchedPolicyCard.vue'
import ResendChannelsCard from './components/ResendChannelsCard.vue'
import BlacklistFilterCard from './components/BlacklistFilterCard.vue'
import DatabaseMaintenanceCard from './components/DatabaseMaintenanceCard.vue'
import SettingsSaveBar from './components/SettingsSaveBar.vue'
import RecentAuthDialog from '../setting/components/RecentAuthDialog.vue'
import { recentAuthPassword } from '@/request/my.js'
import { createRecentAuthCoordinator } from '@/utils/recent-auth.js'
import { isDomain } from '@/utils/verify-utils.js'
import ManagedDomainsCard from './components/ManagedDomainsCard.vue'
import { getSysSettingSection, resolveSysSettingSection } from './sections.js'
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'sys-setting' })

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const settingStore = useSettingStore()
const upgradePending = computed(() => settingStore.setupStatus?.upgradeRequired === true)
const activeSection = computed(() => resolveSysSettingSection(route.query.tab))
const activeSectionMeta = computed(() => getSysSettingSection(activeSection.value))
const loading = ref(false)
const initialized = ref(false)
const loadError = ref('')
const savingGroup = ref('')
const groupErrors = reactive({})
const groupMessages = reactive({})
const childDirty = reactive({ confirmation: false, runtime: false })
const childBusy = reactive({ confirmation: false, runtime: false })
const brandUploading = ref(false)
const upgradeResult = ref('')
const upgradeError = ref('')
const upgradeLoading = ref(false)
const unmatchedPolicy = ref('')
const policyLoading = ref(false)
const policyError = ref(false)
const policySaving = ref(false)
const form = reactive({ receive: 0, send: 0, loginDomain: 0 })
const brandForm = reactive({ title: 'FlareMail', siteDescription: '', siteLogo: '', siteFavicon: '', sitePwaIcons: {}, loginCopy: {} })
const brandBaseline = ref(null)
const brandCardRef = ref()
const resendTokens = reactive({})
const googleClientSecret = ref('')
const managedDomains = ref([])
const domainsRevision = ref(null)
const domainsLoading = ref(false)
const domainsSaving = ref(false)
const domainsError = ref('')
const domains = computed(() => managedDomains.value.length ? managedDomains.value : (form.domainList || []).map(domain => domain.replace(/^@/, '')))

const recentAuthDialog = ref()
const recentAuthVisible = ref(false)
const recentAuthPurpose = ref(t('recentAuthDefaultPurpose'))
const recentAuthWindowMinutes = ref(1440)
const generalBaseline = ref({})
const recentAuthLoading = ref(false)
const recentAuthError = ref('')
let recentAuthResolve = null
let recentAuthRequestEpoch = 0
let disposed = false

function requestRecentAuthentication(purpose, status) {
  recentAuthWindowMinutes.value = status?.windowMinutes || 1440
  if (disposed) return Promise.resolve(false)
  return new Promise(resolve => {
    recentAuthResolve = resolve
    recentAuthPurpose.value = purpose || t('recentAuthDefaultPurpose')
    recentAuthError.value = ''
    recentAuthVisible.value = true
  })
}

function settleRecentAuthentication(verified) {
  recentAuthRequestEpoch += 1
  const resolve = recentAuthResolve
  recentAuthResolve = null
  recentAuthVisible.value = false
  recentAuthLoading.value = false
  recentAuthError.value = ''
  resolve?.(verified === true)
}

async function submitRecentAuth(password) {
  if (!recentAuthResolve || recentAuthLoading.value) return
  const requestEpoch = ++recentAuthRequestEpoch
  recentAuthLoading.value = true
  recentAuthError.value = ''
  try {
    const status = await recentAuthPassword(password)
    if (requestEpoch !== recentAuthRequestEpoch || !recentAuthResolve) return
    if (status?.valid !== true && status?.enabled !== false) {
      recentAuthError.value = t('reauthNotEffectiveMsg')
      await recentAuthDialog.value?.clearAndFocus()
      return
    }
    settleRecentAuthentication(true)
  } catch (error) {
    if (requestEpoch !== recentAuthRequestEpoch || !recentAuthResolve) return
    if (Number(error?.code) === 403) recentAuthError.value = t('currentPwdIncorrectMsg')
    else if (Number(error?.code) === 429) recentAuthError.value = t('tooManyAttemptsMsg')
    else if (Number(error?.code) !== 401) recentAuthError.value = error?.message || t('reauthFailedMsg')
    await recentAuthDialog.value?.clearAndFocus()
  } finally {
    if (requestEpoch === recentAuthRequestEpoch && recentAuthResolve) recentAuthLoading.value = false
  }
}

function cancelRecentAuth() {
  settleRecentAuthentication(false)
}

const recentAuthCoordinator = createRecentAuthCoordinator({
  getStatus: settingsConfirmationStatus,
  requestAuthentication: requestRecentAuthentication
})

function runSensitive(purpose, action) {
  return recentAuthCoordinator.run(purpose, action)
}

onMounted(load)
onActivated(() => { window.addEventListener('beforeunload', warnBeforeUnload); window.addEventListener('focus', syncBrandAfterPreview); syncBrandAfterPreview() })
onDeactivated(() => { window.removeEventListener('beforeunload', warnBeforeUnload); window.removeEventListener('focus', syncBrandAfterPreview) })
async function syncBrandAfterPreview() {
  if (!initialized.value || activeSection.value !== 'brand' || savingGroup.value || brandUploading.value) return
  const data = await settingQuery().catch(() => null)
  if (!data || savingGroup.value || brandUploading.value) return
  for (const key of groupFields.brand) {
    if (JSON.stringify(brandForm[key]) === JSON.stringify(brandBaseline.value[key]) && data[key] !== undefined) {
      brandForm[key] = clone(data[key]); brandBaseline.value[key] = clone(data[key])
    }
  }
  await refreshPublicBrand()
}

const groupFields = {
  core: ['receive', 'send', 'loginDomain', 'r2Domain'],
  filters: ['blackFrom', 'blackSubject', 'blackContent'],
  channels: ['mailProvider'], google: ['googleOauthEnabled', 'googleClientId'],
  brand: ['title', 'siteDescription', 'siteLogo', 'siteFavicon', 'sitePwaIcons', 'loginCopy'],
}
const groupLabels = { core: 'sysSaveCore', filters: 'sysSaveFilters', channels: 'sysSaveChannels', google: 'sysSaveGoogle', brand: 'sysSaveBrand' }
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
function groupPatch(group) {
  const section = { filters: 'mail', google: 'auth' }[group] || group
  const payload = buildSettingPatch(section, form, generalBaseline.value, {
    brand: brandForm, brandBaseline: brandBaseline.value,
    googleClientSecret: group === 'google' ? googleClientSecret.value : '',
    resendTokens: group === 'channels' ? resendTokens : {},
  })
  return payload
}
function saveBar(group) {
  return { dirty: initialized.value && !!Object.keys(groupPatch(group)).length, saving: savingGroup.value === group,
    disabled: !initialized.value || (group === 'channels' && form.mailProviderUpgradeRequired), error: groupErrors[group] || '', message: groupMessages[group] || '', label: t(groupLabels[group]) }
}
function resetGroup(group) {
  if (savingGroup.value || (group === 'brand' && brandUploading.value)) return
  const target = group === 'brand' ? brandForm : form
  const baseline = group === 'brand' ? brandBaseline.value : generalBaseline.value
  for (const key of groupFields[group]) target[key] = clone(baseline?.[key])
  if (group === 'google') googleClientSecret.value = ''
  if (group === 'channels') Object.keys(resendTokens).forEach(key => { resendTokens[key] = '' })
  groupErrors[group] = ''; groupMessages[group] = ''
}
const hasUnsaved = computed(() => initialized.value && (Object.keys(groupFields).some(group => Object.keys(groupPatch(group)).length) || Object.values(childDirty).some(Boolean)))
function warnBeforeUnload(event) {
  if (!hasUnsaved.value && !savingGroup.value && !brandUploading.value && !Object.values(childBusy).some(Boolean)) return
  event.preventDefault(); event.returnValue = ''
}
onBeforeRouteLeave(async () => {
  if (savingGroup.value || brandUploading.value || Object.values(childBusy).some(Boolean)) { ElMessage.info(t('sysBusyLeave')); return false }
  if (!hasUnsaved.value) return true
  try { await ElMessageBox.confirm(t('sysLeaveUnsavedMsg'), t('sysLeaveTitle'), { confirmButtonText: t('sysLeaveConfirm'), cancelButtonText: t('continueEditing'), type: 'warning' }); return true }
  catch { return false }
})

async function refreshPublicBrand() {
  const data = await websiteConfig().catch(() => null)
  if (data) settingStore.applyPublicBrand(data)
}
async function onAssetSaved({ type, config }) {
  const data = config || await settingQuery().catch(() => null)
  if (!data) { groupErrors.brand = t('sysBrandSyncFailed'); return }
  const fields = type === 'logo' ? ['siteLogo'] : ['siteFavicon', 'sitePwaIcons']
  for (const key of fields) {
    if (data[key] !== undefined) { brandForm[key] = clone(data[key]); brandBaseline.value[key] = clone(data[key]) }
  }
  await refreshPublicBrand()
}


async function loadManagedDomains() {
  domainsLoading.value = true
  domainsError.value = ''
  try {
    const result = await adminDomains()
    managedDomains.value = Array.isArray(result?.domains) ? result.domains : []
    domainsRevision.value = result?.revision ?? null
    settingStore.domainList = managedDomains.value.map(domain => '@' + domain)
  } catch (error) {
    domainsError.value = error?.message || t('sysDomainsLoadFailed')
  } finally { domainsLoading.value = false }
}

async function addManagedDomain(value) {
  const domain = String(value || '').trim().replace(/^@/, '').toLowerCase()
  if (domainsSaving.value) return
  if (!isDomain(domain)) { ElMessage({ message: t('sysInvalidDomain'), type: 'error', plain: true }); return }
  if (managedDomains.value.includes(domain)) { ElMessage({ message: t('sysDomainExists'), type: 'warning', plain: true }); return }
  domainsSaving.value = true
  try {
    const result = await adminDomainsAdd([domain], domainsRevision.value)
    managedDomains.value = Array.isArray(result?.domains) ? result.domains : [...managedDomains.value, domain]
    domainsRevision.value = result?.revision ?? domainsRevision.value
    settingStore.domainList = managedDomains.value.map(item => '@' + item)
    ElMessage({ message: t('sysDomainAdded'), type: 'success', plain: true })
  } catch (error) {
    if (Number(error?.code) === 409) { await loadManagedDomains(); ElMessage({ message: t('sysDomainsUpdated'), type: 'warning', plain: true }) }
  } finally { domainsSaving.value = false }
}

async function load() {
  if (initialized.value || loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const data = await settingQuery()
    Object.assign(form, data)
    generalBaseline.value = JSON.parse(JSON.stringify(data))
    Object.assign(brandForm, {
      title: data.title || 'FlareMail',
      siteDescription: data.siteDescription || '',
      siteLogo: data.siteLogo || '',
      siteFavicon: data.siteFavicon || '',
      sitePwaIcons: data.sitePwaIcons && typeof data.sitePwaIcons === 'object' ? data.sitePwaIcons : {},
      loginCopy: data.loginCopy && typeof data.loginCopy === 'object' ? {...data.loginCopy} : {},
    })
    brandBaseline.value = JSON.parse(JSON.stringify(brandForm))
    googleClientSecret.value = ''
    domains.value.forEach(domain => {
      resendTokens[domain] = ''
    })
    const publicBrand = await websiteConfig().catch(() => null)
    if (publicBrand) settingStore.applyPublicBrand(publicBrand)
    await loadUnmatchedPolicy()
    await loadManagedDomains()
    initialized.value = true
  } catch (error) {
    loadError.value = error?.message || t('sysSettingsLoadFailed')
  } finally {
    loading.value = false
  }
}

async function loadUnmatchedPolicy() {
  policyLoading.value = true
  policyError.value = false
  try {
    const res = await unmatchedGetPolicy()
    if (res?.policy) {
      unmatchedPolicy.value = res.policy
    } else {
      policyError.value = true
      unmatchedPolicy.value = ''
    }
  } catch (e) {
    console.warn('加载未匹配策略失败', e)
    policyError.value = true
    unmatchedPolicy.value = ''
  } finally {
    policyLoading.value = false
  }
}

async function onUnmatchedPolicyChange(val) {
  if (!val || policySaving.value) return;
  const previousPolicy = unmatchedPolicy.value;
  policySaving.value = true;
  try {
    await unmatchedSetPolicy(val);
    unmatchedPolicy.value = val;
    ElMessage({ message: t('sysPolicyUpdated'), type: 'success', plain: true });
  } catch (e) {
    unmatchedPolicy.value = previousPolicy;
    ElMessage({ message: e.message || t('sysUpdateFailed'), type: 'error', plain: true });
    await loadUnmatchedPolicy();
  } finally {
    policySaving.value = false;
  }
}

async function save(group) {
  if (savingGroup.value || !initialized.value || (group === 'brand' && brandUploading.value)) return
  savingGroup.value = group
  groupErrors[group] = ''; groupMessages[group] = ''
  try {
    if (group === 'brand' && brandCardRef.value && !(await brandCardRef.value.validate())) { groupErrors[group] = t('sysCheckBrandAssets'); return }
    const payload = clone(groupPatch(group))
    if (!Object.keys(payload).length) return
    const action = () => settingSet(payload)
    if (needsSettingConfirmation(payload)) {
      const saved = await runSensitive(t('sysSensitivePurpose'), action)
      if (saved?.status === 'cancelled' || saved?.status === 'busy') return
    } else await action()
    const target = group === 'brand' ? brandForm : form
    const baseline = group === 'brand' ? brandBaseline.value : generalBaseline.value
    for (const key of groupFields[group]) {
      if (Object.hasOwn(payload, key)) { baseline[key] = clone(payload[key]); target[key] = clone(payload[key]) }
    }
    if (group === 'google' && payload.googleClientSecret) { form.googleClientSecret = 'configured'; googleClientSecret.value = '' }
    if (group === 'channels' && payload.resendTokens) {
      form.resendTokens = { ...form.resendTokens }
      for (const domain of Object.keys(payload.resendTokens)) { form.resendTokens[domain] = 'configured'; resendTokens[domain] = '' }
    }
    if (group === 'brand') await refreshPublicBrand()
    groupMessages[group] = t('sysChangesSaved')
  } catch (error) { groupErrors[group] = error?.message || t('sysSaveFailedKeptRetry') }
  finally { savingGroup.value = '' }
}

onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('beforeunload', warnBeforeUnload)
  window.removeEventListener('focus', syncBrandAfterPreview)
  settleRecentAuthentication(false)
})

async function runUpgrade() {
  if (upgradeLoading.value) return
  upgradeLoading.value = true
  upgradeResult.value = ''; upgradeError.value = ''
  try {
    await upgradeDatabase()
    const status = await setupStatus()
    settingStore.setupStatus = status
    Object.assign(settingStore.settings, status)
    if (!status.upgradeRequired) form.mailProviderUpgradeRequired = false
    if (status.setupRequired || status.upgradeRequired) throw new Error(t('sysDbStillPending'))
    upgradeResult.value = t('sysDbUpToDate')
  } catch (error) { upgradeError.value = error?.message || t('sysDbUpgradeFailed') } finally {
    upgradeLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.page-scroll { height:100%; width:100%; background:var(--paper); }
.sys-setting-page { width:100%; max-width:960px; box-sizing:border-box; padding:24px 24px 48px; margin:0 auto; display:flex; flex-direction:column; gap:20px; }
.page-header { padding:0 0 0 2px; }
.page-title { font-family:inherit; font-size:22px; font-weight:600; line-height:1.4; color:var(--text-strong); margin:0; }
.page-desc { font-size:13px; line-height:1.6; color:var(--muted); margin:6px 0 0; }
.setting-cards-grid, .section-panel { display:flex; flex-direction:column; gap:20px; min-width:0; }
.load-error { color:var(--el-color-danger); font-size:13px; }
@media(max-width:767px) { .sys-setting-page { padding:16px 12px 32px; gap:16px; } .section-panel { gap:16px; } }
</style>
