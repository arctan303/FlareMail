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
import { defineOptions, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import emailScroll from '@/components/email-scroll/index.vue';
import MailListLayout from '@/components/mail-list-layout/index.vue';
import MailboxFilter from '@/components/MailboxFilter.vue';
import { useAccountStore } from '@/store/account.js';
import { useEmailStore } from '@/store/email.js';
import { useSettingStore } from '@/store/setting.js';
import { emailList, emailDelete, emailLatest, emailRead, emailUnread } from '@/request/email.js';
import { starAdd, starCancel } from '@/request/star.js';
import { sleep } from '@/utils/time-utils.js';

defineOptions({
  name: 'email'
});

const router = useRouter();
const route = useRoute();
const emailStore = useEmailStore();
const accountStore = useAccountStore();
const settingStore = useSettingStore();

const scroll = ref({});

const params = reactive({
  timeSort: 0,
});

onMounted(() => {
  emailStore.emailScroll = scroll;
  latest();
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

const existIds = new Set();

async function latest() {
  while (true) {
    let autoRefresh = settingStore.settings.autoRefresh;
    await sleep(autoRefresh > 1 ? autoRefresh * 1000 : 3000);

    if (route.name !== 'email' || scroll.value.currentPage > 0) {
      continue;
    }

    const latestId = scroll.value.latestEmail?.emailId;

    if (!scroll.value.firstLoad && autoRefresh > 1) {
      try {
        const accountId = accountStore.mailboxQuery.accountId;
        const allReceive = scroll.value.latestEmail?.allReceive;
        const curTimeSort = params.timeSort;
        let list = [];

        if (accountId === scroll.value.latestEmail?.reqAccountId) {
          list = await emailLatest(latestId, accountId, allReceive);
        }

        if (accountId === accountStore.mailboxQuery.accountId && params.timeSort === curTimeSort && allReceive === accountStore.mailboxQuery.allReceive) {
          if (list.length > 0) {
            for (let email of list) {
              email.reqAccountId = accountId;
              email.allReceive = allReceive;

              if (!existIds.has(email.emailId)) {
                existIds.add(email.emailId);
                scroll.value.addItem(email);
                await sleep(50);
              }
            }
          }
        }
      } catch (e) {
        if (e.code === 401 || e.code === 403) {
          settingStore.settings.autoRefresh = 0;
        }
        console.error(e);
      }
    }
  }
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
  return emailList(accountId, allReceive, emailId, params.timeSort, size, 0, keyword, route.query.filter, page * size).then(data => {
    if (!data) {
      return { list: [], total: 0, latestEmail: { emailId: 0, reqAccountId: accountId, allReceive } };
    }
    data.latestEmail ??= { emailId: 0 };
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  });
}

watch(() => emailStore.searchKeyword, () => {
  scroll.value?.refreshList();
});
</script>
