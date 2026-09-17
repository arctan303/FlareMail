# 配置与存储

新安装仅需一个应用 Secret：`SETUP_SECRET`。域名、发信凭据与可选功能主要在 Web 后台配置；DNS、资源绑定和第三方平台验证仍需在相应平台完成。

## 设置在哪里

| 位置 | 用途 |
| --- | --- |
| 系统设置 → 核心服务 | 收信、发信等全站服务开关 |
| 系统设置 → 邮箱域名 | 管理地址所属域名与未知收件人策略 |
| 系统设置 → 邮件收发 | 来信过滤、发信通道与 Resend Key |
| 系统设置 → 登录与授权 | Google、Turnstile、OAuth Provider及额外来源 |
| 系统设置 → 站点品牌 | 名称、图标、登录页与 PWA 外观 |
| 系统设置 → 系统维护 | 数据库版本检查与受控升级 |
| 个人设置 | 密码、语言、别名、转发、Google 绑定、CLI Token |

敏感修改按提示确认管理员或用户自己的密码。保存某个配置区不会代替其他区的保存；留意未保存提示。具体操作见[管理员配置](/docs/zh/administration)、[收信](/docs/zh/receiving)和[发信](/docs/zh/sending)。

## Secret 与资源绑定

SETUP_SECRET 存在 Cloudflare Worker Secret 中，首次部署可从 .dev.vars 上传。以后普通更新无需重复上传。它用于首次安装和必要的维护恢复，不是成员登录凭据。

| 绑定名 | 资源 | 是否必需 |
| --- | --- | --- |
| db | D1：账号、邮件正文与元数据、联系人、设置 | 是 |
| kv | KV：会话、短期令牌、偏好与缓存、对象回落存储 | 是 |
| r2 | 私有 R2：附件和品牌素材 | 可选 |
| email | Cloudflare Email Sending | 仅选择该通道时需要 |

不要更改应用所需绑定名。已有实例的资源 ID、桶名和 Secret 应保留，不能用空白新模板替换。

## 选择附件存储

有 r2 绑定时使用 R2，没有则回落到 KV。无需公网桶或自定义 R2 域名，附件通过 Worker 鉴权访问；遗留公网 R2 地址字段通常留空。

首次部署需要 R2 时，启用示例配置中对应段落，填写自己准备使用的桶名：

~~~toml
[[r2_buckets]]
binding = "r2"
bucket_name = "your-mail-files"
~~~

重新部署并核对控制台绑定；自动创建仍依赖 Wrangler 当前资源配置能力。R2可能需要先在账号开通。KV 有存储、写入和单值大小限制，R2/Worker/发信服务也有各自额度。[KV 限制](https://developers.cloudflare.com/kv/platform/limits/) · [R2 费用](https://developers.cloudflare.com/r2/pricing/)

已有邮件后添加或移除 r2 绑定不会自动迁移对象。切换前先备份，并迁移原附件与品牌对象、保留 key 后核验；本项目没有一键存储迁移向导。数据库备份不包含这些对象，详见[更新维护](/docs/zh/updates)。

## 三类域名不要混淆

邮箱域名决定能创建哪些邮箱地址；网页域名用于登录与 API；OAuth 回调或额外 CORS 来源用于网站接入。添加邮箱域名不会自动授权网站访问，也不会自动配置 DNS 收发。
