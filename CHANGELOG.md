# Changelog

## v1.0.3 — 2026-09-20

### 新增 / Added

- **主题与个性化定制 / Theme & Accent Customization**:
  - 新增外观主题卡片（`ThemeCard`），支持浅色（Light）、深色（Dark）及跟随系统（System）模式切换。
  - 支持自定义品牌强调色（Accent Color），提供多套精选预设色板与自定义拾色，并引入首屏快速注入防闪烁脚本（`theme-init.js`）。
  - Added `ThemeCard` component supporting Light, Dark, and System theme modes.
  - Added custom brand accent color picker with presets, persistent local storage, and an anti-flicker pre-bundle boot script (`theme-init.js`).
- **设置页分区导航 / Section-based Settings Navigation**:
  - 个人设置页面重构为独立分区卡片布局（个人资料 Profile、外观 Theme、邮箱别名 Mailboxes、安全验证 Security 等），提升配置效率与移动端可读性。
  - Refactored settings page into dedicated section-based cards (Profile, Theme, Mailboxes, Security) with improved responsive navigation and drawer support.

### 优化 / Improved

- **交互微动效与过渡体系 / Micro-interactions & Transition System**:
  - 引入完整的物理动效令牌体系（`--motion-instant`、`--motion-fast`、`--motion-base`、`--ease-spring`）。
  - 全局交互元素（按钮、图标、卡片等）接入 `:active` 物理按压弹性反馈（`translateY(1px) scale(0.985)`）。
  - 主工作区路由视图引入平滑的 `page-fade-slide` 页面淡入位移过渡。
  - 写信弹窗接入 `modal-scale` 弹性缩放过渡，消除窗口突兀弹出的生硬感。
  - 设置与系统设置 Tab 切换接入 `tab-fade` 柔和渐变过渡。
  - 骨架屏注入顺滑的扫光动画（Shimmer），首屏加载 Loading 增加淡出过渡。
  - 星标按钮增加点击脉冲放大动画，验证码与口令复制增加瞬时绿色脉冲反馈。
  - Introduced design tokens for motion durations and easing curves across the web application.
  - Added physical active press feedback (`translateY(1px) scale(0.985)`) for interactive buttons, icons, and cards.
  - Implemented `page-fade-slide` transitions for main workspace view navigation.
  - Implemented `modal-scale` elastic scale animations for the compose email modal dialog.
  - Added `tab-fade` soft fading transitions for settings and system settings tabs.
  - Added shimmering sweep animations to skeleton rows and smooth fade-out to initial app loading.
  - Enhanced star toggle with pulse animations and verification code copy with instant feedback.
- **邮件列表已读与未读视觉区分度 / Email List Read & Unread Visual Hierarchy**:
  - 遵循纸墨风格设计理念（不使用小圆点），完全通过温润色阶与文字层级实现清晰区分。
  - 未读邮件使用高亮纯白背景（`var(--surface)`），发件人与主题加粗浓黑（`font-weight: 700; color: var(--text-strong)`），时间以品牌色醒目呈现。
  - 已读邮件采用信纸柔和灰背景（`var(--paper-soft)`），发件人与主题呈雅致淡灰（`var(--faint)`），悬停（hover）时平滑提亮并恢复浓墨清晰度。
  - Strengthened visual contrast between read and unread emails without introducing unread dots.
  - Unread emails feature pure white highlighted surface background, bold dark ink typography (`font-weight: 700; color: var(--text-strong)`), and accent-highlighted timestamps.
  - Read emails feature soft paper gray background (`var(--paper-soft)`) and muted ink typography (`var(--faint)`), smoothly brightening and restoring text contrast on hover.

## v1.0.2 — 2026-09-18

### Added

- Deploy to Cloudflare entry in the bilingual README and Docs, with a public root Worker configuration and installation-secret guidance.
- Deployment-launcher regression tests covering existing instance configuration, explicit configuration and local development protection.

### Improved

- New-installation guides prioritize the browser deployment flow and Web setup; command-line deployment remains available as an advanced route.
- Update guides explain how to preserve the existing database, storage bindings and customized configuration when updating a deploy-button instance.

### Validation scope

- Local builds and Worker packaging were verified. Cloudflare deployment-form secret collection, remote resource provisioning and repository ID writeback still require an end-to-end platform check.

## v1.0.1 — 2026-09-18

### Optimized

- Docs page experience: refreshed documentation page design with clean white aesthetics, enlarged brand identity, streamlined navigation, and smoother page/theme/language transition animations.
- Docs directory structure: renamed the primary documentation group to "Quick start" (快速开始) to provide a clearer initial onboarding path.
- Code syntax highlighting: added lightweight zero-dependency token coloring for shell commands, JSON, HTTP requests, and JavaScript in documentation code blocks.

## v1.0.0 — 2026-09-17

First formal release of FlareMail, an invitation-based private mailbox on your own domain.

### Included

- A single Cloudflare Worker serves the Web interface, API and incoming mail handler; D1/KV are required and R2 object storage is optional.
- Multiple domains and mailbox addresses, mail reading and organization, composing, replies, forwarding, attachments, contacts and browser-local drafts.
- Administrator-created invited members, per-user mail access, Web setup, centralized settings and custom branding.
- Chinese/English interfaces, light/dark appearance, responsive layout, keyboard shortcuts and PWA installation.
- Personal CLI / Agent tokens and optional first-party OAuth authorization; optional linked Google sign-in and Turnstile verification.
- Resend sending by default, with optional Cloudflare Email Sending (Beta).
- A separate static Pages experience with sample data and bilingual Docs.

### Before deployment

- Configure receiving DNS/routing and verify the selected sending provider; test delivery with an external mailbox.
- Browser drafts do not synchronize across devices. IMAP, POP3 and SMTP client access are not provided.
- Back up D1 and attachment/brand objects separately before upgrades or storage changes. Current database schema: 324.

[中文部署文档](https://flaremail-demo.pages.dev/docs/zh/deployment) · [English deployment guide](https://flaremail-demo.pages.dev/docs/en/deployment)
