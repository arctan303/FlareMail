<template>
  <div class="setting-card arc-card">
    <!-- 卡片头部：标题与功能描述 -->
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">
          <Icon icon="solar:code-square-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('cliAccessTitle') }}</h3>
          <p class="card-desc">{{ $t('cliAccessDesc') }}</p>
        </div>
      </div>
    </div>

    <!-- 卡片主体：重点聚焦 Token 操作，弱化次级说明按钮 -->
    <div class="card-body">
      <!-- 状态 1：未生成 Token -->
      <div v-if="!userStore.user.hasCliToken && !cliToken" class="action-row">
        <el-button type="primary" class="arc-btn primary-action" :loading="cliGenerating" :disabled="cliRevoking" @click="doGenerateCliToken">
          {{ $t('cliGenToken') }}
        </el-button>
        <el-button plain class="sub-action-btn" tag="a" :href="docUrl" target="_blank" rel="noopener noreferrer">
          <Icon icon="solar:book-linear" width="16" height="16" class="btn-icon" />
          {{ $t('cliDocsBtn') }}
        </el-button>
      </div>

      <!-- 状态 2：刚生成 Token（仅显示一次） -->
      <div v-else-if="cliToken" class="cli-result-block">
        <el-alert type="success" :closable="false" show-icon :title="$t('cliTokenGeneratedAlert')" style="margin-bottom: 14px;" />
        <div class="inline-form">
          <el-input v-model="cliToken" readonly style="max-width: 360px;" />
          <el-button type="primary" class="arc-btn primary-action" @click="doCopyCliToken">
            {{ $t('cliCopyToken') }}
          </el-button>
          <el-button plain class="sub-action-btn" tag="a" :href="docUrl" target="_blank" rel="noopener noreferrer">
            <Icon icon="solar:book-linear" width="16" height="16" class="btn-icon" />
            {{ $t('cliViewDocs') }}
          </el-button>
        </div>
      </div>

      <!-- 状态 3：已激活 Token -->
      <div v-else class="cli-status-block">
        <p class="cli-token-placeholder">{{ $t('cliTokenActive') }}</p>
        <div class="action-row">
          <el-button type="danger" plain class="arc-btn" :loading="cliGenerating" :disabled="cliRevoking" @click="doRotateCliToken">
            {{ $t('cliRotateToken') }}
          </el-button>
          <el-button text type="danger" :loading="cliRevoking" :disabled="cliGenerating" @click="doRevokeCliToken">
            {{ $t('cliRevokeOnly') }}
          </el-button>
          <el-button plain class="sub-action-btn" tag="a" :href="docUrl" target="_blank" rel="noopener noreferrer">
            <Icon icon="solar:book-linear" width="16" height="16" class="btn-icon" />
            {{ $t('cliDocsBtn') }}
          </el-button>
        </div>
      </div>
    </div>


  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Icon } from "@iconify/vue"
import { useUserStore } from "@/store/user.js"
import { genCliToken, revokeCliToken } from "@/request/my.js"
import { ElMessage, ElMessageBox } from 'element-plus'
import { runConfirmedAction } from '@/utils/recent-auth.js'
import { useSettingStore } from '@/store/setting.js'
import { cliDocsUrl } from '@/utils/cli-docs.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  runSensitive: { type: Function, required: true }
})

const userStore = useUserStore()
const settingStore = useSettingStore()
const cliToken = ref('')
const cliGenerating = ref(false)
const cliRevoking = ref(false)

const docUrl = computed(() => cliDocsUrl(window.location.origin, settingStore.lang))

function showActionError(error, fallback) {
  if (Number(error?.code) === 401) return
  ElMessage({
    message: Number(error?.code) === 428
      ? t('authStateExpiredMsg')
      : (error?.message || fallback),
    type: 'error',
    plain: true
  })
}

async function generateToken() {
  const res = await genCliToken({ noMsg: true })
  if (!res?.token) throw new Error(t('cliNoTokenReturned'))
  cliToken.value = res.token
  userStore.user.hasCliToken = true
}

async function doGenerateCliToken() {
  if (cliGenerating.value || cliRevoking.value) return
  cliGenerating.value = true
  try {
    await props.runSensitive(t('cliGenToken'), generateToken)
  } catch (error) {
    showActionError(error, t('cliGenFailedMsg'))
  } finally {
    cliGenerating.value = false
  }
}

async function doRotateCliToken() {
  if (cliGenerating.value || cliRevoking.value) return
  cliGenerating.value = true
  try {
    await props.runSensitive(t('cliRotateTokenTitle'), () => runConfirmedAction(
      () => ElMessageBox.confirm(
        t('cliRotateConfirm'),
        t('cliRotateTokenTitle'),
        { confirmButtonText: t('cliRotateConfirmBtn'), cancelButtonText: t('cancel'), type: 'warning' }
      ),
      generateToken
    ))
  } catch (error) {
    showActionError(error, t('cliRotateFailedMsg'))
  } finally {
    cliGenerating.value = false
  }
}

async function doRevokeCliToken() {
  if (cliRevoking.value || cliGenerating.value) return
  cliRevoking.value = true
  try {
    await runConfirmedAction(
      () => ElMessageBox.confirm(
        t('cliRevokeConfirm'),
        t('cliRevokeTitle'),
        { confirmButtonText: t('cliRevokeConfirmBtn'), cancelButtonText: t('cancel'), type: 'warning' }
      ),
      async () => {
        await revokeCliToken({ noMsg: true })
        cliToken.value = ''
        userStore.user.hasCliToken = false
        ElMessage({ message: t('cliRevokedMsg'), type: 'success', plain: true })
      }
    )
  } catch (error) {
    showActionError(error, t('cliRevokeFailedMsg'))
  } finally {
    cliRevoking.value = false
  }
}

async function copyText(text, successMsg = t('copiedToClipboard')) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage({ message: successMsg, type: 'success', plain: true })
  } catch {
    ElMessage({ message: t('copyFailedManualMsg'), type: 'warning', plain: true })
  }
}

async function doCopyCliToken() {
  await copyText(cliToken.value, t('cliTokenCopied'))
}

</script>

<style scoped lang="scss">
.setting-card {
  padding: 24px 28px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--line);

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;

      .header-icon {
        width: 36px;
        height: 36px;
        border-radius: 9px;
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        color: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .card-title {
        font-size: 16.5px;
        font-weight: 600;
        color: var(--text-strong);
        margin: 0 0 2px 0;
      }

      .card-desc {
        font-size: 12.5px;
        color: var(--muted);
        margin: 0;
      }
    }
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-top: 18px;
  }
}

/* 按钮组排版：突出主操作，弱化次级按钮 */
.action-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.inline-form {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.sub-action-btn {
  color: var(--muted);
  border-color: var(--line);
  background: transparent;
  font-size: 13px;
  font-weight: 400;

  &:hover {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
}

.cli-token-placeholder {
  font-size: 13.5px;
  color: var(--text-muted);
  margin: 0 0 14px;
}

.btn-icon {
  margin-right: 4px;
  flex-shrink: 0;
}

</style>
