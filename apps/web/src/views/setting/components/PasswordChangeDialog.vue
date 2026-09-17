<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :title="$t('changePassword')"
    width="400px"
    class="arc-card password-change-dialog"
    :close-on-click-modal="false"
  >
    <div class="update-pwd-dialog">
      <div class="field-item">
        <label class="field-label">{{ $t('newPasswordHint') }}</label>
        <el-input
          type="password"
          :placeholder="$t('newPassword')"
          v-model="form.password"
          autocomplete="new-password"
          show-password
          @keyup.enter="submitPwd"
        />
      </div>

      <div class="field-item">
        <label class="field-label">{{ $t('confirmNewPassword') }}</label>
        <el-input
          type="password"
          :placeholder="$t('confirmPassword')"
          v-model="form.newPwd"
          autocomplete="new-password"
          show-password
          @keyup.enter="submitPwd"
        />
      </div>

      <div class="dialog-actions">
        <el-button @click="$emit('update:modelValue', false)">{{ $t('cancel') }}</el-button>
        <el-button type="primary" class="arc-btn" :loading="setPwdLoading" @click="submitPwd">
          {{ $t('save') }}
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { resetPassword } from '@/request/my.js'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { setAuthenticatedSession } from '@/utils/session-state.js'
import { invalidateUserScopedStateAcrossTabs } from '@/utils/sensitive-state.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  runSensitive: { type: Function, required: true }
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()
const setPwdLoading = ref(false)
const form = reactive({
  password: '',
  newPwd: ''
})

watch(() => props.modelValue, (val) => {
  if (val) {
    form.password = ''
    form.newPwd = ''
  }
})

async function submitPwd() {
  if (setPwdLoading.value) return
  if (!form.password) {
    ElMessage({ message: t('emptyPwdMsg'), type: 'error', plain: true })
    return
  }
  if (Array.from(form.password).length < 12) {
    ElMessage({ message: t('pwdMinLengthMsg'), type: 'error', plain: true })
    return
  }
  if (form.password !== form.newPwd) {
    ElMessage({ message: t('confirmPwdFailMsg'), type: 'error', plain: true })
    return
  }

  setPwdLoading.value = true
  try {
    const result = await props.runSensitive(t('changePassword'), () => resetPassword(form.password, { noMsg: true }))
    if (result?.status !== 'completed') return

    ElMessage({ message: t('saveSuccessMsg'), type: 'success', plain: true })
    emit('update:modelValue', false)
    setAuthenticatedSession(false)
    invalidateUserScopedStateAcrossTabs()
    window.location.replace('/login')
  } catch (error) {
    if (Number(error?.code) !== 401) {
      ElMessage({
        message: Number(error?.code) === 428
          ? t('authStateExpiredMsg')
          : (error?.message || t('pwdChangeFailedMsg')),
        type: 'error',
        plain: true
      })
    }
  } finally {
    setPwdLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.update-pwd-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;

  .field-item {
    display: flex;
    flex-direction: column;
    gap: 6px;

    .field-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-strong);
    }
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 10px;
  }
}
</style>
