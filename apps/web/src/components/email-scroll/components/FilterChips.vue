<template>
  <nav class="mail-categories" :aria-label="$t('mailCategories')">
    <button v-for="chip in filterChips" :key="chip.id" type="button" class="mail-category"
            :class="{ 'is-active': activeFilter === chip.id }" :aria-current="activeFilter === chip.id ? 'page' : undefined"
            @click="$emit('select', chip.id)">
      <Icon :icon="chip.icon" width="20" height="20" />
      <span>{{ chip.label }}</span>
    </button>
  </nav>
</template>
<script setup>
import { Icon } from '@iconify/vue';
defineProps({ activeFilter: { type: String, default: 'all' }, filterChips: { type: Array, default: () => [] } });
defineEmits(['select']);
</script>
<style scoped lang="scss">
.mail-categories { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid var(--line); padding: 0 12px; }
.mail-category { position: relative; height: 44px; display: flex; align-items: center; gap: 14px; padding: 0 24px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 14px; cursor: pointer; min-width: 0; }
.mail-category:hover { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.mail-category.is-active { color: var(--accent); font-weight: 650; }
.mail-category.is-active::after { content: ''; position: absolute; bottom: 0; left: 12px; right: 12px; height: 3px; border-radius: 4px 4px 0 0; background: var(--accent); }
.mail-category:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; border-radius: 8px; }
@container emailscroll (max-width: 679px) {
  .mail-categories { padding: 0 4px; }
  .mail-category { padding: 0 4px; height: 42px; justify-content: center; gap: 6px; font-size: 12px; }
  .mail-category svg { width: 17px; height: 17px; flex-shrink: 0; }
  .mail-category.is-active::after { left: 6px; right: 6px; }
}
</style>
