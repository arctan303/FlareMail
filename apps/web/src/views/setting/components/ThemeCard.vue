<template>
  <div class="setting-card arc-card" data-pages-appearance>
    <div class="card-header">
      <div class="header-left">
        <div class="header-icon">
          <Icon icon="solar:pallete-2-linear" width="20" height="20" />
        </div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('themeSettings') }}</h3>
          <p class="card-desc">{{ $t('themeSettingsDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body">
      <!-- 行 1: 外观模式 (浅色 / 深色 / 跟随系统) -->
      <div class="setting-row">
        <div class="row-meta">
          <span class="row-label">{{ $t('themeMode') }}</span>
          <span class="row-hint">{{ $t('themeModeHint') }}</span>
        </div>
        <div class="row-action">
          <div class="mode-selector" role="radiogroup" :aria-label="$t('themeMode')">
            <button
              v-for="item in modeOptions"
              :key="item.value"
              type="button"
              class="mode-btn"
              :class="{ 'is-active': currentMode === item.value }"
              :aria-checked="currentMode === item.value"
              role="radio"
              @click="changeMode(item.value, $event)"
            >
              <Icon :icon="item.icon" width="18" height="18" class="mode-icon" />
              <span class="mode-label">{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 分隔线 -->
      <div class="row-divider"></div>

      <!-- 行 2: 主题配色色板 -->
      <div class="setting-row">
        <div class="row-meta">
          <span class="row-label">{{ $t('themeAccent') }}</span>
          <span class="row-hint">{{ $t('themeAccentHint') }}</span>
        </div>
        <div class="row-action">
          <div class="swatches-grid" role="radiogroup" :aria-label="$t('themeAccent')">
            <button
              v-for="accent in THEME_ACCENTS"
              :key="accent.id"
              type="button"
              class="swatch-btn"
              :class="{ 'is-active': currentAccent === accent.id }"
              :aria-checked="currentAccent === accent.id"
              role="radio"
              :title="$t(accent.nameKey)"
              @click="selectAccent(accent.id)"
            >
              <span class="swatch-circle" :class="'swatch-' + accent.id">
                <Icon
                  v-if="currentAccent === accent.id"
                  icon="solar:check-read-linear"
                  width="15"
                  height="15"
                  class="check-icon"
                />
              </span>
              <span class="swatch-name">{{ $t(accent.nameKey) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/store/ui.js'
import { getStoredThemeMode, setThemeMode } from '@/utils/theme.js'
import { THEME_ACCENTS, getStoredThemeAccent, setThemeAccent } from '@/utils/theme-accent.js'

const { t } = useI18n()
const uiStore = useUiStore()

const currentMode = computed(() => uiStore.themeMode || getStoredThemeMode())
const currentAccent = ref(getStoredThemeAccent())

const modeOptions = computed(() => [
  { value: 'light', label: t('themeModeLight'), icon: 'solar:sun-2-linear' },
  { value: 'dark', label: t('themeModeDark'), icon: 'solar:moon-linear' },
  { value: 'system', label: t('themeModeSystem'), icon: 'solar:laptop-minimalistic-linear' },
])

function changeMode(mode, event) {
  if (currentMode.value === mode) return
  setThemeMode(mode, event)
}

function selectAccent(id) {
  if (currentAccent.value === id) return
  currentAccent.value = id
  setThemeAccent(id)
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
        transition: background-color 0.2s ease, color 0.2s ease;
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
  padding: 18px 0;
  gap: 16px;

  .row-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 140px;

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

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }
}

.row-divider {
  height: 1px;
  background: var(--line);
  width: 100%;
}

/* 外观模式选择器 */
.mode-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--paper-soft);
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--line);

  .mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.18s ease;

    .mode-icon {
      flex-shrink: 0;
    }

    &:hover {
      color: var(--text-strong);
    }

    &.is-active {
      background: var(--surface);
      color: var(--text-strong);
      font-weight: 600;
      border-color: var(--line);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    }
  }
}

/* 配色调色板 */
.swatches-grid {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.swatch-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.18s ease;

  &:hover {
    background: var(--paper-soft);
  }

  &.is-active {
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);

    .swatch-name {
      color: var(--text-strong);
      font-weight: 600;
    }
  }

  .swatch-circle {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    position: relative;
    transition: transform 0.18s ease;

    .check-icon {
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
    }
  }

  &:hover .swatch-circle {
    transform: scale(1.08);
  }

  .swatch-name {
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
    transition: color 0.18s ease;
  }

  /* 颜色预览定义 */
  .swatch-monochrome {
    background: linear-gradient(135deg, #ffffff 50%, #0f172a 50%);
    border: 1.5px solid #94a3b8;
    .check-icon {
      color: #0f172a;
      background: rgba(255, 255, 255, 0.85);
      border-radius: 50%;
    }
  }

  .swatch-ocean {
    background: #1b456f;
    .check-icon { color: #ffffff; }
  }

  .swatch-sage {
    background: #15803d;
    .check-icon { color: #ffffff; }
  }

  .swatch-iris {
    background: #6366f1;
    .check-icon { color: #ffffff; }
  }

  .swatch-amber {
    background: #c2410c;
    .check-icon { color: #ffffff; }
  }
}

:global(.dark) {
  .swatch-btn.is-active {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .swatch-monochrome {
    background: linear-gradient(135deg, #ffffff 50%, #1e293b 50%);
    border-color: #64748b;
    .check-icon {
      color: #0f172a;
      background: rgba(255, 255, 255, 0.9);
    }
  }

  .swatch-ocean { background: #4f8ff7; }
  .swatch-sage { background: #4ade80; }
  .swatch-iris { background: #818cf8; }
  .swatch-amber { background: #fb923c; }
}
</style>
