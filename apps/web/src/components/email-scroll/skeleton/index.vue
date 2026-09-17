<template>
  <div v-for="item in rows" :key="item" :class="['email-row', 'skeleton-row', type]" aria-hidden="true">
    <span class="skeleton-block" style="width: 14px" /><span />
    <span class="row-sender skeleton-block" style="width: 75%" />
    <span class="skeleton-summary skeleton-block" /><span class="skeleton-block" />
  </div>
</template>
<script setup>
const props = defineProps({
  rows: {
    type: Number,
    default: 1
  },
  showStar: {
    type: Boolean,
    default: false
  },
  accountShow: {
    type: Boolean,
    default: false
  },
  showStatus: {
    type: Boolean,
    default: false
  },
  showUserInfo: {
    type: Boolean,
    default: false
  },
  type: {
    type: String,
    default: ''
  }
})
</script>
