# 更新、备份与恢复

更新顺序：备份资源与配置 → 更新代码和锁定依赖 → 部署 → 检查数据库版本 → 验证收发。

## 一键部署实例如何更新

一键部署会在你自己的 GitHub 账号创建源码仓库，并通过 Workers Builds 部署它。更新时使用这个仓库和已有 Worker；不要再次点击部署按钮。

1. 先阅读目标版本的 [Release](https://github.com/arctan303/FlareMail/releases)，备份数据库、对象存储和配置。
2. 在 Cloudflare 查看原 Worker 的 db、kv 及可选 R2 绑定；在自己的 GitHub 仓库打开根目录 wrangler.jsonc，确认 Worker 名称、D1 database_id、KV id 和可选 R2 桶名对应现有资源。缺失时填入原资源 ID，保留安装 Secret。
3. 将目标稳定版本的应用代码更新到自己的仓库，保留已定制的 wrangler.jsonc。Cloudflare 创建的仓库可能是源码副本，未必显示 GitHub 的 Sync fork；此时不能照搬 Fork 同步教程，也不要覆盖整个仓库的实例配置。
4. 推送到绑定的生产分支会触发 Workers Builds；在 Cloudflare 构建日志检查成功，再核对部署后的资源绑定。更新代码前先关闭不需要的非生产分支构建，避免预览连接正式邮箱资源。
5. 按下方说明登录管理员，在系统维护页面处理数据库补丁，并验证历史邮件和外部收发。

目前没有应用内一键版本更新。若不熟悉合并版本代码，可使用下方命令行方式；从控制台记录原绑定到自己的实例配置后，再进行更新，切勿创建新数据库替代旧数据库。[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)

## 更新前保留什么

- 保留 apps/worker/wrangler.toml 中的 Worker 名称、D1/KV 资源 ID、R2 桶名及已有绑定；不要重新复制空白模板。
- 保留 Worker Secret，包括 SETUP_SECRET；普通更新不需要重新生成或重复上传。另行保管第三方凭据与本地 .dev.vars。
- 备份 D1 数据，以及 KV/R2 中的附件和品牌对象。D1 SQL 不包含对象文件、浏览器草稿或 Worker Secret。

在仓库根目录创建备份目录并导出远端 D1：

~~~sh
node -e "require('node:fs').mkdirSync('output/backups',{recursive:true})"
npx --yes pnpm@10.34.5 --filter worker exec wrangler d1 export db --remote --output ../../output/backups/flaremail-before-update.sql
~~~

这是远端数据库导出，使用你当前配置绑定的 db。导出期间数据库请求可能受影响，选择维护时间；SQL 含私有邮件与账号数据，不要提交或分享。[D1 导出说明](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## 更新与数据库升级

先查看目标版本的 [Release](https://github.com/arctan303/FlareMail/releases)，确认升级说明。`main` 跟随最新稳定版本，`dev` 是开发分支；固定标签不会自动更新。保留实例配置，在仓库根目录获取所需源码：

~~~sh
git fetch origin --tags
~~~

使用稳定分支的安装可执行 `git switch main` 和 `git pull --ff-only origin main`；固定版本的安装改用 `git switch --detach <目标版本标签>`。有本地源码修改时先妥善保存，不要强制覆盖；不要重新复制实例配置模板。

确认源码版本后安装锁定依赖并部署：

~~~sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 run deploy
~~~

登录管理员账号，在「系统设置 → 系统维护」检查版本与待应用补丁，按提示升级。当前 Schema 为 **324**。兼容补丁允许正常登录；如果未来重大结构升级阻止登录，才使用登录页维护入口与 SETUP_SECRET。安装 Secret 不是忘记密码的重置工具。

完成后检查登录、邮箱筛选、历史邮件与附件，再用外部邮箱测试收信和回复。不要把网页可打开当作收发已恢复。

## 恢复边界

D1 Time Travel 可恢复到保留期内的时间点：Free 为 7 天，Paid 为 30 天，实际以账号与官方说明为准。恢复会回退该时间后的数据库修改，先保存当前备份并暂停相关操作。[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

从 SQL 备份恢复时，先在独立数据库验证导入与版本，再安排切换；不要直接把备份导入正在使用的数据库当作完整恢复。应用版本需兼容恢复后的 Schema，附件与品牌对象还需按原 key 恢复。仅回滚代码不能撤销已执行的数据库升级，也不能恢复已删除对象。

目前没有一键完整备份、恢复或对象存储迁移功能。重要邮箱应自行安排定期备份，并验证历史邮件和附件可以恢复。
