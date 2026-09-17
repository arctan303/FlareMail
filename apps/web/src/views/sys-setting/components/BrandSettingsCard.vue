<template>
  <section class="setting-card brand-card">
    <div class="card-header">
      <div class="header-left-group">
        <div class="header-icon"><Icon icon="solar:settings-minimalistic-linear" width="20" height="20" /></div>
        <div>
          <h3 class="card-title arc-serif-title">{{ $t('sysBrandTitle') }}</h3>
          <p class="card-desc">{{ $t('sysBrandDesc') }}</p>
        </div>
      </div>
    </div>

    <div class="card-body" :inert="uploading ? '' : null">
      <div class="brand-base-stack">
        <div class="field-item">
          <label class="field-label">{{ $t('sysBrandSiteName') }}</label>
          <el-input v-model="form.title" maxlength="80" show-word-limit placeholder="FlareMail" />
        </div>
        <div class="field-item">
          <label class="field-label">{{ $t('sysBrandSiteDesc') }}</label>
          <el-input v-model="form.siteDescription" type="textarea" :rows="2" maxlength="240" show-word-limit placeholder="A private mailbox for your domain." />
        </div>
      </div>

      <div class="form-subsection">
        <h4 class="form-subsection-title">{{ $t('sysBrandImages') }}</h4>
        <p class="field-hint">{{ $t('sysBrandImagesHint') }}</p>
      <div class="asset-grid">
        <div class="asset-item">
          <label class="field-label">Logo</label>
          <div class="asset-preview logo-preview">
            <img :src="logoPreview" :alt="form.title || 'FlareMail'" @error="logoFailed = true" />
          </div>
          <div class="asset-actions">
            <el-button size="small" :loading="logoUploading" :disabled="saving || uploading" @click="logoInput?.click()">{{ $t('sysBrandUploadImage') }}</el-button>
            <input ref="logoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onLogoFile" />
            <el-button size="small" link @click="clearLogo">{{ $t('restoreDefaults') }}</el-button>
          </div>
          <label class="field-label" for="brand-logo-url">{{ $t('sysBrandImageUrl') }}</label>
          <el-input id="brand-logo-url" v-model="form.siteLogo" :placeholder="$t('sysBrandLogoUrlPlaceholder')" @blur="validateLogoUrl" />
          <p class="field-hint">{{ $t('sysBrandLogoHint') }}</p>
        </div>

        <div class="asset-item">
          <label class="field-label">{{ $t('sysBrandFaviconLabel') }}</label>
          <div class="asset-preview favicon-preview">
            <img :src="faviconPreview" :alt="form.title || 'FlareMail'" @error="faviconFailed = true" />
          </div>
          <div class="asset-actions">
            <el-button size="small" :loading="faviconUploading" :disabled="saving || uploading" @click="faviconInput?.click()">{{ $t('sysBrandUploadIcon') }}</el-button>
            <input ref="faviconInput" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onFaviconFile" />
            <el-button size="small" link @click="clearFavicon">{{ $t('restoreDefaults') }}</el-button>
          </div>
          <label class="field-label" for="brand-icon-url">{{ $t('sysBrandImageUrl') }}</label>
          <el-input id="brand-icon-url" v-model="form.siteFavicon" :placeholder="$t('sysBrandIconUrlPlaceholder')" @blur="validateFaviconField" />
          <p class="field-hint">{{ $t('sysBrandIconHint') }}</p>
          <p v-if="faviconDimensions" class="field-hint success-hint">{{ $t('sysBrandFaviconVerified', { width: faviconDimensions.width, height: faviconDimensions.height }) }}</p>
        </div>
      </div>

      </div>
      <div class="advanced-copy-panel">
        <details class="advanced-copy" :open="isCopyOpen" @toggle="isCopyOpen = $event.target.open">
          <summary class="advanced-copy-summary">
            <div class="summary-left">
              <Icon icon="solar:pen-new-square-linear" width="16" height="16" class="summary-icon" />
              <span>{{ $t('sysBrandCopyTitle') }}</span>
            </div>
            <div class="summary-right">
              <span class="summary-badge">{{ isCopyOpen ? $t('sysBrandCollapse') : $t('sysBrandExpand') }}</span>
              <Icon icon="solar:alt-arrow-down-linear" width="14" height="14" class="arrow-icon" :class="{ 'is-open': isCopyOpen }" />
            </div>
          </summary>

          <div class="copy-body">
            <div class="info-callout">
              <Icon icon="solar:info-circle-linear" width="16" height="16" class="callout-icon" />
              <div class="callout-content">
                <p>{{ $t('sysBrandCopyHint') }}</p>
              </div>
              <el-button size="small" type="primary" plain class="arc-btn preview-launch-btn" :disabled="dirty || saving || uploading" @click="openPreview">
                <Icon icon="solar:eye-linear" width="14" height="14" style="margin-right: 4px;" />
                {{ $t('sysBrandOpenPreview') }}
              </el-button>
            </div>

            <div v-for="group in copyGroups" :key="group.title" class="copy-group">
              <div class="copy-group-head">
                <span class="copy-group-title">{{ group.title }}</span>
                <span class="field-hint">{{ group.hint }}</span>
              </div>
              <div class="copy-grid">
                <div
                  v-for="key in group.fields"
                  :key="key"
                  class="field-item"
                  :class="{ 'field-wide': copyFieldMap[key].multiline }"
                >
                  <label class="field-label">{{ copyFieldMap[key].label }}</label>
                  <el-input
                    v-model="form.loginCopy[key]"
                    :type="copyFieldMap[key].multiline ? 'textarea' : 'text'"
                    :rows="copyFieldMap[key].multiline ? 2 : undefined"
                    :maxlength="copyFieldMap[key].max"
                    show-word-limit
                    :placeholder="defaultCopy[key]"
                  />
                </div>
              </div>
            </div>

            <div class="info-callout" style="margin-top: 12px;">
              <Icon icon="solar:shield-check-linear" width="15" height="15" class="callout-icon" />
              <div class="callout-content">
                <p>{{ $t('sysBrandCopyDefaultHint') }}</p>
              </div>
            </div>
          </div>
        </details>
      </div>

      <p v-if="feedback" :class="['feedback', feedbackType]">{{ feedback }}</p>
    </div>
    <slot name="footer" />
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { ElMessage } from 'element-plus'
import { brandAssetUpload } from '@/request/setting.js'
import { DEFAULT_BRAND, defaultLoginCopy } from '@/utils/brand.js'

const props = defineProps({ form: { type: Object, required: true }, saving: Boolean, dirty: Boolean })
const emit = defineEmits(['saved', 'busy'])
const { t } = useI18n()

const logoInput = ref()
const faviconInput = ref()
const logoFailed = ref(false)
const faviconFailed = ref(false)
const faviconUploading = ref(false)
const logoUploading = ref(false)
const uploading = computed(() => logoUploading.value || faviconUploading.value)
watch(uploading, value => emit('busy', value))
watch(() => props.form.siteLogo, () => { logoFailed.value = false })
watch(() => props.form.siteFavicon, () => { faviconFailed.value = false; faviconDimensions.value = null })
const feedback = ref('')
const feedbackType = ref('')
const faviconDimensions = ref(null)
// Reactive: the placeholders show the default that would be used, which follows the
// interface language.
const defaultCopy = computed(() => defaultLoginCopy())
const isCopyOpen = ref(false)
// Both maps hold translated labels, so they have to follow a language switch.
const copyFields = computed(() => [
  { key: 'subtitle', label: t('sysCopySubtitle'), max: 80 },
  { key: 'slogan', label: t('sysCopySlogan'), max: 160, multiline: true },
  { key: 'quoteLead', label: t('sysCopyQuoteLead'), max: 160 },
  { key: 'quoteBody', label: t('sysCopyQuoteBody'), max: 500, multiline: true },
  { key: 'sealText', label: t('sysCopySealText'), max: 16 },
  { key: 'footerText', label: t('sysCopyFooterText'), max: 80 },
  { key: 'stampText', label: t('sysCopyStampText'), max: 80 },
  { key: 'cardTitle', label: t('sysCopyCardTitle'), max: 40 },
  { key: 'cardSubtitle', label: t('sysCopyCardSubtitle'), max: 80 },
])
const copyFieldMap = computed(() => Object.fromEntries(copyFields.value.map(field => [field.key, field])))
const copyGroups = computed(() => [
  { title: t('sysCopyGroupBrandLine'), hint: t('sysCopyGroupBrandLineHint'), fields: ['subtitle'] },
  { title: t('sysCopyGroupHero'), hint: t('sysCopyGroupHeroHint'), fields: ['slogan'] },
  { title: t('sysCopyGroupQuote'), hint: t('sysCopyGroupQuoteHint'), fields: ['quoteLead', 'quoteBody'] },
  { title: t('sysCopyGroupSignature'), hint: t('sysCopyGroupSignatureHint'), fields: ['sealText', 'footerText', 'stampText'] },
  { title: t('sysCopyGroupCard'), hint: t('sysCopyGroupCardHint'), fields: ['cardTitle', 'cardSubtitle'] },
])

const router = useRouter()

function openPreview() {
  if (props.dirty || props.saving || uploading.value) return
  const href = router.resolve({ name: 'brand-preview' }).href
  window.open(href, '_blank', 'noopener')
}

const logoPreview = computed(() => logoFailed.value ? DEFAULT_BRAND.logoUrl : (props.form.siteLogo || DEFAULT_BRAND.logoUrl))
const faviconPreview = computed(() => faviconFailed.value ? DEFAULT_BRAND.faviconUrl : (props.form.siteFavicon || DEFAULT_BRAND.faviconUrl))

function setFeedback(message, type = 'error') {
  feedback.value = message
  feedbackType.value = type
}

function clearFeedback() {
  feedback.value = ''
  feedbackType.value = ''
}

function clearLogo() {
  props.form.siteLogo = ''
  logoFailed.value = false
}

function clearFavicon() {
  props.form.siteFavicon = ''
  props.form.sitePwaIcons = {}
  faviconDimensions.value = null
  faviconFailed.value = false
}

function checkFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error(t('sysErrImageType'))
  }
  if (file.size > 512 * 1024) throw new Error(t('sysErrImageTooLarge'))
  return loadImage(file)
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(t('sysErrImageDecode')))
    }
    image.src = url
  })
}

async function onLogoFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || uploading.value || props.saving) return
  clearFeedback()
  logoUploading.value = true
  try {
    const image = await checkFile(file)
    if (Math.max(image.naturalWidth, image.naturalHeight) > 2048) throw new Error(t('sysErrImageTooWide'))
    const body = new FormData()
    body.append('type', 'logo')
    body.append('file', file, file.name)
    const config = await brandAssetUpload(body)
    setFeedback(t('sysLogoUploaded'), 'success')
    emit('saved', { type: 'logo', config: { siteLogo: config.logoUrl } })
  } catch (error) {
    setFeedback(error?.message || t('sysLogoUploadFailed'))
    ElMessage({ message: feedback.value, type: 'error', plain: true })
  } finally { logoUploading.value = false }
}

function canvasBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(t('sysErrCanvasConvert'))), type)
  })
}

async function makeIcon(image, size) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error(t('sysErrCanvasUnsupported'))
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  const sx = (image.naturalWidth - side) / 2
  const sy = (image.naturalHeight - side) / 2
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size)
  const blob = await canvasBlob(canvas)
  if (blob.size > 256 * 1024) throw new Error(t('sysErrIconTooLarge', { size }))
  return new File([blob], `favicon-${size}.png`, { type: 'image/png' })
}

async function onFaviconFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || uploading.value || props.saving) return
  clearFeedback()
  faviconUploading.value = true
  try {
    const image = await checkFile(file)
    if (Math.max(image.naturalWidth, image.naturalHeight) > 2048) throw new Error(t('sysErrImageTooWide'))
    const body = new FormData()
    body.append('type', 'favicon')
    body.append('icon192', await makeIcon(image, 192), 'favicon-192.png')
    body.append('icon512', await makeIcon(image, 512), 'favicon-512.png')
    const config = await brandAssetUpload(body)
    setFeedback(t('sysFaviconUploaded'), 'success')
    emit('saved', { type: 'favicon', config: { siteFavicon: config.faviconUrl, sitePwaIcons: { icon192: config.faviconUrl, icon512: config.faviconUrl.replace('favicon-192.png', 'favicon-512.png') } } })
  } catch (error) {
    setFeedback(error?.message || t('sysFaviconUploadFailed'))
    ElMessage({ message: feedback.value, type: 'error', plain: true })
  } finally {
    faviconUploading.value = false
  }
}

function validateHttpsImageUrl(value) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  let parsed
  try { parsed = new URL(normalized) } catch { throw new Error(t('sysErrHttpsUrlRequired')) }
  if (normalized !== value || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !/\.(png|jpe?g|webp)$/i.test(parsed.pathname)) {
    throw new Error(t('sysErrImageUrlRules'))
  }
  return normalized
}

function loadRemoteImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t('sysErrImageUrlUnreachable')))
    image.src = url
  })
}

async function validateFaviconUrl() {
  const value = props.form.siteFavicon
  if (!value) {
    props.form.sitePwaIcons = {}
    faviconDimensions.value = null
    return true
  }
  if (value.startsWith('/api/site-assets/brand/')) return true
  const existing = props.form.sitePwaIcons?.url
  if (existing?.src === value && Number.isInteger(existing.width) && existing.width === existing.height && existing.width >= 192 && existing.width <= 2048) {
    faviconDimensions.value = existing
    return true
  }
  const url = validateHttpsImageUrl(value)
  const image = await loadRemoteImage(url)
  if (image.naturalWidth !== image.naturalHeight || image.naturalWidth < 192 || image.naturalWidth > 2048) {
    throw new Error(t('sysErrFaviconSquare'))
  }
  const dimensions = { src: url, width: image.naturalWidth, height: image.naturalHeight }
  props.form.siteFavicon = url
  props.form.sitePwaIcons = { url: dimensions }
  faviconDimensions.value = dimensions
  return true
}

async function validateFaviconField() {
  clearFeedback()
  try {
    await validateFaviconUrl()
  } catch (error) {
    setFeedback(error?.message || t('sysFaviconInvalid'))
    ElMessage({ message: feedback.value, type: 'error', plain: true })
  }
}

function validateLogoUrl() {
  const value = props.form.siteLogo
  if (!value || value.startsWith('/api/site-assets/brand/')) return true
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || /\s/.test(value)) throw new Error()
    return true
  } catch {
    setFeedback(t('sysLogoUrlInvalid'))
    return false
  }
}

async function validate() {
  clearFeedback()
  if (!validateLogoUrl()) return false
  try {
    await validateFaviconUrl()
    return true
  } catch (error) {
    setFeedback(error?.message || t('sysFaviconInvalid'))
    ElMessage({ message: feedback.value, type: 'error', plain: true })
    return false
  }
}

defineExpose({ validate })
</script>

<style lang="scss" scoped>
@use './card' as *;
.brand-base-stack { display:flex; flex-direction:column; gap:18px; max-width:600px; }
.asset-grid { display:flex; flex-direction:column; gap:24px; }
.asset-item { display:grid; grid-template-columns:88px minmax(0,1fr); gap:8px 20px; max-width:708px; min-width:0; }
.asset-item > :not(.asset-preview) { grid-column:2; min-width:0; }
.asset-item > .field-label:first-child { font-weight:600; }
.asset-preview { grid-column:1; grid-row:1 / span 7; align-self:start; height:88px; border:1px solid var(--line); border-radius:10px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:var(--paper-soft); }
.asset-preview img { max-width:64px; max-height:64px; object-fit:contain; }
.asset-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.advanced-copy-panel { border-top:1px solid var(--line); padding-top:16px; }
.advanced-copy-summary { display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer; padding:4px 0; list-style:none; }
.advanced-copy-summary::-webkit-details-marker { display:none; }
.summary-left, .summary-right { display:flex; align-items:center; gap:8px; font-size:13px; }
.summary-left { font-weight:600; color:var(--text-strong); }
.summary-right { color:var(--muted); font-size:12px; }
.arrow-icon.is-open { transform:rotate(180deg); }
.copy-body { padding-top:18px; display:flex; flex-direction:column; gap:24px; }
.copy-body > .info-callout { flex-wrap:wrap; }
.copy-group-head { margin-bottom:12px; display:flex; flex-direction:column; gap:3px; }
.copy-group-title { color:var(--text-strong); font-size:13px; font-weight:600; }
.copy-grid { display:flex; flex-direction:column; gap:16px; max-width:600px; }
@container(max-width:480px) { .asset-item { grid-template-columns:minmax(0,1fr); gap:10px; } .asset-item > :not(.asset-preview) { grid-column:1; } .asset-preview { grid-row:auto; width:72px; height:72px; } .summary-badge { display:none; } }
</style>
