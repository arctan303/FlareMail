<template>
  <div class="att-list" v-if="attachments && attachments.length > 0">
    <div class="att-item" v-for="(item, index) in attachments" :key="index">
      <Icon v-bind="getIconByName(item.filename)"/>
      <span class="att-filename" :title="item.filename">{{ item.filename }}</span>
      <span class="att-size">{{ formatBytes(item.size) }}</span>
      <Icon class="del-icon" icon="solar:close-circle-linear" @click="$emit('delete', index)" width="16" height="16"/>
    </div>
  </div>
</template>

<script setup>
import { Icon } from "@iconify/vue"
import { formatBytes } from "@/utils/file-utils.js"
import { getIconByName } from "@/utils/icon-utils.js"

const props = defineProps({
  attachments: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['delete'])
</script>

<style scoped lang="scss">
.att-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  .att-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    font-size: 12px;
    padding: 4px 10px;
    background: var(--paper-soft);
    border: 1px solid var(--line);
    border-radius: 8px;
    max-width: 240px;

    .att-filename {
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      color: var(--text);
    }

    .att-size {
      color: var(--muted);
      font-size: 11px;
    }

    .del-icon {
      cursor: pointer;
      color: var(--muted);
      &:hover {
        color: var(--danger);
      }
    }
  }
}
</style>
