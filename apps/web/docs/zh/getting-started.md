# 本地开发

本页面向本地运行与修改代码。首次安装真实邮箱请从[部署指南](/docs/zh/deployment)开始。

## 前置要求
- **Node.js**: >= 22.12（本地验证与 CI 推荐 Node.js 24）
- **包管理器**: pnpm 10.34.5（以下命令直接使用 `npx`，无需全局安装 pnpm）

## 完整运行一个本地 Worker

使用与生产环境相同的架构模板，由单 Worker 提供前端页面、API 和邮件处理。无需预先登录 Cloudflare、无需填写真实资源 ID、无需手动执行 SQL。

首次运行，在仓库根目录执行：

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
node -e "const fs=require('node:fs');fs.copyFileSync('apps/worker/wrangler.example.toml','apps/worker/wrangler.toml',fs.constants.COPYFILE_EXCL)"
node -e "require('node:fs').writeFileSync('apps/worker/.dev.vars','SETUP_SECRET='+require('node:crypto').randomBytes(32).toString('hex')+'\n',{flag:'wx'})"
npx --yes pnpm@10.34.5 dev:worker
```

> 复制和凭据生成命令会自动拒绝覆盖已有文件；已有实例会完整保留自己的配置。Worker 启动时会自动构建前端，等待终端出现 `Ready on http://127.0.0.1:8787`。

在浏览器打开 `http://127.0.0.1:8787`，从 `apps/worker/.dev.vars` 读取安装凭据完成初始化：
1. 输入 `SETUP_SECRET` 并验证。
2. 填写至少一个邮箱域名（本地测试可填 `example.com`，无需配置真实 DNS）。
3. 选择域名，输入管理员邮箱前缀与初始密码。
4. 核对并确认；此时数据库自动建表、初始化管理员并登录系统。

停止只需按 `Ctrl+C`。本地数据持久化在 `apps/worker/.wrangler/state`，下次重复执行 `dev:worker` 即可无缝继续使用。

## 本地模拟收信

本地运行不会收到真实公网邮件。将以下内容保存为 `test-email.eml`（收件人改为已创建的邮箱）：

```text
From: Local Sender <sender@example.net>
To: owner@example.com
Subject: Local mail test
Message-ID: <local-test-001@example.net>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Hello from the local email handler!
```

在该文件所在目录运行（Windows PowerShell 请使用 `curl.exe`）：

```sh
curl --request POST "http://127.0.0.1:8787/cdn-cgi/handler/email?from=sender@example.net&to=owner@example.com" --header "Content-Type: message/rfc822" --data-binary "@test-email.eml"
```

刷新网页收件箱即可看到新信件。

## 修改代码时的热重载（双进程开发）

在仓库根目录执行：

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 dev
```

一个终端同时启动 Vite 开发服务器（`3001`）和 Worker（`8787`）。访问 `http://127.0.0.1:3001`，Vite 自动将 API、OAuth 端点和 manifest 代理到 `8787`，享受前端即时热重载。
