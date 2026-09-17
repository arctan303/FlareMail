# FlareMail

FlareMail 是部署在自己 Cloudflare 账号上的邀请制私有域名邮箱，适合个人、受邀家庭或小团队使用。管理员添加受邀成员，每个人独立访问自己的邮件；也可使用个人 CLI / Agent 令牌接入脚本或 Agent。

正式首版 v1.0.0 正在准备发布。建议先[在线体验](/docs/zh/experience)，再按[部署指南](/docs/zh/deployment)给自己或少量受邀成员安装。

不提供公开注册、批量接码平台或管理员跨用户浏览邮件的入口。

## 主要能力

- 多域名、多邮箱地址、邮件收发、回复与转发、附件、星标和联系人。
- 中文与英文界面、深浅色主题、响应式布局与键盘快捷键。
- Web 安装向导、域名管理、受邀成员管理和集中配置。
- 自定义品牌与 PWA、Google 登录绑定、敏感设置二次验密。
- 个人 CLI / Agent 令牌与第一方 OAuth 授权接入。

## 架构


整个系统以**单个 Cloudflare Worker** 为统一入口，无常驻服务器负担，随用随走：

| 组件 | 技术选型 | 用途 |
| --- | --- | --- |
| **Worker 网关** | Cloudflare Workers + Hono | 邮件处理、HTTP API、用户鉴权与前端静态资源托管 |
| **主关系库** | Cloudflare D1（绑定名 `db`） | 成员、邮箱、邮件元数据与正文、联系人、系统设置、Schema 迁移记录 |
| **键值存储** | Cloudflare KV（绑定名 `kv`） | 会话 Session、短期令牌、语言与品牌缓存、无 R2 时的对象回落存储 |
| **对象存储** | Cloudflare R2（绑定名 `r2`，可选） | 邮件大附件与自定义品牌素材（附件经由 Worker 鉴权，桶保持私有） |
| **前端应用** | Vue 3 + Vite + Element Plus | 响应式邮箱客户端与完整功能管理员后台（输出至 `apps/worker/dist`） |
| **收信路由** | Cloudflare Email Routing | 将域名收信无缝交给 Worker 的 `email()` 事件处理器 |
| **发信渠道** | Resend / Cloudflare Email Sending (Beta) | 外部发信投递 |

## 项目结构


```text
FlareMail/
├─ apps/
│  ├─ web/          # Vue 3 前端页面、组件、i18n 与前端单元测试
│  └─ worker/       # Cloudflare Worker、Hono 后端、数据库迁移与后端单元测试
├─ scripts/         # 工作区启动脚本
├─ package.json     # 统一开发、测试、构建和部署入口
├─ pnpm-workspace.yaml
└─ pnpm-lock.yaml   # 全工作区唯一依赖锁
```

前端发布构建输出到 `apps/worker/dist`，最终依然部署为一个统一的 Worker。实例配置放在 `apps/worker/wrangler.toml`，本地凭据放在 `apps/worker/.dev.vars`（两者均被 Git 忽略）。

体验站直接复用前端组件，独立构建为静态 Pages；正式邮箱保持单 Worker 架构。

FlareMail 是一方产品之一，历时三个月开发。维护者已作为日常主力邮箱使用，并将持续维护。
