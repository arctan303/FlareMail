<template>
  <div class="content-box" ref="contentBox">
    <button v-if="blockedRemoteImages > 0 && !allowRemoteImages" class="remote-image-button" @click="loadRemoteImages">
      {{ $t('showRemoteImages', { count: blockedRemoteImages }) }}
    </button>
    <div ref="container" class="content-html"></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { sanitizeEmailHtml } from '@/utils/html-sanitizer.js'
import { useUiStore } from '@/store/ui.js'

const props = defineProps({
  html: {
    type: String,
    required: true
  },
  forceLight: {
    type: Boolean,
    default: false
  }
})

const uiStore = useUiStore()
const container = ref(null)
const contentBox = ref(null)
const blockedRemoteImages = ref(0)
const allowRemoteImages = ref(false)
let shadowRoot = null

const isDarkMode = computed(() => {
  if (props.forceLight) return false
  return !!uiStore.dark
})

function getShell(isDark) {
  if (isDark) {
    return `
      <style>
        :host {
          all: initial;
          width: 100%;
          height: 100%;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
          font-size: 15px;
          line-height: 1.7;
          color: #CBD5E1;
          word-break: break-word;
        }
        h1, h2, h3, h4 { font-size: 17px; font-weight: 600; color: #F1F5F9; margin: 12px 0 6px 0; }
        p { margin: 0 0 8px 0; }
        a { color: #60A5FA; text-decoration: underline; text-underline-offset: 2px; }
        blockquote { border-left: 3px solid #475569; padding: 4px 0 4px 12px; margin: 10px 0; color: #94A3B8; }
        .shadow-content { background: transparent; width: fit-content; height: fit-content; min-width: 100%; color: #CBD5E1; }
        img:not(table img) { max-width: 100%; height: auto !important; border-radius: 4px; }
        table { border-color: #334155; border-collapse: collapse; }
        td, th { border-color: #334155; }
        pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13.5px; background: rgba(255,255,255,0.06); padding: 2px 5px; border-radius: 4px; }
        pre { padding: 10px 12px; overflow-x: auto; }
      </style>
      <div class="shadow-content"></div>
    `
  }
  return `
    <style>
      :host {
        all: initial;
        width: 100%;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
        font-size: 15px;
        line-height: 1.7;
        color: #1E293B;
        word-break: break-word;
      }
      h1, h2, h3, h4 { font-size: 17px; font-weight: 600; color: #0F172A; margin: 12px 0 6px 0; }
      p { margin: 0 0 8px 0; }
      a { color: #0E70DF; text-decoration: underline; text-underline-offset: 2px; }
      blockquote { border-left: 3px solid #CBD5E1; padding: 4px 0 4px 12px; margin: 10px 0; color: #64748B; }
      .shadow-content { background: transparent; width: fit-content; height: fit-content; min-width: 100%; color: #1E293B; }
      img:not(table img) { max-width: 100%; height: auto !important; border-radius: 4px; }
      table { border-color: #E2E8F0; border-collapse: collapse; }
      td, th { border-color: #E2E8F0; }
      pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13.5px; background: rgba(0,0,0,0.04); padding: 2px 5px; border-radius: 4px; }
      pre { padding: 10px 12px; overflow-x: auto; }
    </style>
    <div class="shadow-content"></div>
  `
}

function updateContent() {
  if (!shadowRoot) return
  const dark = isDarkMode.value
  const sanitized = sanitizeEmailHtml(props.html, {
    allowRemoteImages: allowRemoteImages.value,
    isDark: dark
  })
  blockedRemoteImages.value = sanitized.blockedRemoteImages

  shadowRoot.innerHTML = getShell(dark)
  const content = shadowRoot.querySelector('.shadow-content')
  content.innerHTML = sanitized.html
  if (sanitized.bodyStyle) content.setAttribute('style', sanitized.bodyStyle)
}

function autoScale() {
  if (!shadowRoot || !contentBox.value) return
  const shadowContent = shadowRoot.querySelector('.shadow-content')
  if (!shadowContent || shadowContent.scrollWidth === 0) return
  const scale = Math.min(1, contentBox.value.offsetWidth / shadowContent.scrollWidth)
  shadowRoot.host.style.zoom = scale
}

async function render() {
  updateContent()
  await nextTick()
  autoScale()
}

function loadRemoteImages() {
  allowRemoteImages.value = true
  render()
}

onMounted(() => {
  shadowRoot = container.value.attachShadow({mode: 'open'})
  render()
})

watch(() => [props.html, isDarkMode.value], () => {
  render()
})
</script>

<style scoped>
.content-box {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
}

.content-html {
  width: 100%;
  height: 100%;
}

.remote-image-button {
  margin-bottom: 10px;
  padding: 7px 12px;
  border: 0;
  border-radius: 16px;
  font-size: 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.remote-image-button:hover {
  background: color-mix(in srgb, var(--text) 8%, var(--surface));
}
.remote-image-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
