<template>
  <MailListLayout>

      <emailScroll :email-read="emailRead" type="star" ref="scroll"
                   :allow-star="false"
                   :cancel-success="cancelStar"
                   :getEmailList="getStarList"
                   :emailDelete="emailDelete"
                   :star-add="starAdd"
                   :star-cancel="starCancel"
                   @jump="jumpContent"
                   actionLeft="6px"
                   :show-account-icon="false"
      ><template #first><MailboxFilter /></template></emailScroll>

  </MailListLayout>
</template>

<script setup>
import { defineOptions, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import emailScroll from '@/components/email-scroll/index.vue';
import MailListLayout from '@/components/mail-list-layout/index.vue';
import MailboxFilter from '@/components/MailboxFilter.vue';
import {useAccountStore} from '@/store/account.js';
import { emailDelete, emailRead } from '@/request/email.js';
import { starAdd, starCancel, starList } from '@/request/star.js';
import { useEmailStore } from '@/store/email.js';

defineOptions({
  name: 'star'
});

const router = useRouter();
const scroll = ref({});
const emailStore = useEmailStore();
const accountStore=useAccountStore();
watch(()=>accountStore.mailboxFilterId,()=>scroll.value?.refreshList());

function jumpContent(email) {
  Object.assign(emailStore.contentData, {
    email, delType: 'logic', showStar: true, showReply: true, showUnread: true
  });
  router.push('/message');
}

function cancelStar(email) {
  emailStore.cancelStarEmailId = email.emailId;
  scroll.value?.deleteEmail([email.emailId]);

}

function getStarList(emailId, size, page = 0) {
  return starList(emailId, size, emailStore.searchKeyword, page * size, accountStore.mailboxFilterId || undefined);
}

watch(() => emailStore.searchKeyword, () => {
  scroll.value?.refreshList();
});

onMounted(() => {
  emailStore.starScroll = scroll;
});

</script>
