<template>
  <el-scrollbar class="trash-scroll">
    <section class="trash-page" v-loading="loading">
      <header class="trash-header">
        <div><h2 class="arc-serif-title">{{ t('trash') }}</h2><p>{{ t('mailRecovery.description') }}</p></div>
        <el-button :disabled="busy" @click="loadList">{{ t('mailRecovery.refresh') }}</el-button>
      </header>
      <p v-if="errorMessage" role="alert" class="trash-error">{{ errorMessage }}</p>
      <div class="trash-card arc-card">
        <div class="trash-tools">
          <el-input v-model="keyword" :placeholder="t('mailRecovery.search')" :aria-label="t('mailRecovery.search')" clearable @keyup.enter="search" @clear="search" />
          <el-button :disabled="!selection.length || busy || selection.some(row => !row.canRestore)" @click="restoreSelected">{{ t('mailRecovery.restore') }}</el-button>
          <el-button type="danger" plain :disabled="!selection.length || busy" @click="purgeSelected">{{ t('mailRecovery.purge') }}</el-button>
          <el-button type="danger" plain :disabled="!total || busy" @click="emptyAll">{{ t('mailRecovery.emptyTrash') }}</el-button>
          <span aria-live="polite">{{ t('mailRecovery.selection', { count: selection.length }) }}</span>
          <span v-if="emptyProgress !== null" role="status">{{ t('mailRecovery.emptyProgress', { count: emptyProgress }) }}</span>
        </div>
        <el-table ref="table" :data="rows" row-key="emailId" :empty-text="t('mailRecovery.empty')" @selection-change="selection = $event">
          <el-table-column type="selection" width="44" :selectable="() => !busy" />
          <el-table-column :label="t('mailRecovery.subject')" min-width="220">
            <template #default="{ row }">
              <button class="subject-button" @click="view(row)">{{ row.subject || t('mailRecovery.noSubject') }}</button>
              <p v-if="!row.canRestore" class="restore-notice">{{ t('mailRecovery.deletedAlias') }}</p>
            </template>
          </el-table-column>
          <el-table-column prop="sendEmail" :label="t('mailRecovery.sender')" min-width="180" show-overflow-tooltip />
          <el-table-column prop="mailbox" :label="t('mailRecovery.mailbox')" min-width="180" show-overflow-tooltip />
          <el-table-column prop="createTime" :label="t('mailRecovery.time')" min-width="160" />
          <el-table-column prop="expiresAt" :label="t('mailRecovery.expires')" min-width="160" />
        </el-table>
        <footer class="trash-pagination">
          <span>{{ t('mailRecovery.page', { page, total }) }}</span>
          <el-button :disabled="page <= 1 || busy" @click="changePage(-1)">{{ t('mailRecovery.previous') }}</el-button>
          <el-button :disabled="page * size >= total || busy" @click="changePage(1)">{{ t('mailRecovery.next') }}</el-button>
        </footer>
      </div>
      <el-dialog v-model="detailVisible" :title="detail?.subject || t('mailRecovery.noSubject')" width="min(760px, 94vw)" destroy-on-close>
        <template v-if="detail">
          <dl class="detail-meta">
            <dt>{{ t('mailRecovery.sender') }}</dt><dd>{{ detail.sendEmail }}</dd>
            <dt>{{ t('mailRecovery.mailbox') }}</dt><dd>{{ detail.mailbox }}</dd>
            <dt>{{ t('mailRecovery.time') }}</dt><dd>{{ detail.createTime }}</dd>
          </dl>
          <shadow-html v-if="detail.content" :key="detail.emailId" :html="detail.content" />
          <pre v-else class="plain-body">{{ detail.text }}</pre>
          <ul v-if="detail.attachments?.length" class="attachments">
            <li v-for="item in detail.attachments" :key="item.attId"><a :href="attachmentHref(item.key)" :download="item.filename">{{ item.filename }}</a></li>
          </ul>
        </template>
        <template #footer><el-button @click="detailVisible = false">{{ t('mailRecovery.close') }}</el-button></template>
      </el-dialog>
    </section>
  </el-scrollbar>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import ShadowHtml from '@/components/shadow-html/index.vue';
import { trashList, trashDetail, trashRestore, trashPurge, trashEmptyPreview, trashEmpty } from '@/request/mail-recovery.js';
import { toPrivateAttachmentUrl } from '@/utils/convert.js';

const { t } = useI18n();
const rows = ref([]), selection = ref([]), loading = ref(false), busy = ref(false), keyword = ref('');
const page = ref(1), total = ref(0), size = 20, table = ref();
const detail = ref(null), detailVisible = ref(false);
const emptyProgress = ref(null);
const errorMessage = ref('');
let requestVersion = 0;

async function loadList() {
  const version = ++requestVersion;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await trashList({ page: page.value, size, keyword: keyword.value.trim() || undefined });
    if (version !== requestVersion) return;
    rows.value = result.list || []; total.value = result.total || 0;
    selection.value = []; table.value?.clearSelection();
    if (!rows.value.length && page.value > 1) { page.value -= 1; await loadList(); }
  } catch (error) { if (version === requestVersion) errorMessage.value = error?.message || t('mailRecovery.loadFailed'); }
  finally { if (version === requestVersion) loading.value = false; }
}
function search() { page.value = 1; loadList(); }
function changePage(delta) { page.value += delta; loadList(); }
function attachmentHref(key) { return toPrivateAttachmentUrl(key); }
async function view(row) {
  try { detail.value = await trashDetail(row.emailId); detailVisible.value = true; }
  catch (error) { errorMessage.value = error?.message || t('mailRecovery.loadFailed'); }
}
async function restoreSelected() {
  if (busy.value || !selection.value.length || selection.value.some(row => !row.canRestore)) return;
  const ids = selection.value.map(row => row.emailId);
  busy.value = true;
  try {
    const result = await trashRestore(ids);
    ElMessage.success(t('mailRecovery.restored', { count: result.restoredCount }));
    await loadList();
  } catch (error) { errorMessage.value = error?.message || t('mailRecovery.operationFailed'); }
  finally { busy.value = false; }
}
async function purgeSelected() {
  if (busy.value || !selection.value.length) return;
  const ids = selection.value.map(row => row.emailId);
  try {
    await ElMessageBox.confirm(t('mailRecovery.purgeConfirm', { count: ids.length }), t('mailRecovery.purgeTitle'), {
      confirmButtonText: t('mailRecovery.purge'), cancelButtonText: t('mailRecovery.cancel'), type: 'warning',
    });
  } catch { return; }
  busy.value = true;
  try {
    const result = await trashPurge(ids);
    ElMessage.success(t('mailRecovery.purged', { count: result.deletedCount }));
    await loadList();
  } catch (error) { errorMessage.value = error?.message || t('mailRecovery.operationFailed'); }
  finally { busy.value = false; }
}
async function emptyAll() {
  if (busy.value) return;
  busy.value = true;
  try {
    const plan = await trashEmptyPreview();
    if (!plan.count) { await loadList(); return; }
    try {
      await ElMessageBox.confirm(t(plan.limited ? 'mailRecovery.emptyBatchConfirm' : 'mailRecovery.emptyConfirm', { count: plan.count, total: plan.total }), t('mailRecovery.emptyTrash'), {
        confirmButtonText: t('mailRecovery.purge'), cancelButtonText: t('mailRecovery.cancel'), type: 'warning',
      });
    } catch { return; }
    emptyProgress.value = 0;
    let offset = 0;
    do {
      const result = await trashEmpty(plan.token, offset);
      emptyProgress.value += result.deletedCount;
      offset = result.nextOffset;
    } while (offset !== null);
    ElMessage.success(t('mailRecovery.purged', { count: emptyProgress.value }));
    await loadList();
  } catch (error) { errorMessage.value = error?.message || t('mailRecovery.operationFailed'); }
  finally { busy.value = false; emptyProgress.value = null; }
}
onMounted(loadList);
</script>

<style scoped lang="scss">
.trash-scroll { width: 100%; height: 100%; }
.trash-page { max-width: 1280px; margin: auto; padding: 28px 24px; }
.trash-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; h2 { margin: 0 0 8px; } p { margin: 0; color: var(--muted); line-height: 1.6; } }
.trash-card { padding: 20px; min-width: 0; }
.trash-tools { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; .el-input { width: min(100%, 300px); } span { color: var(--muted); font-size: 13px; } }
.subject-button { border: 0; padding: 4px 0; color: var(--text-strong); background: transparent; text-align: left; cursor: pointer; font: inherit; overflow-wrap: anywhere; &:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; } }
.restore-notice { color: var(--muted); font-size: 12px; margin: 4px 0; }
.trash-pagination { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; padding-top: 18px; span { margin-right: auto; color: var(--muted); font-size: 13px; } }
.detail-meta { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; overflow-wrap: anywhere; dt { color: var(--muted); } dd { margin: 0; } }
.plain-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.attachments { padding-left: 20px; overflow-wrap: anywhere; a { color: var(--accent); } }
.trash-error { color: var(--el-color-danger); overflow-wrap: anywhere; }
@media (max-width: 640px) { .trash-page { padding: 16px 10px; } .trash-card { padding: 12px; } .trash-header { align-items: flex-start; } }
</style>
