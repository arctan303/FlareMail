<template>
  <el-dialog class="user-add-dialog" v-model="visible" :title="$t('addUser')" @closed="resetForm">
    <div class="container">
      <el-input v-model="form.email" type="text" :placeholder="$t('emailAccount')" autocomplete="off">
        <template #append>
          <div class="suffix-select-wrapper" @click.stop="openSelect">
            <el-select
              ref="mySelect"
              v-model="form.suffix"
              :placeholder="$t('select')"
              class="select-hidden"
            >
              <el-option
                v-for="item in domainList"
                :key="item"
                :label="item"
                :value="item"
              />
            </el-select>
            <div class="suffix-trigger">
              <span>{{ form.suffix }}</span>
              <Icon class="setting-icon" icon="mingcute:down-small-fill" width="20" height="20" />
            </div>
          </div>
        </template>
      </el-input>
      <el-input type="password" v-model="form.password" :placeholder="$t('password')" />
      <el-button class="btn" type="primary" @click="handleSubmit" :loading="loading">
        {{ $t('add') }}
      </el-button>
    </div>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { userAdd } from '@/request/user.js';
import { isEmail } from '@/utils/verify-utils.js';
import { ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  modelValue: Boolean,
  domainList: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['update:modelValue', 'success']);
const { t } = useI18n();

const visible = ref(false);
const loading = ref(false);
const mySelect = ref(null);

const form = reactive({
  email: '',
  suffix: '',
  password: ''
});

watch(() => props.modelValue, (val) => {
  visible.value = val;
  if (val && !form.suffix && props.domainList?.length) {
    form.suffix = props.domainList[0];
  }
});

watch(visible, (val) => {
  emit('update:modelValue', val);
});

function openSelect() {
  mySelect.value?.toggleMenu();
}

function resetForm() {
  form.email = '';
  form.suffix = props.domainList?.[0] || '';
  form.password = '';
}

async function handleSubmit() {
  if (!form.email) {
    ElMessage({ message: t('emptyEmailMsg'), type: 'error', plain: true });
    return;
  }

  const input = form.email.trim().toLowerCase();
  const email = input.includes('@') ? input : input + form.suffix;
  if (!isEmail(email) || !props.domainList.includes(`@${email.split('@')[1]}`)) {
    ElMessage({ message: t('notEmailMsg'), type: 'error', plain: true });
    return;
  }

  if (!form.password) {
    ElMessage({ message: t('emptyPwdMsg'), type: 'error', plain: true });
    return;
  }

  if (Array.from(form.password).length < 12) {
    ElMessage({ message: t('pwdMinLengthMsg'), type: 'error', plain: true });
    return;
  }

  loading.value = true;
  try {
    await userAdd({ ...form, email });
    ElMessage({ message: t('addSuccessMsg'), type: 'success', plain: true });
    visible.value = false;
    emit('success');
  } finally {
    loading.value = false;
  }
}
</script>

<style>
.user-add-dialog.el-dialog {
  width: 420px !important;
  border-radius: 14px;
}
@media (max-width: 480px) {
  .user-add-dialog.el-dialog {
    width: calc(100% - 32px) !important;
    margin-right: 16px !important;
    margin-left: 16px !important;
  }
}
</style>

<style lang="scss" scoped>
.container {
  display: flex;
  flex-direction: column;
  gap: 15px;

  .btn {
    width: 100%;
    margin-top: 5px;
  }
}

.suffix-select-wrapper {
  display: flex;
  align-items: center;
  position: relative;
  cursor: pointer;
}

.select-hidden {
  position: absolute;
  right: 0;
  top: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
}

.suffix-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  font-size: 13px;
  color: var(--text);

  .setting-icon {
    position: relative;
    top: 1px;
    color: var(--muted);
  }
}
</style>
