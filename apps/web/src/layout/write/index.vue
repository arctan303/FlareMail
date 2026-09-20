<template>
  <div class="send" v-show="show" :class="{ 'is-minimized': isMinimized }">
    <div class="write-box arc-card">
      <!-- 顶栏组件（支持全屏和最小化挂起胶囊两种形态） -->
      <ComposeHeader
        v-model="form.accountId"
        :account-options="accountOptions"
        :subject="form.subject"
        :is-minimized="isMinimized"
        @change="onSendAccountChange"
        @toggle-minimize="isMinimized = !isMinimized"
        @close="close"
      />

      <div class="container" v-show="!isMinimized">
        <!-- 收件人输入行 -->
        <div class="compose-field-row">
          <div class="field-label">{{ $t('recipient') }}：</div>
          <div class="field-input-wrapper">
            <el-input-tag
              @add-tag="addTagChange"
              tag-type="primary"
              @input="inputChange"
              size="default"
              v-model="form.receiveEmail"
              class="compose-tag-input"
              :placeholder="$t('recipientPlaceholder')"
            >
              <template #prefix>
                <el-select
                  ref="mySelect"
                  class="write-select"
                  popper-class="write-select"
                  :show-arrow="false"
                  :no-match-text="' '"
                  :no-data-text="' '"
                  @visible-change="selectStatusChange"
                  @change="selectChange"
                >
                  <el-option
                    v-for="item in selectRecipientList"
                    :key="item"
                    :label="item"
                    :value="item"
                    style="color: var(--regular-text-color);"
                  />
                </el-select>
              </template>
              <template #suffix>
                <div class="recipient-suffix-actions">
                  <el-tooltip :content="$t('chooseContact')" placement="top" :show-after="100">
                    <button type="button" class="field-tool-btn" @click.stop="openContacts">
                      <Icon icon="solar:users-group-rounded-linear" width="16" height="16" />
                      <span>{{ $t('contacts') }}</span>
                    </button>
                  </el-tooltip>
                </div>
              </template>
            </el-input-tag>
          </div>
        </div>

        <!-- 主题输入行 -->
        <div class="compose-field-row">
          <div class="field-label">{{ t('subject') }}：</div>
          <div class="field-input-wrapper">
            <el-input
              v-model="form.subject"
              :placeholder="t('subjectPlaceholder')"
              class="compose-subject-input"
              clearable
            />
          </div>
        </div>

        <!-- 富文本编辑器区 -->
        <div class="compose-editor-area">
          <tinyEditor :def-value="defValue" ref="editor" @change="change" @focus="focusChange" />
        </div>

        <!-- 底部操作栏与附件区 -->
        <div class="compose-bottom-bar">
          <div class="bottom-left-group">
            <el-button
              type="primary"
              class="arc-btn send-btn-primary"
              :disabled="isDraftAccountInvalid"
              @click="sendEmail"
            >
              <Icon icon="solar:plain-2-linear" width="16" height="16" style="margin-right: 5px" />
              <span v-if="form.sendType === 'reply'">{{ $t('reply') }}</span>
              <span v-else-if="form.sendType === 'forward'">{{ $t('forward') }}</span>
              <span v-else>{{ $t('send') }}</span>
              <span class="key-shortcut">Ctrl+Enter</span>
            </el-button>

            <button type="button" class="bottom-tool-btn" @click="chooseFile" :title="$t('addAttachment')">
              <Icon icon="solar:paperclip-2-linear" width="18" height="18" />
              <span>{{ $t('addAttachment') }}</span>
            </button>

            <button type="button" class="bottom-tool-btn danger" @click="clearContent" :title="$t('clearAllContent')">
              <Icon icon="solar:eraser-linear" width="17" height="17" />
              <span>{{ $t('clearAll') }}</span>
            </button>
          </div>

          <!-- 附件列表组件展示 -->
          <div class="bottom-center-attachments" v-if="form.attachments && form.attachments.length > 0">
            <ComposeAttachments :attachments="form.attachments" @delete="delAtt" />
          </div>

          <!-- 右侧失效/状态提示 -->
          <div class="bottom-right-group">
            <div v-if="isDraftAccountInvalid" class="account-invalid-tip">
              {{ $t('senderMailboxInvalid') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 通讯录选择弹窗 -->
    <ComposeContactsModal
      v-model:visible="showContacts"
      :contacts="contactStore.contacts"
      :recent-recipients="writerStore.sendRecipientRecord"
      :current-recipients="form.receiveEmail"
      @select="onContactsSelected"
      @delete-recent="onDeleteRecentRecipient"
      @clear-recent="onClearRecentRecipients"
    />
  </div>
</template>

<script setup>
import { computed, h, nextTick, onMounted, onUnmounted, reactive, ref, toRaw, watch } from 'vue'
import { Icon } from '@iconify/vue'
import tinyEditor from '@/components/tiny-editor/index.vue'
import ComposeHeader from './components/ComposeHeader.vue'
import ComposeAttachments from './components/ComposeAttachments.vue'
import ComposeContactsModal from './components/ComposeContactsModal.vue'
import {useUserStore} from "@/store/user.js";
import {emailSend} from "@/request/email.js";
import {isEmail} from "@/utils/verify-utils.js";
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import {fileToBase64, formatBytes} from "@/utils/file-utils.js";
import {getIconByName} from "@/utils/icon-utils.js";
import sendPercent from "@/components/send-percent/index.vue"
import {formatDetailDate} from "@/utils/day.js";
import {userDraftStore} from "@/store/draft.js";
import {useWriterStore} from "@/store/writer.js";
import db from "@/db/db.js";
import dayjs from "dayjs";
import {useI18n} from "vue-i18n";
import router from "@/router/index.js";
import {ElMessage, ElMessageBox, ElNotification} from "element-plus";
import {useContactStore} from "@/store/contact.js";

defineExpose({
  open,
  openReply,
  openForward,
  openDraft,
  clearContent
})

const isMinimized = ref(false)
const {t} = useI18n()
const writerStore = useWriterStore();
const contactStore = useContactStore();
const draftStore = userDraftStore()
const emailStore = useEmailStore();
const accountStore = useAccountStore()
const editor = ref({})
const defValue = ref('')
const userStore = useUserStore();
const show = ref(false);
const percent = ref(0)
let percentMessage = null
let sending = false
const isDraftAccountInvalid = ref(false);

const accountOptions = computed(() => {
  const list = (accountStore.accountList?.length ? accountStore.accountList : userStore.user.accountList) || [];
  if (userStore.user?.email) {
    const mainEmail = userStore.user.email;
    const hasMain = list.some(item => item.email?.toLowerCase() === mainEmail.toLowerCase());
    if (!hasMain) {
      return [{
        accountId: userStore.user.account?.accountId || 0,
        email: mainEmail,
        name: userStore.user.name || mainEmail.split('@')[0]
      }, ...list];
    }
  }
  return list.length > 0 ? list : [{
    accountId: userStore.user?.account?.accountId || 0,
    email: userStore.user?.email || '',
    name: userStore.user?.name || ''
  }];
});

function onSendAccountChange(val) {
  const selected = accountOptions.value.find(item => item.accountId === val);
  if (selected) {
    form.accountId = selected.accountId;
    form.sendEmail = selected.email;
    form.name = selected.name;
    isDraftAccountInvalid.value = false;
  }
}
const contactsTabRef = ref({})
const showContacts = ref(false)
const mySelect = ref()
let selectStatus = false
const backReply = reactive({
  receiveEmail: [],
  subject: '',
  content: '',
  sendType: ''
})
const form = reactive({
  sendEmail: '',
  receiveEmail: [],
  accountId: -1,
  name: '',
  subject: '',
  content: '',
  sendType: '',
  text: '',
  emailId: 0,
  attachments: [],
  draftId: null,
  requestId: '',
})

const selectRecipientList = ref([])

function openContacts() {
  contactStore.fetchContacts();
  showContacts.value = true;
}

function onContactsSelected(selectedEmails) {
  selectedEmails.forEach(email => {
    if (!form.receiveEmail.includes(email)) {
      form.receiveEmail.push(email);
    }
  });
}

function onDeleteRecentRecipient(email) {
  writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.filter(item => item !== email);
  ElMessage.success(t('recordDeletedMsg'));
}

function onClearRecentRecipients() {
  writerStore.sendRecipientRecord = [];
  ElMessage.success(t('recentClearedMsg'));
}

function selectChange(value) {
  form.receiveEmail.push(value)
}

function selectStatusChange(status) {
  selectStatus = status
}

const openSelect = () => {
  mySelect.value?.toggleMenu()
}

function inputChange(value) {
  if (!value) {
    selectRecipientList.value = [];
    if (selectStatus) openSelect();
    return;
  }

  const kw = value.toLowerCase();
  const matchedContacts = (contactStore.contacts || [])
    .filter(c => !form.receiveEmail.includes(c.email) && (
      (c.email && c.email.toLowerCase().includes(kw)) ||
      (c.name && c.name.toLowerCase().includes(kw))
    ))
    .map(c => c.email);

  const matchedRecent = (writerStore.sendRecipientRecord || [])
    .filter(item => !form.receiveEmail.includes(item) && item.toLowerCase().includes(kw));

  selectRecipientList.value = Array.from(new Set([...matchedContacts, ...matchedRecent])).slice(0, 10);

  if (!selectStatus && selectRecipientList.value.length > 0) {
    openSelect()
  }

  if (selectStatus && selectRecipientList.value.length === 0) {
    openSelect()
  }
}

function addTagChange(val) {
  const emails = Array.from(new Set(
      val.split(/[,，;；]/).map(item => item.trim()).filter(item => item)
  ));

  form.receiveEmail.splice(form.receiveEmail.length - 1, 1)

  let has = false
  emails.forEach(email => {
    if (isEmail(email) && !form.receiveEmail.includes(email)) {
      form.receiveEmail.push(email)
      has = true
    }
  })
  if (selectStatus && has) openSelect()
}

function clearContent() {
  ElMessageBox.confirm(t('clearContentConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    resetForm()
  }).catch(() => {})
}

function delAtt(index) {
  form.attachments.splice(index, 1);
}

function chooseFile() {
  const doc = document.createElement("input")
  doc.setAttribute("type", "file")
  doc.multiple = true;
  doc.click()
  doc.onchange = async (e) => {
    const fileList = e.target.files;
    for (const file of fileList) {
      const size = file.size
      const filename = file.name
      const contentType = file.type
      const content = await fileToBase64(file)
      form.attachments.push({content, filename, size, contentType})
    }
  }
}

async function sendEmail() {
  if (form.receiveEmail.length === 0) {
    ElMessage({
      message: t('emptyRecipientMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (!form.subject) {
    ElMessage({
      message: t('emptySubjectMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (!form.content) {
    form.content = editor.value.getContent();
  }

  if (!form.content) {
    ElMessage({
      message: t('emptyContentMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (sending) {
    ElMessage({
      message: t('sendingErrorMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  percentMessage = ElMessage({
    message: () => h(sendPercent, {value: percent.value, desc: t('sending')}),
    dangerouslyUseHTMLString: true,
    plain: true,
    duration: 0,
    customClass: 'message-bottom'
  })

  sending = true

  if (!form.requestId) {
    form.requestId = crypto.randomUUID()
  }

  show.value = false

  emailSend(form, (e) => {
    percent.value = Math.round((e.loaded * 98) / e.total)
  }).then(emailList => {
    const email = emailList[0]
    emailList.forEach(item => {
      emailStore.sendScroll?.addItem(item)
    })

    ElNotification({
      title: email?.deliveryWarning ? t('deliveryWarningTitle') : t('sendSuccessMsg'),
      type: email?.deliveryWarning ? 'warning' : 'success',
      message: h('span', {style: 'color: teal'}, email?.deliveryWarning || email?.subject),
      position: 'bottom-right',
      duration: email?.deliveryWarning ? 0 : 4500,
    })

    userStore.refreshUserInfo();
    addRecipientRecord();

    if (form.draftId) {
      form.subject = ''
      form.content = ''
      form.receiveEmail = []
      draftStore.setDraft = {...toRaw(form)}
    }

    show.value = false
    isMinimized.value = false
    resetForm();
  }).catch((e) => {
    ElNotification({
      title: t('sendFailMsg'),
      type: e.code === 403 ? 'warning' : 'error',
      message: h('span', {style: 'color: teal'}, e.message),
      position: 'bottom-right'
    })
    if (e.code === 401) {
      router.replace('/login');
    }
    show.value = true
    addRecipientRecord();
  }).finally(() => {
    percentMessage?.close()
    percent.value = 0
    sending = false
  })
}

function addRecipientRecord() {
  writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.filter(
      email => !form.receiveEmail.includes(email)
  );

  writerStore.sendRecipientRecord.unshift(...form.receiveEmail);
  writerStore.sendRecipientRecord = writerStore.sendRecipientRecord.slice(0, 500);
}

function resetForm() {
  form.receiveEmail = []
  form.subject = ''
  form.content = ''
  form.manyType = null
  form.attachments = []
  form.sendType = ''
  form.emailId = 0
  form.draftId = null
  form.requestId = ''
  backReply.content = ''
  backReply.subject = ''
  backReply.receiveEmail = []
  backReply.sendType = ''
  editor.value?.clearEditor?.()
}

function change(content, text) {
  form.content = content;
  form.text = text
}

function focusChange() {
  if (selectStatus) openSelect()
}

function normalizeReplySubject(subject) {
  if (!subject) return 'Re: ';
  const cleaned = subject.replace(/^((re|fwd|fw|回复|转发)\s*[:：]\s*)+/gi, '').trim();
  return `Re: ${cleaned}`;
}

function normalizeForwardSubject(subject) {
  if (!subject) return 'Fwd: ';
  const cleaned = subject.replace(/^((re|fwd|fw|回复|转发)\s*[:：]\s*)+/gi, '').trim();
  return `Fwd: ${cleaned}`;
}

function openReply(email) {
  resetForm();
  form.sendType = 'reply';
  form.emailId = email.emailId;
  const replyAccount = accountOptions.value.find(item => item.email?.toLowerCase() === email.toEmail?.toLowerCase());
  const matchedTarget = replyAccount || accountOptions.value[0];
  form.accountId = matchedTarget.accountId;
  form.sendEmail = matchedTarget.email;
  form.name = matchedTarget.name;

  if (email.replyTo && email.replyTo.length > 0) {
    form.receiveEmail = email.replyTo.map(item => item.address);
  } else {
    form.receiveEmail = [email.sendEmail];
  }

  const rawSubject = (email.subject || '').replace(/{{code}}/g, email.code || '');
  form.subject = normalizeReplySubject(rawSubject);

  setTimeout(() => {
    defValue.value = `
    <p><br></p>
    <div class="gmail_quote flaremail_quote" style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #64748b;">
      <div class="flaremail_quote_header" style="font-size: 12.5px; margin-bottom: 8px; color: #64748b;">
        ${formatDetailDate(email.createTime)} ${email.name} &lt;${email.sendEmail}&gt; ${t('wrote')}:
      </div>
      <blockquote class="flaremail_quote_body mceNonEditable" style="margin: 0; padding-left: 12px; border-left: 2px solid #cbd5e1; color: inherit;">
        <article>
          ${formatImage(email.content) || `<pre style="font-family: inherit;word-break: break-word;white-space: pre-wrap;margin: 0">${email.text}</pre>`}
        </article>
      </blockquote>
    </div>`;
    open(matchedTarget);

    nextTick(() => {
      backReply.content = editor.value.getContent();
      backReply.subject = form.subject;
      backReply.receiveEmail = form.receiveEmail;
      backReply.sendType = form.sendType;
    });
  });
}

function openForward(email) {
  resetForm();
  form.sendType = 'forward';
  form.emailId = email.emailId;
  const forwardAccount = accountOptions.value.find(item => item.email?.toLowerCase() === email.toEmail?.toLowerCase());
  const matchedTarget = forwardAccount || accountOptions.value[0];
  form.accountId = matchedTarget.accountId;
  form.sendEmail = matchedTarget.email;
  form.name = matchedTarget.name;

  const rawSubject = (email.subject || '').replace(/{{code}}/g, email.code || '');
  form.subject = normalizeForwardSubject(rawSubject);

  setTimeout(() => {
    defValue.value = `
    <p><br></p>
    <div class="gmail_quote flaremail_quote" style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #64748b;">
      <div class="flaremail_quote_header" style="font-size: 12.5px; margin-bottom: 8px; color: #64748b;">
        ${formatDetailDate(email.createTime)} ${email.name} &lt;${email.sendEmail}&gt; ${t('wrote')}:
      </div>
      <blockquote class="flaremail_quote_body mceNonEditable" style="margin: 0; padding-left: 12px; border-left: 2px solid #cbd5e1; color: inherit;">
        <article>
          ${formatImage(email.content) || `<pre style="font-family: inherit;word-break: break-word;white-space: pre-wrap;margin: 0">${email.text}</pre>`}
        </article>
      </blockquote>
    </div>`;
    open(matchedTarget);

    nextTick(() => {
      backReply.content = editor.value.getContent();
      backReply.subject = form.subject;
      backReply.receiveEmail = form.receiveEmail;
      backReply.sendType = form.sendType;
    });
  });
}

function formatImage(content) {
  content = content || '';
  return content.replace(/{{domain}}/g, '/api/attachment/');
}

function open(targetAccountOrOptions) {
  isDraftAccountInvalid.value = false;
  isMinimized.value = false;
  let target = targetAccountOrOptions;
  if (target?.receiveEmail && Array.isArray(target.receiveEmail)) {
    form.receiveEmail = [...target.receiveEmail];
    target = target.targetAccount;
  }
  if (!target || !target.email) {
    if (accountStore.currentAccount?.email) {
      target = accountOptions.value.find(acc => acc.email?.toLowerCase() === accountStore.currentAccount.email.toLowerCase()) || accountOptions.value[0];
    } else {
      target = accountOptions.value[0];
    }
  }
  if (target) {
    form.sendEmail = target.email;
    form.accountId = target.accountId;
    form.name = target.name;
  }
  show.value = true;
  nextTick(() => {
    editor.value?.focus?.();
  });
}

function openDraft(draft) {
  resetForm();
  Object.assign(form, { ...draft });
  defValue.value = '';
  setTimeout(() => defValue.value = form.content);

  const matched = accountOptions.value.find(
    acc => acc.accountId === (draft.sendAccountId || draft.accountId) || acc.email?.toLowerCase() === (draft.sendEmail || '').toLowerCase()
  );
  if (matched) {
    form.accountId = matched.accountId;
    form.sendEmail = matched.email;
    form.name = matched.name;
    isDraftAccountInvalid.value = false;
  } else {
    isDraftAccountInvalid.value = true;
  }
  show.value = true;
  isMinimized.value = false;
  nextTick(() => {
    editor.value?.focus?.();
  });
}

const handleKeyDown = (event) => {
  if (event.key === 'Escape' && show.value && !isMinimized.value) {
    close()
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && show.value && !isMinimized.value) {
    event.preventDefault();
    sendEmail();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

function close() {
  if (selectStatus) openSelect();

  if (!form.content) {
    form.content = editor.value?.getContent?.() || '';
  }

  if (form.draftId) {
    draftStore.setDraft = {...toRaw(form)}
    show.value = false
    isMinimized.value = false
    resetForm()
    return;
  }

  if (!form.subject && !form.content && form.receiveEmail.length === 0) {
    show.value = false
    isMinimized.value = false
    resetForm()
    return;
  }

  if (form.sendType === 'reply' || form.sendType === 'forward') {
    if (form.content === backReply.content &&
        form.subject === backReply.subject &&
        form.receiveEmail.toString() === backReply.receiveEmail.toString()
    ) {
      show.value = false
      isMinimized.value = false
      resetForm()
      return;
    }
  }

  ElMessageBox.confirm(
      t('saveDraftTip'),
      {
        confirmButtonText: t('saveDraft'),
        cancelButtonText: t('dontSaveDraft'),
        type: 'warning',
        distinguishCancelAndClose: true,
      }
  ).then(() => {
    if (!form.subject) {
      form.subject = t('emptySubject')
    }
    const sendAccount = accountOptions.value.find(item => item.accountId === form.accountId) || accountOptions.value[0];
    const draftData = {
      ...toRaw(form),
      sendAccountId: sendAccount?.accountId,
      sendEmail: sendAccount?.email,
      sendName: sendAccount?.name,
      updateTime: new Date().getTime(),
      createTime: new Date().getTime(),
      userId: userStore.user.userId
    };
    db.draft.add(draftData).then(draftId => {
      draftData.draftId = draftId
      draftStore.setDraft = draftData
      show.value = false
      isMinimized.value = false
      resetForm()
      ElMessage.success(t('draftSavedMsg'));
    })
  }).catch((action) => {
    if (action === 'cancel') {
      show.value = false
      isMinimized.value = false
      resetForm()
    }
  })
}
</script>

<style>
.write-select .el-select-dropdown__list {
  padding: 4px 4px !important;
}
.write-select .el-select-dropdown__item {
  padding: 0 10px 0 10px;
}
.write-select .el-select-dropdown {
  min-width: 0 !important;
}
</style>

<style scoped lang="scss">
@use './write.scss';
</style>
