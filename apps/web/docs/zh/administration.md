# 管理员配置

先完成[部署](/docs/zh/deployment)与真实收发测试，再添加成员或启用可选功能。管理员负责账号与系统配置，每个成员访问自己的邮件。

## 添加受邀成员

在左侧「用户列表」添加用户，填写邮箱、名称、初始密码及需要的额度。邮箱域名应先在「系统设置 → 邮箱域名」登记，并完成收信路由与发信配置。

当前邀请制由管理员创建账号并安全交付登录地址、邮箱和初始密码，不会自动发送邀请邮件，也没有公开注册或邀请链接。成员第一次用密码登录后，应修改初始密码。停用、删除与物理删除的影响不同，执行前阅读确认提示；物理删除会清理相关邮件与附件，不能当作普通停用。

## Google 登录（可选）

1. 在 Google Cloud 创建 OAuth 的 Web application 客户端，按 Google 提示配置授权界面与测试用户或发布状态。
2. 添加两个完整的 Authorized redirect URI，把示例域名换成实际网页地址：

~~~text
https://mail.example.com/login/oauth/callback
https://mail.example.com/oauth/bind/callback
~~~

3. 在「系统设置 → 登录与授权」保存 Client ID、Client Secret，再启用 Google 登录入口。
4. 成员先用邮箱密码登录，在个人设置绑定自己的 Google 账号，之后才可使用 Google 登录。

Google 登录不会自动创建邮箱成员。登录入口开关与个人账号绑定不同：已配置凭据时，关闭入口仍可在个人设置绑定或解绑。解绑会使现有会话及个人 CLI Token 失效，需要重新登录。改变网页域名时同步修改 Google 回调地址。[Google 配置说明](https://developers.google.com/identity/protocols/oauth2/web-server)

## Turnstile（可选）

在 Cloudflare 创建 Turnstile widget，将正式网页主机名加入允许列表。把 Site Key 与 Secret Key 保存到「登录与授权」，按界面启用验证。Site Key 用于浏览器，Secret Key 只交给服务端；两者不能互换。启用后从退出登录的页面验证是否能正常加载与登录。[官方步骤](https://developers.cloudflare.com/turnstile/get-started/)

## 品牌与服务开关

「站点品牌」管理名称、图标、登录页和 PWA 外观；品牌文字不会自动翻译。「核心服务」管理全站服务开关。修改后保存对应分区，并检查前台效果。

收信过滤、未知收件人及转发见[收信配置](/docs/zh/receiving)，发信通道见[发信配置](/docs/zh/sending)。不要为了接入脚本开放额外 CORS 来源；普通 CLI 使用个人 Token 即可。

## 网站授权与敏感操作

把 FlareMail 作为自己网站的授权服务时，另按[OAuth 接入](/docs/zh/oauth)配置。这与 Google 登录及 CLI Token 独立，默认关闭。

涉及密钥、主邮箱迁移和数据删除的操作按提示重新验证密码。管理员迁移主邮箱后，用户需要使用新邮箱与原密码重新登录；不要把邮箱置顶或写信选择发件地址当作登录身份迁移。
