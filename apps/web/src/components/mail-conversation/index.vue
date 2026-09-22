<template>
  <section class="conversation" :aria-label="$t('conversation')">
    <header class="conversation-toolbar">
      <button type="button" class="conversation-tool" @click="$emit('back')"><Icon icon="solar:arrow-left-linear" width="20" />{{ $t('back') }}</button>
      <span class="conversation-count">{{ $t('conversationCount', { count: messages.length }) }}</span>
      <button type="button" class="conversation-tool" @click="toggleAll">{{ allExpanded ? $t('collapseAll') : $t('expandAll') }}</button>
    </header>
    <div class="conversation-scroll">
      <h1 class="conversation-subject">{{ conversationSubject(anchor.subject) || $t('noSubjectParens') }}</h1>
      <div v-if="partial" class="conversation-notice">{{ $t('conversationPartial') }}</div>
      <div v-if="error" class="conversation-error">
        <span>{{ $t('conversationLoadFailed') }}</span>
        <button type="button" @click="loadInitial(true)">{{ $t('retry') }}</button>
      </div>
      <div v-if="readError" class="conversation-error">
        <span>{{ $t('threadReadFailed') }}</span>
        <button type="button" @click="retryThreadRead">{{ $t('retry') }}</button>
      </div>
      <button v-if="hasMore" type="button" class="load-earlier" :disabled="loadingEarlier" @click="loadEarlier">
        {{ loadingEarlier ? $t('loading') : $t('loadEarlierMessages') }}
      </button>
      <div v-else-if="loading" class="conversation-loading">{{ $t('loading') }}</div>

      <article v-for="message in messages" :key="message.emailId" class="conversation-item" :class="{ 'is-expanded': isExpanded(message.emailId) }"
        :ref="element => setItemRef(message.emailId, element)">
        <button v-if="!isExpanded(message.emailId)" type="button" class="conversation-summary" :aria-expanded="false" @click="expand(message.emailId)">
          <span class="summary-avatar">{{ avatar(message) }}</span>
          <span class="summary-main">
            <span class="summary-line"><strong>{{ message.name || message.sendEmail }}</strong><time>{{ formatMailListTime(message.createTime) }}</time></span>
            <span class="summary-address">{{ Number(message.type) === 1 ? $t('sent') : $t('received') }} · {{ mailboxLabel(message) }}</span>
            <span class="summary-text">{{ conversationSnippet(message) || $t('noBodyText') }}</span>
          </span>
          <span v-if="Number(message.type) === 0 && Number(message.unread) === 0" class="unread-dot" :title="$t('unread')"></span>
        </button>
        <div v-else class="expanded-message">
          <MailDetailPane :email="message" :del-type="delType" :show-star="showStar" :show-reply="showReply"
            :show-unread="canManageUnread(message)" :auto-read="false" :is-embedded="false" conversation-item
            @collapse="collapse(message.emailId)"
            @delete-success="handleDelete" @star-change="$emit('star-change', $event)" @unread-change="handleUnreadChange" />
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import MailDetailPane from '@/components/mail-detail/index.vue'
import { emailConversation, emailConversationRead } from '@/request/email.js'
import { useEmailStore } from '@/store/email.js'
import { formatMailListTime } from '@/utils/mail-list-time.js'
import { applyReadIdsToMessages, conversationAllowsUnread, conversationSnippet, conversationSubject, createConversationRequestGate, initialExpandedIds, mergeConversationMessages } from '@/utils/mail-conversation.js'

const props = defineProps({
  anchor: { type: Object, default: () => ({}) },
  delType: { type: String, default: 'logic' },
  showStar: { type: Boolean, default: true },
  showReply: { type: Boolean, default: true },
  showUnread: { type: Boolean, default: true },
})
const emit = defineEmits(['back', 'delete-success', 'star-change', 'unread-change', 'thread-read'])
const emailStore = useEmailStore()
const messages = ref([]), expanded = ref(new Set()), loading = ref(false), loadingEarlier = ref(false), error = ref(''), readError = ref('')
const nextCursor = ref(null), hasMore = ref(false), partial = ref(false)
const readThroughEmailId = ref(null)
const gate = createConversationRequestGate(), readGate = createConversationRequestGate(), itemRefs = new Map()
let firstLoadForAnchor = 0
const confirmedReadIds = new Set()
const allExpanded = computed(() => messages.value.length > 0 && messages.value.every(item => expanded.value.has(Number(item.emailId))))
const explicitUnreadIds = new Set()

function reapplyLocalReadState() {
  applyReadIdsToMessages(messages.value, confirmedReadIds)
  messages.value.forEach(message => {
    if (explicitUnreadIds.has(Number(message.emailId))) message.unread = 0
  })
}

function setItemRef(id, element) { if (element) itemRefs.set(Number(id), element); else itemRefs.delete(Number(id)) }
function isExpanded(id) { return expanded.value.has(Number(id)) }
function expand(id) { expanded.value = new Set(expanded.value).add(Number(id)) }
function collapse(id) { const next = new Set(expanded.value); next.delete(Number(id)); expanded.value = next }
function toggleAll() { expanded.value = allExpanded.value ? new Set() : new Set(messages.value.map(item => Number(item.emailId))) }
function avatar(message) { return String(message.name || message.sendEmail || '✉').trim().charAt(0).toUpperCase() }
function mailboxLabel(message) { return Number(message.type) === 1 ? (message.sendEmail || '') : (message.toEmail || '') }
function canManageUnread(message) { return conversationAllowsUnread(props.showUnread, message) }

async function markThreadRead(anchorId, watermark, token = readGate.begin(anchorId)) {
  if (!props.showUnread || !watermark) return
  readError.value = ''
  try {
    const result = await emailConversationRead(anchorId, watermark)
    const readIds = result?.emailIds || []
    emit('thread-read', readIds)
    if (!readGate.isCurrent(token, props.anchor?.emailId)) return
    readIds.forEach(id => confirmedReadIds.add(Number(id)))
    reapplyLocalReadState()
    if (confirmedReadIds.has(Number(props.anchor?.emailId))) props.anchor.unread = 1
  } catch (cause) {
    if (readGate.isCurrent(token, props.anchor?.emailId)) readError.value = cause?.message || 'failed'
  }
}

function retryThreadRead() {
  const anchorId = Number(props.anchor?.emailId)
  if (!anchorId || !readThroughEmailId.value) return
  markThreadRead(anchorId, readThroughEmailId.value)
}

async function loadInitial(preserveExpanded = false) {
  const anchorId = Number(props.anchor?.emailId)
  if (!anchorId) return
  const token = gate.begin(anchorId), previousIds = new Set(expanded.value)
  loading.value = true; loadingEarlier.value = false; error.value = ''; readError.value = ''
  if (!messages.value.some(item => Number(item.emailId) === anchorId)) messages.value = mergeConversationMessages(messages.value, [], props.anchor)
  try {
    const data = await emailConversation(anchorId, 20)
    if (!gate.isCurrent(token, props.anchor?.emailId)) return
    messages.value = mergeConversationMessages([], data?.messages || [], data?.anchor || props.anchor)
    reapplyLocalReadState()
    expanded.value = preserveExpanded ? new Set([...previousIds, Number(messages.value.at(-1)?.emailId)].filter(Boolean)) : initialExpandedIds(messages.value, data?.anchorEmailId || anchorId)
    nextCursor.value = data?.nextCursor || null; hasMore.value = !!data?.hasMore; partial.value = !!(data?.scanLimited || data?.truncated)
    readThroughEmailId.value = data?.readThroughEmailId || null
    if (firstLoadForAnchor !== anchorId) {
      firstLoadForAnchor = anchorId
      await nextTick(); itemRefs.get(Number(messages.value.at(-1)?.emailId))?.scrollIntoView?.({ block: 'center' })
    }
    await markThreadRead(anchorId, readThroughEmailId.value)
  } catch (cause) {
    if (!gate.isCurrent(token, props.anchor?.emailId)) return
    error.value = cause?.message || 'failed'
    messages.value = mergeConversationMessages(messages.value, [], props.anchor)
    expanded.value = new Set(previousIds).add(anchorId)
  } finally {
    if (gate.isCurrent(token, props.anchor?.emailId)) loading.value = false
  }
}

async function loadEarlier() {
  if (!hasMore.value || loadingEarlier.value) return
  const anchorId = Number(props.anchor?.emailId), token = gate.begin(anchorId)
  loading.value = false; loadingEarlier.value = true; error.value = ''
  try {
    const data = await emailConversation(anchorId, 20, nextCursor.value)
    if (!gate.isCurrent(token, props.anchor?.emailId)) return
    messages.value = mergeConversationMessages(messages.value, data?.messages || [], data?.anchor)
    reapplyLocalReadState()
    nextCursor.value = data?.nextCursor || null; hasMore.value = !!data?.hasMore; partial.value ||= !!(data?.scanLimited || data?.truncated)
  } catch (cause) {
    if (gate.isCurrent(token, props.anchor?.emailId)) error.value = cause?.message || 'failed'
  } finally { if (gate.isCurrent(token, props.anchor?.emailId)) loadingEarlier.value = false }
}

function handleDelete(emailId) {
  const id = Number(emailId), anchorId = Number(props.anchor?.emailId)
  gate.begin(anchorId)
  loading.value = false; loadingEarlier.value = false; error.value = ''
  messages.value = messages.value.filter(item => Number(item.emailId) !== id)
  emailStore.deleteIds = [id]
  const shouldLeave = id === anchorId || messages.value.length === 0
  emit('delete-success', id, shouldLeave)
  if (!shouldLeave) loadInitial(true)
}

function handleUnreadChange(message) {
  const id = Number(message?.emailId)
  if (Number(message?.unread) === 1) {
    confirmedReadIds.add(id)
    explicitUnreadIds.delete(id)
  } else {
    confirmedReadIds.delete(id)
    explicitUnreadIds.add(id)
  }
  const local = messages.value.find(item => Number(item.emailId) === id)
  if (local) local.unread = message.unread
  emit('unread-change', message)
}

watch(() => props.anchor, () => {
  gate.begin(props.anchor?.emailId || 0)
  readGate.begin(props.anchor?.emailId || 0)
  confirmedReadIds.clear()
  explicitUnreadIds.clear()
  messages.value = props.anchor?.emailId ? [props.anchor] : []
  expanded.value = new Set(props.anchor?.emailId ? [Number(props.anchor.emailId)] : [])
  nextCursor.value = null; hasMore.value = false; partial.value = false; error.value = ''; readError.value = ''; readThroughEmailId.value = null; loading.value = false; loadingEarlier.value = false; firstLoadForAnchor = 0
  if (props.anchor?.emailId) loadInitial(false)
}, { immediate: true })
watch(() => emailStore.conversationRevision, () => loadInitial(true))
</script>

<style scoped lang="scss">
.conversation { height:100%; display:flex; flex-direction:column; background:var(--surface); }
.conversation-toolbar { min-height:48px; display:flex; align-items:center; gap:12px; padding:0 14px; border-bottom:1px solid var(--line); }
.conversation-tool { border:0; background:transparent; color:var(--text-strong); display:inline-flex; align-items:center; gap:6px; cursor:pointer; padding:7px 9px; border-radius:8px; }
.conversation-tool:hover,.load-earlier:hover { background:var(--paper-soft); }.conversation-tool:focus-visible,.load-earlier:focus-visible,.conversation-summary:focus-visible,.collapse-message:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.conversation-count { flex:1; color:var(--muted); font-size:13px; }
.conversation-subject { margin:0; padding:4px 14px 16px; font-size:24px; line-height:1.35; font-weight:650; color:var(--text-strong); overflow-wrap:anywhere; box-sizing:border-box; }
.conversation-scroll { flex:1; min-height:0; overflow:auto; padding:12px; }
.conversation-item { border:1px solid var(--line); border-radius:10px; margin-bottom:9px; overflow:hidden; background:var(--surface); }
.conversation-summary { width:100%; border:0; background:transparent; display:flex; gap:11px; padding:13px 14px; text-align:left; cursor:pointer; color:inherit; }
.summary-avatar { width:34px; height:34px; flex:none; border-radius:50%; display:grid; place-items:center; background:var(--paper-soft); color:var(--accent); font-weight:650; }
.summary-main { min-width:0; flex:1; display:grid; gap:3px; }.summary-line{display:flex;justify-content:space-between;gap:12px}.summary-line time,.summary-address,.summary-text{color:var(--muted);font-size:12.5px}.summary-address{overflow-wrap:anywhere}.summary-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.unread-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:8px}
.expanded-message { position:relative; }
.conversation-notice,.conversation-error,.conversation-loading { margin:0 0 10px; padding:10px 12px; border-radius:8px; background:var(--paper-soft); color:var(--muted); font-size:13px; }.conversation-error{display:flex;justify-content:space-between}.conversation-error button,.load-earlier{border:0;background:transparent;color:var(--accent);cursor:pointer}.load-earlier{display:block;margin:0 auto 10px;padding:8px 14px}
@media(max-width:767px){.conversation-scroll{padding:8px}.conversation-toolbar{padding:0 6px}.conversation-subject{padding:4px 6px 12px;font-size:20px}.summary-line{align-items:flex-start}.summary-line time{white-space:nowrap}}
</style>
