<template>
  <el-dropdown
      ref="dropdownRef"
      @visible-change="handleVisibleChange"
      :virtual-ref="triggerRef"
      :show-arrow="false"
      :popper-options="{
        modifiers: [{ name: 'offset', options: { offset: [0, 0] } }],
      }"
      virtual-triggering
      trigger="contextmenu"
      placement="bottom-start"
  >
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item v-if="email.code" @click="emit('copy-code', email.code)">
          <div class="right-dropdown-item">
            <Icon icon="solar:copy-linear" width="16" height="16" />
            <span>{{ t('copyCode') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-if="['email'].includes(type) && email.unread === EmailUnreadEnum.READ" @click="emit('unread', email.emailId)">
          <div class="right-dropdown-item">
            <Icon icon="solar:letter-unread-linear" width="16" height="16" />
            <span>{{ t('markAsUnread') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-else-if="['email'].includes(type) && email.unread === EmailUnreadEnum.UNREAD" @click="emit('read', email.emailId)">
          <div class="right-dropdown-item">
            <Icon icon="solar:letter-opened-linear" width="16" height="16" />
            <span>{{ t('markAsRead') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-if="['email', 'star'].includes(type)" @click="emit('reply', email)">
          <div class="right-dropdown-item">
            <Icon icon="solar:chat-round-line-linear" width="16" height="16" />
            <span>{{ t('reply') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-if="['email', 'send', 'star'].includes(type)" @click="emit('forward', email)">
          <div class="right-dropdown-item">
            <Icon icon="solar:plain-2-linear" width="16" height="16" />
            <span>{{ t('forward') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-if="['email', 'send', 'star'].includes(type)" @click="emit('star', email)">
          <div class="right-dropdown-item">
            <Icon icon="solar:star-linear" width="16" height="16" />
            <span>{{ t('star') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-if="type === 'all-email'" @click="emit('search', 'user', email.userEmail)">
          <div class="right-dropdown-item">
            <Icon icon="solar:magnifer-linear" width="16" height="16" />
            <span>{{ t('searchUser') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-if="type === 'all-email'" @click="emit('search', 'account', email.toEmail)">
          <div class="right-dropdown-item">
            <Icon icon="solar:magnifer-linear" width="16" height="16" />
            <span>{{ t('searchEmail') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item v-if="type === 'all-email'" @click="emit('search', 'name', email.name)">
          <div class="right-dropdown-item">
            <Icon icon="solar:magnifer-linear" width="16" height="16" />
            <span>{{ t('searchSender') }}</span>
          </div>
        </el-dropdown-item>

        <el-dropdown-item @click="emit('delete', email.emailId)">
          <div class="right-dropdown-item">
            <Icon icon="solar:trash-bin-trash-linear" width="16" height="16" />
            <span>{{ t('delete') }}</span>
          </div>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { ref } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import { EmailUnreadEnum } from '@/enums/email-enum.js';

const props = defineProps({
  type: String,
  email: {
    type: Object,
    default: () => ({})
  },
  triggerRef: Object
});

const emit = defineEmits([
  'visible-change',
  'copy-code',
  'read',
  'unread',
  'reply',
  'forward',
  'star',
  'search',
  'delete'
]);

const { t } = useI18n();
const dropdownRef = ref(null);

function handleVisibleChange(visible) {
  emit('visible-change', visible);
}

function handleOpen() {
  dropdownRef.value?.handleOpen();
}

function handleClose() {
  dropdownRef.value?.handleClose();
}

defineExpose({
  handleOpen,
  handleClose
});
</script>

<style lang="scss" scoped>
.right-dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
