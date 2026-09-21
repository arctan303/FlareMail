# FlareMail Release Process / 发布流程

This file defines the repository release gate. 本文件定义本仓库的发布门禁。

## Branch roles / 分支职责

- `dev` is the only integration branch for development changes and release preparation. Development commits, version bumps, and changelog updates are pushed to `dev` first.
- `main` contains only the latest approved stable release. Do not push development work directly to `main`.
- `dev` 是开发变更和发布准备的唯一集成分支。开发提交、版本号和更新日志必须先推送到 `dev`。
- `main` 只保留已经确认的最新稳定版本，禁止将日常开发直接推送到 `main`。

## Release gate / 发布门禁

1. Fetch the remote branches and compare the complete `origin/main..dev` range.
2. Update all package versions together and write a complete Chinese/English `CHANGELOG.md` entry from that full range. Do not describe only the last commit or current task.
3. Run the repository tests, production and Pages builds, artifact smoke checks, and a sensitive-information review. Push the validated commit to `dev` and report its exact SHA and remaining limitations.
4. Wait for the maintainer's explicit post-validation approval, such as “没问题”, before changing `main`, creating a tag, or publishing a GitHub Release. Earlier task authorization does not replace this gate. Any new `dev` commit after approval invalidates that approval and requires validation and approval again.
5. Fast-forward `main` to the exact approved `dev` commit and push it without rewriting history. Create an immutable annotated `vX.Y.Z` tag on that same commit and push the tag.
6. Publish a non-draft GitHub Release from that tag. Its Chinese/English notes must match the complete change range that made `main` advance, including compatibility notes, validation scope, and known limitations. Read back the remote branch, tag, and Release before declaring success.

1. 获取远端分支，并核对完整的 `origin/main..dev` 差异。
2. 同步更新所有 package 版本，并根据上述完整差异编写中英双语 `CHANGELOG.md`；不能只记录最后一个提交或当前任务。
3. 运行仓库测试、正式版与 Pages 构建、产物冒烟及敏感信息审计。将通过验证的提交推送到 `dev`，报告准确 SHA 与剩余限制。
4. 只有维护者在查看验证结果后明确回复“没问题”或等价发布批准，才允许更新 `main`、创建标签或发布 GitHub Release。此前的任务授权不替代此门禁；批准后若 `dev` 又有新提交，必须重新验证并重新确认。
5. 将 `main` 快进到获批的同一个 `dev` 提交并推送，禁止改写历史；在该提交创建不可移动的 annotated `vX.Y.Z` 标签并推送。
6. 从该标签发布非草稿 GitHub Release。中英双语说明必须覆盖本次 `main` 前进的完整差异，并写明兼容性、验证范围和已知限制；回读远端分支、标签和 Release 后才能宣告完成。

## Version and deployment boundaries / 版本与部署边界

- Follow SemVer. Patch releases contain compatible fixes, security hardening, and small improvements; minor releases add backward-compatible capabilities; major releases may contain incompatible changes. The maintainer may explicitly choose a version level for a release.
- Tags are immutable. Fix a released version with a new commit and a new version; never move or overwrite an existing tag.
- A repository release does not authorize a Cloudflare Worker, Pages, database, DNS, or production deployment. Those operations require separate explicit authorization.
- 遵循 SemVer：补丁版本用于兼容修复、安全加固和小型改进；次版本用于向后兼容的新能力；主版本可包含不兼容变化。维护者可以为某次发布明确指定版本级别。
- 标签不可移动。已发布版本出现问题时使用新提交和新版本修复，禁止覆盖既有标签。
- 仓库发版不等于授权部署 Cloudflare Worker、Pages、数据库、DNS 或生产环境；这些操作必须另行明确授权。
