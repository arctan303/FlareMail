<template>
  <div class="mail-operations-stack" :aria-busy="busy">
    <section class="setting-card arc-card" aria-labelledby="mail-dns-title">
      <div class="card-header">
        <div class="header-left-group">
          <div class="header-icon"><Icon icon="solar:global-linear" width="20" height="20" aria-hidden="true" /></div>
          <div>
            <h3 id="mail-dns-title" class="card-title">{{ t('capabilities.dnsTitle') }}</h3>
            <p class="card-desc">{{ t('capabilities.dnsDesc') }}</p>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="field-item">
          <label for="mail-check-domain" class="field-label">{{ t('capabilities.domain') }}</label>
          <el-select id="mail-check-domain" v-model="domain" :disabled="busy" class="input-standard">
            <el-option v-for="item in domains" :key="item" :label="item" :value="item" />
          </el-select>
        </div>
        <details class="help-details">
          <summary>{{ t('capabilities.dkimOptions') }}</summary>
          <div class="field-item">
            <label for="mail-dkim-selector" class="field-label">{{ t('capabilities.selector') }}</label>
            <el-input id="mail-dkim-selector" v-model="selector" :disabled="busy" maxlength="63" class="input-standard" />
            <p class="field-hint">{{ t('capabilities.selectorHint') }}</p>
          </div>
        </details>
        <div v-if="inspection" class="inspection" aria-live="polite">
          <div class="inspection-heading">
            <strong>{{ inspection.domain }}</strong>
            <span class="status-pill" :class="inspection.enabled ? 'ready' : 'missing'">{{ t(inspection.enabled ? 'capabilities.enabled' : 'capabilities.disabled') }}</span>
          </div>
          <div class="dns-checks">
            <div v-for="(check, key) in inspection.checks" :key="key" class="dns-check">
              <div class="dns-check-heading">
                <span class="field-label">{{ key.toUpperCase() }}</span>
                <span class="status-pill" :class="check.status === 'found' ? 'ready' : 'missing'">{{ t('capabilities.' + check.status) }}</span>
              </div>
              <details v-if="check.records.length" class="help-details">
                <summary>{{ t('capabilities.showRecords') }}</summary>
                <pre>{{ check.records.join('\n') }}</pre>
              </details>
            </div>
          </div>
          <dl class="configuration-list">
            <div><dt>{{ t('capabilities.provider') }}</dt><dd>{{ inspection.provider }}</dd></div>
            <div><dt>{{ t('capabilities.credentials') }}</dt><dd>{{ t(inspection.credentialsConfigured ? 'capabilities.configured' : 'capabilities.notConfigured') }}</dd></div>
            <div><dt>{{ t('capabilities.binding') }}</dt><dd>{{ t(inspection.cloudflareBound ? 'capabilities.configured' : 'capabilities.notConfigured') }}</dd></div>
          </dl>
        </div>
        <p class="field-hint">{{ t('capabilities.routingHint') }}</p>
        <p v-if="feedbackSection === 'dns' && error" class="feedback" role="alert">{{ error }}</p>
        <div class="save-row">
          <el-button :disabled="busy || !domain" :loading="busy && feedbackSection === 'dns'" class="operation-button" @click="run(async () => { inspection = await inspectMail(domain, selector) }, 'dns')">
            <Icon icon="solar:magnifer-linear" width="16" height="16" aria-hidden="true" />
            {{ t('capabilities.inspect') }}
          </el-button>
        </div>
      </div>
    </section>

    <section class="setting-card arc-card" aria-labelledby="mail-test-title">
      <div class="card-header">
        <div class="header-left-group">
          <div class="header-icon"><Icon icon="solar:letter-linear" width="20" height="20" aria-hidden="true" /></div>
          <div>
            <h3 id="mail-test-title" class="card-title">{{ t('capabilities.flowTitle') }}</h3>
            <p class="card-desc">{{ t('capabilities.flowDesc') }}</p>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div v-if="accountLoadError" class="load-error">
          <p class="feedback" role="alert">{{ accountLoadError }}</p>
          <el-button text :disabled="busy" class="operation-button" @click="load">
            <Icon icon="solar:refresh-circle-linear" width="16" height="16" aria-hidden="true" />
            {{ t('capabilities.refresh') }}
          </el-button>
        </div>
        <div class="field-item">
          <label for="mail-test-account" class="field-label">{{ t('capabilities.testMailbox') }}</label>
          <el-select id="mail-test-account" v-model="accountId" :disabled="busy" class="input-standard">
            <el-option v-for="item in accounts" :key="item.accountId" :label="item.email" :value="item.accountId" />
          </el-select>
        </div>
        <div class="test-section">
          <h4 class="form-subsection-title">{{ t('capabilities.sendSection') }}</h4>
          <div class="field-item">
            <label for="mail-test-recipient" class="field-label">{{ t('capabilities.testTo') }}</label>
            <el-input id="mail-test-recipient" v-model="to" type="email" :disabled="busy" class="input-standard" />
            <p class="field-hint">{{ t('capabilities.sendHint') }}</p>
          </div>
          <div class="operation-actions">
            <el-button :disabled="busy || !accountId || !to" class="operation-button" @click="sendTest">
              <Icon icon="solar:plain-2-linear" width="16" height="16" aria-hidden="true" />
              {{ t('capabilities.sendTest') }}
            </el-button>
          </div>
        </div>
        <div class="form-subsection">
          <h4 class="form-subsection-title">{{ t('capabilities.receiveSection') }}</h4>
          <p class="field-hint">{{ t('capabilities.receiveTestDesc') }}</p>
          <div class="operation-actions">
            <el-button :disabled="busy || !accountId" class="operation-button" @click="run(async () => { probe = await startReceiveTest(accountId); receiveResult = null }, 'test')">
              <Icon icon="solar:inbox-in-linear" width="16" height="16" aria-hidden="true" />
              {{ t('capabilities.receiveTest') }}
            </el-button>
          </div>
          <div v-if="probe" class="probe-instructions">
            <p class="field-hint">{{ t('capabilities.receiveHint', { email: probe.email }) }}</p>
            <div class="code-snippet-row"><code class="code-text">{{ probe.subject }}</code></div>
            <div class="operation-actions">
              <el-button :disabled="busy" class="operation-button" @click="run(async () => { receiveResult = await checkReceiveTest(probe.id) }, 'test')">
                <Icon icon="solar:refresh-circle-linear" width="16" height="16" aria-hidden="true" />
                {{ t('capabilities.checkReceive') }}
              </el-button>
            </div>
            <p v-if="receiveResult" class="field-hint" role="status">{{ t(receiveResult.received ? 'capabilities.received' : 'capabilities.notReceived') }}</p>
          </div>
        </div>
        <p v-if="feedbackSection === 'test' && error" class="feedback" role="alert">{{ error }}</p>
        <p v-if="feedbackSection === 'test' && message" class="field-hint" role="status">{{ message }}</p>
      </div>
    </section>

    <section class="setting-card arc-card" aria-labelledby="mail-delivery-title">
      <div class="card-header">
        <div class="header-left-group">
          <div class="header-icon"><Icon icon="solar:history-linear" width="20" height="20" aria-hidden="true" /></div>
          <div>
            <h3 id="mail-delivery-title" class="card-title">{{ t('capabilities.deliveryTitle') }}</h3>
            <p class="card-desc">{{ t('capabilities.deliveryDesc') }}</p>
          </div>
        </div>
        <el-button text :disabled="busy" class="operation-button" @click="load">
          <Icon icon="solar:refresh-circle-linear" width="16" height="16" aria-hidden="true" />
          {{ t('capabilities.refresh') }}
        </el-button>
      </div>
      <div class="card-body">
        <p v-if="deliveryLoadError" class="feedback" role="alert">{{ deliveryLoadError }}</p>
        <template v-if="config">
          <div class="field-item">
            <label for="mail-delivery-url" class="field-label">{{ t('capabilities.webhookUrl') }}</label>
            <el-input id="mail-delivery-url" :model-value="config.webhookUrl" readonly class="input-standard" />
          </div>
          <details class="help-details">
            <summary>{{ t('capabilities.deliverySetup') }}</summary>
            <p>{{ t('capabilities.deliveryHint') }}</p>
          </details>
          <div class="field-item">
            <div class="secret-heading">
              <label for="mail-delivery-secret" class="field-label">{{ t('capabilities.signingSecret') }}</label>
              <span class="status-pill" :class="config.secretConfigured ? 'ready' : 'missing'">{{ t(config.secretConfigured ? 'capabilities.configured' : 'capabilities.notConfigured') }}</span>
            </div>
            <el-input id="mail-delivery-secret" v-model="secret" type="password" show-password :disabled="busy" :placeholder="t('capabilities.keepSecret')" class="input-standard" />
            <p class="field-hint">{{ t('capabilities.secretHint') }}</p>
          </div>
        </template>
        <p v-if="feedbackSection === 'delivery' && error" class="feedback" role="alert">{{ error }}</p>
        <p v-if="feedbackSection === 'delivery' && message" class="field-hint" role="status">{{ message }}</p>
        <div v-if="config" class="save-row">
          <el-button :disabled="busy || !config.secretConfigured" type="danger" plain class="operation-button" @click="saveSecret(true)">
            <Icon icon="solar:trash-bin-trash-linear" width="16" height="16" aria-hidden="true" />
            {{ t('capabilities.clearSecret') }}
          </el-button>
          <el-button :disabled="busy || !secret" type="primary" class="operation-button" @click="saveSecret(false)">
            <Icon icon="solar:diskette-linear" width="16" height="16" aria-hidden="true" />
            {{ t('capabilities.save') }}
          </el-button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { accountList } from '@/request/index.js'
import { deliveryConfig, saveDeliveryConfig, inspectMail, testMailSend, startReceiveTest, checkReceiveTest } from '@/request/mail-operations.js'

const props = defineProps({ domains: { type: Array, default: () => [] }, runSensitive: { type: Function, required: true } })
const emit = defineEmits(['busy', 'dirty-change'])
const { t } = useI18n()
const domain = ref(''), selector = ref('resend'), accounts = ref([]), accountId = ref(null), to = ref(''), inspection = ref(null), probe = ref(null), receiveResult = ref(null), config = ref(null), secret = ref(''), busy = ref(false), error = ref(''), message = ref(''), feedbackSection = ref('delivery')
const accountLoadError = ref(''), deliveryLoadError = ref('')

watch(() => props.domains, list => { if (!list.includes(domain.value)) domain.value = list[0] || '' }, { immediate: true })
watch(secret, value => emit('dirty-change', !!value))
watch(accountId, () => { probe.value = null; receiveResult.value = null })
watch([domain, selector], () => { inspection.value = null })

async function run(action, section = 'delivery') {
  if (busy.value) return
  busy.value = true
  emit('busy', true)
  feedbackSection.value = section
  error.value = ''
  message.value = ''
  try { await action() }
  catch (failure) { error.value = failure?.message || t('requestFailedMsg') }
  finally { busy.value = false; emit('busy', false) }
}

async function load() {
  await run(async () => {
    accountLoadError.value = ''
    deliveryLoadError.value = ''
    const result = await Promise.allSettled([deliveryConfig(), accountList(0, 100)])
    if (result[0].status === 'fulfilled') config.value = result[0].value
    else deliveryLoadError.value = result[0].reason?.message || t('requestFailedMsg')
    if (result[1].status === 'fulfilled') {
      accounts.value = result[1].value
      if (!accounts.value.some(a => a.accountId === accountId.value)) accountId.value = accounts.value[0]?.accountId || null
    } else accountLoadError.value = result[1].reason?.message || t('requestFailedMsg')
  })
}

async function sendTest() {
  await run(async () => {
    const id = crypto.randomUUID()
    const result = await props.runSensitive(t('capabilities.sendTest'), () => testMailSend({ accountId: accountId.value, to: to.value, requestId: id }))
    if (result?.status === 'completed') message.value = t('capabilities.accepted')
  }, 'test')
}

async function saveSecret(clear) {
  await run(async () => {
    const result = await props.runSensitive(t('capabilities.save'), () => saveDeliveryConfig({ revision: config.value.revision, secretAction: clear ? 'clear' : 'replace', ...(!clear ? { secret: secret.value } : {}) }))
    if (result?.status === 'completed') {
      config.value = result.value
      secret.value = ''
      message.value = t('capabilities.saved')
    }
  })
}

onMounted(load)
</script>

<style scoped lang="scss">
@use './card' as *;

.mail-operations-stack { display:flex; flex-direction:column; gap:24px; min-width:0; }
.operation-button { min-height:36px; }
.operation-button :deep(> span) { display:inline-flex; align-items:center; justify-content:center; gap:6px; }
.operation-button :deep(svg) { flex-shrink:0; }
.operation-actions { display:flex; flex-wrap:wrap; gap:10px; }
.load-error { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; }
.test-section, .probe-instructions { display:flex; flex-direction:column; gap:14px; min-width:0; }
.probe-instructions { max-width:600px; }
.inspection { display:flex; flex-direction:column; gap:16px; min-width:0; font-size:13px; }
.inspection-heading, .secret-heading { display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-width:0; overflow-wrap:anywhere; }
.dns-checks { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:0 20px; max-width:600px; }
.dns-check { min-width:0; padding:10px 0; border-bottom:1px solid var(--line); }
.dns-check-heading { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; }
.dns-check .help-details { margin-top:6px; }
.configuration-list { display:flex; flex-direction:column; gap:8px; margin:0; max-width:600px; font-size:12px; line-height:1.6; }
.configuration-list > div { display:flex; flex-wrap:wrap; gap:4px 12px; }
.configuration-list dt { color:var(--muted); }
.configuration-list dd { margin:0; color:var(--text); }
pre { margin:0; padding:10px 12px; border-radius:6px; background:var(--paper-soft); white-space:pre-wrap; overflow-wrap:anywhere; max-height:150px; overflow:auto; font-size:12px; line-height:1.6; }

@container (max-width:560px) { .dns-checks { grid-template-columns:minmax(0, 1fr); } }
@media (max-width:640px) { .mail-operations-stack { gap:20px; } }
</style>
