<template>
  <div class="webhook-settings">
    <section class="setting-card arc-card" v-loading="busy">
      <header class="card-header">
        <div class="header-left-group">
          <div class="header-icon" aria-hidden="true"><Icon icon="solar:letter-linear" width="20" /></div>
          <div><h3 class="card-title">{{ t('webhook.title') }}</h3><p class="card-desc">{{ t('webhook.description') }}</p></div>
        </div>
        <el-button text :disabled="busy || !accountId" @click="load"><Icon icon="solar:refresh-circle-linear" width="16" aria-hidden="true" />{{ t('webhook.reload') }}</el-button>
      </header>
      <div class="card-body">
        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
        <el-form label-position="top" :disabled="busy" class="webhook-form">
          <el-form-item :label="t('mailboxAddress')">
            <el-select v-model="accountId" :aria-label="t('mailboxAddress')" @change="load">
              <el-option v-for="account in accounts" :key="account.accountId" :value="account.accountId" :label="account.email" />
            </el-select>
          </el-form-item>
          <template v-if="form">
            <div class="switch-item">
              <div class="switch-meta"><label for="webhook-enabled" class="switch-title">{{ t('webhook.enabled') }}</label></div>
              <el-switch id="webhook-enabled" v-model="form.enabled" :aria-label="t('webhook.enabled')" />
            </div>
            <el-form-item label="URL"><el-input v-model="form.url" placeholder="https://assistant.example.com/mail" maxlength="2048" /></el-form-item>
            <el-form-item :label="t('webhook.senders')">
              <el-radio-group v-model="form.mode" :aria-label="t('webhook.senders')">
                <el-radio value="all">{{ t('webhook.all') }}</el-radio>
                <el-radio value="allowlist">{{ t('webhook.allowlist') }}</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="form.mode === 'allowlist'" :label="t('webhook.addresses')"><el-input v-model="addresses" type="textarea" :rows="3" placeholder="owner@example.com" /></el-form-item>
            <p class="field-hint">{{ t('webhook.filterHint') }}</p>
            <details class="help-details secret-settings">
              <summary><Icon icon="solar:key-linear" width="16" aria-hidden="true" />{{ t('webhook.advanced') }}</summary>
              <div class="maintenance-fields">
                <el-form-item :label="t('webhook.secret')"><el-input v-model="newSecret" type="password" show-password autocomplete="new-password" :placeholder="t('webhook.secretHint')" maxlength="256" /></el-form-item>
                <p class="field-hint">{{ t('webhook.savedActionsHint') }}</p>
                <div class="maintenance-actions">
                  <el-button :disabled="!form.hasSecret" @click="act(() => testWebhook(accountId))"><Icon icon="solar:plain-2-linear" width="16" aria-hidden="true" />{{ t('webhook.test') }}</el-button>
                  <el-button text :disabled="!form.hasSecret" @click="act(() => rotateWebhookSecret(accountId, form.revision), true)"><Icon icon="solar:refresh-circle-linear" width="16" aria-hidden="true" />{{ t('webhook.rotate') }}</el-button>
                </div>
                <div class="remove-action"><el-button type="danger" text :disabled="!form.hasSecret" @click="remove"><Icon icon="solar:trash-bin-trash-linear" width="16" aria-hidden="true" />{{ t('webhook.remove') }}</el-button></div>
              </div>
            </details>
          </template>
        </el-form>
        <div v-if="revealedSecret" class="secret-result" role="status">
          <el-alert :title="t('webhook.secretOnce')" type="success" :closable="false" />
          <el-input :model-value="revealedSecret" readonly type="password" show-password :aria-label="t('webhook.secret')" />
        </div>
      </div>
      <footer v-if="form" class="webhook-save-bar">
        <p>{{ t('webhook.saveHint') }}</p>
        <el-button type="primary" :disabled="busy || !form.mode" @click="save"><Icon icon="solar:diskette-linear" width="16" aria-hidden="true" />{{ t('save') }}</el-button>
      </footer>
    </section>
    <section v-if="form" class="setting-card arc-card" :aria-busy="busy">
      <header class="card-header">
        <div class="header-left-group">
          <div class="header-icon" aria-hidden="true"><Icon icon="solar:history-linear" width="20" /></div>
          <div><h3 class="card-title">{{ t('webhook.deliveries') }}</h3><p class="card-desc">{{ t('webhook.deliveryHint') }}</p></div>
        </div>
        <el-button text :disabled="busy" @click="refreshDeliveries"><Icon icon="solar:refresh-circle-linear" width="16" aria-hidden="true" />{{ t('webhook.reload') }}</el-button>
      </header>
      <div class="card-body">
        <el-table :data="deliveries" :empty-text="t('webhook.empty')">
          <el-table-column :label="t('webhook.event')" min-width="180"><template #default="{ row }"><div>{{ row.event }}</div><small>{{ row.eventId }}</small></template></el-table-column>
          <el-table-column :label="t('webhook.status')" min-width="150"><template #default="{ row }">{{ t(`webhook.${row.status}`) }} · {{ row.attempts }}<div v-if="row.httpStatus">HTTP {{ row.httpStatus }}</div><small>{{ row.error }}</small></template></el-table-column>
          <el-table-column :label="t('action')" width="100"><template #default="{ row }"><el-button v-if="row.status === 'failed'" link :disabled="busy" @click="act(() => retryWebhook(accountId, row.eventId))"><Icon icon="solar:refresh-circle-linear" width="16" aria-hidden="true" />{{ t('webhook.retry') }}</el-button></template></el-table-column>
        </el-table>
        <el-button v-if="nextBefore" class="more-records" :disabled="busy" @click="more">{{ t('webhook.more') }}</el-button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ElMessageBox } from 'element-plus'
import { accountList } from '@/request/account.js'
import { getWebhook, saveWebhook, deleteWebhook, rotateWebhookSecret, testWebhook, webhookDeliveries, retryWebhook } from '@/request/webhook.js'

const { t } = useI18n()
const accounts = ref([]), accountId = ref(null), form = ref(null), addresses = ref('')
const newSecret = ref(''), revealedSecret = ref(''), busy = ref(false), error = ref('')
const deliveries = ref([]), nextBefore = ref(null)
let epoch = 0, disposed = false
function applyConfig({ secret, ...config }) { form.value = config; addresses.value = config.allowlist.join('\n'); newSecret.value = '' }
async function act(action, reloadConfig = false) {
  if (busy.value || !accountId.value) return
  const ticket = ++epoch, id = accountId.value
  busy.value = true; error.value = ''; revealedSecret.value = ''
  try {
    const result = await action()
    if (disposed || ticket !== epoch) return
    // Preserve the one-time secret even if refreshing delivery history fails.
    if (result?.secret) revealedSecret.value = result.secret
    // Keep the acknowledged revision paired with its one-time secret, even if
    // another client changes the configuration before history is refreshed.
    const savedConfig = reloadConfig && result?.accountId === id && result?.hasSecret !== undefined
    if (savedConfig) applyConfig(result)
    const [config, page] = await Promise.all([reloadConfig && !savedConfig ? getWebhook(id) : Promise.resolve(null), webhookDeliveries(id)])
    if (disposed || ticket !== epoch) return
    if (config) applyConfig(config)
    deliveries.value = page.list; nextBefore.value = page.nextBefore
  } catch (failure) { if (!disposed && ticket === epoch) error.value = failure?.message || t('webhook.failedAction') }
  finally { if (ticket === epoch) busy.value = false }
}
async function load() {
  if (!accountId.value || busy.value) return
  form.value = null; deliveries.value = []; nextBefore.value = null
  await act(() => getWebhook(accountId.value).then(config => { if (!disposed) applyConfig(config) }))
}
function save() {
  const data = { revision: form.value.revision, url: form.value.url, enabled: form.value.enabled, mode: form.value.mode,
    allowlist: addresses.value.split(/[\n,]+/).map(value => value.trim()).filter(Boolean) }
  if (newSecret.value) data.secret = newSecret.value
  return act(() => saveWebhook(accountId.value, data), true)
}
async function remove() {
  const id = accountId.value, revision = form.value.revision
  try { await ElMessageBox.confirm(t('webhook.removeConfirm'), t('webhook.remove'), { type: 'warning' }) }
  catch { return }
  if (disposed || id !== accountId.value || revision !== form.value?.revision) return
  await act(() => deleteWebhook(id, revision), true)
}
const refreshDeliveries = () => act(() => Promise.resolve())
async function more() {
  if (busy.value || !nextBefore.value) return
  busy.value = true; error.value = ''
  try { const page = await webhookDeliveries(accountId.value, nextBefore.value); if (!disposed) { deliveries.value.push(...page.list); nextBefore.value = page.nextBefore } }
  catch (failure) { if (!disposed) error.value = failure?.message || t('webhook.failedAction') }
  finally { busy.value = false }
}
onMounted(async () => {
  busy.value = true
  try {
    let cursor = 0, sort
    while (!disposed) {
      const page = await accountList(cursor, 50, sort)
      if (!page.length) break
      accounts.value.push(...page); cursor = page.at(-1).accountId; sort = page.at(-1).sort
      if (page.length < 50) break
    }
    if (!disposed) accountId.value = accounts.value[0]?.accountId || null
  } catch (failure) { if (!disposed) error.value = failure?.message || t('webhook.failedAction') }
  finally { busy.value = false }
  if (!disposed) await load()
})
onBeforeUnmount(() => { disposed = true; epoch += 1; revealedSecret.value = ''; newSecret.value = '' })
</script>

<style scoped lang="scss">
@use '../../sys-setting/components/card' as *;
.webhook-settings { display:flex; flex-direction:column; gap:24px; min-width:0; }
.card-header > .el-button { flex-shrink:0; }
.webhook-form { display:flex; flex-direction:column; gap:20px; max-width:600px; width:100%; }
.webhook-form :deep(.el-form-item) { margin:0; }
.webhook-form :deep(.el-form-item__label) { font-size:13px; font-weight:500; color:var(--text-strong); margin-bottom:7px; line-height:1.5; }
.webhook-form :deep(.el-form-item__content) { line-height:1.6; }
.webhook-form :deep(.el-select) { width:100%; }
.webhook-form :deep(.el-radio-group) { display:flex; flex-wrap:wrap; gap:8px 20px; }
.webhook-form :deep(.el-radio) { margin-right:0; }
.webhook-form .switch-item { padding:0 0 18px; }
.secret-settings { padding-top:18px; border-top:1px solid var(--line); }
.secret-settings > summary { display:flex; align-items:center; gap:8px; }
.secret-settings > summary::before { content:'›'; font-size:18px; line-height:1; transform:rotate(0); }
.secret-settings[open] > summary::before { transform:rotate(90deg); }
.maintenance-fields { display:flex; flex-direction:column; gap:14px; padding-top:10px; }
.maintenance-actions { display:flex; flex-wrap:wrap; gap:8px; }
.remove-action { padding-top:12px; border-top:1px solid var(--line); }
.secret-result { display:grid; gap:12px; max-width:600px; }
.webhook-save-bar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 24px; border-top:1px solid var(--line); background:color-mix(in srgb,var(--paper) 35%,var(--surface)); }
.webhook-save-bar p { margin:0; font-size:12px; line-height:1.6; color:var(--muted); }
small { color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.more-records { align-self:flex-start; }
@media (max-width:640px) { .webhook-settings { gap:16px; } .webhook-save-bar { padding:12px 16px; flex-wrap:wrap; } .webhook-save-bar > .el-button { margin-left:auto; } }
</style>
