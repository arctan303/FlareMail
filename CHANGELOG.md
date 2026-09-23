# Changelog

## 未发布 / Unreleased

## v1.1.0 — 2026-09-23

本版本覆盖上一稳定版之后 `main` 到 `dev` 的完整变更；此前仅准备、未发布的 v1.0.4 内容一并纳入 v1.1.0。

This release includes the complete `main`-to-`dev` change range since the previous stable release, including work prepared for v1.0.4 that was never published.

### 新增 / Added

- **会话列表与阅读**：收件箱、已发送和星标列表将同一回复链收纳为一个入口，按会话分页，在发件人后显示邮件数量。存在未读来信时整个入口呈现未读；打开会话会标记其中的来信已读，最新邮件展开，历史往返可按时间查看。
- **Conversation lists and reading**: Inbox, Sent and Starred group a reply chain into one entry, paginate conversations and show message counts beside senders. An unread incoming message makes the conversation unread; opening it marks incoming messages read, expands the latest message and provides chronological history.
- **主题与引用**：归组同时检查消息回复关联和主题，兼容重复 `Re:`、中文回复前缀；仅主题相同不会合并，中途改题会另起会话。阅读页统一主题随正文滚动，各封原始主题保留在详情；历史引用默认折叠并限制多级缩进，保留原文。
- **Subjects and quotes**: Grouping requires reply links and matching subjects, recognizes repeated `Re:` and Chinese reply prefixes, and starts a separate conversation when the subject changes. Matching subjects alone do not merge mail. A shared heading scrolls with the conversation; original subjects remain in message details. Historical quotes collapse with bounded indentation while retaining their content.
- **草稿与自动刷新**：写信增加“保存草稿”，收件人未填也可保存，正文和附件一起持久化。收件箱默认每 30 秒检查新邮件，隐藏或离线时暂停，返回页面或恢复网络时立即检查；保留当前分页、滚动位置和正在进行的勾选操作。
- **Drafts and automatic updates**: Compose adds Save draft, including incomplete recipient fields, with body and attachments persisted together. Inbox checks every 30 seconds by default, pauses when hidden or offline, and checks on return or reconnection while preserving paging, scrolling and active selections.
- **未读与撤销**：列表和阅读页可重新标未读；标已读提供 5 秒撤销，列表批量操作作用于当前文件夹及邮箱筛选内的会话邮件。发送提供 5 秒撤销窗口，倒计时开始前保存恢复草稿，并防止重复开启发送及刷新丢失待处理内容。
- **Unread and undo**: Lists and message details can mark mail unread. Mark-as-read offers a five-second undo window; list actions affect conversation messages within the current folder and mailbox filter. Sending offers a five-second undo window, saves a recovery draft before the countdown, and guards against concurrent sends and loss of pending content on reload.
- **Reply-To**：升级数据库后，新收件保存并展示 Reply-To；Web 和 CLI 回复优先使用来信指定的回复地址，回复已发送邮件使用原收件人。
- **Reply-To**: After the schema upgrade, incoming mail stores and displays Reply-To. Web and CLI replies prefer the sender's designated reply addresses; replying to sent mail targets its original recipients.

### 修复与优化 / Fixed and improved

- 修复草稿/回复切换及编辑器重建时的旧内容覆盖、回复身份和收件人选择、正文同步与附件保存；CLI 纯文本发信和回复正确转义 HTML。
- Fixed stale content when switching drafts/replies or rebuilding the editor, sender/recipient selection, body synchronization and attachment persistence. CLI plaintext sends and replies now escape HTML correctly.
- 修复草稿单封删除误用服务器邮件接口、批量删除遗留附件；保存或删除失败保留内容并提示。修复后台刷新期间翻页/手动刷新被忽略，以及结果返回后滚动位置倒退。
- Fixed draft-row deletion calling the server mail API and batch deletion leaving attachments behind, with visible failure feedback. Fixed foreground paging/refresh being ignored during background updates and scroll position jumping backward afterward.
- 修复筛选、分页和升序下的新邮件检测游标；后台请求串行调度并丢弃过期范围响应。
- Corrected new-mail cursors across filters, pages and ascending order; background checks run serially and discard responses for obsolete scopes.
- 区分投递服务内部 ID 与 RFC Message-ID，保留回复的 In-Reply-To/References 链。Resend 排队期间 Message-ID 暂未生成时最多查询三次、整体最多五秒，不重复发送；已受理但关联元数据缺失时提示已发送及会话关联限制，真实投递不确定仍保留警告。
- Distinguished provider IDs from RFC Message-ID values and preserved In-Reply-To/References chains. Resend metadata lookups retry at most three times within five seconds while queued, without resending. Accepted mail with missing threading metadata shows sent feedback and a threading limitation; genuine delivery uncertainty still warns.
- 优化窄屏工具栏、分页、批量选择、星标和复制反馈；邮件详情可复制地址，附件下载显示进度并防重复点击。数据库维护页更清晰地展示当前/目标版本、待升级补丁和升级状态。静态体验页同步会话和草稿行为，中英使用/发信文档同步更新。
- Improved narrow-screen toolbars, paging, bulk selection, starring and copy feedback. Message details support address copying and attachment download progress with duplicate-click protection. Database maintenance presents current/target versions, pending patches and upgrade status more clearly. The static experience and bilingual usage/sending guides reflect the new workflows.

### 安全与维护 / Security and maintenance

- 入站原始邮件限制为 25 MiB、附件最多 50 件、解码后附件总量最多 18 MiB；超限邮件在业务持久化和转发前拒绝。
- Incoming raw mail is limited to 25 MiB, 50 attachments and 18 MiB of decoded attachments; oversized messages are rejected before business persistence or forwarding.
- 登录、安装验证/升级与 OAuth Token 请求体使用 16 KiB 流式上限，完整安装使用 64 KiB；覆盖缺失或虚假的 Content-Length 及分块请求。
- Login, setup verification/upgrade and OAuth token bodies use streamed 16 KiB limits; full setup uses 64 KiB, including missing/misleading Content-Length and chunked bodies.
- 回复/转发引用重新净化 HTML、转义元数据并默认阻断远程图片；当前用户的本地草稿和附件仅在显式退出登录时清理，刷新、401 或自然过期继续保留。
- Reply/forward quotes are sanitized, metadata is escaped and remote images are blocked by default. Browser-local drafts and attachments are cleared only on explicit logout, surviving refreshes, 401 responses and natural session expiry.
- 成员权限统一由服务端一处定义；已兑换 OAuth 授权码在保持不可重放的前提下保留 30 天审计窗口。完善权限回归测试、遗留表说明及 `dev` → 验证批准 → `main`/标签/Release 发布流程。
- Member permissions use one server-side definition. Redeemed OAuth codes remain non-replayable while retained for a 30-day audit window. Permission regression tests, legacy-table documentation and the `dev` → validated approval → `main`/tag/Release process were strengthened.

### 升级、兼容性与限制 / Upgrade, compatibility and limitations

- 数据库目标版本从 **324 升至 325**，新增 `email.reply_to`。部署前备份 D1 与附件对象；部署后管理员在“系统设置 → 系统维护”执行数据库更新。旧 schema 继续兼容基本收发，但历史未保存的 Reply-To 无法自动恢复。
- The target schema advances from **324 to 325**, adding `email.reply_to`. Back up D1 and attachment objects before deployment; afterward, apply the database update under System settings → Maintenance. Basic mail operations remain compatible with the old schema, but historical Reply-To values that were never stored cannot be recovered automatically.
- 回复头缺失或供应商未返回 RFC Message-ID 时，会话关联可能不完整；超大会话/扫描达到保护上限时界面会提示。草稿仍只保存在当前浏览器；自动更新采用轮询。累计邮箱容量配额尚未实现。
- Threading may be incomplete when reply headers or provider RFC Message-ID values are unavailable; the UI reports conversation/scan limits. Drafts remain browser-local, updates use polling, and cumulative mailbox storage quotas are not implemented.
- 验证基线：Worker **324**、Web **121**、部署脚本 **5** 项通过；正式版与 Pages 构建、产物页面/资源冒烟及草稿删除浏览器验证通过。未重新执行线上真实收发；附件浏览器上传验收受工具限制，保存事务有自动测试覆盖。构建仍有既有的大分块提示。
- Validation baseline: **324 Worker**, **121 Web** and **5 deployment-script** tests passed, along with production/Pages builds, artifact route/asset smoke checks and browser draft-deletion verification. Live delivery was not rerun; browser attachment-upload verification was limited by tooling, with persistence covered by automated tests. Existing large-chunk build warnings remain.
- 本 Release 发布源码，不代表已经部署 Cloudflare Worker/Pages 或执行生产数据库迁移。
- This Release publishes source code; it does not imply Cloudflare Worker/Pages deployment or production database migration.

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
