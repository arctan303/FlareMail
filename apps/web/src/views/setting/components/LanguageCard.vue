<template>
  <div class="setting-card arc-card">
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">
          <Icon icon="solar:global-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('language') }}</h3>
          <p class="card-desc">{{ $t('languageDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <div class="setting-row">
        <div class="row-meta">
          <span class="row-label">{{ $t('language') }}</span>
          <span class="row-hint">{{ $t('languageHint') }}</span>
        </div>
        <div class="row-action">
          <el-radio-group :model-value="current" :disabled="saving" @change="choose">
            <el-radio-button v-for="option in options" :key="option.value" :value="option.value">
              {{ option.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/store/setting.js'
import { setUserLocale } from '@/request/my.js'
import { SUPPORTED_LOCALES } from '@/utils/locale.js'

const { t } = useI18n()
const settingStore = useSettingStore()
const saving = ref(false)

// Each option keeps its own language name so it stays recognisable either way.
const options = computed(() => SUPPORTED_LOCALES.map(value => ({
  value,
  label: value === 'zh' ? t('languageZh') : t('languageEn'),
})))

const current = computed(() => settingStore.lang || 'zh')

async function choose(locale) {
  if (saving.value || locale === current.value) return
  // Applied locally first so the switch is instant; the account copy follows.
  settingStore.setLang(locale)
  saving.value = true
  try {
    await setUserLocale(locale)
  } catch {
    ElMessage({ message: t('localeSyncFailMsg'), type: 'warning', plain: true })
  } finally {
    saving.value = false
  }
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
  }
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 0 4px;

  .row-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;

    .row-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-strong);
    }

    .row-hint {
      font-size: 12px;
      color: var(--muted);
    }
  }

  .row-action {
    display: flex;
    align-items: center;
  }

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>
