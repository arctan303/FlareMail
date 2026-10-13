# FlareMail Release Process / 发布流程

This file summarizes the development and release rules. 本文件是开发与发版规则的公开摘要。

## Branch roles / 分支职责

- `dev` is the only integration branch for development changes and release preparation. Development commits, version bumps, and changelog updates are pushed to `dev` first.
- `main` contains stable release code. Integrate validated candidates through a `dev → main` pull request; do not push daily development directly to `main`.
- `dev` 是开发变更和发布准备的唯一集成分支。开发提交、版本号和更新日志必须先推送到 `dev`。
- `main` 保留正式发布代码；通过 `dev → main` PR 合入已验证的候选，禁止将日常开发直接推送到 `main`。

## Release gate / 发布门禁

1. Fetch remote branches and inspect the complete candidate, including all accumulated `origin/main..dev` changes and intended working-tree edits. If the branches diverge, account for changes on both sides. Preserve unrelated work.
2. Complete independent review of the full candidate and relevant pending maintenance items. Reuse applicable review and test evidence after checking its baseline; substantive fixes need focused verification and review. An interrupted review is not a pass.
3. Run Worker/Web and deployment-configuration tests, production and Pages builds, artifact smoke checks, and a sensitive-information review. Fix required failures before proceeding.
4. From the accepted code, write a complete Chinese/English `CHANGELOG.md` entry and synchronize the root, Web and Worker package versions. Push the final candidate to `dev`, record its SHA, and verify all required GitHub and configured Cloudflare checks for that SHA. Successful CI alone does not prove deployment success.
5. When release execution is authorized and all gates are satisfied, merge a `dev → main` pull request using a merge commit that preserves the validated candidate history. Verify that `main` contains the entire candidate and any existing main fixes; verify authorized automatic deployment results separately.
6. Create an immutable annotated `vX.Y.Z` tag on the verified main release commit and publish a non-draft, non-prerelease GitHub Release. Its bilingual notes must cover the complete release range, compatibility, upgrade requirements, validation and known limitations. Read back main, the tag target and the Release before declaring completion.

1. 获取远端分支，核对完整候选，包括累计 `origin/main..dev` 差异及本次待纳入的工作区修改。分支分叉时同时考虑两侧变更，保留无关工作。
2. 完成完整候选和相关维护队列的独立审查。核对基线后复用仍适用的审查与测试证据；实质修复补针对性验证和聚焦复核。审查中断不能记为通过。
3. 运行 Worker/Web 与部署配置测试、正式版与 Pages 构建、产物冒烟及敏感信息审计；必要检查失败先修复。
4. 根据已验收代码编写完整中英双语 `CHANGELOG.md`，同步根、Web、Worker 三份 package 版本。推送最终 dev 候选并记录 SHA，核验该 SHA 的全部必要 GitHub 和已配置 Cloudflare 检查；CI 成功不等于部署成功。
5. 已获发版执行授权且门禁全部满足后，通过保留候选历史的 merge commit 合并 `dev → main` PR。回读 main 包含完整候选及原有 main 修复，另行核验已获授权的自动部署结果。
6. 在已验证的 main 发布提交创建不可移动的 annotated `vX.Y.Z` 标签，发布非草稿、非预发布的 GitHub Release。双语说明覆盖完整发行差异、兼容性、升级要求、验证与限制；回读 main、标签目标和 Release 后才能宣告完成。

## Authorization / 执行授权

- An explicit instruction to execute a release authorizes the necessary dev commit/push, pull request creation and merge, tag, and GitHub Release within the agreed scope. Do not ask again at every step. Preparation requests and successful checks do not themselves authorize release execution.
- A new substantive change requires updated validation and focused review. It requires renewed authorization only when it exceeds or changes the authorized scope; it must never bypass a failed gate.
- 用户明确要求“执行发版”或等价指令时，一次有效授权覆盖约定范围内必要的 dev 提交/推送、PR 创建与合并、标签和正式 GitHub Release，不逐步骤重复询问。“准备合入 main”“准备发版”和检查成功本身不触发发版执行。
- 新增实质变化须补验证和聚焦审查；超出或改变已授权范围时才补授权，不能绕过失败门禁。

## Version and deployment boundaries / 版本与部署边界

- Use the maintainer's chosen version. Otherwise, the project defaults to the next patch after the relevant main release baseline; reuse an existing candidate version throughout the same pending release. This default is a maintainer policy, not a claim of strict SemVer classification: disclose new interfaces and incompatible changes accurately.
- Tags are immutable. Fix a released version with a new commit and a new version; never move or overwrite an existing tag.
- Verify the actual deployment target before pushing or deploying. Existing branch-triggered deployments follow their valid authorization and must be checked. New deployment paths, manual production deployments, database migrations, secret changes, DNS and binding changes need their own valid authorization. Never replace an existing instance's private bindings with the public deployment template.
- Use the pnpm workspace and its lockfile. Keep internal notes, private configuration, credentials and test artifacts out of commits and Release attachments. The creator.skill `.version` is independent of the product version.
- 用户指定版本优先；未指定时默认从对应 main 发布基线递增修订号，同一待发布任务复用已有候选版本。默认 patch 是维护者策略，不称为严格 SemVer 分类；接口新增和不兼容变化仍须如实披露。
- 标签不可移动。已发布版本出现问题时使用新提交和新版本修复，禁止覆盖既有标签。
- 推送或部署前核验实际目标；已配置的分支自动部署沿用有效授权并回验。新增部署链路、手工生产部署、数据库迁移、秘密修改、DNS 和绑定变更需各自有效授权；禁止使用公共部署模板覆盖已有实例的私有绑定。
- 复用 pnpm 工作区与锁文件；内部记录、私有配置、凭据及测试产物不提交、不放入 Release 附件。creator.skill 的 `.version` 独立于产品版本。
