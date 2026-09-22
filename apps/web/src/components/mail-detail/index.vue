<template>
  <div class="mail-detail-container" :class="{ 'is-embedded': isEmbedded, 'is-conversation-item': conversationItem }">
    <div class="detail-toolbar" v-if="(email && email.emailId) || !isEmbedded" role="group" :aria-label="$t('mailActions')">
      <button v-if="!isEmbedded && !conversationItem" type="button" class="tool-btn" @click="$emit('back')" :title="$t('back')" :aria-label="$t('back')">
        <Icon icon="solar:arrow-left-linear" width="20" height="20" />
        <span class="tool-label">{{ $t('back') }}</span>
      </button>
      <button v-else-if="!conversationItem" type="button" class="tool-btn" @click="$emit('close')" :title="$t('closeMailDetailEsc')" :aria-label="$t('closeMailDetail')">
        <Icon icon="solar:close-circle-linear" width="20" height="20" />
        <span class="tool-label">{{ $t('close') }}</span>
      </button>
      <span v-if="email && email.emailId && !conversationItem" class="toolbar-divider" aria-hidden="true"></span>
      <div class="tool-actions" v-if="email && email.emailId">
        <button type="button" class="tool-btn" :class="{ 'is-starred': email.isStar, 'is-starring': isStarAnimating }" @click="toggleStar" v-if="showStar"
          :title="email.isStar ? $t('cancelStar') : $t('starMail')" :aria-label="email.isStar ? $t('cancelStar') : $t('starMail')" :aria-pressed="!!email.isStar">
          <Icon :icon="email.isStar ? 'solar:star-bold' : 'solar:star-linear'" width="20" height="20" />
          <span class="tool-label">{{ email.isStar ? $t('starredFlag') : $t('star') }}</span>
        </button>
        <button type="button" class="tool-btn" v-if="showUnread && email.unread === EmailUnreadEnum.READ" @click="handleMarkUnread"
          :title="$t('markAsUnread')" :aria-label="$t('markAsUnread')">
          <Icon icon="solar:letter-unread-linear" width="20" height="20" />
          <span class="tool-label">{{ $t('markAsUnread') }}</span>
        </button>
        <button type="button" class="tool-btn danger" v-perm="'email:delete'" @click="handleDelete" :title="$t('deleteMail')" :aria-label="$t('deleteMail')">
          <Icon icon="solar:trash-bin-trash-linear" width="20" height="20" />
          <span class="tool-label">{{ $t('delete') }}</span>
        </button>
        <button type="button" class="tool-btn" @click="forceLightView = !forceLightView" v-if="uiStore.dark"
          :title="forceLightView ? $t('restoreDarkReading') : $t('viewOriginalLight')"
          :aria-label="forceLightView ? $t('restoreDarkReading') : $t('viewOriginalLight')" :aria-pressed="forceLightView">
          <Icon :icon="forceLightView ? 'solar:moon-stars-linear' : 'solar:sun-2-linear'" width="20" height="20" />
          <span class="tool-label">{{ forceLightView ? $t('dark') : $t('originalLook') }}</span>
        </button>
      </div>
      <button v-if="conversationItem" type="button" class="tool-btn collapse-message" :aria-expanded="true"
        @click="$emit('collapse')" :title="$t('collapseMessage')" :aria-label="$t('collapseMessage')">
        <Icon icon="solar:alt-arrow-up-linear" width="20" height="20" />
        <span class="tool-label">{{ $t('collapseMessage') }}</span>
      </button>
    </div>

    <el-scrollbar class="detail-scrollbar" v-if="email && email.emailId">
      <div class="detail-content-wrapper">
        <header class="email-header-meta">
          <h1 v-if="!conversationItem" class="email-subject-title reading-aligned">{{ email.subject || $t('noSubjectParens') }}</h1>
          <div class="sender-profile">
            <div class="sender-avatar" aria-hidden="true">{{ getSenderAvatarText(email.name, email.sendEmail) }}</div>
            <div class="sender-details">
              <div class="sender-primary-line">
                <span class="sender-display-name">{{ email.name || email.sendEmail }}</span>
                <span class="sender-address" v-if="email.name">&lt;{{ email.sendEmail }}&gt;</span>
              </div>
              <details class="delivery-details" :key="email.emailId">
                <summary class="delivery-summary" :title="$t('toggleMailDetail')">
                  <span class="recipient-desc"><i18n-t keypath="sentTo" scope="global"><template #recipients>{{ formatReceive(email.recipient) || email.toEmail || $t('recipientUnavailable') }}</template></i18n-t></span>
                  <Icon icon="solar:alt-arrow-down-linear" width="14" height="14" class="details-chevron" />
                </summary>
                <div class="delivery-expanded">
                  <dl class="delivery-fields">
                    <template v-if="conversationItem">
                      <dt>{{ $t('subject') }}</dt>
                      <dd class="original-subject">{{ email.subject || $t('noSubjectParens') }}</dd>
                    </template>
                    <dt>{{ $t('sender') }}</dt>
                    <dd class="delivery-field-value">
                      <span>{{ email.name ? `${email.name} <${email.sendEmail}>` : email.sendEmail }}</span>
                      <button v-if="email.sendEmail" type="button" class="copy-address-btn" @click.stop="copyAddress(email.sendEmail)" :title="$t('copy')" :aria-label="$t('copy')">
                        <Icon icon="solar:copy-linear" width="13" height="13" />
                      </button>
                    </dd>
                    <template v-if="formatReceive(email.replyTo)">
                      <dt>{{ $t('replyToAddress') }}</dt>
                      <dd class="delivery-field-value">
                        <span>{{ formatReceive(email.replyTo) }}</span>
                        <button type="button" class="copy-address-btn" @click.stop="copyAddress(formatReceive(email.replyTo))" :title="$t('copy')" :aria-label="$t('copy')">
                          <Icon icon="solar:copy-linear" width="13" height="13" />
                        </button>
                      </dd>
                    </template>
                    <dt>{{ $t('recipient') }}</dt>
                    <dd class="delivery-field-value">
                      <span>{{ formatReceive(email.recipient) || email.toEmail || $t('recipientUnavailable') }}</span>
                      <button v-if="email.toEmail || email.recipient" type="button" class="copy-address-btn" @click.stop="copyAddress(formatReceive(email.recipient) || email.toEmail)" :title="$t('copy')" :aria-label="$t('copy')">
                        <Icon icon="solar:copy-linear" width="13" height="13" />
                      </button>
                    </dd>
                    <template v-if="formatReceive(email.cc)">
                      <dt>{{ $t('cc') }}</dt>
                      <dd class="delivery-field-value">
                        <span>{{ formatReceive(email.cc) }}</span>
                        <button type="button" class="copy-address-btn" @click.stop="copyAddress(formatReceive(email.cc))" :title="$t('copy')" :aria-label="$t('copy')">
                          <Icon icon="solar:copy-linear" width="13" height="13" />
                        </button>
                      </dd>
                    </template>
                    <template v-if="formatReceive(email.bcc)">
                      <dt>{{ $t('bcc') }}</dt>
                      <dd class="delivery-field-value">
                        <span>{{ formatReceive(email.bcc) }}</span>
                        <button type="button" class="copy-address-btn" @click.stop="copyAddress(formatReceive(email.bcc))" :title="$t('copy')" :aria-label="$t('copy')">
                          <Icon icon="solar:copy-linear" width="13" height="13" />
                        </button>
                      </dd>
                    </template>
                    <dt>{{ $t('time') }}</dt><dd>{{ formatDetailDate(email.createTime) }}</dd>
                  </dl>
                  <button type="button" class="save-contact-action" :disabled="isSenderInContacts || !email.sendEmail" @click="handleQuickSaveContact">
                    <Icon :icon="isSenderInContacts ? 'solar:user-check-rounded-bold' : 'solar:user-plus-linear'" width="16" height="16" />
                    <span>{{ isSenderInContacts ? $t('alreadyInContacts') : $t('saveAsContact') }}</span>
                  </button>
                </div>
              </details>
            </div>
            <time class="meta-time-text" :title="formatDetailDate(email.createTime)">{{ formatMailListTime(email.createTime) }}</time>
          </div>
          <div class="reading-aligned" v-if="email.code">
            <button type="button" class="verification-code-chip" :class="{ 'is-copied': isCodeCopied }" @click="copyVerificationCode(email.code)" :title="$t('copyCode')" :aria-label="$t('copyCode')">
              <span class="code-label">{{ isCodeCopied ? $t('copySuccessMsg') : $t('verificationCode') }}</span>
              <span class="code-value">{{ email.code }}</span>
              <Icon :icon="isCodeCopied ? 'solar:check-circle-linear' : 'solar:copy-linear'" width="16" height="16" />
            </button>
          </div>
          <div class="alert-block reading-aligned" v-if="email.status === 3 || email.status === 4 || email.status === 5">
            <el-alert v-if="email.status === 3" :closable="false" :title="toMessage(email.message)" type="error" show-icon />
            <el-alert v-if="email.status === 4" :closable="false" :title="$t('complained')" type="warning" show-icon />
            <el-alert v-if="email.status === 5" :closable="false" :title="$t('delayed')" type="warning" show-icon />
          </div>
        </header>

        <div class="email-body-content reading-aligned" :class="{ 'is-forced-light': forceLightView }">
          <ShadowHtml v-if="email.content" :html="email.content" :key="email.emailId" :force-light="forceLightView" />
          <div v-else class="email-plain-text" :class="{ 'is-empty': !email.text }">{{ email.text || $t('noBodyText') }}</div>
        </div>

        <section class="email-attachments-section reading-aligned" v-if="email.attList && email.attList.length > 0" :aria-label="$t('mailAttachments')">
          <div class="att-section-header">
            <Icon icon="solar:paperclip-2-linear" width="16" height="16" />
            <span>{{ $t('attachmentCount', { count: email.attList.length }) }}</span>
          </div>
          <div class="att-grid">
            <div class="att-card" v-for="att in email.attList" :key="att.attId" :class="{ 'is-downloading': isDownloading(att) }">
              <button type="button" class="att-open" @click="handleDownload(att)" :title="$t('downloadFile', { name: att.filename })" :disabled="isDownloading(att)">
                <Icon v-if="isDownloading(att)" class="att-file-icon is-spinning" icon="solar:restart-linear" width="24" height="24" />
                <Icon v-else class="att-file-icon" :icon="getIconByName(getExtName(att.filename))" width="24" height="24" />
                <span class="att-info">
                  <span class="att-name">{{ att.filename }}</span>
                  <span class="att-size">{{ formatBytes(att.size) }}</span>
                </span>
              </button>
              <div class="att-actions">
                <button v-if="isImage(att.filename)" type="button" class="att-opt-btn" :title="$t('previewImage')" :aria-label="$t('previewFile', { name: att.filename })" @click="showImage(att.key)">
                  <Icon icon="solar:eye-linear" width="18" height="18" />
                </button>
                <button type="button" class="att-opt-btn" :class="{ 'is-loading': isDownloading(att) }" :disabled="isDownloading(att)" :title="$t('downloadAttachment')" :aria-label="$t('downloadFile', { name: att.filename })" @click="handleDownload(att)">
                  <Icon :icon="isDownloading(att) ? 'solar:restart-linear' : 'solar:download-linear'" :class="{ 'is-spinning': isDownloading(att) }" width="18" height="18" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <div class="body-actions reading-aligned" v-if="showReply" v-perm="'email:send'">
          <button type="button" class="body-action-btn reply-action" @click="openReply">
            <Icon icon="solar:chat-round-line-linear" width="18" height="18" /><span>{{ $t('reply') }}</span>
          </button>
          <button type="button" class="body-action-btn" @click="openForward">
            <Icon icon="solar:plain-2-linear" width="18" height="18" /><span>{{ $t('forward') }}</span>
          </button>
        </div>
      </div>
    </el-scrollbar>

    <div v-else class="detail-empty-wrap">
      <Icon icon="solar:letter-opened-linear" width="40" height="40" />
      <h3>{{ $t('selectMailTitle') }}</h3>
      <p>{{ $t('selectMailDesc') }}</p>
    </div>

    <el-image-viewer v-if="showPreview" :url-list="srcList" show-progress @close="showPreview = false" />
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import ShadowHtml from '@/components/shadow-html/index.vue';
import { emailDelete, emailRead, emailUnread } from '@/request/email.js';
import { starAdd, starCancel } from '@/request/star.js';
import { useUiStore } from '@/store/ui.js';
import { useContactStore } from '@/store/contact.js';
import { formatDetailDate } from '@/utils/day.js';
import { formatMailListTime } from '@/utils/mail-list-time.js';
import { getExtName, formatBytes, downloadFileFromUrl } from '@/utils/file-utils.js';
import { toPrivateAttachmentUrl } from '@/utils/convert.js';
import { getIconByName } from '@/utils/icon-utils.js';
import { EmailUnreadEnum } from '@/enums/email-enum.js';

const props = defineProps({
  email: {
    type: Object,
    default: () => ({})
  },
  delType: {
    type: String,
    default: 'logic'
  },
  showStar: {
    type: Boolean,
    default: true
  },
  showReply: {
    type: Boolean,
    default: true
  },
  showUnread: {
    type: Boolean,
    default: true
  },
  isEmbedded: {
    type: Boolean,
    default: false
  },
  conversationItem: {
    type: Boolean,
    default: false
  },
  autoRead: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['starChange', 'deleteSuccess', 'back', 'close', 'unreadChange', 'collapse']);
const { t } = useI18n();
const uiStore = useUiStore();
const contactStore = useContactStore();

const showPreview = ref(false);
const srcList = reactive([]);
const forceLightView = ref(false);
const isCodeCopied = ref(false);
const isStarAnimating = ref(false);

function getSenderAvatarText(name, sendEmail) {
  const str = (name || sendEmail || '').trim();
  if (!str) return '✉';
  return str.charAt(0).toUpperCase();
}

function copyVerificationCode(code) {
  if (!code) return;
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(code).then(() => {
      isCodeCopied.value = true;
      setTimeout(() => { isCodeCopied.value = false; }, 1500);
      ElMessage.success(t('codeCopiedMsg'));
    }).catch(() => {
      ElMessage.warning(t('copyCodeManualMsg'));
    });
  } else {
    ElMessage.warning(t('copyCodeManualMsg'));
  }
}

watch(() => props.email?.emailId, () => {
  forceLightView.value = false;
});

function onKeyDown(e) {
  if (e.key === 'Escape' && props.isEmbedded && props.email?.emailId) {
    emit('close');
  }
}

onMounted(() => {
  contactStore.fetchContacts();
  window.addEventListener('keydown', onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
});

const isSenderInContacts = computed(() => {
  if (!props.email?.sendEmail) return false;
  const sEmail = props.email.sendEmail.toLowerCase();
  return (contactStore.contacts || []).some(c => c.email?.toLowerCase() === sEmail);
});

// Auto mark as read when viewing an unread email
watch(() => props.email?.emailId, async (newId) => {
  if (newId && props.autoRead && props.showUnread && props.email.unread === EmailUnreadEnum.UNREAD) {
    const target = props.email;
    try {
      await emailRead([newId]);
      target.unread = EmailUnreadEnum.READ;
      emit('unreadChange', target);
    } catch (err) {
      target.unread = EmailUnreadEnum.UNREAD;
      console.error(err);
    }
  }
}, { immediate: true });

async function handleMarkUnread() {
  if (!props.email?.emailId) return;
  try {
    await emailUnread([props.email.emailId]);
    props.email.unread = EmailUnreadEnum.UNREAD;
    ElMessage.success(t('markedAsUnreadMsg'));
    emit('unreadChange', props.email);
  } catch (err) {
    if (err?.message) {
      ElMessage.error(err.message);
    }
  }
}

async function copyAddress(address) {
  if (!address) return;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(address);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = address;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    ElMessage.success(t('addressCopiedMsg'));
  } catch (err) {
    console.error(err);
  }
}

function openReply() {
  const target = uiStore.writerRef?.value || uiStore.writerRef;
  if (target?.openReply) {
    target.openReply(props.email);
  }
}

function openForward() {
  const target = uiStore.writerRef?.value || uiStore.writerRef;
  if (target?.openForward) {
    target.openForward(props.email);
  }
}

function toggleStar() {
  if (!props.email?.emailId) return;
  isStarAnimating.value = true;
  setTimeout(() => { isStarAnimating.value = false; }, 280);
  if (props.email.isStar) {
    props.email.isStar = 0;
    starCancel(props.email.emailId).then(() => {
      emit('starChange', { ...props.email, isStar: 0 });
    }).catch(err => {
      console.error(err);
      props.email.isStar = 1;
    });
  } else {
    props.email.isStar = 1;
    starAdd(props.email.emailId).then(() => {
      emit('starChange', { ...props.email, isStar: 1 });
    }).catch(err => {
      console.error(err);
      props.email.isStar = 0;
    });
  }
}

function handleDelete() {
  if (!props.email?.emailId) return;
  ElMessageBox.confirm(t('delEmailConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(async () => {
    try {
      await emailDelete(props.email.emailId);
      ElMessage.success(t('delSuccessMsg'));
      emit('deleteSuccess', props.email.emailId);
    } catch (err) {
      ElMessage.error(err?.message || t('deleteFailedMsg'));
    }
  }).catch(() => {});
}

async function handleQuickSaveContact() {
  if (!props.email?.sendEmail || isSenderInContacts.value) return;
  try {
    const contactName = props.email.name || props.email.sendEmail.split('@')[0];
    await contactStore.createContact({
      name: contactName,
      email: props.email.sendEmail,
      remark: t('contactRemarkFromMail', { subject: props.email.subject || t('noSubjectParens') })
    });
    ElMessage.success(t('contactAddedMsg', { name: contactName }));
  } catch (err) {
    ElMessage.error(err?.message || t('saveFailedMsg'));
  }
}

function formatReceive(recipient) {
  if (!recipient) return '';
  try {
    const parsed = typeof recipient === 'string' ? JSON.parse(recipient) : recipient;
    if (Array.isArray(parsed)) {
      return parsed.map(item => item.address || item).join(', ');
    }
    return String(recipient);
  } catch (_) {
    return String(recipient);
  }
}

function toMessage(message) {
  if (!message) return '';
  try {
    return JSON.parse(message).message || message;
  } catch (_) {
    return message;
  }
}

function formatImage(content) {
  if (!content) return '';
  return content.replace(/{{domain}}/g, '/api/attachment/');
}

function showImage(key) {
  if (!isImage(key)) return;
  const url = toPrivateAttachmentUrl(key);
  srcList.length = 0;
  srcList.push(url);
  showPreview.value = true;
}

function isImage(filename) {
  if (!filename) return false;
  return ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'jfif', 'webp', 'svg'].includes(getExtName(filename));
}

const downloadingAtts = reactive(new Set());

function getAttKey(att) {
  return att?.attId || att?.key;
}

function isDownloading(att) {
  return downloadingAtts.has(getAttKey(att));
}

async function handleDownload(att) {
  const attKey = getAttKey(att);
  if (downloadingAtts.has(attKey)) return;
  downloadingAtts.add(attKey);
  ElMessage({ message: t('downloadStartedMsg', { name: att.filename }), type: 'info', plain: true, duration: 2500 });
  try {
    const url = toPrivateAttachmentUrl(att.key);
    await downloadFileFromUrl(url, att.filename);
  } catch (e) {
    ElMessage.error(t('downloadFailed'));
  } finally {
    downloadingAtts.delete(attKey);
  }
}

onMounted(() => {
  contactStore.fetchContacts();
});
</script>

<style scoped lang="scss">
.mail-detail-container {
  height: 100%;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  overflow: hidden;
  container-type: inline-size;
  container-name: maildetail;
}

button { font: inherit; }
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  height: 44px;
  padding: 0 8px;
  flex-shrink: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 40%, var(--surface));
  box-sizing: border-box;
}

.toolbar-divider {
  height: 18px;
  width: 1px;
  background: var(--line);
  margin: 0 6px;
  flex-shrink: 0;
}

.tool-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.tool-label { line-height: 1; }
.collapse-message { margin-left: auto; }
.tool-btn svg { flex-shrink: 0; }
.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  gap: 6px;
  min-width: 38px;
  height: 38px;
  padding: 0 8px;
  border: 0;
  border-radius: 19px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;

  &:hover { background: color-mix(in srgb, var(--text) 7%, transparent); color: var(--text-strong); }
  &.is-starred { color: #d99b16; }
  &.danger:hover { color: var(--el-color-danger); }
}

.detail-scrollbar { flex: 1; min-height: 0; overflow: hidden; }
.is-conversation-item {
  height: auto;
  min-height: 0;

  .detail-toolbar { flex: none; }
  .detail-scrollbar { flex: none; height: auto; overflow: visible; }
  :deep(.detail-scrollbar .el-scrollbar__wrap) { max-height: none; overflow: visible; }
  :deep(.detail-scrollbar .el-scrollbar__bar) { display: none; }
}
.detail-content-wrapper {
  --reading-inset: 48px;
  width: 100%;
  max-width: 1120px;
  margin: 0;
  padding: 20px 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 0;
  box-sizing: border-box;
}
.reading-aligned { margin-left: var(--reading-inset); min-width: 0; }
.email-header-meta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 18px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--line);
}
.email-subject-title {
  margin-top: 0;
  margin-bottom: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.sender-profile {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: start;
  gap: 0 12px;
}
.sender-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 600;
  user-select: none;
}
.sender-details { min-width: 0; }
.sender-primary-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; line-height: 1.5; overflow-wrap: anywhere; }
.sender-display-name { font-size: 13px; font-weight: 500; color: var(--text); }
.sender-address { font-size: 12px; color: var(--muted); }
.meta-time-text { margin-top: 2px; font-size: 12px; line-height: 1.6; color: var(--muted); white-space: nowrap; }

.delivery-summary {
  display: flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  max-width: 100%;
  padding: 2px 0;
  border-radius: 4px;
  list-style: none;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);

  &::-webkit-details-marker { display: none; }
  &:hover { color: var(--text-strong); }
}
.recipient-desc { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.details-chevron { flex-shrink: 0; transition: transform 150ms ease; }
.delivery-details[open] .details-chevron { transform: rotate(180deg); }
.delivery-expanded { margin-top: 8px; padding: 12px 14px; background: var(--paper-soft); border-radius: 8px; }
.delivery-fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;

  dt { color: var(--muted); }
  dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
}
.delivery-field-value {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}
.copy-address-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  line-height: 1;
  transition: color 150ms ease, background-color 150ms ease;

  &:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
}
.save-contact-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 4px 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;

  &:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
  &:disabled { color: var(--muted); cursor: default; }
}
.verification-code-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 7%, var(--surface));
  color: var(--accent);
  cursor: pointer;

  .code-label { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .code-value { font-family: var(--font-mono, monospace); font-size: 15px; font-weight: 600; letter-spacing: 1px; user-select: all; overflow-wrap: anywhere; min-width: 0; }
  svg { flex-shrink: 0; }
  &:hover { background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
}

.email-body-content {
  min-height: 80px;
  font-size: 15px;
  line-height: 1.7;
  color: var(--text);

  &.is-forced-light { background: #fff; color: #1e293b; padding: 16px; border-radius: 8px; }
}
.email-plain-text { max-width: 78ch; white-space: pre-wrap; overflow-wrap: anywhere; }
.email-plain-text.is-empty { color: var(--muted); }

.email-attachments-section { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line); }
.att-section-header { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; font-size: 12px; color: var(--muted); }
.att-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.att-card {
  display: flex;
  align-items: center;
  flex: 0 1 300px;
  max-width: 100%;
  min-width: 0;
  padding-right: 6px;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--paper-soft);
  transition: background-color 150ms ease;

  &:hover { background: color-mix(in srgb, var(--text) 7%, var(--surface)); }
}
.att-open {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 10px 8px 10px 12px;
  border: 0;
  border-radius: 8px;
  color: var(--text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.att-file-icon { flex-shrink: 0; color: var(--muted); }
.att-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.att-size { font-size: 11px; color: var(--muted); }
.att-actions { display: flex; gap: 2px; flex-shrink: 0; }
.att-opt-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--muted);
  background: transparent;
  cursor: pointer;

  &:hover { color: var(--text-strong); background: color-mix(in srgb, var(--text) 8%, transparent); }
}
.body-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line); }
.body-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 38px;
  padding: 0 20px;
  border: 0;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  background: var(--paper-soft);
  color: var(--text);
  cursor: pointer;

  &:hover { background: color-mix(in srgb, var(--text) 9%, var(--surface)); }
  &.reply-action { background: color-mix(in srgb, var(--accent) 10%, var(--surface)); color: var(--accent); }
  &.reply-action:hover { background: color-mix(in srgb, var(--accent) 16%, var(--surface)); }
}
.detail-empty-wrap {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: var(--muted);
  text-align: center;

  h3 { margin: 0; font-size: 15px; color: var(--text-strong); font-weight: 500; }
  p { margin: 0; font-size: 13px; line-height: 1.6; }
}

@container maildetail (max-width: 640px) {
  .detail-content-wrapper { --reading-inset: 0px; padding: 16px 16px 24px; }
  .email-header-meta { padding-bottom: 16px; margin-bottom: 16px; }
  .email-subject-title { font-size: 20px; }
  .sender-profile { grid-template-columns: 36px minmax(0, 1fr); }
  .meta-time-text { grid-column: 2; margin-top: 4px; }
}

@container maildetail (max-width: 340px) {
  .tool-btn { width: 38px; padding: 0; gap: 0; border-radius: 50%; }
  .tool-label { display: none; }
}

@container maildetail (max-width: 600px) {
  .is-conversation-item .tool-btn { width: 38px; padding: 0; gap: 0; }
  .is-conversation-item .tool-label { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .tool-btn, .details-chevron, .att-card { transition: none; }
}

.is-spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.att-card.is-downloading {
  opacity: 0.85;
}

.att-opt-btn.is-loading {
  color: var(--accent);
  cursor: wait;
}
</style>
