# 部署自己的邮箱

推荐使用 Cloudflare 的一键部署页面：无需在本机安装 Git、Node.js 或打开终端。一个 Worker 提供网页、API 和邮件处理；网页安装完成后，再接通收信和发信。

## 准备账号与域名

- 一个 Cloudflare 账号。
- 一个 GitHub 账号，用于保存你自己的源码与部署配置。
- 使用 Cloudflare DNS 的邮箱域名，例如 example.com。
- 一个密码管理器，用于生成并保存安装凭据。
- 发信服务：新安装默认 Resend，也可选择 [Cloudflare Email Sending（Beta）](/docs/zh/sending)。服务额度与费用各自计算。

`owner@example.com` 是邮箱地址；`https://mail.example.com` 是网页和 API 地址。可以先使用部署生成的 workers.dev 地址，再绑定网页域名。

## 一键部署（推荐）

**[一键部署到 Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/arctan303/FlareMail)**

1. 点击上方部署链接，登录 Cloudflare，并按页面提示连接自己的 GitHub 账号。
2. 选择自己的 Cloudflare 账号和新仓库名称；Cloudflare 会将项目复制到你的 GitHub，供后续更新使用。使用默认稳定分支 main。
3. 设置 Worker 名称、D1 数据库及 KV 命名空间。保持绑定名称 db 和 kv；资源会由 Cloudflare 自动创建，无需预先手填资源 ID。
4. 在 SETUP_SECRET 字段填入密码管理器生成的、至少 32 字符的独立随机密码，并保存。稍后的网页安装向导会使用相同值；它与管理员登录密码不同。
5. 保留仓库根目录作为构建入口，按页面提示确认构建与部署。默认命令会构建前端并部署 Worker。不要将入口改为 apps/worker，也不要把 SETUP_SECRET 填入普通公开变量或提交到源码。
6. 等待部署成功，打开页面给出的 Worker 地址。看到安装向导后，继续下方的 Web 初始化。

部署按钮用于**创建新实例**。已有邮箱更新时请按[更新维护](/docs/zh/updates)操作，保留原数据库和存储；不要重新点击按钮安装第二套实例。

部署后在 Worker → Settings → Bindings 核对 db、kv 指向的资源，并在你自己的仓库根目录 wrangler.jsonc 核对 database_id 和 KV id 已回填。若仍为空，在 GitHub 网页编辑此文件，填入控制台显示的原资源 ID 并保存；后续更新必须保留这些值。不要把已回填的文件换成上游空白模板。[Cloudflare 官方说明](https://developers.cloudflare.com/workers/platform/deploy-buttons/)

如果未看到 SETUP_SECRET 字段，检查部署来源是否包含根目录 .dev.vars.example 和 wrangler.jsonc，改用支持此入口的稳定版本或下方命令行方式。缺少必填 Secret 会导致部署失败；不要使用教程里的固定示例密码。

R2 为可选项，默认使用现有 KV 对象存储路径；如需 R2，建议在开始存放邮件前完成[存储配置](/docs/zh/configuration)。部署失败时先打开构建日志处理具体错误，不要反复创建新资源。

## 完成 Web 初始化

1. 输入部署时保存的 SETUP_SECRET，验证安装权限。
2. 填写邮箱域名，例如 example.com；这里填写域名，不是完整网页 URL。
3. 选择域名，填写管理员邮箱前缀与登录密码。
4. 核对并确认。应用自动建表、创建管理员，并进入邮箱。

此时网页和账号已可用，真实收发还需要下一步。

## 接通邮件

1. 按[收信配置](/docs/zh/receiving)启用域名路由，将邮件交给刚部署的 Worker。
2. 按[发信配置](/docs/zh/sending)验证发件域名、配置凭据与通道。
3. 用另一个外部邮箱给管理员地址发信，确认收件箱能读到；再回复，并在外部邮箱确认收到。可使用小附件验证下载，同时检查垃圾箱。

请使用外部邮箱测试；同实例内发信可能走站内投递，不能证明公网路由已配置成功。

## 绑定网页域名（可选）

在 Cloudflare 打开该 Worker → Settings → Domains & Routes，添加 Custom Domain，例如 mail.example.com。该域名需属于你账号内的 Cloudflare DNS 区域。绑定后从新地址登录；Google 回调或 OAuth issuer 如已配置，也需要同步更新。[官方步骤](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

网页域名绑定不会代替邮箱域名的收发信配置。完成后可继续[管理员配置](/docs/zh/administration)添加成员、配置品牌和可选登录方式。

## 命令行部署（高级方式）

适用于需要本地构建或自行管理配置的用户。需要 Git、Node.js ≥ 22.12（推荐 24）；以下使用锁定的 pnpm 10.34.5。固定 v1.0.0 标签仍按此方式部署，该标签不包含后来新增的一键部署入口。

### 取得源码

`main` 是默认稳定分支，`dev` 是开发分支。Fork 时保留默认分支即可用于部署；请勿将开发分支直接用于生产。每次正式发布都有固定版本标签及 [Release](https://github.com/arctan303/FlareMail/releases)。

在终端执行：

~~~sh
git clone --branch main --single-branch https://github.com/arctan303/FlareMail.git
cd FlareMail
npx --yes pnpm@10.34.5 install --frozen-lockfile
~~~

也可下载源码 ZIP，解压后在包含 package.json 的仓库根目录执行安装命令。以下命令均从该根目录运行。

需要固定在首版时，可直接下载 [v1.0.0 源码 ZIP](https://github.com/arctan303/FlareMail/archive/refs/tags/v1.0.0.zip)，或在克隆后、安装依赖前执行：

~~~sh
git fetch origin tag v1.0.0
git switch --detach v1.0.0
~~~

此时源码固定在该标签，不会跟随稳定分支更新；升级请先阅读新版 Release 和[更新维护](/docs/zh/updates)。

### 准备实例配置

首次安装执行：

~~~sh
node -e "const fs=require('node:fs');fs.copyFileSync('apps/worker/wrangler.example.toml','apps/worker/wrangler.toml',fs.constants.COPYFILE_EXCL)"
node -e "require('node:fs').writeFileSync('apps/worker/.dev.vars','SETUP_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\n',{flag:'wx'})"
~~~

命令拒绝覆盖已有文件。打开 apps/worker/wrangler.toml，将 name 改为你自己的 Worker 名称。保留模板中的绑定名和构建配置；D1 与 KV 无需预先创建。

SETUP_SECRET 是安装与维护凭据，与邮箱登录密码不同。将它保存在自己的密码管理器中；配置文件与 .dev.vars 均不提交到 Git。已有实例不要重新复制模板，改按[更新维护](/docs/zh/updates)操作。

如果要使用 R2，建议在开始存放邮件前完成[存储配置](/docs/zh/configuration)。

### 登录并部署

~~~sh
npx --yes pnpm@10.34.5 --filter worker exec wrangler login
npx --yes pnpm@10.34.5 run deploy --secrets-file .dev.vars
~~~

登录命令会打开浏览器，由你选择自己的 Cloudflare 账号。部署命令会自动构建前端，并将 .dev.vars 中的安装 Secret 上传至 Worker。

Wrangler 自动资源配置目前为 Beta：首次部署创建 D1/KV，并把资源 ID 写回实例配置。部署后检查 wrangler.toml 已有 D1 database_id 与 KV id，备份这份配置；以后更新必须保留它们。控制台或 Git 自动部署不一定回写仓库，应在控制台核对资源 ID。[官方说明](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

成功时终端会给出 Worker 地址。打开它应看到安装向导；若部署报错，先处理终端错误，不要反复创建新资源。

完成命令行部署后，按本文上方的「完成 Web 初始化」和「接通邮件」继续。
