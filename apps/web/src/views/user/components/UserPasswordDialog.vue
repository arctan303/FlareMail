<template>
  <el-dialog class="user-action-dialog" v-model="visible" :title="$t('changePassword')" @closed="handleClosed">
    <div class="dialog-box">
      <el-input v-model="password" type="password" :placeholder="$t('newPassword')" autocomplete="off" />
      <el-button class="btn" type="primary" :loading="loading" @click="handleSave">
        {{ $t('save') }}
      </el-button>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { userSetPwd } from '@/request/user.js';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  modelValue: Boolean,
  userId: [Number, String]
});

const emit = defineEmits(['update:modelValue', 'success']);
const { t } = useI18n();

const visible = ref(false);
const password = ref('');
const loading = ref(false);

watch(() => props.modelValue, (val) => {
  visible.value = val;
  if (!val) password.value = '';
});

watch(visible, (val) => {
  emit('update:modelValue', val);
});

function handleClosed() {
  password.value = '';
}

async function handleSave() {
  if (!password.value) {
    ElMessage.warning(t('newPassword'));
    return;
  }
  if (Array.from(password.value).length < 12) {
    ElMessage({ message: t('pwdMinLengthMsg'), type: 'error', plain: true });
    return;
  }
  loading.value = true;
  try {
    await userSetPwd({ userId: props.userId, password: password.value });
    ElMessage.success(t('updateSuccess'));
    visible.value = false;
    emit('success');
  } finally {
    loading.value = false;
  }
}
</script>

<style>
.user-action-dialog.el-dialog {
  width: 420px !important;
  border-radius: 14px;
}
@media (max-width: 480px) {
  .user-action-dialog.el-dialog {
    width: calc(100% - 32px) !important;
    margin-right: 16px !important;
    margin-left: 16px !important;
  }
}
</style>

<style lang="scss" scoped>
.dialog-box {
  display: flex;
  flex-direction: column;
  gap: 15px;

  .btn {
    width: 100%;
    margin-top: 5px;
  }
}
</style>
