<template>
  <div class="card-header-block">
    <el-input
      v-if="editing === 'cardTitle'"
      ref="editInput"
      v-model="draft"
      size="small"
      :maxlength="40"
      @blur="commit"
      @keyup.enter="commit"
    />
    <h2
      v-else
      class="card-title-serif arc-serif-title"
      :class="{ 'is-editable': editable }"
      @click="beginEdit('cardTitle')"
    >{{ title }}</h2>

    <el-input
      v-if="editing === 'cardSubtitle'"
      ref="editInput"
      v-model="draft"
      size="small"
      :maxlength="80"
      @blur="commit"
      @keyup.enter="commit"
    />
    <p
      v-else
      class="card-desc-text"
      :class="{ 'is-editable': editable }"
      @click="beginEdit('cardSubtitle')"
    >{{ desc }}</p>
  </div>
</template>

<script setup>
import { nextTick, ref } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  desc: { type: String, default: '' },
  copy: { type: Object, default: () => ({}) },
  editable: { type: Boolean, default: false }
})

const emit = defineEmits(['update:copy'])

const editing = ref('')
const draft = ref('')
const editInput = ref()

function beginEdit(key) {
  if (!props.editable || editing.value) return
  draft.value = props.copy[key] ?? ''
  editing.value = key
  nextTick(() => {
    const input = editInput.value
    if (!input) return
    input.focus?.()
    input.select?.()
  })
}

function commit() {
  const key = editing.value
  if (!key) return
  editing.value = ''
  const next = draft.value
  if ((props.copy[key] ?? '') === next) return
  emit('update:copy', { ...props.copy, [key]: next })
}
</script>

<style lang="scss" scoped>
.card-header-block {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .card-title-serif {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-strong);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .card-desc-text {
    font-size: 13.5px;
    color: var(--muted);
    margin: 0;
  }
}

/* 可编辑态：hover 提示可点 */
.is-editable {
  cursor: text;
  border-radius: 6px;
  outline: 1px dashed transparent;
  transition: background 0.15s ease, outline-color 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    outline-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
}
</style>
