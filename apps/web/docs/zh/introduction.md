# 无需 VPS 的个人域名邮箱

FlareMail 让你用自己的域名收发邮件，部署在你自己的 Cloudflare 账号。**免费计划也能起步，网页就能完成应用部署和初始化**，无需购买或维护 VPS。

给自己一个常用地址，为项目留一个联系地址，再给助手一个独立邮箱。多个地址的邮件可以在同一个 Web 界面查看、搜索和回复。

[在线体验](/inbox) · [费用与准备](/docs/zh/costs) · [部署自己的邮箱](/docs/zh/deployment)

## 为什么适合个人使用

- **从一个人开始**：安装向导创建自己的管理员邮箱，即可使用；需要时再添加地址或受邀成员。
- **无需管理服务器**：网页、API 和邮件处理运行在 Cloudflare，数据保存在自己账号的 D1 与 KV；附件也可按需使用 R2。
- **免费账号可部署**：应用和收信使用 Cloudflare 免费计划，发信可搭配 Resend 免费额度。域名自行准备，服务额度见[费用说明](/docs/zh/costs)。
- **用网页完成设置**：一键部署应用，按安装向导创建邮箱，再接通域名收发。日常设置、邮箱地址和品牌配置都能在网页管理。

## 可以怎样使用

### 日常通信与项目联系

用自己的域名作为联系地址。回复、转发、附件、搜索、星标和联系人覆盖日常邮件操作；同一回复链集中为一个会话，阅读往来时可以折叠历史引用。

多个域名和地址可在一个实例内管理。顶部选择器可以查看自己的全部邮箱，也可以只看某个地址。手机布局、深浅色主题、中英双语和 PWA 方便随时打开。

### 给助手一个独立邮箱

用个人 CLI Token 让脚本或 Agent 查询、搜索、读取和回复邮件。收件 Webhook 在邮件与附件就绪后通知接收端，由助手自己排队和处理；通知规则、密钥、测试及投递记录均可通过 CLI 管理。详见 [CLI / Agent](/docs/zh/cli)，以所部署版本为准。

### 按需与家人共享

管理员可以创建受邀成员，每个人使用自己的邮箱。成员管理是可选能力，一个人使用也无需额外建立团队；Google 登录、站点品牌和自己网站的 OAuth 授权也可按需设置。

## 从这里开始

也可以先按自己的用途阅读：[个人域名邮箱](/docs/zh/personal-mailbox) · [给助手一个邮箱](/docs/zh/assistant-mailbox)。

1. [先体验邮箱](/docs/zh/experience)：无需登录，使用示例邮件了解阅读、整理和写信。
2. [看费用与准备](/docs/zh/costs)：确认域名、免费方案和发信选择。
3. [部署并接通收发](/docs/zh/deployment)：创建应用、完成 Web 初始化，再配置域名路由和发信服务。
4. [开始日常使用](/docs/zh/usage)：管理地址、阅读会话、搜索邮件，或[接入自己的助手](/docs/zh/cli)。

邮箱通过 Web 或 CLI API 使用；客户端接入、附件和其他问题见[常见问题](/docs/zh/faq)。稳定版本和更新记录见 [Releases](https://github.com/arctan303/FlareMail/releases)。

## 技术与数据放在哪里

正式邮箱由**单个 Cloudflare Worker**提供网页、API 与收信处理，无需常驻服务器。发信可选 Resend 或 Cloudflare Email Sending；后者向任意外部地址发信需要 Workers Paid。

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
