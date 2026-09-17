<template>
  <el-dialog class="user-accounts-dialog" v-model="visible" :title="t('userAccount')" @closed="handleClosed">
    <div class="account-add-row">
      <el-input v-model="accountEmail" :placeholder="$t('accountEmailPlaceholder')" @keyup.enter="handleAddAccount">
        <template #append>
          <el-select v-model="accountSuffix" class="select" :placeholder="$t('select')" style="width: 130px;">
            <el-option v-for="item in domainList" :key="item" :label="item" :value="item" />
          </el-select>
        </template>
      </el-input>
      <el-button type="primary" :loading="accountAdding" @click="handleAddAccount">{{ t('add') }}</el-button>
    </div>
    <el-table
      :data="accountList"
      style="height: 480px; width: 100%;"
      v-loading="accountLoading"
      element-loading-background="transparent"
      :empty-text="accountLoading ? '' : null"
    >
      <el-table-column property="email" :label="t('emailAccount')" min-width="160">
        <template #default="props">
          <div class="email-row">{{ props.row.email }}</div>
        </template>
      </el-table-column>
      <el-table-column property="name" :label="$t('senderNameColumn')" min-width="140">
        <template #default="props">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span>{{ props.row.name || (props.row.email ? props.row.email.split('@')[0] : '') }}</span>
            <el-button size="small" type="primary" link @click="editUserAccountName(props.row)">
              <Icon icon="ic:outline-edit" width="14" height="14" />
            </el-button>
          </div>
        </template>
      </el-table-column>
      <el-table-column property="address" :label="t('tabStatus')" :width="locale === 'en' ? 75 : 65">
        <template #default="props">
          <el-tag type="primary" disable-transitions v-if="props.row.isDel === 0">{{ $t('active') }}</el-tag>
          <el-tag type="info" disable-transitions v-if="props.row.isDel === 1">{{ $t('deleted') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('action')" :width="locale === 'en' ? 75 : 65">
        <template #default="props">
          <el-dropdown trigger="click">
            <el-button type="primary" size="small">{{ t('action') }}</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="editUserAccountName(props.row)">{{ $t('changeNickname') }}</el-dropdown-item>
                <el-dropdown-item @click="deleteAccount(props.row)">{{ $t('delete') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>
    <div class="account-pagination">
      <el-pagination
        :disabled="accountLoading"
        background
        layout="prev, pager, next"
        :pager-count="3"
        :total="accountParams.total"
        @current-change="accountCurChange"
      />
    </div>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { userAllAccount, userDeleteAccount, userAddAccount } from '@/request/user.js';
import { accountSetName } from '@/request/account.js';
import { isEmail } from '@/utils/verify-utils.js';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  modelValue: Boolean,
  userId: [Number, String],
  domainList: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['update:modelValue', 'change']);
const { t, locale } = useI18n();

const visible = ref(false);
const accountList = reactive([]);
const accountEmail = ref('');
const accountSuffix = ref('');
const accountAdding = ref(false);
const accountLoading = ref(false);

const accountParams = reactive({
  size: 10,
  num: 1,
  total: 0
});

watch(() => props.modelValue, (val) => {
  visible.value = val;
  if (val) {
    if (!accountSuffix.value && props.domainList?.length) {
      accountSuffix.value = props.domainList[0];
    }
    accountParams.num = 1;
    fetchAccountList();
  }
});

watch(visible, (val) => {
  emit('update:modelValue', val);
});

function handleClosed() {
  accountList.length = 0;
  accountEmail.value = '';
}

function accountCurChange(num) {
  accountParams.num = num;
  fetchAccountList();
}

async function fetchAccountList() {
  if (!props.userId) return;
  accountLoading.value = true;
  try {
    const data = await userAllAccount(props.userId, accountParams.num, accountParams.size);
    accountList.length = 0;
    accountList.push(...data.list);
    accountParams.total = data.total;
  } finally {
    accountLoading.value = false;
  }
}

function editUserAccountName(account) {
  ElMessageBox.prompt(t('nicknamePrompt'), t('changeUserName'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    inputValue: account.name || (account.email ? account.email.split('@')[0] : ''),
    inputPattern: /\S+/,
    inputErrorMessage: t('nicknameRequired')
  }).then(async ({ value }) => {
    const name = value.trim();
    if (!name) return;
    try {
      await accountSetName(account.accountId, name);
      account.name = name;
      ElMessage({ message: t('senderNameSavedMsg'), type: 'success', plain: true });
    } catch (e) {
      console.error(e);
    }
  });
}

function deleteAccount(account) {
  ElMessageBox.confirm(t('delConfirm', { msg: account.email }), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    await userDeleteAccount(account.accountId);
    ElMessage({ message: t('delSuccessMsg'), type: 'success', plain: true });
    fetchAccountList();
    emit('change');
  });
}

async function handleAddAccount() {
  const input = accountEmail.value.trim().toLowerCase();
  const email = input.includes('@') ? input : input + accountSuffix.value;
  if (!isEmail(email) || !props.domainList.includes(`@${email.split('@')[1]}`)) {
    ElMessage({ message: t('notEmailMsg'), type: 'error', plain: true });
    return;
  }
  accountAdding.value = true;
  try {
    await userAddAccount(props.userId, email);
    accountEmail.value = '';
    fetchAccountList();
    emit('change');
  } finally {
    accountAdding.value = false;
  }
}
</script>

<style>
.user-accounts-dialog.el-dialog {
  width: 580px !important;
  border-radius: 14px;
}
@media (max-width: 600px) {
  .user-accounts-dialog.el-dialog {
    width: calc(100% - 32px) !important;
    margin-right: 16px !important;
    margin-left: 16px !important;
  }
}
</style>

<style lang="scss" scoped>
.account-add-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  margin-bottom: 12px;
}

.email-row {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-pagination {
  display: flex;
  justify-content: flex-end;
  width: 100%;
  margin-top: 10px;
}
</style>
