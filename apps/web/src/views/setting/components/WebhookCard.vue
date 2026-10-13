<template>
  <section class="setting-card arc-card webhook-card" v-loading="busy">
    <h3 class="arc-serif-title">{{ t('webhook.title') }}</h3>
    <p class="hint">{{ t('webhook.description') }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-form label-position="top" :disabled="busy">
      <el-form-item :label="t('mailboxAddress')">
        <el-select v-model="accountId" @change="load" style="width: 100%">
          <el-option v-for="account in accounts" :key="account.accountId" :value="account.accountId" :label="account.email" />
        </el-select>
      </el-form-item>
      <template v-if="form">
        <el-form-item label="URL"><el-input v-model="form.url" placeholder="https://assistant.example.com/mail" maxlength="2048" /></el-form-item>
        <el-form-item :label="t('webhook.enabled')"><el-switch v-model="form.enabled" /></el-form-item>
        <el-form-item :label="t('webhook.senders')">
          <el-radio-group v-model="form.mode">
            <el-radio value="all">{{ t('webhook.all') }}</el-radio>
            <el-radio value="allowlist">{{ t('webhook.allowlist') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.mode === 'allowlist'" :label="t('webhook.addresses')"><el-input v-model="addresses" type="textarea" :rows="3" placeholder="owner@example.com" /></el-form-item>
        <p class="hint">{{ t('webhook.filterHint') }}</p>
        <el-form-item :label="t('webhook.secret')"><el-input v-model="newSecret" type="password" show-password autocomplete="new-password" :placeholder="t('webhook.secretHint')" maxlength="256" /></el-form-item>
        <div class="actions">
          <el-button type="primary" :disabled="!form.mode" @click="save">{{ t('save') }}</el-button>
          <el-button @click="load">{{ t('webhook.reload') }}</el-button>
          <el-button :disabled="!form.hasSecret" @click="act(() => rotateWebhookSecret(accountId, form.revision), true)">{{ t('webhook.rotate') }}</el-button>
          <el-button :disabled="!form.hasSecret" @click="act(() => testWebhook(accountId))">{{ t('webhook.test') }}</el-button>
          <el-button type="danger" plain :disabled="!form.hasSecret" @click="remove">{{ t('webhook.remove') }}</el-button>
        </div>
      </template>
    </el-form>
    <div v-if="revealedSecret" class="secret-result">
      <el-alert :title="t('webhook.secretOnce')" type="success" :closable="false" />
      <el-input :model-value="revealedSecret" readonly type="password" show-password :aria-label="t('webhook.secret')" />
    </div>
    <template v-if="form">
      <div class="delivery-title"><h4>{{ t('webhook.deliveries') }}</h4><el-button :disabled="busy" @click="refreshDeliveries">{{ t('webhook.reload') }}</el-button></div>
      <p class="hint">{{ t('webhook.deliveryHint') }}</p>
      <el-table :data="deliveries" :empty-text="t('webhook.empty')" style="width: 100%">
        <el-table-column :label="t('webhook.event')" min-width="180"><template #default="{ row }"><div>{{ row.event }}</div><small>{{ row.eventId }}</small></template></el-table-column>
        <el-table-column :label="t('webhook.status')" min-width="120"><template #default="{ row }">{{ t(`webhook.${row.status}`) }} · {{ row.attempts }}<div v-if="row.httpStatus">HTTP {{ row.httpStatus }}</div><small>{{ row.error }}</small></template></el-table-column>
        <el-table-column :label="t('action')" width="100"><template #default="{ row }"><el-button v-if="row.status === 'failed'" link :disabled="busy" @click="act(() => retryWebhook(accountId, row.eventId))">{{ t('webhook.retry') }}</el-button></template></el-table-column>
      </el-table>
      <el-button v-if="nextBefore" :disabled="busy" @click="more">{{ t('webhook.more') }}</el-button>
    </template>
  </section>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
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

<style scoped>
.webhook-card { padding: 24px; }
h3 { margin: 0 0 8px; }
.hint, small { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.hint { line-height: 1.6; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.actions :deep(.el-button) { margin: 0; }
.secret-result { display: grid; gap: 12px; margin-top: 20px; }
.delivery-title { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; }
@media (max-width: 767px) { .webhook-card { padding: 16px; } }
</style>
