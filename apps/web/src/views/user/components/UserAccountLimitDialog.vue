<template>
  <el-dialog class="user-action-dialog" v-model="visible" :title="$t('setMailboxLimit')" @closed="handleClosed">
    <div class="dialog-box">
      <el-input-number v-model="accountLimit" :min="1" :max="999999" :placeholder="$t('mailboxLimitPlaceholder')" style="width: 100%;" />
      <div class="limit-hint">{{ $t('mailboxLimitHint') }}</div>
      <el-button class="btn" type="primary" :loading="loading" @click="handleSave">
        {{ $t('save') }}
      </el-button>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { userUpdateAccountLimit } from '@/request/user.js';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  modelValue: Boolean,
  userId: [Number, String],
  initialLimit: {
    type: Number,
    default: 10
  }
});

const emit = defineEmits(['update:modelValue', 'success']);
const { t } = useI18n();

const visible = ref(false);
const accountLimit = ref(10);
const loading = ref(false);

watch(() => props.modelValue, (val) => {
  visible.value = val;
  if (val) {
    accountLimit.value = props.initialLimit;
  }
});

watch(visible, (val) => {
  emit('update:modelValue', val);
});

function handleClosed() {
  accountLimit.value = 10;
}

async function handleSave() {
  loading.value = true;
  try {
    await userUpdateAccountLimit(props.userId, accountLimit.value);
    ElMessage.success(t('updateSuccess'));
    visible.value = false;
    emit('success', accountLimit.value);
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

  .limit-hint {
    font-size: 12px;
    color: var(--muted);
    line-height: 1.4;
  }

  .btn {
    width: 100%;
    margin-top: 5px;
  }
}
</style>
