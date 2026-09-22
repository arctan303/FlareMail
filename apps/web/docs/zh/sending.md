# 发信配置

在系统设置 → 邮件收发选择全站发信通道。新安装默认 Resend；Cloudflare Email Sending 为 Beta 备选。选择通道不会清除另一通道的配置，失败也不会自动切换服务。

## Resend

1. 在 Resend 账号中添加你拥有的发件域名，例如 example.com，按要求配置 DNS 并等待验证通过。
2. 创建允许该域名发信的 API Key。
3. 在 FlareMail 系统设置 → 邮件收发选择 Resend，将 Key 填入对应域名一栏，保存并按提示验证管理员密码。
4. 写信时选择该域名下的发件地址，发送到自己的外部邮箱，检查实际收到的邮件。

每个发件域名都需可用的 Key 和域名验证。输入框留空通常表示保留已有密钥，不是清除。不要把 Key 写进源码或文档。Resend 的测试发件域名和测试收件限制不能代替自己的正式域名配置。[域名验证](https://resend.com/docs/dashboard/domains/introduction) · [API Key](https://resend.com/docs/dashboard/api-keys/introduction)

发送成功后，FlareMail 会尝试读取真实 Message-ID，供后续回复关联原邮件。若密钥没有读取邮件的权限，或读取请求失败，发送仍然有效，但界面会提示 Message-ID 未能取得；继续回复这封已发送邮件时，外部客户端可能无法将它归入原会话。此提示不要求重新发送邮件。[Resend 邮件关联说明](https://resend.com/changelog/message-id-for-sent-emails)

## Cloudflare Email Sending（Beta）

向任意外部收件人发送需要 Workers Paid，并在当前账号为每个发件域名启用 Email Sending。免费发送到账号已验证目标的例外不能代替一般邮箱发信路径。[费用与前提](https://developers.cloudflare.com/email-service/platform/pricing/)

1. 在 Cloudflare Email Service → Email Sending 接入发件域名，完成 DNS 验证。
2. 在自己的 apps/worker/wrangler.toml 中启用模板注释中的绑定：

~~~toml
[[send_email]]
name = "email"
~~~

3. 在仓库根目录重新部署：

~~~sh
npx --yes pnpm@10.34.5 run deploy
~~~

4. 在系统设置 → 邮件收发确认绑定已就绪，选择 Cloudflare 并保存。若提示数据库待升级，先在系统维护完成升级。
5. 发送到自己的外部邮箱，检查收件、垃圾箱与 Cloudflare 发信日志。

仅添加绑定不会改变当前通道。项目本地模拟绑定不投递真实邮件；不要为普通本地测试添加 remote = true。[平台配置](https://developers.cloudflare.com/email-service/get-started/send-emails/)

## 附件与大小

应用发信最多 10 个附件（含内嵌图片），单个不超过 10 MiB，合计不超过 20 MiB。Cloudflare 通道还按整封邮件的编码后估算体积提前限制为 5 MiB，因此实际可用附件体积更小。服务商可能另有额度、收件人数或内容限制。[Cloudflare 限制](https://developers.cloudflare.com/email-service/platform/limits/)

## 发送结果与重试

已发送中查看状态和提示。服务接受发送请求不保证邮件进入收件人的主收件箱，需检查垃圾箱或服务商日志。

未验证域名、凭据无效、未绑定通道、超额或大小不符，应先修正配置。网络超时或结果未知时不要立即重发；CLI/Agent 重试同一次发送必须复用原 requestId，详见 [CLI / Agent](/docs/zh/cli)。
