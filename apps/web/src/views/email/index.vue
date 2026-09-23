<template>
  <MailListLayout>
      <emailScroll ref="scroll"
                   :cancel-success="cancelStar"
                   :star-success="addStar"
                   :getEmailList="getEmailList"
                   :emailDelete="emailDelete"
                   :star-add="starAdd"
                   :star-cancel="starCancel"
                   :time-sort="params.timeSort"
                   :email-read="emailRead"
                   :email-unread="emailUnread"
                   :show-unread="true"
                   conversation-view
                   :conversation-action="conversationAction"
                   :conversation-scope="conversationScope"
                   actionLeft="4px"
                   @jump="jumpContent"
      >
        <template #first>
          <button class="tool-icon-btn" :title="params.timeSort === 0 ? $t('sortByTimeDesc') : $t('sortByTimeAsc')" @click="changeTimeSort">
            <Icon icon="solar:sort-from-top-to-bottom-linear" width="16" height="16" />
          </button>
          <MailboxFilter />
        </template>
      </emailScroll>
  </MailListLayout>
</template>

<script setup>
import { computed, defineOptions, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import emailScroll from '@/components/email-scroll/index.vue';
import MailListLayout from '@/components/mail-list-layout/index.vue';
import MailboxFilter from '@/components/MailboxFilter.vue';
import { useAccountStore } from '@/store/account.js';
import { useEmailStore } from '@/store/email.js';
import { useSettingStore } from '@/store/setting.js';
import { emailList, emailDelete, emailLatest, emailRead, emailUnread, emailConversationState } from '@/request/email.js';
import { starAdd, starCancel } from '@/request/star.js';
import { createInboxCheck, createInboxRefresh } from '@/utils/inbox-refresh.js';

defineOptions({
  name: 'email'
});

const router = useRouter();
const route = useRoute();
const emailStore = useEmailStore();
const accountStore = useAccountStore();
const settingStore = useSettingStore();

const scroll = ref({});
let refreshDisposed = false;

const params = reactive({
  timeSort: 0,
});

onMounted(() => {
  emailStore.emailScroll = scroll;
  document.addEventListener('visibilitychange', syncRefresh);
  window.addEventListener('online', syncRefresh);
  window.addEventListener('offline', syncRefresh);
  window.addEventListener('focus', syncRefresh);
  syncRefresh();
});

onBeforeUnmount(() => {
  refreshDisposed = true;
  refresher.dispose();
  document.removeEventListener('visibilitychange', syncRefresh);
  window.removeEventListener('online', syncRefresh);
  window.removeEventListener('offline', syncRefresh);
  window.removeEventListener('focus', syncRefresh);
});

watch(() => [accountStore.currentAccountId,accountStore.mailboxFilterId], () => {
  scroll.value.refreshList();
});

function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1;
  scroll.value.refreshList();
}

function jumpContent(email) {
  Object.assign(emailStore.contentData, {
    email, delType: 'logic', showStar: true, showReply: true, showUnread: true
  });
  router.push('/message');
}

const refreshContext = () => JSON.stringify([route.fullPath, accountStore.mailboxQuery, params.timeSort, emailStore.searchKeyword]);
const isRefreshActive = () => !refreshDisposed && route.name === 'email' && document.visibilityState !== 'hidden' && navigator.onLine !== false;
const refresher = createInboxRefresh({
  // Older installations stored 0 with no settings UI to turn polling on.
  interval: () => Math.max(5000, (Number(settingStore.settings.autoRefresh) > 1 ? Number(settingStore.settings.autoRefresh) : 30) * 1000),
  check: createInboxCheck({
    isActive: isRefreshActive,
    isReady: () => !!scroll.value && !scroll.value.firstLoad,
    getContext: () => ({ key: refreshContext(), ...accountStore.mailboxQuery }),
    getMarker: () => scroll.value.latestEmail,
    fetchLatest: emailLatest,
    refresh: () => scroll.value.refreshCurrentPage(),
  }),
  onError: error => {
    if ([401, 403].includes(Number(error?.code || error?.response?.status))) refresher.pause();
    console.error('Inbox update check failed:', error);
  },
});
function syncRefresh() {
  if (isRefreshActive()) refresher.resume();
  else refresher.pause();
}
watch(() => [route.name, settingStore.settings.autoRefresh], syncRefresh);

function addStar(email) {
  emailStore.starScroll?.addItem(email);
}

function cancelStar(email) {
  emailStore.starScroll?.deleteEmail([email.emailId]);
}

function getEmailList(emailId, size, page = 0) {
  const accountId = accountStore.mailboxQuery.accountId;
  const allReceive = accountStore.mailboxQuery.allReceive;
  const keyword = emailStore.searchKeyword;
  return emailList(accountId, allReceive, emailId, params.timeSort, size, 0, keyword, route.query.filter, page * size, 'conversation').then(data => {
    if (!data) {
      return { list: [], total: 0, latestEmail: { emailId: 0, reqAccountId: accountId, allReceive } };
    }
    data.latestEmail ??= { emailId: 0 };
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  });
}

const conversationScope = computed(() => ({ type: 0, accountId: accountStore.mailboxQuery.accountId, allReceive: accountStore.mailboxQuery.allReceive }));
function conversationAction(action, emailIds, scope = conversationScope.value) { return emailConversationState(emailIds, action, { ...scope }); }

watch(() => emailStore.searchKeyword, () => {
  scroll.value?.refreshList();
});
</script>
