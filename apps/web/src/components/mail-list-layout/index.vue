<template>
  <section class="mail-list-page" :aria-label="$t('mailLabel')">
    <div class="mail-list-surface"><slot /></div>
  </section>
</template>
<style scoped lang="scss">
.mail-list-page { width: 100%; height: 100%; min-width: 0; padding: 0 16px 16px 8px; box-sizing: border-box; }
.mail-list-surface { height: 100%; min-width: 0; overflow: hidden; border-radius: 12px; background: var(--surface); }
@media (max-width: 767px) {
  .mail-list-page { padding: 0; }
  .mail-list-surface { border-radius: 10px 10px 0 0; }
}
</style>
