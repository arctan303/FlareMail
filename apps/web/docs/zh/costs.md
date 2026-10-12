# 费用与准备

**无需购买 VPS，Cloudflare 免费账号也能部署。** 个人轻量使用可以从 Cloudflare 免费计划与 Resend 免费发信额度开始；自己的域名需要另行准备。

## 一套可开始使用的免费方案

| 用途 | 选择 | 费用边界 |
| --- | --- | --- |
| 网页、API、邮件处理 | Cloudflare Workers Free | 有请求与运行额度，无需租用服务器 |
| 邮件与应用数据 | Cloudflare D1 + KV | 有免费读写、存储额度；默认不要求启用 R2 |
| 接收域名邮件 | Cloudflare Email Routing | Free 计划可用；处理和保存邮件仍消耗应用额度 |
| 向外部邮箱发信 | Resend Free | 当前为每月 3,000 封、每天最多 100 封，需验证自己的发件域名 |
| 邮箱域名 | 自己已有或购买的域名 | 域名注册与续费不包含在服务免费额度中 |

以上是可以选择的免费组合，不代表无限收发或无限存储。数据和服务用量归你的账号管理。核对日期：**2026-10-12**，最新额度以 [Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/)、[KV](https://developers.cloudflare.com/kv/platform/pricing/)、[Email Service](https://developers.cloudflare.com/email-service/platform/pricing/) 与 [Resend](https://resend.com/pricing) 官方说明为准。

## 部署前准备这些

- **Cloudflare 账号**：运行应用、数据库和收信路由，免费账号即可开始。
- **自己的域名**：邮箱域名使用 Cloudflare DNS，例如 `hello@example.com` 中的 `example.com`。
- **GitHub 账号**：网页部署会保存你自己的源码副本，供后续更新。
- **发信账号与域名验证**：免费方案选择 Resend，配置步骤见[发信指南](/docs/zh/sending)。
- **密码管理器**：保存独立的安装凭据和邮箱密码。

网页部署无需在本机安装 Git、Node.js 或命令行工具。应用安装后，仍要设置 DNS、收信路由与发信域名验证，详见[部署指南](/docs/zh/deployment)。

## 如果希望收发都使用 Cloudflare

FlareMail 也支持 Cloudflare Email Sending。**向任意外部地址发送需要 Workers Paid**，并为发件域名开通该服务。仅向账号已验证目标免费发送的例外，不等于完整的免费发信方案。[Cloudflare 发信费用与要求](https://developers.cloudflare.com/email-service/platform/pricing/)

选择 Cloudflare 或 Resend 都不需要 VPS。可以先采用免费组合，再按自己的用量选择服务；切换不会自动补齐另一通道的配置。

## 什么时候考虑更多额度或 R2

免费资源的额度分别计算。登录、页面操作、缓存、收信保存和附件都会产生请求或读写，不能把平台请求数当成可收邮件数量。较大邮件还受运行时间和邮件大小限制；持续保存邮件也会占用存储空间。

默认附件存储可使用 KV。附件较多时可按需启用私有 R2，并先查看其开通条件、免费额度与费用；R2 是可选项，已有附件不会在切换时自动搬迁。[存储配置](/docs/zh/configuration) · [R2 费用](https://developers.cloudflare.com/r2/pricing/)

准备好了就[部署自己的邮箱](/docs/zh/deployment)，也可以先[在线体验](/inbox)。
