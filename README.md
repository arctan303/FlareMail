<h1 align="center">
  <img src="./assets/flaremail-wordmark.svg" width="205" height="48" alt="FlareMail" />
</h1>

<p align="center">
  <strong>无需 VPS 的个人域名邮箱</strong><br />
  部署在自己的 Cloudflare 账号，支持 CLI 与助手接入。<br />
  <em>Personal domain email in your Cloudflare account. No VPS required.</em>
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.1.1-blue" alt="Version: 1.1.1" /></a>
  <a href="THIRD-PARTY-NOTICES.md"><img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License: AGPL 3.0" /></a>
  <img src="https://img.shields.io/badge/Platform-Cloudflare%20Workers-F38020.svg?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <a href="README-en.md">English</a> ·
  <a href="https://flaremail.arcinks.com/inbox">在线体验</a> ·
  <a href="https://flaremail.arcinks.com/docs/zh/introduction">使用文档</a> ·
  <a href="https://github.com/arctan303/FlareMail/releases">Releases</a>
</p>

FlareMail 是面向个人的开源域名邮箱，支持日常收发、多个邮箱地址和助手接入。网页、API 与邮件处理部署为一个 Cloudflare Worker，邮件数据保存在你自己的 Cloudflare 账号，无需购买或维护 VPS。

## 在线体验

**[打开 FlareMail 在线体验 →](https://flaremail.arcinks.com/inbox)**

无需登录，可直接尝试阅读会话、搜索邮件、切换邮箱、撰写回复和管理草稿，也支持手机访问。体验使用示例数据，模拟发送不会投递真实邮件，刷新后恢复初始数据。详见[体验说明](apps/web/docs/zh/experience.md)。

## 功能

- **域名与邮箱地址**：管理多个域名和地址，为个人联系、项目或助手分配邮箱；需要时可邀请家人或成员使用。
- **日常邮件**：收发、回复、转发、附件、搜索、星标、联系人与会话阅读，支持草稿保存和发送撤销。
- **Web 客户端**：响应式布局、中英双语、深浅色主题、快捷键和可安装的 PWA。
- **CLI / Agent**：通过个人 Token 查询、读取、发送和回复邮件；HTML 邮件提供可读正文，支持未读过滤与增量查询。
- **收件 Webhook**：新邮件就绪后通知接收端，可选全部发件人或地址白名单；网页和 CLI 均可管理配置、密钥、测试通知与投递记录。
- **管理与定制**：网页管理域名、成员、品牌、Google 登录和 OAuth 授权；附件可按需使用私有 R2 存储。

## 快速部署

准备自己的 **Cloudflare 账号、GitHub 账号，以及使用 Cloudflare DNS 的域名**，即可通过网页部署，无需在本机安装开发工具。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/arctan303/FlareMail)

1. **部署应用**：按 Cloudflare 页面提示创建 Worker、D1 和 KV，设置并保存独立的安装凭据。
2. **初始化邮箱**：打开部署后的地址，使用 Web 向导创建管理员和邮箱域名。
3. **接通收发**：配置域名收信路由和发信服务，再用外部邮箱验证收信与回复。

Cloudflare 免费计划可用于托管应用和收信，发信可搭配 Resend 免费额度。域名另行准备，各服务有使用额度；R2 可选。**一键部署完成应用安装，收发信还需要域名配置。**

继续阅读[完整部署指南](apps/web/docs/zh/deployment.md)和[费用与准备](apps/web/docs/zh/costs.md)。部署按钮使用稳定分支 `main`；已有实例请按[更新维护](apps/web/docs/zh/updates.md)升级并保留原资源。

## 文档

[在线文档](https://flaremail.arcinks.com/docs/zh/introduction)提供完整使用指引，也可按主题阅读下方文档。

| 主题 | 文档 |
| --- | --- |
| 开始使用 | [项目介绍](apps/web/docs/zh/introduction.md) · [费用与准备](apps/web/docs/zh/costs.md) · [部署指南](apps/web/docs/zh/deployment.md) |
| 使用场景 | [个人域名邮箱](apps/web/docs/zh/personal-mailbox.md) · [给助手一个邮箱](apps/web/docs/zh/assistant-mailbox.md) |
| 邮件收发 | [收信配置](apps/web/docs/zh/receiving.md) · [发信配置](apps/web/docs/zh/sending.md) · [日常使用](apps/web/docs/zh/usage.md) |
| 设置与管理 | [配置说明](apps/web/docs/zh/configuration.md) · [管理员指南](apps/web/docs/zh/administration.md) |
| 助手与集成 | [CLI / Agent 与 Webhook](apps/web/docs/zh/cli.md) · [OAuth 接入](apps/web/docs/zh/oauth.md) |
| 维护与排错 | [更新、备份与恢复](apps/web/docs/zh/updates.md) · [常见问题](apps/web/docs/zh/faq.md) |
| 开发与体验站 | [本地运行与开发](apps/web/docs/zh/getting-started.md) · [部署体验站](apps/web/docs/zh/pages.md) |

## 本地开发

需要 Node.js ≥ 22.12，使用锁定的 pnpm 10.34.5。在仓库根目录安装依赖：

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
```

按[本地运行与开发](apps/web/docs/zh/getting-started.md)准备实例配置，再启动正式邮箱：

```sh
npx --yes pnpm@10.34.5 dev
```

- `apps/web`：Vue 3、Vite 与 Element Plus 前端。
- `apps/worker`：Cloudflare Workers、Hono 后端与数据库迁移。
- `apps/web/docs`：双语使用文档。

正式前端构建输出至 `apps/worker/dist`，随 Worker 一起部署。仅开发静态体验站与 Docs 时使用 `dev:pages`，通过 `build:pages` 构建至 `apps/web/dist-pages`。私有配置、凭据和运行数据不进入源码仓库。

## 反馈与贡献

通过 [Issues](https://github.com/arctan303/FlareMail/issues) 反馈问题，通过 [Discussions](https://github.com/arctan303/FlareMail/discussions) 交流使用。安全漏洞请按 [SECURITY.md](SECURITY.md) 私密报告。

`main` 保持已发布的稳定版本，`dev` 用于日常开发。参与开发请从 `dev` 创建工作分支；分支门禁、双语日志、标签与 Release 规则见[发布流程](RELEASING.md)。提交前按改动范围运行相关测试与构建：

```sh
npx --yes pnpm@10.34.5 test:web
npx --yes pnpm@10.34.5 test:worker
npx --yes pnpm@10.34.5 build
npx --yes pnpm@10.34.5 build:pages
```

## 许可证

FlareMail 自身源码采用 [MIT](LICENSE)，完整分发物整体按 **AGPL-3.0-or-later** 提供，见[第三方通知](THIRD-PARTY-NOTICES.md)。

FlareMail 是一方产品之一，维护者将其作为日常主力邮箱使用。
