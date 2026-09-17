# 部署自己的邮箱

本指南从新安装开始，由一个 Cloudflare Worker 提供网页、API 和邮件处理。完成网页部署后，继续接通收信和发信，才能作为真实邮箱使用。

## 准备账号与域名

- 一个 Cloudflare 账号，以及使用 Cloudflare DNS 的邮箱域名，例如 example.com。
- 本机安装 Git、Node.js ≥ 22.12（推荐 24）；命令使用 pnpm 10.34.5，无需全局安装。
- 发信服务：新安装默认 Resend；也可选择 [Cloudflare Email Sending（Beta）](/docs/zh/sending)。不同服务的额度与费用各自计算，不承诺无限或完全免费。

区分两种地址：`owner@example.com` 是邮箱地址；`https://mail.example.com` 是网页和 API 的访问地址。可以先使用部署生成的 workers.dev 地址，再绑定自己的网页域名。

## 取得源码

在终端执行：

~~~sh
git clone https://github.com/arctan303/FlareMail.git
cd FlareMail
npx --yes pnpm@10.34.5 install --frozen-lockfile
~~~

也可下载源码 ZIP，解压后在包含 package.json 的仓库根目录执行安装命令。以下命令均从该根目录运行。

## 准备实例配置

首次安装执行：

~~~sh
node -e "const fs=require('node:fs');fs.copyFileSync('apps/worker/wrangler.example.toml','apps/worker/wrangler.toml',fs.constants.COPYFILE_EXCL)"
node -e "require('node:fs').writeFileSync('apps/worker/.dev.vars','SETUP_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\n',{flag:'wx'})"
~~~

命令拒绝覆盖已有文件。打开 apps/worker/wrangler.toml，将 name 改为你自己的 Worker 名称。保留模板中的绑定名和构建配置；D1 与 KV 无需预先创建。

SETUP_SECRET 是安装与维护凭据，与邮箱登录密码不同。将它保存在自己的密码管理器中；配置文件与 .dev.vars 均不提交到 Git。已有实例不要重新复制模板，改按[更新维护](/docs/zh/updates)操作。

如果要使用 R2，建议在开始存放邮件前完成[存储配置](/docs/zh/configuration)。

## 登录并部署

~~~sh
npx --yes pnpm@10.34.5 --filter worker exec wrangler login
npx --yes pnpm@10.34.5 run deploy --secrets-file .dev.vars
~~~

登录命令会打开浏览器，由你选择自己的 Cloudflare 账号。部署命令会自动构建前端，并将 .dev.vars 中的安装 Secret 上传至 Worker。

Wrangler 自动资源配置目前为 Beta：首次部署创建 D1/KV，并把资源 ID 写回实例配置。部署后检查 wrangler.toml 已有 D1 database_id 与 KV id，备份这份配置；以后更新必须保留它们。控制台或 Git 自动部署不一定回写仓库，应在控制台核对资源 ID。[官方说明](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

成功时终端会给出 Worker 地址。打开它应看到安装向导；若部署报错，先处理终端错误，不要反复创建新资源。

## 完成 Web 初始化

1. 输入 .dev.vars 中的 SETUP_SECRET，验证安装权限。
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
