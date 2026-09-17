<template>
  <el-dialog class="user-details-dialog" v-model="visible" :title="t('userDetails')">
    <div class="details" v-if="userDetails">
      <div v-if="!sendNumShow">
        <span class="details-item-title">{{ $t('tabSent') }}:</span>{{ userDetails.sendEmailCount }}
      </div>
      <div v-if="!accountNumShow">
        <span class="details-item-title">{{ $t('tabMailboxes') }}:</span>{{ userDetails.accountCount }}
      </div>
      <div v-if="!createTimeShow">
        <span class="details-item-title">{{ $t('tabRegisteredAt') }}:</span>{{ tzDayjs(userDetails.createTime).format('YYYY-MM-DD HH:mm') }}
      </div>
      <div v-if="!typeShow">
        <span class="details-item-title">{{ $t('perm') }}:</span>
        {{ userDetails.type === 0 ? t('admin') : t('user') }}
      </div>
      <div v-if="!statusShow">
        <span class="details-item-title">{{ $t('tabStatus') }}:</span>
        <el-tag disable-transitions v-if="userDetails.isDel === 1" type="info">{{ $t('deleted') }}</el-tag>
        <el-tag disable-transitions v-else-if="userDetails.status === 0" type="primary">{{ $t('active') }}</el-tag>
        <el-tag disable-transitions v-else-if="userDetails.status === 1" type="danger">{{ $t('banned') }}</el-tag>
      </div>
      <div>
        <span class="details-item-title">{{ $t('registrationIp') }}:</span>{{ userDetails.createIp || $t('unknown') }}
      </div>
      <div>
        <span class="details-item-title">{{ $t('recentIP') }}:</span>{{ userDetails.activeIp || $t('unknown') }}
      </div>
      <div>
        <span class="details-item-title">{{ $t('recentActivity') }}:</span>{{ userDetails.activeTime ? tzDayjs(userDetails.activeTime).format('YYYY-MM-DD') : $t('unknown') }}
      </div>
      <div>
        <span class="details-item-title">{{ $t('loginDevice') }}:</span>{{ userDetails.device || $t('unknown') }}
      </div>
      <div>
        <span class="details-item-title">{{ $t('loginSystem') }}:</span>{{ userDetails.os || $t('unknown') }}
      </div>
      <div>
        <span class="details-item-title">{{ $t('browserLogin') }}:</span>{{ userDetails.browser || $t('unknown') }}
      </div>
      <div class="send-limit-row">
        <span class="details-item-title">{{ $t('sendEmail') }}:</span>
        <span>{{ userDetails.sendCount }}/{{ userDetails.sendLimit || $t('unlimited') }}</span>
        <el-button size="small" style="margin-left: 10px" @click="handleResetSendCount" type="primary">
          {{ $t('reset') }}
        </el-button>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { tzDayjs } from '@/utils/day.js';
import { userRestSendCount } from '@/request/user.js';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  modelValue: Boolean,
  userDetails: {
    type: Object,
    default: () => ({})
  },
  sendNumShow: Boolean,
  accountNumShow: Boolean,
  createTimeShow: Boolean,
  typeShow: Boolean,
  statusShow: Boolean
});

const emit = defineEmits(['update:modelValue', 'reset-send-count']);
const { t } = useI18n();
const visible = ref(false);

watch(() => props.modelValue, (val) => {
  visible.value = val;
});

watch(visible, (val) => {
  emit('update:modelValue', val);
});

function handleResetSendCount() {
  if (!props.userDetails?.userId) return;
  ElMessageBox.confirm(t('reSendConfirm', { msg: props.userDetails.email }), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    await userRestSendCount(props.userDetails.userId);
    ElMessage({ message: t('reSuccessMsg'), type: 'success', plain: true });
    props.userDetails.sendCount = 0;
    emit('reset-send-count', props.userDetails);
  });
}
</script>

<style>
.user-details-dialog.el-dialog {
  width: 580px !important;
  border-radius: 14px;
}
@media (max-width: 600px) {
  .user-details-dialog.el-dialog {
    width: calc(100% - 32px) !important;
    margin-right: 16px !important;
    margin-left: 16px !important;
  }
}
</style>

<style lang="scss" scoped>
.details {
  padding: 0 10px 10px 10px;
  display: grid;
  gap: 12px;

  .details-item-title {
    white-space: pre;
    color: var(--secondary-text-color, var(--muted));
    font-weight: bold;
    padding-right: 10px;
  }

  .send-limit-row {
    display: flex;
    align-items: center;
  }
}
</style>
