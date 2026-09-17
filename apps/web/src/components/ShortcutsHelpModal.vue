<template>
  <el-dialog
    v-model="isShortcutsHelpVisible"
    :title="$t('shortcutsTitle')"
    width="540px"
    class="shortcuts-dialog arc-card"
    :append-to-body="true"
  >
    <div class="shortcuts-container">
      <div class="shortcuts-intro">
        {{ $t('shortcutsIntro') }}
      </div>
      <div class="shortcuts-grid">
        <div class="shortcut-item" v-for="item in shortcutList" :key="item.key">
          <kbd class="shortcut-kbd">{{ item.key }}</kbd>
          <span class="shortcut-label">{{ item.label }}</span>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isShortcutsHelpVisible } from '@/utils/shortcuts.js'

const { t } = useI18n()

// Computed so the labels follow a language switch. Key names themselves are never translated.
const shortcutList = computed(() => [
  { key: '?', label: t('shortcutToggleHelp') },
  { key: 'C', label: t('shortcutCompose') },
  { key: 'R', label: t('shortcutReply') },
  { key: 'F', label: t('shortcutForward') },
  { key: 'J / ↓', label: t('shortcutNext') },
  { key: 'K / ↑', label: t('shortcutPrevious') },
  { key: 'D / Del', label: t('shortcutDelete') },
  { key: 'S', label: t('shortcutToggleStar') },
  { key: '/', label: t('shortcutFocusSearch') },
  { key: 'Esc', label: t('shortcutClose') }
])
</script>

<style scoped>
.shortcuts-intro {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 16px;
}

.shortcuts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 20px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.shortcut-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 26px;
  padding: 0 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-strong);
  background: var(--paper-soft);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.shortcut-label {
  font-size: 13px;
  color: var(--text);
}
</style>
