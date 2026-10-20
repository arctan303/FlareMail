# 更新、备份与恢复

更新顺序：备份资源与配置 → 更新代码和锁定依赖 → 部署 → 检查数据库版本 → 验证收发。

## 一键部署实例如何更新

更新的是**你自己 GitHub 仓库中的代码，以及它连接的原 Worker**。重新 clone 只会下载代码；将检查过的新代码推送到 Workers Builds 绑定的生产分支，才会触发原实例的自动构建与部署。目前没有应用内一键版本更新。[Workers Builds 分支规则](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)

部署按钮会在你的账号创建源码仓库，这个仓库可能是普通副本，没有 Sync fork。真正的 Fork 可以使用 GitHub 的同步功能，但它不会替你核对实例配置或数据库升级。下面的本地更新步骤同时适用于两种仓库，无需转换为 Fork；已有邮箱不要再次点击部署按钮创建新实例。[部署按钮说明](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[GitHub Fork 同步说明](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/syncing-a-fork)

## 更新前保留什么

- 在 Cloudflare 原 Worker 的 Settings → Build 中记录已连接的仓库、生产分支、构建和部署命令，以及实际使用的配置路径。以下以生产分支 main 为例；你的分支不同就替换对应命令。先关闭不需要的非生产分支构建，避免旧预览配置使用正式邮箱资源。
- 网页部署通常使用根目录 wrangler.jsonc；命令行实例通常使用 apps/worker/wrangler.toml；自定义构建以实际的 --config 路径为准。保留配置中的 Worker 名称、D1 database_id、KV id、R2 桶名及已有绑定。与控制台的原资源逐项核对，ID 缺失时先补齐；不要重新复制空白模板。
- 保留 Worker Secret，包括 SETUP_SECRET；普通更新不需要重新生成或重复上传。另行保管第三方凭据与本地 .dev.vars。
- 备份 D1 数据，以及 KV/R2 中的附件和品牌对象。D1 SQL 不包含对象文件、浏览器草稿或 Worker Secret。

以下 D1 导出示例从已安装依赖的仓库根目录执行，显式使用网页部署的根配置：

~~~sh
node -e "require('node:fs').mkdirSync('output/backups',{recursive:true})"
npx --yes pnpm@10.34.5 --filter worker exec wrangler d1 export db --config ../../wrangler.jsonc --remote --output ../../output/backups/flaremail-before-update.sql
~~~

命令行实例把 --config 后的路径改为 wrangler.toml；自定义实例使用自己的配置路径。先核对其中 db 指向原数据库，再导出。导出期间数据库请求可能受影响，选择维护时间；SQL 含私有邮件与账号数据，不要提交或分享。[D1 导出说明](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

## 将稳定版本更新到自己的仓库

需要 Git、Node.js ≥ 22.12（推荐 24）。以下示例为 **v1.1.1 → v1.1.2**，先在 [Releases](https://github.com/arctan303/FlareMail/releases) 确认目标版本已正式发布。旧版本标签必须对应你当前安装时使用的上游源码；如果不是 v1.1.1，替换下方所有旧标签和补丁文件名。不清楚来源版本时先核实部署记录，不要猜测或强制套用。`dev` 不用于生产更新。

### 1. 在新目录克隆自己的仓库

将 YOUR_ACCOUNT/YOUR_REPOSITORY 替换为 Cloudflare 实际连接的仓库，不是维护者仓库。使用全新目录可保留原本地源码、忽略文件和配置备份：

~~~sh
git clone https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git FlareMail-update
cd FlareMail-update
git switch main
git pull --ff-only origin main
git status --short
git switch -c update/flaremail-1.1.2
git remote add flaremail-upstream https://github.com/arctan303/FlareMail.git
~~~

git status --short 应无输出。origin 始终指向你自己的仓库；单独执行 git pull origin main 只能取得你自己的旧代码。此时仅创建本地分支，不推送、不部署。原来仅保存在本地的 wrangler.toml 等配置另行复制到新目录的相同位置，保留其忽略状态，不加入公开提交。

### 2. 取得两版差异，保留实例配置

获取明确的发布标签，放到独立的远程引用，避免与自己仓库的同名标签混淆：

~~~sh
git fetch --no-tags flaremail-upstream refs/tags/v1.1.1:refs/remotes/flaremail-upstream/releases/v1.1.1 refs/tags/v1.1.2:refs/remotes/flaremail-upstream/releases/v1.1.2
git diff --binary --full-index --output=../flaremail-v1.1.1-to-v1.1.2.patch flaremail-upstream/releases/v1.1.1 flaremail-upstream/releases/v1.1.2 -- . ":(exclude)wrangler.jsonc" ":(exclude)apps/worker/wrangler.toml"
git apply --3way --index ../flaremail-v1.1.1-to-v1.1.2.patch
git diff --cached --stat
git diff --cached --check
~~~

这是将两版源码的差异合入自己的代码，不要求普通副本与上游有共同提交历史；配置文件从补丁中排除。自定义构建若还使用其他实例配置，在 git diff 命令末尾为每个路径追加 `":(exclude)你的配置路径"`，不要排除应用代码或锁文件。[Git 补丁合并说明](https://git-scm.com/docs/git-apply)

逐条执行；任何一步报错就停止，不继续提交或推送。三方合并可能留下冲突和部分已暂存文件；用 git status 检查，逐个解决冲突并仅暂存已解决文件，再检查整个差异。不要用 --force、--ours、--theirs 或整仓覆盖跳过冲突。不确定如何解决时保留这个目录以便排查，原 Worker 尚未更新。

### 3. 合并配置要求并本地验证

补丁保留了旧配置，因此需要**手动合并目标版本新增的配置要求**，不能只更新代码。v1.1.2 应保留原来的每日 Cron，并加入每分钟任务；根 JSONC 配置的默认示例如下，如果每日时间已定制，保留自己的值：

~~~json
"triggers": { "crons": ["0 16 * * *", "* * * * *"] }
~~~

TOML 配置合并到现有的 triggers 段，不要新增重复段：

~~~toml
[triggers]
crons = ["0 16 * * *", "* * * * *"]
~~~

每分钟任务处理通知重试和分批过期邮件清理。Cron 使用 UTC；Wrangler 部署会同步定时任务配置，传播可能需要最多 15 分钟。自定义构建若从私有文件或构建变量生成配置，也要同步该源文件，避免下次构建覆盖控制台修改。[Cron 配置说明](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

再次确认原 Worker 名称、原 D1/KV/R2、已有邮件路由绑定和 keep_vars 未丢失；不要把 Secret 值写入配置。根 wrangler.jsonc 中只包含资源标识的修改可单独 git add；本地私有配置继续保持忽略。然后运行：

~~~sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 test
npx --yes pnpm@10.34.5 test:deploy
npx --yes pnpm@10.34.5 build
git diff --name-only --diff-filter=U
git diff --cached --check
git diff --cached
git status --short
~~~

这些命令只测试和构建，不部署。git diff --name-only --diff-filter=U 必须无输出；确认测试通过、没有未解决冲突、暂存内容只含预期代码和配置修改后，才创建提交；不要使用 git add . 将无关或私有文件一并加入。

### 4. 推送生产分支，等待原 Worker 自动部署

~~~sh
git commit -m "Update FlareMail to v1.1.2"
git switch main
git pull --ff-only origin main
git merge --ff-only update/flaremail-1.1.2
git push origin main
~~~

最后一条 push 会触发已连接生产分支的构建和部署。如果 pull、merge 或 push 因他人新提交、权限或分支保护失败，停止并重新整合，不强推；有 PR 要求的仓库改用自己的 PR 流程，并在推送更新分支前确认非生产构建已关闭。

在 Cloudflare 原 Worker 的构建日志确认成功，并核对部署提交和资源绑定仍为原实例。构建失败先处理日志，不创建替代数据库或再次运行部署按钮。随后完成下方数据库升级和收发验收。

## 仅使用命令行部署的实例

如果从维护者仓库直接 clone，未连接 Git 自动部署，且实例配置一直保存在被忽略的 apps/worker/wrangler.toml，可在原本地目录更新固定版本。先备份并确认 git status --short 无输出、git remote get-url origin 为 `https://github.com/arctan303/FlareMail.git`，再执行：

~~~sh
git fetch --no-tags origin refs/tags/v1.1.2:refs/remotes/origin/releases/v1.1.2
git switch --detach origin/releases/v1.1.2
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 test
npx --yes pnpm@10.34.5 test:deploy
npx --yes pnpm@10.34.5 build
~~~

有自定义应用代码时先保存并使用上方补丁方式整合，不直接切换覆盖。核对原实例配置并合并目标版本的 Cron 等要求，确认测试通过后，在仓库根目录执行 `npx --yes pnpm@10.34.5 run deploy`，它会立即部署，无需推送。部署命令优先使用已有 apps/worker/wrangler.toml，否则使用根 wrangler.jsonc；自定义路径须显式传 --config 并核对目标。普通更新不附加 --secrets-file，保留远端已有 Secret。[Wrangler 配置保留规则](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)

## 部署后的数据库升级

登录管理员账号，在「系统设置 → 系统维护」检查版本与待应用补丁，按提示升级。当前 Schema 为 **329**。兼容补丁允许正常登录；Google 更换绑定的会话撤销保护需要326，邮件Webhook需要327，域名启停与整域迁移需要328；回收站30天保留、Cc/Bcc幂等与投递回传需要329。如果未来重大结构升级阻止登录，才使用登录页维护入口与SETUP_SECRET。安装Secret不是忘记密码的重置工具。

329增量添加删除时间与删除代次、发送指纹和投递事件；旧已删邮件从升级时起保留30天，不按邮件创建日期直接清理。保留每日及每分钟Cron，过期邮件和通知均分批处理。原有完整328仍能使用基础登录、阅读和To发信，新依赖操作会提示升级。

328 为现有域名补充启停与迁移保护，已有域名默认启用，不移动原邮件或附件。升级前的完整 327 实例仍可正常使用，新增管理操作需升级后开放。迁移域名后的账号使用新地址登录；旧版代码不识别停用状态，因此依赖域名停用时不能直接回退旧版服务。代码回退也不会自动还原已迁移的地址；需要在新版本重新预览并反向迁移。[域名管理](/docs/zh/administration)

327 增量创建 Webhook 设置和投递表，不自动启用。保留实例资源 ID，在自己的 Wrangler 配置 triggers.crons 中保留每日任务并加入 `* * * * *`，否则失败通知只有后续收信或每日任务才可能补发。公开模板已包含该任务，已有定制配置需自行合并。D1 备份包含 Webhook 共享密钥，应按敏感数据保存；回退代码前停用 Webhook，保留新增表即可。完整配置见 [CLI / Agent](/docs/zh/cli)。

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
