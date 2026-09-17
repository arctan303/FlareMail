<template>
  <div class="setting-card arc-card" v-loading="loading">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon"><Icon icon="solar:key-linear" width="20" height="20" /></div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysConfirmTitle') }}</h3>
          <p class="card-desc">{{ $t('sysConfirmDesc') }}</p>
        </div>
      </div>
      <div v-if="baseline" class="header-right-group">
        <span :class="['status-pill', baseline.enabled ? 'ready' : 'missing']">{{ baseline.enabled ? $t('enabled') : $t('disabled') }}</span>
      </div>
    </div>
    <div class="card-body">
      <template v-if="baseline">
        <div class="switch-item">
          <div class="switch-meta">
            <span class="switch-title">{{ $t('sysConfirmSwitch') }}</span>
            <span class="switch-desc">{{ $t('sysConfirmSwitchDesc') }}</span>
          </div>
          <el-switch v-model="enabled" :aria-label="$t('sysConfirmSwitchAria')" :disabled="saving" />
        </div>

        <div class="field-item">
          <label class="field-label" for="confirmation-duration">{{ $t('sysConfirmDurationLabel') }}</label>
          <div class="duration-controls">
            <el-input-number id="confirmation-duration" v-model="amount" :min="1" :max="10080 / unit" :precision="0" :disabled="saving" class="duration-number" />
            <el-select v-model="unit" :aria-label="$t('sysConfirmUnitAria')" :disabled="saving" class="duration-select">
              <el-option :label="$t('sysUnitMinutes')" :value="1" /><el-option :label="$t('sysUnitHours')" :value="60" /><el-option :label="$t('sysUnitDays')" :value="1440" />
            </el-select>
            <el-button size="small" :disabled="saving" @click="amount = 1; unit = 1440">{{ $t('sysConfirmSetDay') }}</el-button>
            <el-button size="small" :disabled="saving" @click="amount = 30; unit = 1">{{ $t('sysConfirmSet30Min') }}</el-button>
          </div>
          <span class="field-hint">{{ $t('sysConfirmHint') }}</span>
        </div>

        <details class="help-details"><summary>{{ $t('sysConfirmScopeSummary') }}</summary>
          <Icon icon="solar:shield-warning-linear" width="16" height="16" class="callout-icon" />
          <div class="callout-content">
            <p><strong>{{ $t('sysConfirmScopeTitle') }}</strong>{{ $t('sysConfirmScopeBody') }}</p>
            <p>{{ $t('sysConfirmScopeDetail') }}</p>
          </div>
        </details>
      </template>
      <p v-if="!baseline && error" class="field-error" role="alert">{{ error }} <el-button link @click="load">{{ $t('sysReload') }}</el-button></p>
    </div>
    <SettingsSaveBar :dirty="Boolean(dirty)" :saving="saving" :disabled="!baseline || !valid" :error="error" :label="$t('sysConfirmSave')" @save="save" @reset="resetDraft" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingsSaveBar from './SettingsSaveBar.vue'
import { Icon } from '@iconify/vue'
import { ElMessage } from 'element-plus'
import { confirmationSettings, confirmationSettingsSet } from '@/request/setting.js'

const props = defineProps({ runSensitive: { type: Function, required: true } })
const emit = defineEmits(['dirty-change', 'busy'])
const { t } = useI18n()
const baseline = ref(null)
const enabled = ref(false)
const amount = ref(1)
const unit = ref(1440)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const minutes = computed(() => amount.value * unit.value)
const valid = computed(() => Number.isInteger(amount.value) && amount.value >= 1 && Number.isInteger(minutes.value) && minutes.value >= 1 && minutes.value <= 10080)
const dirty = computed(() => baseline.value && (enabled.value !== baseline.value.enabled || minutes.value !== baseline.value.windowMinutes))

watch(saving, value => emit('busy', value))
watch(dirty, value => emit('dirty-change', Boolean(value)), { immediate: true })
function resetDraft() { if (baseline.value && !saving.value) { apply(baseline.value); error.value = '' } }

function apply(value) {
  baseline.value = value
  enabled.value = value.enabled
  unit.value = value.windowMinutes % 1440 === 0 ? 1440 : value.windowMinutes % 60 === 0 ? 60 : 1
  amount.value = value.windowMinutes / unit.value
}

async function load() {
  if (loading.value || saving.value) return
  loading.value = true
  error.value = ''
  try { apply(await confirmationSettings()) }
  catch (e) { error.value = e?.message || t('sysConfirmLoadFailed') }
  finally { loading.value = false }
}

async function save() {
  if (saving.value || !valid.value || !dirty.value) return
  saving.value = true
  error.value = ''
  const body = { enabled: enabled.value, windowMinutes: minutes.value, revision: baseline.value.revision }
  try {
    const result = await props.runSensitive(t('sysConfirmPurpose'), () => confirmationSettingsSet(body))
    if (result?.status !== 'completed') return
    apply(result.value)
    ElMessage({ message: t('sysConfirmSaved'), type: 'success', plain: true })
  } catch (e) {
    error.value = Number(e?.code) === 409 ? t('sysConfirmConflict') : e?.message || t('saveRetryMsg')
  } finally { saving.value = false }
}

onMounted(load)
</script>

<style scoped lang="scss">
@use './card' as *;

.duration-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;

  .duration-number {
    max-width: 140px;
  }

  .duration-select {
    width: 96px;
  }
}

.field-error {
  color: var(--el-color-danger);
  font-size: 13px;
  margin: 0;
}
</style>
