# 更新、备份与恢复

更新顺序：备份资源与配置 → 更新代码和锁定依赖 → 部署 → 检查数据库版本 → 验证收发。

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

取得最新源码，保留实例配置，在仓库根目录执行：

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
