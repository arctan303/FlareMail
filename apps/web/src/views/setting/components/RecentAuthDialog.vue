<template>
  <el-dialog
    :model-value="modelValue"
    :title="$t('reauthDialogTitle')"
    width="min(400px, calc(100vw - 32px))"
    class="arc-card recent-auth-dialog"
    append-to-body
    destroy-on-close
    :before-close="handleBeforeClose"
  >
    <div class="recent-auth-content">
      <i18n-t keypath="reauthDialogDesc" scope="global" tag="p" class="auth-description">
        <template #purpose>{{ purposeLabel }}</template>
        <template #duration>{{ durationLabel }}</template>
      </i18n-t>

      <div class="field-item">
        <label class="field-label" for="recent-auth-password">{{ $t('currentPassword') }}</label>
        <el-input
          id="recent-auth-password"
          ref="passwordInput"
          v-model="password"
          type="password"
          autocomplete="current-password"
          :placeholder="$t('currentPasswordPlaceholder')"
          show-password
          @input="handleInput"
          @keyup.enter="submit"
        />
        <p v-if="displayError" class="field-error" role="alert">{{ displayError }}</p>
      </div>

      <div class="dialog-actions">
        <el-button @click="cancel">{{ $t('cancel') }}</el-button>
        <el-button type="primary" class="arc-btn" :loading="loading" @click="submit">
          {{ $t('verifyAndContinue') }}
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  purpose: { type: String, default: '' },
  windowMinutes: { type: Number, default: 1440 },
  loading: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' }
})

const emit = defineEmits(['submit', 'cancel', 'clear-error'])

const purposeLabel = computed(() => props.purpose || t('recentAuthDefaultPurpose'))

const durationLabel = computed(() => {
  const minutes = props.windowMinutes
  if (minutes % 1440 === 0) return t('durationDays', { count: minutes / 1440 })
  if (minutes % 60 === 0) return t('durationHours', { count: minutes / 60 })
  return t('durationMinutes', { count: minutes })
})

const password = ref('')
const passwordInput = ref()
const localError = ref('')
const displayError = computed(() => localError.value || props.errorMessage)

watch(() => props.modelValue, async (visible) => {
  if (!visible) {
    password.value = ''
    localError.value = ''
    return
  }
  await nextTick()
  passwordInput.value?.focus()
})

function handleInput() {
  localError.value = ''
  emit('clear-error')
}

function submit() {
  if (props.loading) return
  if (!password.value) {
    localError.value = t('currentPasswordPlaceholder')
    passwordInput.value?.focus()
    return
  }
  emit('submit', password.value)
}

function cancel() {
  emit('cancel')
}

function handleBeforeClose(done) {
  emit('cancel')
  done()
}

async function clearAndFocus() {
  password.value = ''
  await nextTick()
  passwordInput.value?.focus()
}

defineExpose({ clearAndFocus })
</script>

<style lang="scss" scoped>
.recent-auth-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
}

.auth-description {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 500;
}

.field-error {
  margin: 0;
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}
</style>
