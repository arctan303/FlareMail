<template>
  <section class="right-card-pane">
    <div class="stationery-card">
      <div class="mobile-brand-wrap">
        <div class="brand-seal-icon mobile-seal">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
        </div>
        <div>
          <h3 class="brand-title-text arc-serif-title" style="font-size: 19px">{{ title }}</h3>
          <span style="font-size: 12px; color: var(--muted);">{{ subtitle }}</span>
        </div>
      </div>

      <slot name="header" />
      <slot />
    </div>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' }
})
</script>

<!--
  刻意不加 scoped：卡片内部样式需要同时作用于登录页与预览页传入的插槽内容，
  只写一份，避免两处各维护一套导致预览与真实登录页不一致。
  全部选择器都限定在 .stationery-card / .right-card-pane 之下，不外溢到其它页面。
-->
<style lang="scss">
.right-card-pane {
  display: flex;
  justify-content: center;

  .stationery-card {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 20px;
    padding: 40px 36px;
    box-shadow: 0 12px 36px -8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.02);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 20px;

    @media (max-width: 480px) {
      padding: 28px 20px;
      border-radius: 16px;
    }

    .mobile-brand-wrap {
      display: none;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;

      @media (max-width: 960px) {
        display: flex;
      }

      .mobile-seal {
        width: 36px;
        height: 36px;
        background: var(--accent);
        color: #fff;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;

        svg {
          width: 20px;
          height: 20px;
        }
      }
    }

    .form-item {
      display: flex;
      flex-direction: column;
      gap: 7px;

      .item-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-strong);
      }

      .field-icon {
        color: var(--muted);
        margin-left: 4px;
      }
    }

    .arc-submit-btn {
      width: 100%;
      height: 44px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 10px;
      margin-top: 6px;
      letter-spacing: 0.02em;
    }

    .login-turnstile {
      display: flex;
      justify-content: center;
      margin: 8px 0;
      min-height: 65px;
    }

    .oauth-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 4px 0;

      .oauth-divider-line {
        flex: 1;
        height: 1px;
        background: var(--line);
      }

      .oauth-divider-text {
        font-size: 12px;
        color: var(--faint);
      }
    }

    .oauth-btn {
      width: 100%;
      height: 44px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--text-strong);
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      cursor: pointer;
      transition: all 0.18s ease;

      &:hover {
        background: var(--paper-soft);
        border-color: var(--accent);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      }

      .google-g {
        width: 18px;
        height: 18px;
      }
    }

    .domain-select-wrapper {
      display: flex;
      align-items: center;
      position: relative;
      cursor: pointer;
      padding: 0 6px;
    }

    .hidden-select {
      position: absolute;
      top: 0;
      right: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      pointer-events: none;
    }

    .domain-display {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: var(--text);

      .setting-icon {
        position: relative;
        top: 1px;
        color: var(--muted);
      }
    }
  }
}
</style>
