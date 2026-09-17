<template>
  <button
    type="button"
    class="hamburger-btn"
    :class="{ 'is-active': isActive }"
    @click="toggleClick"
    :title="isActive ? $t('expandSidebar') : $t('collapseSidebar')"
    :aria-label="$t('toggleSidebar')"
  >
    <span class="bar bar-top"></span>
    <span class="bar bar-mid"></span>
    <span class="bar bar-bot"></span>
  </button>
</template>

<script setup>
defineProps({
  isActive: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['toggleClick'])
const toggleClick = () => {
  emit('toggleClick')
}
</script>

<style scoped lang="scss">
.hamburger-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  color: var(--muted);
  transition: all var(--duration-fast, 150ms) var(--ease-smooth, ease);

  &:hover {
    background: var(--paper-soft);
    color: var(--text-strong);
  }

  &:active {
    transform: scale(0.92);
  }

  .bar {
    display: block;
    width: 15px;
    height: 1.5px;
    background-color: currentColor;
    border-radius: var(--radius-full, 9999px);
    transition: all 340ms cubic-bezier(0.22, 1, 0.36, 1);
    transform-origin: center;
  }

  &.is-active {
    .bar-top {
      width: 10px;
      transform: translateY(2.5px) rotate(45deg);
    }
    .bar-mid {
      opacity: 0;
      transform: scaleX(0);
    }
    .bar-bot {
      width: 10px;
      transform: translateY(-2.5px) rotate(-45deg);
    }
  }
}
</style>
