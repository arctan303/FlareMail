<template>
  <div class="draft-page-container">
    <div class="draft-card arc-card">
      <div v-if="legacyEntries.length" class="draft-recovery-notice">
        <span>{{ t('legacyDraftCount', { count: legacyEntries.length }) }}</span>
        <el-button link type="primary" @click="recoveryVisible = true">{{ t('recoverLegacyDrafts') }}</el-button>
      </div>
      <emailScroll :key="db.userId || 'no-user'" ref="scroll"
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
    <el-dialog v-model="recoveryVisible" :title="t('recoverLegacyDrafts')" width="520px">
      <p>{{ t('legacyDraftRecoveryNotice') }}</p>
      <div v-for="(entry, index) in legacyEntries" :key="JSON.stringify(entry)" class="draft-recovery-row">
        <span>{{ t('legacyDraftNumber', { number: index + 1 }) }}</span>
        <div>
          <el-button type="primary" :disabled="recovering" @click="claimLegacy(entry)">{{ t('claimLegacyDraft') }}</el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import emailScroll from "@/components/email-scroll/index.vue"
import {deleteLocalDrafts} from '@/db/draft-lifecycle.js';
import {ElMessage} from 'element-plus';
import {useI18n} from 'vue-i18n';
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, onMounted, ref, watch} from "vue";
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
const legacyEntries = ref([]);
const recoveryVisible = ref(false);
const recovering = ref(false);

async function refreshRecovery() {
  const database = db.value;
  try {
    const entries = await database.listLegacyUnowned?.() || [];
    if (database === db.value) legacyEntries.value = entries;
  } catch (error) {
    console.error('Legacy draft recovery is unavailable:', error);
  }
}

watch(() => db.value, () => {
  legacyEntries.value = [];
  recoveryVisible.value = false;
  recovering.value = false;
  refreshRecovery();
}, {flush: 'sync'});
onMounted(refreshRecovery);

async function claimLegacy(entry) {
  const database = db.value;
  recovering.value = true;
  try {
    await database.claimLegacyDraft(entry);
    if (database !== db.value) return;
    draftStore.refreshList++;
    await refreshRecovery();
    ElMessage.success(t('legacyDraftClaimed'));
  } catch (error) {
    console.error('Legacy draft claim failed:', error);
    if (database === db.value) ElMessage.error(t('saveFailedMsg'));
  } finally {
    if (database === db.value) recovering.value = false;
  }
}

watch(() => draftStore.refreshList, () => scroll.value?.refreshList());
watch(() => emailStore.searchKeyword, () => scroll.value?.refreshList());

async function getEmailList(_emailId, size = 50, page = 0) {
  const keyword = emailStore.searchKeyword.trim().toLowerCase();
  const database = db.value;
  if (!database.userId) return {list: [], total: 0};
  const drafts = await database.draft.orderBy('createTime').reverse().toArray();
  if (database !== db.value) return {list: [], total: 0};
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
    const database = db.value;
    const draft = await database.draft.get(email.draftId);
    if (!draft) return;
    const att = await database.att.get(email.draftId)
    if (database !== db.value) return;
    uiStore.writerRef.openDraft({...draft, attachments: att?.attachments || []});
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

.draft-recovery-notice, .draft-recovery-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
}
</style>
