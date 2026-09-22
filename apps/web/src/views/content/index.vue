<template>
  <div class="email-detail-route-page">
    <div class="detail-route-card">
      <MailConversation
        :anchor="email"
        :del-type="emailStore.contentData.delType"
        :show-star="emailStore.contentData.showStar"
        :show-reply="emailStore.contentData.showReply"
        :show-unread="true"
        @back="handleBack"
        @delete-success="handleDeleteSuccess"
        @star-change="handleStarChange"
        @unread-change="handleUnreadChange"
        @thread-read="handleThreadRead"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useEmailStore } from '@/store/email.js';
import MailConversation from '@/components/mail-conversation/index.vue';

const router = useRouter();
const emailStore = useEmailStore();
const email = computed(() => emailStore.contentData.email || {});

let touchStartX = 0;
let touchStartY = 0;
let isTrackingTouch = false;

function handleTouchStart(e) {
  if (!e.touches || e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;

  // 仅在手指从屏幕左侧边缘 (<= 40px) 开始滑动时激活返回手势
  if (touchStartX <= 40) {
    isTrackingTouch = true;
  } else {
    isTrackingTouch = false;
  }
}

function handleTouchEnd(e) {
  if (!isTrackingTouch) return;
  isTrackingTouch = false;

  if (!e.changedTouches || e.changedTouches.length !== 1) return;
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;

  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;

  // 水平滑动大于 70px 且偏角较平时触发返回
  if (deltaX > 70 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
    handleBack();
  }
}

onMounted(() => {
  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('touchstart', handleTouchStart);
  window.removeEventListener('touchend', handleTouchEnd);
});

function handleBack() {
  router.back();
}

function handleStarChange(email) {
  if (email.isStar) emailStore.starScroll?.addItem(email);
  else emailStore.starScroll?.deleteEmail([email.emailId]);
}

function handleDeleteSuccess(emailId, shouldLeave) {
  emailStore.deleteIds = [emailId];
  if (shouldLeave) router.back();
}

function handleUnreadChange(message) {
  const read = Number(message?.unread) === 1;
  if (Number(email.value?.emailId) === Number(message?.emailId)) email.value.unread = message.unread;
  for (const list of [emailStore.emailScroll, emailStore.starScroll, emailStore.sendScroll]) {
    list?.applyReadState?.(message.emailId, read);
  }
}

function handleThreadRead(emailIds) {
  const ids = new Set((emailIds || []).map(Number));
  if (ids.has(Number(email.value?.emailId))) email.value.unread = 1;
  for (const id of ids) {
    for (const list of [emailStore.emailScroll, emailStore.starScroll, emailStore.sendScroll]) list?.applyReadState?.(id, true);
  }
}
</script>

<style scoped lang="scss">
.email-detail-route-page {
  height: 100%;
  width: 100%;
  overflow: hidden;
  padding: 0 16px 16px 8px;
  box-sizing: border-box;
  background-color: var(--paper);

  .detail-route-card {
    height: 100%;
    border-radius: 12px;
    border: none;
    background-color: var(--surface);
    overflow: hidden;
  }
}
@media (max-width: 767px) { .email-detail-route-page { padding: 0; .detail-route-card { border-radius: 10px 10px 0 0; } } }
</style>
