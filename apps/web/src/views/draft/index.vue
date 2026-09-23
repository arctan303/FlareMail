<template>
  <div class="draft-page-container">
    <div class="draft-card arc-card">
      <emailScroll ref="scroll"
                   :allow-star="false"
                   :getEmailList="getEmailList"
                   :star-add="starAdd"
                   :star-cancel="starCancel"
                   @jump="jumpContent"
                   actionLeft="6px"
                   :show-account-icon="false"
                   :show-first-loading="false"
                   :showStar="false"
                   @delete-draft="deleteDraft"
                   :type="'draft'"
      >
        <template #name="props">
          <span class="send-email">{{ props.email.receiveEmail?.join(',') || '(' + $t('noRecipient') + ')' }}</span>
        </template>
        <template #subject="props">
          {{ props.email.subject || '(' + $t('noSubject') + ')' }}
        </template>
      </emailScroll>
    </div>
  </div>
</template>

<script setup>
import emailScroll from "@/components/email-scroll/index.vue"
import {deleteLocalDrafts} from '@/db/draft-lifecycle.js';
import {ElMessage} from 'element-plus';
import {useI18n} from 'vue-i18n';
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, ref, watch} from "vue";
import {useEmailStore} from "@/store/email.js";
import {useUiStore} from "@/store/ui.js";
import {userDraftStore} from "@/store/draft.js";
import db from "@/db/db.js"

defineOptions({
  name: 'draft'
})

const draftStore = userDraftStore();
const emailStore = useEmailStore();
const uiStore = useUiStore();
const scroll = ref({})
const {t} = useI18n();

watch(() => draftStore.refreshList, () => scroll.value?.refreshList());
watch(() => emailStore.searchKeyword, () => scroll.value?.refreshList());

async function getEmailList(_emailId, size = 50, page = 0) {
  const keyword = emailStore.searchKeyword.trim().toLowerCase();
  const drafts = await db.value.draft.orderBy('createTime').reverse().toArray();
  const filtered = keyword ? drafts.filter(item => [item.subject, item.text, item.content, ...(item.receiveEmail || [])]
    .some(value => String(value || '').toLowerCase().includes(keyword))) : drafts;
  return { list: filtered.slice(page * size, (page + 1) * size), total: filtered.length };
}

async function deleteDraft(draftIds) {
  try {
    await deleteLocalDrafts(db.value, draftIds);
    draftStore.refreshList++;
    ElMessage.success(t('delSuccessMsg'));
  } catch (error) {
    console.error('Draft deletion failed:', error);
    ElMessage.error(t('deleteFailedMsg'));
  }
}

async function jumpContent(email) {
  try {
    const att = await db.value.att.get(email.draftId)
    email.attachments = att?.attachments || []
    uiStore.writerRef.openDraft(email);
  } catch (e) {
    console.error("Draft open error:", e)
  }
}
</script>

<style scoped lang="scss">
.draft-page-container {
  padding: 8px 10px 10px 10px;
  height: 100%;
  box-sizing: border-box;
  background-color: var(--el-bg-color-page, #f8fafc);

  .draft-card {
    height: 100%;
    border-radius: 12px;
    border: 1px solid var(--el-border-color-lighter, #e2e8f0);
    background-color: var(--el-bg-color, #ffffff);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
    overflow: hidden;
  }
}

.send-email {
  font-weight: normal;
}
</style>
