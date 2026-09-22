<template>
  <MailListLayout>

      <emailScroll ref="sendScroll"
                   :cancel-success="cancelStar"
                   :star-success="addStar"
                   :getEmailList="getEmailList"
                   :emailDelete="emailDelete"
                   :email-read="emailRead"
                   :star-add="starAdd"
                   show-status
                   :show-unread="false"
                   actionLeft="4px"
                   :star-cancel="starCancel"
                   @jump="jumpContent"
                   :time-sort="params.timeSort"
                   :type="'send'"
                   conversation-view
                   :conversation-action="conversationAction"
                   :conversation-scope="conversationScope"
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
import { computed, defineOptions, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import emailScroll from '@/components/email-scroll/index.vue';
import MailListLayout from '@/components/mail-list-layout/index.vue';
import MailboxFilter from '@/components/MailboxFilter.vue';
import { useAccountStore } from '@/store/account.js';
import { useEmailStore } from '@/store/email.js';
import { emailList, emailDelete, emailRead, emailConversationState } from '@/request/email.js';
import { starAdd, starCancel } from '@/request/star.js';

defineOptions({
  name: 'send'
});

const router = useRouter();
const emailStore = useEmailStore();
const accountStore = useAccountStore();
const sendScroll = ref({});

const params = reactive({
  timeSort: 0,
});

onMounted(() => {
  emailStore.sendScroll = sendScroll;
});

watch(() => [accountStore.currentAccountId,accountStore.mailboxFilterId], () => {
  sendScroll.value.refreshList();
});

function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1;
  sendScroll.value.refreshList();
}

function jumpContent(email) {
  Object.assign(emailStore.contentData, {
    email, delType: 'logic', showStar: true, showReply: true, showUnread: false
  });
  router.push('/message');
}

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
  return emailList(accountId, allReceive, emailId, params.timeSort, size, 1, keyword, undefined, page * size, 'conversation').then(data => {
    if (!data) {
      return { list: [], total: 0, latestEmail: { emailId: 0, reqAccountId: accountId, allReceive } };
    }
    data.latestEmail ??= { emailId: 0 };
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  });
}

const conversationScope = computed(() => ({ type: 1, accountId: accountStore.mailboxQuery.accountId, allReceive: accountStore.mailboxQuery.allReceive }));
function conversationAction(action, emailIds, scope = conversationScope.value) { return emailConversationState(emailIds, action, { ...scope }); }

watch(() => emailStore.searchKeyword, () => {
  sendScroll.value?.refreshList();
});
</script>
