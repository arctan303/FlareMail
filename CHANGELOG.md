# Changelog

## 未发布 / Unreleased

- 修复草稿行删除误用服务器邮件接口及批量删除遗留附件；自动检查新邮件时，手动刷新与翻页优先处理，保留请求期间用户的新滚动位置。
- Fixed draft-row deletion calling the server mail API and batch deletion leaving attachments behind. Manual refresh and paging now take priority over background checks, which preserve scrolling performed during the request.

- 写信新增直接保存草稿入口，新建及更新均事务保存正文和附件；收件箱默认每30秒自动检查新邮件，切回页面立即检查，后台更新保留页码/滚动并避开勾选操作，修复筛选和分页下的新邮件检测游标。
- Added direct draft saving with transactional body and attachment storage. Inbox checks for new mail every 30 seconds by default and on return, preserving paging/scroll position and active selections; corrected update cursors across filters and pages.

- 修复 Resend 刚受理邮件、仍在排队时 Message-ID 为空的问题：元数据查询增加有限重试和总截止时间，不重复发信，并记录失败类别。
- Added bounded Message-ID lookup retries for newly queued Resend messages, with an overall deadline and diagnostic reasons, without resending mail.

- 修复发信成功但 Message-ID 查询受限时误报“状态需要确认”：改为已发送提示，单独说明会话关联限制，并补齐中英文说明。
- Corrected misleading delivery warnings after successful sends when Message-ID lookup is unavailable; show sent feedback with a localized threading limitation notice.

- 会话数量移至发件人后，阅读主题随正文滚动，收起邮件并入操作栏以减少空行。
- Moved conversation counts beside senders, let the reading heading scroll with messages, and placed Collapse in the message toolbar to remove the extra row.

- 会话归组同时检查回复关联与主题，兼容重复 `Re:` 等回复前缀；中途改题另起会话，列表、阅读及会话操作使用同一规则，原始主题和引用保留。
- Conversations now require reply links and matching subjects, tolerating repeated reply prefixes such as `Re:`. Subject changes start separate conversations consistently across lists, reading and actions, while original subjects and quotes are preserved.

- 会话阅读顶部统一显示主题，各封原始主题保留在邮件详情，避免历史邮件重复大标题。
- Conversation reading shows one heading, with each original subject available in message details.

- 新增 Gmail 式会话列表与阅读：同一回复链一个入口，按会话分页并显示未读；打开后整段来信标已读，历史邮件可展开，引用原文保留。
- Added conversation lists and reading: one entry per reply chain, conversation paging and unread state, and conversation-wide read updates on opening, with expandable history and original quotes preserved.
- 优化阅读和写信的历史引用折叠及多级缩进，保留原文；修复引用错配、草稿/编辑器同步、回复对象和消息关联 ID。
- Improved quote folding and nested indentation in reading and composing while preserving original content; fixed stale quotes, draft/editor synchronization, reply recipients, and threading IDs.
- 新收件保存并展示 Reply-To，需要管理员执行数据库 325 更新；旧邮件丢失的字段不自动恢复。
- Newly received mail stores and displays Reply-To after an administrator applies database update 325; missing historical values cannot be recovered automatically.

## v1.0.4 — 2026-09-22

### 新增 / Added

- **邮件操作与撤销 / Mail actions and undo**:
  - 邮件列表与阅读页支持将邮件重新标记为未读；已读操作提供 5 秒撤销窗口，批量操作同步反馈结果。
  - 发信增加 5 秒“撤销发送”窗口；倒计时开始前持久化可恢复的本地草稿，发送完成前阻止打开第二封写信，并在刷新或关闭页面时提示仍有待处理邮件。
  - Mail list and detail views can mark messages as unread. Mark-as-read actions provide a five-second undo window with clear batch feedback.
  - Sending now has a five-second undo window. A recoverable local draft is persisted before the countdown, a second composer is blocked until sending finishes, and refresh or close warns while mail is still pending.
- **邮件详情反馈 / Mail detail feedback**:
  - 投递详情支持复制发件人、收件人、抄送与密送地址；附件下载显示开始提示、进行中状态并阻止重复点击。
  - Delivery details can copy sender, recipient, CC, and BCC addresses. Attachment downloads now show start and in-progress feedback and prevent duplicate clicks.

### 安全 / Security

- **入站邮件资源边界 / Inbound mail resource boundaries**:
  - 在解析和业务持久化前限制原始邮件为 25 MiB、附件数量为 50、解码后附件总量为 18 MiB；超限邮件不会写入 D1、KV、R2，也不会转发。
  - Raw messages are capped at 25 MiB, with at most 50 attachments and 18 MiB of decoded attachment data before parsing or business persistence. Rejected messages do not write to D1, KV, or R2 and are not forwarded.
- **公开请求体限制 / Public request-body limits**:
  - 登录、安装验证/升级和 OAuth Token 使用 16 KiB 流式上限，完整安装提交使用 64 KiB；声明长度、分块请求和虚假偏小长度均经过实际读取上限约束。
  - Login, setup verification/upgrade, and OAuth token requests use a 16 KiB streaming cap; full setup submissions use 64 KiB. Declared, chunked, and deceptively undersized bodies are all constrained by bytes actually read.
- **回复与转发隐私 / Reply and forward privacy**:
  - 引用邮件进入编辑器前转义发件人元数据与纯文本，并重新清洗富文本；远程图片默认保持阻断且不会自动请求，站内附件图片路径继续保留。
  - Quoted sender metadata and plaintext are escaped and rich content is sanitized before entering the editor. Remote images stay blocked without automatic requests while internal attachment image paths remain available.
- **草稿与认证生命周期 / Draft and authentication lifecycle**:
  - 只有用户明确退出登录时才清理当前用户的浏览器本地草稿和草稿附件；刷新、401、自然过期及跨标签失效继续保留草稿。
  - Member permissions now come from one server-side definition, and redeemed OAuth authorization codes are retained for a bounded 30-day audit window without becoming replayable.
  - Browser-local drafts and draft attachments are cleared only on explicit logout; refreshes, 401 responses, natural expiry, and cross-tab invalidation continue to preserve them.
  - 成员权限改为服务端单一来源；已兑换 OAuth 授权码在不可重放的前提下保留 30 天审计窗口。

### 优化 / Improved

- 邮件工具栏、分页计数、批量选择和复选框在窄屏下更紧凑；批量星标、复制和下载操作提供一致反馈。
- 数据库维护卡片改为更清晰的当前版本 → 目标版本流程，集中展示待升级补丁、状态、刷新和升级操作，并改善移动端布局。
- Mail toolbars, page counts, batch selection, and checkboxes are more compact on narrow screens, with consistent feedback for batch starring, copying, and downloading.
- The database maintenance card now presents a clearer current-to-target version flow, pending patches, status, refresh, and upgrade actions with improved mobile layout.

### 兼容性与验证 / Compatibility and validation

- 数据库 schema 保持 324，不需要数据迁移。极端大邮件及超大公开请求体现在会被明确拒绝；累计邮箱容量配额仍未实现。
- 完整 Worker/Web 测试、正式构建、Pages 构建、产物冒烟、敏感信息审计及回复/转发浏览器网络验证作为发布门禁执行；最终结果以获批的 `dev` 提交和 GitHub Release 为准。
- Database schema remains at 324 with no data migration. Exceptionally large mail and oversized public request bodies are now rejected explicitly; cumulative mailbox storage quotas remain out of scope.
- Full Worker/Web tests, production and Pages builds, artifact smoke checks, sensitive-information review, and browser network checks for reply/forward are release gates. Final evidence is tied to the approved `dev` commit and GitHub Release.

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
