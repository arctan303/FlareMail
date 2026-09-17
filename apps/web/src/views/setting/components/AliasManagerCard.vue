<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">
          <Icon icon="solar:mailbox-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('aliasCardTitle') }}</h3>
          <p class="card-desc">{{ $t('aliasCardDesc') }}</p>
        </div>
      </div>
    </div>
    <div class="card-body">
      <!-- 添加别名表单 -->
      <div class="inline-form add-alias-row">
        <el-input v-model="addForm.localPart" :placeholder="$t('aliasPrefixPlaceholder')" class="alias-input" @keyup.enter="addAccount">
          <template #append>
            <el-select v-model="addForm.suffix" style="width: 145px">
              <el-option :label="item" :value="item" v-for="item in domainList" :key="item"/>
            </el-select>
          </template>
        </el-input>
        <el-button type="primary" class="arc-btn add-btn" :loading="addLoading" @click="addAccount">
          <Icon icon="solar:add-circle-linear" width="16" height="16" style="margin-right: 4px;" />
          {{ $t('addAlias') }}
        </el-button>
      </div>

      <!-- 邮箱列表与昵称配置 -->
      <div class="alias-table-wrapper" v-loading="listLoading">
        <el-table :data="accounts" style="width: 100%" class="alias-table" :empty-text="$t('noMailboxYet')">
          <el-table-column prop="email" :label="$t('mailboxAddress')" min-width="210">
            <template #default="{ row }">
              <div class="email-col">
                <span class="email-text">{{ row.email }}</span>
                <button class="copy-email-btn" :title="$t('copyMailbox')" @click="copyEmail(row.email)">
                  <Icon icon="solar:copy-linear" width="13" height="13" />
                </button>
              </div>
            </template>
          </el-table-column>

          <el-table-column :label="$t('senderNameColumn')" min-width="180">
            <template #default="{ row }">
              <template v-if="editingId === row.accountId">
                <div class="inline-edit">
                  <el-input
                    v-model="editName"
                    size="small"
                    style="width: 140px;"
                    :placeholder="$t('namePlaceholder')"
                    @keyup.enter="saveName(row)"
                    ref="nameInputRef"
                  />
                  <el-button size="small" type="primary" link @click="saveName(row)">{{ $t('save') }}</el-button>
                  <el-button size="small" link @click="editingId = null">{{ $t('cancel') }}</el-button>
                </div>
              </template>
              <template v-else>
                <div class="name-display" @click="startEdit(row)">
                  <span class="name-val">{{ row.name || emailPrefix(row.email) }}</span>
                  <span class="edit-hint">
                    <Icon icon="solar:pen-new-square-linear" width="14" height="14" />
                    {{ $t('change') }}
                  </span>
                </div>
              </template>
            </template>
          </el-table-column>

          <el-table-column :label="$t('action')" min-width="210" align="right">
            <template #default="{ row, $index }">
              <div class="action-col">
                <span v-if="isPrimary(row)" class="default-badge">{{ $t('primaryMailbox') }}</span>
                <template v-else>
                  <el-button
                    v-if="isAdminUser"
                    size="small"
                    type="warning"
                    link
                    class="action-link primary-link"
                    :loading="migratingEmail === row.email"
                    @click="promoteToPrimary(row)"
                  >
                    {{ $t('setAsPrimary') }}
                  </el-button>

                  <el-button
                    size="small"
                    type="primary"
                    link
                    class="action-link"
                    @click="pinAccount(row, $index)"
                  >
                    {{ $t('pin') }}
                  </el-button>

                  <el-popconfirm
                    :title="$t('deleteAliasConfirmShort')"
                    :confirm-button-text="$t('delete')"
                    :cancel-button-text="$t('cancel')"
                    confirm-button-type="danger"
                    @confirm="delAccount(row, $index)"
                  >
                    <template #reference>
                      <el-button size="small" type="danger" link class="action-link del-link">{{ $t('delete') }}</el-button>
                    </template>
                  </el-popconfirm>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, computed, watch, onMounted } from 'vue'
import { Icon } from "@iconify/vue"
import { useUserStore } from "@/store/user.js"
import { accountAdd, accountList, accountSetName, accountDelete, accountSetAsTop } from "@/request/account.js"
import { migratePrimaryEmail } from "@/request/setting.js"
import { isEmail } from "@/utils/verify-utils.js"
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from "vue-i18n"
import { setAuthenticatedSession } from '@/utils/session-state.js'
import { invalidateUserScopedStateAcrossTabs } from '@/utils/sensitive-state.js'

const props = defineProps({
  runSensitive: {
    type: Function,
    default: null
  }
})

const { t } = useI18n()
const userStore = useUserStore()
const isAdminUser = computed(() => userStore.user?.type === 0 || userStore.user?.permKeys?.includes('*'))
const migratingEmail = ref('')

const domainList = computed(() => userStore.user.domainList || [])
const addForm = reactive({
  localPart: '',
  suffix: domainList.value.length > 0 ? domainList.value[0] : ''
})
const addLoading = ref(false)
const listLoading = ref(false)
const accounts = ref([])
const editingId = ref(null)
const editName = ref('')

function isPrimary(row) {
  return row.email?.toLowerCase() === userStore.user?.email?.toLowerCase()
}

watch(() => domainList.value, (list) => {
  if (list.length > 0 && !addForm.suffix) {
    addForm.suffix = list[0]
  }
})

function emailPrefix(email) {
  return email ? email.split('@')[0] : ''
}

function copyEmail(email) {
  if (!email) return
  navigator.clipboard.writeText(email).then(() => {
    ElMessage({ message: t('mailboxCopiedMsg', { email }), type: 'success', plain: true, duration: 2000 })
  }).catch(() => {
    ElMessage({ message: t('copyFailedManualMsg'), type: 'warning', plain: true })
  })
}

async function fetchAccounts() {
  listLoading.value = true
  try {
    const res = await accountList(0, 100)
    if (res && Array.isArray(res.list)) {
      accounts.value = res.list
      userStore.user.accountList = res.list
      userStore.user.accountCount = res.list.length
    } else if (Array.isArray(res)) {
      accounts.value = res
      userStore.user.accountList = res
      userStore.user.accountCount = res.length
    }
  } catch (e) {
    console.error(e)
  } finally {
    listLoading.value = false
  }
}

onMounted(() => {
  fetchAccounts()
})

function startEdit(row) {
  editingId.value = row.accountId
  editName.value = row.name || emailPrefix(row.email)
}

async function saveName(row) {
  const name = editName.value.trim()
  if (!name) {
    ElMessage({ message: t('senderNameRequiredMsg'), type: 'error', plain: true })
    return
  }
  try {
    await accountSetName(row.accountId, name)
    row.name = name
    if (isPrimary(row)) {
      userStore.user.name = name
    }
    editingId.value = null
    ElMessage({ message: t('senderNameSavedMsg'), type: 'success', plain: true })
  } catch (e) {
    console.error(e)
  }
}

async function pinAccount(row, index) {
  try {
    await accountSetAsTop(row.accountId)
    await fetchAccounts()
    ElMessage({ message: t('pinnedMsg'), type: 'success', plain: true })
  } catch (e) {
    console.error(e)
  }
}

async function delAccount(row, index) {
  try {
    await accountDelete(row.accountId)
    accounts.value.splice(index, 1)
    userStore.user.accountCount = accounts.value.length
    userStore.user.accountList = accounts.value
    ElMessage({ message: t('delSuccessMsg'), type: 'success', plain: true })
  } catch (e) {
    console.error(e)
  }
}

async function addAccount() {
  const input = addForm.localPart.trim().toLowerCase()
  if (!input) return
  const email = input.includes('@') ? input : input + addForm.suffix
  if (!isEmail(email) || !domainList.value.includes(`@${email.split('@')[1]}`)) {
    ElMessage({ message: t('notEmailMsg'), type: 'error', plain: true })
    return
  }
  addLoading.value = true
  try {
    const res = await accountAdd(email)
    if (res) {
      addForm.localPart = ''
      await fetchAccounts()
      ElMessage({ message: t('saveSuccessMsg'), type: 'success', plain: true })
    }
  } finally {
    addLoading.value = false
  }
}

async function promoteToPrimary(row) {
  if (migratingEmail.value) return
  try {
    await ElMessageBox.confirm(
      t('migratePrimaryConfirm', { email: row.email }),
      t('migratePrimaryTitle'),
      {
        confirmButtonText: t('confirmSwitch'),
        cancelButtonText: t('cancel'),
        type: 'warning'
      }
    )
  } catch {
    return
  }

  migratingEmail.value = row.email
  try {
    const doMigrate = async () => {
      await migratePrimaryEmail(row.email)
    }

    if (typeof props.runSensitive === 'function') {
      await props.runSensitive(t('migratePrimaryPurpose'), doMigrate)
    } else {
      await doMigrate()
    }

    ElMessage({
      message: t('migratePrimarySuccessMsg', { email: row.email }),
      type: 'success',
      duration: 3000
    })

    setTimeout(() => {
      setAuthenticatedSession(false)
      invalidateUserScopedStateAcrossTabs()
      userStore.user = {}
      window.location.replace('/login')
    }, 1200)
  } catch (e) {
    console.error('Migrate primary email failed:', e)
    if (Number(e?.code) !== 401 && Number(e?.code) !== 428) {
      ElMessage({
        message: e?.message || t('migratePrimaryFailedMsg'),
        type: 'error',
        plain: true
      })
    }
  } finally {
    migratingEmail.value = ''
  }
}
</script>

<style scoped lang="scss">
.setting-card {
  padding: 24px;
  
  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);

    .card-title {
      font-size: 17px;
      font-weight: 600;
      color: var(--text-strong);
      margin: 0;
    }
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .card-desc {
    font-size: 13px;
    color: var(--muted);
    margin: 0 0 4px 0;
  }
}

.inline-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;

  &.add-alias-row {
    .alias-input {
      max-width: 400px;
    }
    .add-btn {
      padding: 8px 18px;
    }
  }
}

.alias-table-wrapper {
  margin-top: 6px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface);

  .alias-table {
    --el-table-border-color: var(--line);
    --el-table-header-bg-color: color-mix(in srgb, var(--paper-soft) 80%, transparent);
    --el-table-bg-color: var(--surface);
    --el-table-tr-bg-color: var(--surface);
    --el-table-row-hover-bg-color: color-mix(in srgb, var(--paper-soft) 60%, transparent);
  }

  .email-col {
    display: flex;
    align-items: center;
    gap: 8px;

    .email-text {
      font-size: 13.5px;
      font-weight: 500;
      color: var(--text-strong);
    }

    .copy-email-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--muted);
      cursor: pointer;
      opacity: 0.7;
      transition: all 0.15s ease;

      &:hover {
        opacity: 1;
        color: var(--accent);
        border-color: var(--accent);
        background: var(--paper-soft);
      }
    }
  }

  .name-display {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    margin-left: -8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover {
      background: var(--paper-soft);

      .edit-hint {
        opacity: 1;
        color: var(--accent);
      }
    }

    .name-val {
      color: var(--text);
      font-size: 13px;
      font-weight: 500;
    }

    .edit-hint {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 11px;
      color: var(--muted);
      opacity: 0.6;
      transition: all 0.15s ease;
    }
  }

  .inline-edit {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .action-col {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;

    .default-badge {
      font-size: 12px;
      color: var(--muted);
      padding: 2px 8px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--line) 40%, transparent);
    }

    .action-link {
      font-size: 12.5px;
      padding: 0;
      font-weight: 500;

      &.del-link {
        color: #ef4444;
        &:hover {
          color: #dc2626;
        }
      }

      &.primary-link {
        color: #d97706;
        &:hover {
          color: #b45309;
        }
      }
    }
  }
}
</style>
