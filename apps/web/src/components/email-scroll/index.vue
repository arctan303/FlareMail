<template>
  <div class="email-container" :class="{ 'has-categories': showCategories, 'is-compact': isCompact }" :style="{ '--mail-row-height': itemHeight + 'px' }">
    <div class="header-actions">
      <el-checkbox
          v-model="checkAll"
          :indeterminate="isIndeterminate"
          :disabled="!emailList.length || loading"
          @change="handleCheckAllChange"
      >
      </el-checkbox>
      
      <!-- 当有勾选时：在顶部工具栏显示优雅的批量操作工具组 (Gmail / Apple Mail 风格) -->
      <div class="top-batch-bar" v-if="selectedMailsCount > 0">
        <span class="batch-selected-count">{{ $t('batchSelectedCount', { count: selectedMailsCount }) }}</span>
        <div class="batch-buttons">
          <button class="batch-action-btn" @click="handleRead" :title="$t('markAsReadBatch')" v-if="shouldShowUnread">
            <Icon icon="solar:letter-opened-linear" width="15" height="15" />
            <span>{{ $t('markAsReadBatch') }}</span>
          </button>
          <button class="batch-action-btn" @click="handleStar" :title="$t('markAsStarred')" v-if="props.showStar">
            <Icon icon="solar:star-linear" width="15" height="15" />
            <span>{{ $t('markAsStarred') }}</span>
          </button>
          <button class="batch-action-btn danger" @click="handleDelete" :title="showDelete ? $t('deleteForever') : $t('moveToTrash')">
            <Icon icon="solar:trash-bin-trash-linear" width="15" height="15" />
            <span>{{ showDelete ? $t('deleteForever') : $t('moveToTrash') }}</span>
          </button>
        </div>
      </div>

      <!-- 常规刷新与排序；分类在下方滚动区域 -->
      <template v-else>

        <div class="header-left" :style="'padding-left:' + actionLeft">
          <button
            class="tool-icon-btn refresh-btn"
            :class="{ 'is-spinning': isRefreshing }"
            :disabled="isRefreshing"
            :title="$t('refreshList')"
            @click="refresh"
          >
            <Icon icon="solar:restart-linear" width="16" height="16"/>
          </button>
          <slot name="first"></slot>
        </div>
      </template>

      <div class="header-right">
        <span class="email-count-badge" aria-live="polite">{{ pageRange }}</span>
        <button class="tool-icon-btn page-btn" type="button" :title="$t('previousPage')" :aria-label="$t('previousPage')" :disabled="loading || currentPage === 0" @click="changePage(-1)">
          <Icon icon="solar:alt-arrow-left-linear" width="20" height="20" />
        </button>
        <button class="tool-icon-btn page-btn" type="button" :title="$t('nextPage')" :aria-label="$t('nextPage')" :disabled="loading || !hasNextPage" @click="changePage(1)">
          <Icon icon="solar:alt-arrow-right-linear" width="20" height="20" />
        </button>
      </div>
    </div>

    <div ref="scroll" class="scroll" @scroll="onScroll" :aria-busy="loading">
      <FilterChips v-if="showCategories" :active-filter="activeFilter" :filter-chips="filterChips" @select="setFilter" />
      <div v-if="listTruncated" class="list-notice">{{ $t('conversationListPartial') }}</div>
      <div class="mail-page-rows" v-if="!loading && displayEmails.length > 0">
            <div v-for="(item, index) in displayEmails"
                 :class="['email-row', props.type, { 'is-unread-row': item.unread === EmailUnreadEnum.UNREAD && shouldShowUnread }]"
                 :key="item.conversationId || item.emailId || item.draftId" :data-checked="item.checked" :data-email-id="item.emailId"
                 tabindex="0" role="link" :aria-label="conversationView ? (conversationSubject(item.subject) || $t('noSubjectParens')) : (item.subject || $t('noSubjectParens'))"
                 @keydown.enter.self="jumpDetails(item)" @click="jumpDetails(item)"
                 @contextmenu="handleContextmenu($event, item)">
              <el-checkbox class="row-checkbox" :model-value="item.checked" :aria-label="$t('selectMailLabel', { subject: conversationView ? (conversationSubject(item.subject) || $t('noSubjectParens')) : (item.subject || $t('noSubjectParens')) })"
                           @click.stop="handleRowCheckboxClick($event, index, item)" />
              <button v-if="showStar && props.type !== 'draft'" class="row-star" type="button"
                      :class="{ 'is-starred': item.isStar, 'is-starring': starringId === item.emailId }" :aria-pressed="!!item.isStar"
                      :title="item.isStar ? $t('cancelStar') : $t('starMail')" :aria-label="item.isStar ? $t('cancelStar') : $t('starMail')"
                      @click.stop="starChange(item)">
                <Icon :icon="item.isStar ? 'solar:star-bold' : 'solar:star-linear'" width="17" height="17" />
              </button>
              <span v-else class="row-star-placeholder" />
              <div class="row-sender" :title="item.sendEmail">
                <span class="unread-dot" v-if="item.unread === EmailUnreadEnum.UNREAD && shouldShowUnread" :title="$t('unread')" />
                <span class="row-sender-name"><slot name="name" :email="item">{{ item.name || item.sendEmail }}</slot></span>
                <span v-if="conversationView && item.conversationCount > 1" class="conversation-count-inline">{{ item.conversationCount }}</span>
              </div>
              <div class="row-summary">
                <span v-if="item.code" class="code-tag" @click.stop="copyCode(item.code)">{{ item.code }}</span>
                <span class="row-subject"><slot name="subject" :email="item">{{ conversationView ? (conversationSubject(item.subject) || $t('noSubjectParens')) : (item.subject || $t('noSubjectParens')) }}</slot></span>
                <span v-if="item.formatText" class="row-snippet">— {{ item.formatText }}</span>
              </div>
              <div class="row-indicators">
                <span class="row-account" v-if="accountShow && (item.toEmail || item.sendEmail)" :title="formatToEmailTooltip(item)">{{ formatToEmailBadge(item) }}</span>
                <Icon v-if="item.attList?.length" icon="solar:paperclip-2-linear" width="16" height="16" :aria-label="$t('attachmentCount', { count: item.attList.length })" role="img" />
                <Icon v-if="showStatus && item.type === 1 && item.statusIcon" :icon="item.statusIcon.icon" :style="{ color: item.statusIcon.color }" width="15" height="15" :title="item.statusIcon.content" />
              </div>
              <time class="row-time" :title="item.createTime">{{ item.formatCreateTime }}</time>
              <div class="row-user-info" v-if="showUserInfo">{{ item.userEmail }} · {{ item.type === 0 ? item.toEmail : item.sendEmail }}</div>
              <div class="hover-actions" @click.stop>
                <button v-if="item.code" class="hover-action-btn" @click.stop="copyCode(item.code)" :title="$t('copyCode')"><Icon icon="solar:copy-linear" width="17" /></button>
                <button v-if="item.unread === EmailUnreadEnum.UNREAD && shouldShowUnread && props.emailRead" class="hover-action-btn" @click.stop="emailRead(item)" :title="$t('markAsRead')"><Icon icon="solar:letter-opened-linear" width="17" /></button>
                <button class="hover-action-btn danger" @click.stop="rightDelete(item)" :title="$t('deleteMail')"><Icon icon="solar:trash-bin-trash-linear" width="17" /></button>
              </div>
            </div>
      </div>
      <skeletonBlock v-if="loading"
                       :rows="skeletonRows"
                       :showStar="showStar"
                       :accountShow="accountShow"
                       :showStatus="showStatus"
                       :showUserInfo="showUserInfo"
                       :type="type"/>
      <div class="empty-state-card" v-if="!loading && displayEmails.length === 0">
        <div class="empty-icon-circle">
          <Icon v-if="emailStore.searchKeyword" icon="solar:magnifer-linear" width="44" height="44" color="var(--muted)" />
          <Icon v-else-if="activeFilter === 'unread'" icon="solar:letter-unread-linear" width="44" height="44" color="var(--accent)" />
          <Icon v-else-if="activeFilter === 'has_att'" icon="solar:paperclip-2-linear" width="42" height="42" color="var(--muted)" />
          <Icon v-else-if="props.type === 'star'" icon="solar:star-linear" width="44" height="44" color="#f59e0b" />
          <Icon v-else-if="props.type === 'draft'" icon="solar:pen-new-square-linear" width="44" height="44" color="var(--muted)" />
          <Icon v-else icon="solar:mailbox-linear" width="44" height="44" color="var(--accent)" />
        </div>
        <div class="empty-title">{{ emptyTitleText }}</div>
        <div class="empty-subtext" v-if="emailStore.searchKeyword">
          <i18n-t keypath="noSearchResults" scope="global">
            <template #keyword>{{ emailStore.searchKeyword }}</template>
          </i18n-t>
        </div>
      </div>
    </div>

    <!-- 抽离出的右键菜单组件 -->
    <EmailContextMenu
      ref="dropdownRef"
      :type="props.type"
      :email="rightClickEmail"
      :trigger-ref="triggerRef"
      @visible-change="visibleChange"
      @copy-code="copyCode"
      @read="emailRead"
      @unread="emailUnread"
      @reply="openReply"
      @forward="openForward"
      @star="starChange"
      @search="handleSearch"
      @delete="rightDelete"
    />
  </div>
</template>

<script setup>
import { computed, h, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { formatMailListTime } from "@/utils/mail-list-time.js";
import { useElementSize } from '@vueuse/core';
import { useRoute, useRouter } from 'vue-router';
import skeletonBlock from './skeleton/index.vue';
import FilterChips from './components/FilterChips.vue';
import EmailContextMenu from './components/EmailContextMenu.vue';
import { useI18n } from "vue-i18n";
import { useEmailStore } from "@/store/email.js";
import { useUiStore } from "@/store/ui.js";
import { useAccountStore } from "@/store/account.js";
import { useUserStore } from "@/store/user.js";
import { EmailUnreadEnum } from "@/enums/index.js";
import { Icon } from "@iconify/vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { emailUnread as apiEmailUnread } from "@/request/email.js";
import { applyConversationRead, conversationMemberIds, conversationSubject } from '@/utils/mail-conversation.js';


const { t } = useI18n();

const props = defineProps({
  emailList: Function,
  emailDelete: Function,
  emailRead: Function,
  emailUnread: Function,
  conversationAction: Function,
  starAdd: Function,
  starCancel: Function,
  starSuccess: Function,
  cancelSuccess: Function,
  getEmailList: Function,
  timeSort: [Boolean, Number],
  allowStar: {
    type: Boolean,
    default: true
  },
  showFirstLoading: {
    type: Boolean,
    default: true
  },
  showUnread: {
    type: Boolean,
    default: true
  },
  showStatus: {
    type: Boolean,
    default: true
  },
  showStar: {
    type: Boolean,
    default: true
  },
  skeleton: {
    type: Boolean,
    default: true
  },
  showUserInfo: {
    type: Boolean,
    default: false
  },
  actionLeft: {
    type: String,
    default: '0px'
  },
  activeEmailId: {
    type: [Number, String],
    default: null
  },
  type: {
    type: String,
    default: 'email'
  },
  conversationView: {
    type: Boolean,
    default: false
  },
  conversationScope: { type: Object, default: () => ({}) }
});

const route = useRoute();
const router = useRouter();
const emit = defineEmits(['jump', 'right-search', 'refresh-before', 'delete-draft']);
const emailStore = useEmailStore();
const uiStore = useUiStore();

let reqLock = false;
let requestVersion = 0;
let scrollTop = 0;
const skeletonRows = 12;
let reloadTimer = null;
const PAGE_SIZE = 50;
const currentPage = ref(0);

const isRefreshing = ref(false);
const shouldShowUnread = computed(() => {
  return props.showUnread && props.type !== 'send' && props.type !== 'draft';
});

const emailList = reactive([]);
const scroll = ref(null);
const { width: listWidth } = useElementSize(scroll);
const isCompact = computed(() => (listWidth.value || window.innerWidth) < 680);
const firstLoad = ref(true);
const loading = ref(false);
const noLoading = ref(false);
const latestEmail = ref({});
const total = ref(0);
const listTruncated = ref(false);

const checkAll = ref(false);
const isIndeterminate = ref(false);
const dropdownRef = ref(null);
const dropdownCloseLock = ref(false);
const dropdownShow = ref(false);
const rightClickEmail = ref({});
const checkedEmailCount = ref(0);
const starringId = ref(null);
let timer = null;

const position = ref(DOMRect.fromRect({ x: 0, y: 0 }));
const triggerRef = ref({
  getBoundingClientRect() {
    return position.value;
  }
});

const hasNextPage = computed(() => (currentPage.value + 1) * PAGE_SIZE < total.value);
const pageRange = computed(() => {
  if (!total.value) return isCompact.value ? '0' : t('zeroMessages');
  const start = currentPage.value * PAGE_SIZE + 1;
  const end = Math.min(currentPage.value * PAGE_SIZE + emailList.length, total.value);
  if (isCompact.value) {
    return `${start}–${Math.max(start, end)} / ${total.value}`;
  }
  return t(props.conversationView ? 'conversationPageRange' : 'pageRangeOfTotal', { start, end: Math.max(start, end), total: total.value });
});

defineExpose({
  refreshList,
  deleteEmail,
  addItem,
  handleList,
  emailList,
  firstLoad,
  latestEmail,
  noLoading,
  total,
  currentPage,
  applyReadState
});

onActivated(() => {
  requestAnimationFrame(() => {
    if (scroll.value) scroll.value.scrollTop = scrollTop;
    if (props.type === 'email' && activeFilter.value === 'unread' && emailList.some(item => item.unread !== EmailUnreadEnum.UNREAD)) schedulePageReload();
  });
});

onMounted(() => {
  window.addEventListener('beforeunload', flushPendingRead);
  timer = setInterval(() => {
    emailList.forEach(email => {
      email.formatCreateTime = formatMailListTime(email.createTime);
    });
  }, 1000 * 60);
});

onBeforeUnmount(() => {
  flushPendingRead();
  window.removeEventListener('beforeunload', flushPendingRead);
});

onDeactivated(() => {
  flushPendingRead();
});

onUnmounted(() => {
  flushPendingRead();
  clearInterval(timer);
  clearTimeout(reloadTimer);
  requestVersion++;
});

getEmailList();


function onScroll(e) {
  scrollTop = e.target.scrollTop;
}


const showCategories = computed(() => ['email', 'star'].includes(props.type));
const activeFilter = computed(() => props.type === 'star' ? 'star' : ['unread', 'has_att'].includes(route.query.filter) ? route.query.filter : 'all');
// Reactive so the chip labels follow a language switch without a reload.
const filterChips = computed(() => [
  { id: 'all', label: t('all'), icon: 'solar:inbox-linear' },
  { id: 'unread', label: t('unread'), icon: 'solar:letter-unread-linear' },
  { id: 'star', label: t('star'), icon: 'solar:star-linear' },
  { id: 'has_att', label: t('hasAttachment'), icon: 'solar:paperclip-2-linear' }
]);
function setFilter(id) {
  if (id === 'star') router.push({ name: 'star' });
  else router.push({ name: 'email', query: id === 'all' ? {} : { filter: id } });
}
watch(() => [route.name, route.query.filter], ([name, filter], [previousName, previousFilter]) => {
  if (props.type === 'email' && name === 'email' && (filter !== previousFilter || previousName === 'star')) refreshList();
});

// Filtering and search are applied before pagination by each data source.
const displayEmails = computed(() => emailList);

const itemHeight = computed(() => {
  if (props.type === 'all-email') {
    return isCompact.value ? 104 : 76;
  }
  return isCompact.value ? 64 : 36;
});

watch(
  () => emailList.map(item => item.checked),
  () => {
    updateCheckStatus();
  },
  { deep: true }
);

watch(() => emailStore.deleteIds, () => {
  if (emailStore.deleteIds) {
    deleteEmail(emailStore.deleteIds);
  }
});

function openReply(email) {
  uiStore.writerRef?.openReply(email);
}

function openForward(email) {
  uiStore.writerRef?.openForward(email);
}

function visibleChange(e) {
  dropdownShow.value = e;
  dropdownCloseLock.value = true;
  setTimeout(() => {
    dropdownCloseLock.value = false;
  }, 1500);

  if (!e && rightClickEmail.value.rightChecked) {
    rightClickEmail.value.rightChecked = false;
  }
}

const handleContextmenu = (event, email) => {
  if (props.type === 'draft') return;

  if (rightClickEmail.value.rightChecked) {
    rightClickEmail.value.rightChecked = false;
  }

  const { clientX, clientY } = event;
  position.value = DOMRect.fromRect({ x: clientX, y: clientY });
  event.preventDefault();
  dropdownRef.value?.handleOpen();

  rightClickEmail.value = email;
  rightClickEmail.value.rightChecked = true;
};



const accountShow = computed(() => {
  return !accountStore.mailboxFilterId;
});

function htmlToText(email) {
  if (email.content) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = email.content.replace(/<(img|iframe|object|embed|video|audio|source|link)[^>]*>/gi, '');
    const scriptsAndStyles = tempDiv.querySelectorAll('script, style, title');
    scriptsAndStyles.forEach(el => el.remove());
    let text = tempDiv.textContent || tempDiv.innerText || '';
    text = text.replace(/\s+/g, ' ').trim();
    return cleanSpace(text);
  }
  if (email.text) {
    return cleanSpace(email.text);
  }
  return '';
}

function cleanSpace(text) {
  return text
    .replace(/[\u200B-\u200F\uFEFF\u034F\u200B-\u200F\u00A0\u3000\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const accountStore = useAccountStore();
const userStore = useUserStore();

// 建立邮箱地址与账户配置的响应式映射字典
const accountMap = computed(() => {
  const map = new Map();
  const list = (accountStore.accountList?.length ? accountStore.accountList : userStore.user?.accountList) || [];
  list.forEach(acc => {
    if (acc?.email) {
      map.set(acc.email.toLowerCase().trim(), acc);
    }
  });
  return map;
});

// 获取胶囊展示文本：优先使用自定义账户名称/发信昵称，兜底使用邮箱前缀
function formatToEmailBadge(emailItem) {
  const targetEmail = props.type === 'send' ? emailItem.sendEmail : emailItem.toEmail;
  if (!targetEmail) return '';

  const clean = targetEmail.trim().toLowerCase();
  const acc = accountMap.value.get(clean);

  if (acc && acc.name && acc.name.trim()) {
    return acc.name.trim();
  }

  return targetEmail.split('@')[0] || targetEmail;
}

// 获取 Tooltip 完整提示信息
function formatToEmailTooltip(emailItem) {
  const targetEmail = props.type === 'send' ? emailItem.sendEmail : emailItem.toEmail;
  if (!targetEmail) return '';

  const clean = targetEmail.trim().toLowerCase();
  const acc = accountMap.value.get(clean);
  const accName = acc && acc.name && acc.name.trim() ? acc.name.trim() : '';

  const roleLabel = props.type === 'send' ? t('senderIdentity') : t('recipientAddress');
  if (accName) {
    return t('identityTooltip', { role: roleLabel, email: targetEmail, name: accName });
  }
  return t('identityTooltipNoName', { role: roleLabel, email: targetEmail });
}

function starChange(email) {
  starringId.value = email.emailId;
  setTimeout(() => {
    if (starringId.value === email.emailId) starringId.value = null;
  }, 280);
  if (props.conversationView) {
    const wasStarred = !!email.isStar;
    if (!wasStarred && !props.allowStar) return;
    email.isStar = wasStarred ? 0 : 1;
    const scope = { ...props.conversationScope };
    Promise.resolve(props.conversationAction?.(wasStarred ? 'unstar' : 'star', [email.emailId], scope)).then(() => {
      if (wasStarred) props.cancelSuccess?.(email); else props.starSuccess?.(email);
      if (props.type === 'star') schedulePageReload();
    }).catch(error => { console.error(error); email.isStar = wasStarred ? 1 : 0; schedulePageReload(); });
  } else if (!email.isStar) {
    if (!props.allowStar) return;
    email.isStar = 1;
    props.starAdd(email.emailId).then(() => {
      email.isStar = 1;
      props.starSuccess?.(email);
    }).catch(e => {
      console.error(e);
      email.isStar = 0;
    });
  } else {
    email.isStar = 0;
    props.starCancel(email.emailId).then(() => {
      email.isStar = 0;
      props.cancelSuccess?.(email);
    }).catch(e => {
      console.error(e);
      email.isStar = 1;
    });
  }
}

const selectedMailsCount = computed(() => {
  return emailList.filter(item => item.checked && !item.expand).length;
});

let pendingRead = null;

function commitPendingRead() {
  if (!pendingRead) return;
  const { emailIds, timer, scope } = pendingRead;
  pendingRead = null;
  if (timer) clearTimeout(timer);
  if (emailIds?.length && (typeof props.emailRead === 'function' || typeof props.conversationAction === 'function')) {
    const res = props.conversationView ? props.conversationAction('read', emailIds, scope) : props.emailRead(emailIds);
    if (res && typeof res.catch === 'function') {
      res.catch(err => { console.error(err); schedulePageReload(); });
    }
    if (props.type === 'email' && activeFilter.value === 'unread') {
      schedulePageReload();
    }
  }
}

function flushPendingRead() {
  if (!pendingRead) return;
  const msg = pendingRead.messageInstance;
  commitPendingRead();
  if (msg && typeof msg.close === 'function') {
    msg.close();
  }
}

function undoRead() {
  if (!pendingRead) return;
  const { timer, messageInstance, savedStates } = pendingRead;
  pendingRead = null;
  if (timer) clearTimeout(timer);
  if (messageInstance && typeof messageInstance.close === 'function') {
    messageInstance.close();
  }
  savedStates.forEach(({ emailId, unread, unreadIds, checked }) => {
    const item = emailList.find(email => email.emailId === emailId);
    if (item) {
      item.unread = unread;
      item.unreadIds = unreadIds;
      item.checked = checked;
    }
  });
  updateCheckStatus();
  ElMessage({ message: t('actionUndoneMsg'), type: 'info', plain: true });
}

function triggerReadWithUndo(targetIds, isBatch = false) {
  if (!targetIds?.length) return;

  flushPendingRead();

  const savedStates = [];
  targetIds.forEach(target => {
    const id = typeof target === 'object' ? target.emailId : target;
    const item = emailList.find(email => email.emailId === id);
    if (item) {
      savedStates.push({
        emailId: item.emailId,
        unread: item.unread,
        unreadIds: Array.isArray(item.unreadIds) ? [...item.unreadIds] : [],
        checked: item.checked
      });
    }
  });

  if (!savedStates.length) return;

  const selectedRows = savedStates.map(state => emailList.find(item => item.emailId === state.emailId)).filter(Boolean);
  const emailIds = savedStates.map(s => s.emailId);
  selectedRows.forEach(item => { item.unread = EmailUnreadEnum.READ; item.unreadIds = []; item.checked = false; });
  updateCheckStatus();

  const messageText = isBatch
    ? t('batchMarkedAsRead', { count: emailIds.length })
    : t('markedAsReadMsg');

  const timer = setTimeout(() => {
    commitPendingRead();
  }, 5000);

  const messageInstance = ElMessage({
    message: h('div', { class: 'undo-toast-inner' }, [
      h('span', { class: 'undo-toast-text' }, messageText),
      h('button', {
        type: 'button',
        class: 'undo-toast-btn',
        onClick: (e) => {
          e.stopPropagation();
          undoRead();
        }
      }, t('undo'))
    ]),
    type: 'info',
    plain: true,
    duration: 5000,
    customClass: 'undo-toast-msg',
    onClose: () => {
      commitPendingRead();
    }
  });

  pendingRead = {
    emailIds,
    timer,
    messageInstance,
    savedStates,
    scope: { ...props.conversationScope }
  };
}

const handleRead = () => {
  const rows = getSelectedMails();
  if (!rows.length) return;
  triggerReadWithUndo(rows, true);
};

const showDelete = computed(() => props.type === 'draft');

const handleStar = async () => {
  if (!props.allowStar) return;
  const selected = getSelectedMails().filter(email => !email.isStar);
  if (props.conversationView) {
    if (!selected.length) return;
    const scope = { ...props.conversationScope };
    selected.forEach(email => { email.isStar = 1; email.checked = false; });
    updateCheckStatus();
    try {
      await props.conversationAction?.('star', selected.map(email => email.emailId), scope);
      ElMessage({ message: t('batchStarSuccessMsg', { count: selected.length }), type: 'success', plain: true });
      schedulePageReload();
    } catch (error) {
      console.error(error); selected.forEach(email => { email.isStar = 0; }); schedulePageReload();
    }
    return;
  }
  let count = 0;
  emailList.filter(item => item.checked).forEach(email => {
    if (!email.isStar) {
      starChange(email);
      count++;
    }
    email.checked = false;
  });
  if (count > 0) {
    ElMessage({ message: t('batchStarSuccessMsg', { count }), type: 'success', plain: true });
  }
};

function emailRead(emailId) {
  const ids = Array.isArray(emailId) ? emailId : [emailId];
  if (!ids.length) return;
  triggerReadWithUndo(ids, false);
}

function localRead(emailIds) {
  emailIds.forEach(emailId => {
    const index = emailList.findIndex(email => email.emailId === emailId);
    if (index > -1) {
      emailList[index].unread = EmailUnreadEnum.READ;
      emailList[index].checked = false;
    }
  });
  updateCheckStatus();
}

function emailUnread(emailId) {
  const targets = Array.isArray(emailId) ? emailId : [emailId];
  const rows = targets.map(target => typeof target === 'object' ? target : emailList.find(item => item.emailId === target)).filter(Boolean);
  const ids = props.conversationView ? rows.map(row => row.emailId) : targets;
  if (!ids.length) return;
  flushPendingRead();
  if (props.conversationView) rows.forEach(row => { row.unreadIds = conversationMemberIds(row); row.unread = EmailUnreadEnum.UNREAD; });
  else localUnread(ids);
  const doUnread = props.emailUnread || apiEmailUnread;
  const scope = { ...props.conversationScope };
  const res = props.conversationView ? props.conversationAction?.('unread', rows.map(row => row.emailId), scope) : doUnread(ids);
  if (res && typeof res.then === 'function') {
    res.then(() => {
      ElMessage({ message: t('markedAsUnreadMsg'), type: 'success', plain: true });
      if (props.type === 'email' && activeFilter.value === 'unread') {
        schedulePageReload();
      }
    }).catch(err => {
      console.error(err);
      schedulePageReload();
    });
  } else {
    ElMessage({ message: t('markedAsUnreadMsg'), type: 'success', plain: true });
    if (props.type === 'email' && activeFilter.value === 'unread') {
      schedulePageReload();
    }
  }
}

function localUnread(emailIds) {
  emailIds.forEach(emailId => {
    const index = emailList.findIndex(email => email.emailId === emailId);
    if (index > -1) {
      emailList[index].unread = EmailUnreadEnum.UNREAD;
    }
  });
}

function applyReadState(emailId, read) {
  const ids = [Number(emailId)]
  if (props.conversationView) {
    if (read) applyConversationRead(emailList, ids)
    else emailList.forEach(row => {
      if (conversationMemberIds(row).includes(ids[0])) {
        row.unreadIds = [...new Set([...(row.unreadIds || []).map(Number), ids[0]])]
        row.unread = EmailUnreadEnum.UNREAD
      }
    })
    if (read && props.type === 'email' && activeFilter.value === 'unread') schedulePageReload()
    return
  }
  if (read) {
    localRead(ids)
    if (props.type === 'email' && activeFilter.value === 'unread') schedulePageReload()
  } else {
    localUnread(ids)
  }
}

function rightDelete(emailId) {
  flushPendingRead();
  const row = typeof emailId === 'object' ? emailId : emailList.find(item => item.emailId === emailId);
  const deleteIds = props.conversationView && row ? conversationMemberIds(row) : [typeof emailId === 'object' ? emailId.emailId : emailId];
  const scope = { ...props.conversationScope };
  const deleteAction = () => props.conversationView ? props.conversationAction?.('delete', [row.emailId], scope) : props.emailDelete(deleteIds);
  if (props.type === 'all-email') {
    ElMessageBox.confirm(t('delOneEmailConfirm'), {
      confirmButtonText: t('confirm'),
      cancelButtonText: t('cancel'),
      type: 'warning'
    }).then(() => {
      deleteAction().then(result => {
        const affected = result?.emailIds || deleteIds;
        ElMessage({ message: t('delSuccessMsg'), type: 'success', plain: true });
        emailStore.deleteIds = affected;
        schedulePageReload();
      }).catch(err => { console.error(err); schedulePageReload(); });
    });
    return;
  }
  deleteAction().then(result => {
    const affected = result?.emailIds || deleteIds;
    ElMessage({ message: t('delSuccessMsg'), type: 'success', plain: true });
    emailStore.deleteIds = affected;
    schedulePageReload();
  }).catch(err => { console.error(err); schedulePageReload(); });
}

function handleSearch(type, value) {
  emit('right-search', type, value);
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    ElMessage({ message: t('copySuccessMsg'), type: 'success', plain: true });
  } catch (err) {
    console.error(`${t('copyFailMsg')}:`, err);
    ElMessage({ message: t('copyFailMsg'), type: 'error', plain: true });
  }
}

function handleDelete() {
  flushPendingRead();
  ElMessageBox.confirm(t('delEmailsConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    if (props.type === 'draft') {
      const draftIds = getSelectedDraftsIds();
      emit('delete-draft', draftIds);
      return;
    }
    const selected = getSelectedMails();
    const emailIds = props.conversationView ? selected.map(item => item.emailId) : getSelectedMailsIds();
    const scope = { ...props.conversationScope };
    const operation = props.conversationView ? props.conversationAction?.('delete', emailIds, scope) : props.emailDelete(emailIds);
    operation.then(result => {
      const affected = result?.emailIds || emailIds;
      ElMessage({ message: t('delSuccessMsg'), type: 'success', plain: true });
      emailStore.deleteIds = affected;
      schedulePageReload();
    }).catch(err => { console.error(err); schedulePageReload(); });
  });
}

function deleteEmail(emailIds) {
  flushPendingRead();
  const ids = new Set(emailIds);
  const remaining = emailList.filter(item => !ids.has(item.emailId));
  if (remaining.length === emailList.length) return;
  total.value = Math.max(0, total.value - (emailList.length - remaining.length));
  emailList.splice(0, emailList.length, ...remaining);
  schedulePageReload();
}

function addItem(email) {
  if (props.conversationView) {
    if (email.emailId > (latestEmail.value?.emailId || 0)) latestEmail.value = email;
    schedulePageReload();
    return true;
  }
  if (emailList.some(item => item.emailId === email.emailId)) return false;
  // Re-query one bounded page so new mail never expands it beyond 50 items.
  if (email.emailId > (latestEmail.value?.emailId || 0)) latestEmail.value = email;
  schedulePageReload();
  return true;
}

function schedulePageReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => getEmailList(false, currentPage.value, true), 150);
}

function changePage(direction) {
  if (loading.value || (direction < 0 && currentPage.value === 0) || (direction > 0 && !hasNextPage.value)) return;
  flushPendingRead();
  getEmailList(false, currentPage.value + direction);
}

function handleCheckAllChange(val) {
  displayEmails.value.forEach(item => (item.checked = val));
  isIndeterminate.value = false;
}

function getSelectedMailsIds() {
  return emailList.filter(item => item.checked).map(item => item.emailId);
}

function getSelectedMails() {
  return emailList.filter(item => item.checked);
}

function getSelectedDraftsIds() {
  return emailList.filter(item => item.checked).map(item => item.draftId);
}

const lastCheckedIndex = ref(-1);

function handleRowCheckboxClick(event, index, item) {
  const targetState = !item.checked;

  if (event.shiftKey && lastCheckedIndex.value >= 0 && lastCheckedIndex.value !== index) {
    const start = Math.min(lastCheckedIndex.value, index);
    const end = Math.max(lastCheckedIndex.value, index);
    const visibleList = displayEmails.value;
    for (let i = start; i <= end; i++) {
      if (visibleList[i] && !visibleList[i].expand) {
        visibleList[i].checked = targetState;
      }
    }
  } else {
    item.checked = targetState;
  }

  lastCheckedIndex.value = index;
  updateCheckStatus();
}

function updateCheckStatus() {
  const validList = displayEmails.value.filter(item => !item.expand);
  const checkedCount = validList.filter(item => item.checked).length;
  checkedEmailCount.value = checkedCount;
  checkAll.value = validList.length > 0 && checkedCount === validList.length;
  isIndeterminate.value = checkedCount > 0 && checkedCount < validList.length;
}

const emptyTitleText = computed(() => {
  if (activeFilter.value === 'unread') return t('allUnreadHandled');
  if (activeFilter.value === 'has_att') return t('noAttachmentMail');
  if (props.type === 'star') return t('noStarredMail');
  if (props.type === 'draft') return t('draftsEmpty');
  if (props.type === 'send') return t('noSentMail');
  return t('noMessagesFound');
});

function jumpDetails(email) {
  if (dropdownShow.value) {
    dropdownRef.value?.handleClose();
    return;
  }
  if (!dropdownCloseLock.value) {
    const sel = window.getSelection();
    if (sel.toString().trim()) return;
  }
  emit('jump', email);
}

let manualRefreshTriggered = false;

async function getEmailList(refresh = false, targetPage = currentPage.value, preserveScroll = false) {
  if (reqLock && !refresh) return;
  reqLock = true;
  const version = ++requestVersion;
  let page = refresh ? 0 : Math.max(0, targetPage);
  const previousScroll = scrollTop;
  loading.value = true;
  clearTimeout(reloadTimer);
  try {
    if (typeof props.getEmailList !== 'function') throw new Error(t('missingEmailFetcher'));
    let data = await props.getEmailList(0, PAGE_SIZE, page);
    if (version !== requestVersion) return;
    const lastPage = Math.max(0, Math.ceil((Number(data?.total) || 0) / PAGE_SIZE) - 1);
    if (page > lastPage) {
      page = lastPage;
      data = await props.getEmailList(0, PAGE_SIZE, page);
      if (version !== requestVersion) return;
    }
    const rows = (data?.list || []).slice(0, PAGE_SIZE).map(item => ({ ...item, checked: false }));
    handleList(rows);
    emailList.splice(0, emailList.length, ...rows);
    total.value = Math.max(0, Number(data?.total) || 0);
    listTruncated.value = !!data?.truncated;
    latestEmail.value = data?.latestEmail || {};
    currentPage.value = page;
    noLoading.value = (page + 1) * PAGE_SIZE >= total.value;
    firstLoad.value = false;
    checkAll.value = false;
    isIndeterminate.value = false;
    lastCheckedIndex.value = -1;
    const restoreScroll = preserveScroll && page === targetPage ? previousScroll : 0;
    loading.value = false;
    await nextTick();
    if (version !== requestVersion) return;
    if (scroll.value) scroll.value.scrollTop = restoreScroll;
    scrollTop = scroll.value?.scrollTop || 0;
    if (manualRefreshTriggered) ElMessage({ message: t('listRefreshedMsg'), type: 'success', plain: true, duration: 1500 });
  } catch (error) {
    if (version !== requestVersion) return;
    ElMessage({ message: Number(error?.response?.status || error?.code || error?.status) === 413 ? t('conversationLimitExceeded') : (error?.message || t('mailLoadFailedMsg')), type: 'error', plain: true });
  } finally {
    if (version === requestVersion) {
      loading.value = false;
      isRefreshing.value = false;
      manualRefreshTriggered = false;
      reqLock = false;
    }
  }
}

function handleList(list) {
  list.forEach(email => {
    if (props.conversationView) email.unread = Array.isArray(email.unreadIds) && email.unreadIds.length ? EmailUnreadEnum.UNREAD : EmailUnreadEnum.READ;
    email.formatText = htmlToText(email);
    email.formatCreateTime = formatMailListTime(email.createTime);
    email.test = t('received');
    const statusIconMap = {
      0: { icon: 'ic:round-mark-email-read', color: '#51C76B', content: t('received') },
      1: { icon: 'bi:send-arrow-up-fill',  color: '#51C76B', content: t('sent') },
      2: { icon: 'bi:send-check-fill',     color: '#51C76B', content: t('delivered') },
      3: { icon: 'bi:send-x-fill',         color: '#F56C6C', content: t('bounced') },
      8: { icon: 'bi:send-x-fill',         color: '#F56C6C', content: t('bounced') },
      4: { icon: 'bi:send-exclamation-fill', color: '#FBBD08', content: t('complained') },
      5: { icon: 'bi:send-arrow-up-fill',  color: '#FBBD08', content: t('delayed') },
      7: { icon: 'ic:round-mark-email-read', color: '#FBBD08', content: t('noRecipient') },
    };

    if (email.isDel) {
      email.isDelContent = t('selectDeleted');
    }
    email.statusIcon = statusIconMap[email.status];
  });
}

function refresh() {
  if (isRefreshing.value || loading.value) return;
  flushPendingRead();
  manualRefreshTriggered = true;
  isRefreshing.value = true;
  emit('refresh-before');
  getEmailList(false, currentPage.value);
}

function refreshList() {
  flushPendingRead();
  checkAll.value = false;
  isIndeterminate.value = false;
  getEmailList(true);
}

</script>

<style lang="scss" scoped>
@use './email-scroll.scss';

.conversation-count-inline {
  flex: none;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--muted);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

.list-notice {
  margin: 8px 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--muted);
  font-size: 12px;
}

:global(.undo-toast-msg) {
  border-radius: 20px !important;
  padding: 8px 16px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12) !important;
  background: var(--surface) !important;
  border: 1px solid var(--line) !important;
}

:global(.undo-toast-inner) {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

:global(.undo-toast-text) {
  font-size: 13px;
  color: var(--text-strong);
}

:global(.undo-toast-btn) {
  border: none;
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
  font-weight: 600;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  cursor: pointer;
  outline: none;
  transition: background-color var(--duration-fast, 150ms) ease, color var(--duration-fast, 150ms) ease;

  &:hover {
    background: color-mix(in srgb, var(--accent) 26%, transparent);
    color: var(--accent);
  }

  &:active {
    background: color-mix(in srgb, var(--accent) 36%, transparent);
  }
}
</style>
