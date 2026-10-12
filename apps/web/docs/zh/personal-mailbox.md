# 用自己的域名收发邮件

FlareMail 面向想拥有个人域名邮箱的人：用自己的地址联系朋友、接收项目邮件，在网页里阅读和回复。应用部署在自己的 Cloudflare 账号，无需另外维护 VPS。

[先体验邮箱](/inbox) · [部署指南](/docs/zh/deployment) · [费用与准备](/docs/zh/costs)

## 从一个常用地址开始

准备一个由 Cloudflare DNS 管理的域名，先创建自己日常使用的地址，例如 `you@example.com`。按网页向导完成初始化，再配置收信路由和发信服务，就可以用外部邮箱验证收信与回复。

日常打开网页即可查看邮件，会话把同一回复链集中在一起；搜索、星标、联系人和草稿用于整理与继续处理邮件。手机也可访问，常用时可以安装为 PWA。详见[日常使用](/docs/zh/usage)。

## 按用途添加地址

需要区分项目、公开联系和自动化通知时，再添加 `project@example.com` 或 `assistant@example.com` 等地址。顶部选择器既能查看自己全部邮箱的邮件，也能只看其中一个地址。

多个域名和地址可以在一个实例里管理。你也可以按需邀请家人或成员使用，各自拥有邮箱；一个人使用不需要额外组建团队。

## 应用与数据放在哪里

网页、API 和邮件处理部署为单个 Cloudflare Worker；D1 保存账号与邮件数据，KV 保存缓存和相关对象，R2 可按需用于附件。资源位于你自己的 Cloudflare 账号，更新时需要保留原数据库、存储和凭据。

发信可选择 Resend 或 Cloudflare Email Sending，各自有额度和使用条件。域名需要自行准备，附件方案和费用边界见[费用与准备](/docs/zh/costs)。

## 先体验，再部署

[在线体验](/inbox)无需登录。可以打开会话、搜索邮件、切换邮箱地址和撰写回复；使用的是示例数据，模拟发送不会投递真实邮件。

决定部署时，按[部署指南](/docs/zh/deployment)完成应用安装、Web 初始化和域名收发配置，最后用外部邮箱验证收信与回复。FlareMail 当前通过 Web 与 CLI API 使用；如果需要传统邮件客户端，请先阅读[常见问题](/docs/zh/faq)中的客户端支持边界。

## 告诉我们使用感受

体验或部署后，欢迎在 [Discussions](https://github.com/arctan303/FlareMail/discussions)说说你想怎样使用邮箱、在哪一步遇到困难，以及希望先改进什么。可复现的问题请提交 [Issue](https://github.com/arctan303/FlareMail/issues)，附所用版本、对应文档、预期结果和实际结果。

公开反馈请隐去 Token、安装凭据、邮件正文和私人地址。若是安全漏洞，请使用[私密报告渠道](https://github.com/arctan303/FlareMail/security/advisories/new)。
