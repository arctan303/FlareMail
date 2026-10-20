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

登录管理员账号，在「系统设置 → 系统维护」检查版本与待应用补丁，按提示升级。当前 Schema 为 **329**。兼容补丁允许正常登录；Google 更换绑定的会话撤销保护需要326，邮件Webhook需要327，域名启停与整域迁移需要328；回收站30天保留、Cc/Bcc幂等与投递回传需要329。如果未来重大结构升级阻止登录，才使用登录页维护入口与SETUP_SECRET。安装Secret不是忘记密码的重置工具。

329增量添加删除时间与删除代次、发送指纹和投递事件；旧已删邮件从升级时起保留30天，不按邮件创建日期直接清理。保留每日及每分钟Cron，过期邮件和通知均分批处理。原有完整328仍能使用基础登录、阅读和To发信，新依赖操作会提示升级。

328 为现有域名补充启停与迁移保护，已有域名默认启用，不移动原邮件或附件。升级前的完整 327 实例仍可正常使用，新增管理操作需升级后开放。迁移域名后的账号使用新地址登录；旧版代码不识别停用状态，因此依赖域名停用时不能直接回退旧版服务。代码回退也不会自动还原已迁移的地址；需要在新版本重新预览并反向迁移。[域名管理](/docs/zh/administration)

327 增量创建 Webhook 设置和投递表，不自动启用。保留实例资源 ID，在自己的 Wrangler 配置 triggers.crons 中保留每日任务并加入 `* * * * *`，否则失败通知只有后续收信或每日任务才可能补发。公开模板已包含该任务，已有定制配置需自行合并。D1 备份包含 Webhook 共享密钥，应按敏感数据保存；回退代码前停用 Webhook，保留新增表即可。完整配置见 [CLI / Agent](cli)。

326 是增量升级，保留已有账号及会话。回退代码时保留新增字段和会话撤销表；旧代码不会执行新的会话撤销规则，恢复旧代码服务前必须作废全部网页会话。浏览器草稿升级保留旧库及迁移记录，不能通过清空站点数据回退，否则可能丢失草稿。

完成后检查登录、邮箱筛选、历史邮件与附件，再用外部邮箱测试收信和回复。不要把网页可打开当作收发已恢复。

## 恢复边界

D1 Time Travel 可恢复到保留期内的时间点：Free 为 7 天，Paid 为 30 天，实际以账号与官方说明为准。恢复会回退该时间后的数据库修改，先保存当前备份并暂停相关操作。[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

从 SQL 备份恢复时，先在独立数据库验证导入与版本，再安排切换；不要直接把备份导入正在使用的数据库当作完整恢复。应用版本需兼容恢复后的 Schema，附件与品牌对象还需按原 key 恢复。仅回滚代码不能撤销已执行的数据库升级，也不能恢复已删除对象。

## 完整实例备份与恢复

仓库提供本地管理命令，不新增网页上的整库下载接口。Node最低22.12，根命令已带SQLite兼容开关。先停止HTTP、Email Routing、Cron和其他写入，等待KV传播至少60秒，存在更长cacheTtl时相应延长，并确认读到稳定值。`--offline`表示操作者已完成停写，不会替你停止生产服务。

配置文件只放资源标识和凭据环境变量名，例如：

~~~json
{"accountId":"你的32位账号ID","databaseId":"D1_UUID","namespaceId":"KV_NAMESPACE_ID","storage":"kv","tokenEnv":"SOURCE_CLOUDFLARE_API_TOKEN"}
~~~

使用R2时把storage设为r2并增加bucket；通过 `r2AccessKeyIdEnv`、`r2SecretAccessKeyEnv`选择S3凭据环境名，默认 `R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY`。未指定tokenEnv时读取 `CLOUDFLARE_API_TOKEN`。不要将真实Token写入配置或命令示例；源需要读取权限，目标需要对应写入权限。Worker Secret、SETUP_SECRET与浏览器草稿不包含在备份内，另行保管。

~~~sh
pnpm backup:export --config source.json --out output/backups/new-backup --offline
pnpm backup:verify --in output/backups/new-backup
pnpm backup:restore --config target.json --in output/backups/new-backup --offline --confirm-target TARGET_D1_UUID
~~~

导出包括D1结构和数据、必要持久KV、附件及品牌对象、metadata和SHA-256清单；缺少引用对象、源变更或损坏时拒绝完整验收。备份含私信、密码哈希及应用凭据，应存私有加密磁盘或归档，不能提交仓库。摘要检测损坏，不是防恶意改写的签名，只恢复可信的自有归档。

恢复只接受不同于源的全新空D1/KV/R2，不覆盖已有实例；先校验全部本地文件与引用，再复制验证对象，最后导入数据库。恢复保留账号、邮件和历史ID，但撤销网页会话、CLI Token、未兑换授权码和待重试通知，并清空Resend回传签名密钥；重新登录和配置相关凭据。失败目标保持离线，按提示处理或换新空资源重试，不要对正在使用的数据库直接导入。

## KV / R2 对象迁移

~~~sh
pnpm storage:migrate --source source.json --target target.json --out output/storage-report.json --offline --confirm-target TARGET_BUCKET_OR_KV_NAMESPACE_ID
~~~

迁移按原key复制并验证字节及metadata，保留源、不覆盖不匹配的目标对象；失败重试只复用完全相同的目标。R2→KV超过25MiB或键名不能安全放入应用KV的对象会提前拒绝。KV目标必须独占停写，工具无法提供KV本身不支持的原子条件写；写成功后会有界等待可见性，超时禁止切换。成功后按报告切换绑定，再验证历史邮件、附件和收发；命令不会自动部署、改绑定或删除源。更换KV namespace涉及语言偏好等持久数据时，使用完整备份恢复；仅迁附件宜保留现有kv绑定并切换r2。
