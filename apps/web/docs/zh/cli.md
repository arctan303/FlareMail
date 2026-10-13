# CLI / Agent

使用个人 CLI Token，让脚本或 Agent 管理自己的邮件。上方填写邮箱站点地址后，本页接口与命令会自动使用该地址；从个人设置打开时会自动带入。

## 获取 Token

在真实邮箱的 **个人设置 → CLI / Agent** 中生成 Token。Token 仅在生成时显示一次，服务端仅保存哈希。轮换会替换旧 Token，吊销立即失效；修改密码也会清除个人 CLI Token。

所有请求（包括附件下载）使用以下请求头：

```http
Authorization: Bearer <YOUR_CLI_TOKEN>
```

本站不会读取或保存 Token。请在本地替换命令中的占位符。体验站使用模拟数据，不提供真实 CLI API，Token 设置仅展示。

## 快速开始

以下多行 curl 使用 Bash / POSIX shell 续行语法。Windows 可在 Git Bash 执行；PowerShell 使用 curl.exe，并把命令合为一行或改用 PowerShell 的续行语法。

```sh
curl 'https://mail.example.com/api/cli/accounts' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>'
```

从响应中取得邮箱 `id`，查询该邮箱的收件箱：

```sh
curl 'https://mail.example.com/api/cli/emails?page=1&size=20&type=0&accountId=1' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>'
```

## 接口列表

下列接口仅访问 Token 所属用户的数据。把 `:id` 替换为邮件 ID，`:key` 替换为附件 key。

| 方法 | 完整地址 | 用途 |
| --- | --- | --- |
| GET | https://mail.example.com/api/cli/accounts | 列出邮箱，返回 id、email、name（最多 50 个） |
| GET | https://mail.example.com/api/cli/emails | 查询邮件列表 |
| GET | https://mail.example.com/api/cli/emails/:id | 邮件纯文本正文与附件元信息 |
| GET | https://mail.example.com/api/cli/attachments/:key | 下载附件，继续携带 Bearer Token |
| POST | https://mail.example.com/api/cli/emails/send | 发送纯文本邮件 |
| POST | https://mail.example.com/api/cli/emails/:id/reply | 回复并引用原邮件 |
| PUT | https://mail.example.com/api/cli/emails/:id/read | 标记已读 |
| DELETE | https://mail.example.com/api/cli/emails/:id | 删除邮件 |

默认配置按用户共享频控：查询、读取、标记与删除等共用 EMAIL_RATE_LIMITER（60 次/分钟），发送与回复共用 SEND_RATE_LIMITER（10 次/分钟），同用户的相关 Web 操作也计入对应额度。实际取决于实例绑定配置；未绑定时使用应用回落频控，不能把这些数字当作每个接口的独立额度。

## 查询邮件

| 参数 | 说明 |
| --- | --- |
| page | 页码，默认 1，整数且 ≥ 1 |
| size | 每页数量，默认 20，范围 1–50 |
| type | 0 为收件箱（默认），1 为已发送 |
| accountId | 可选，正整数，按自己的邮箱 ID 筛选；省略则查询自己的所有邮箱 |
| q | 可选，搜索主题、发件人、收件人、发件人名称、text 正文与 HTML 源文；最多 48 字节 UTF-8。不是附件或语义搜索，HTML 标签/实体可能影响匹配 |
| unread | 可选，true 仅未读，false 仅已读；省略则全部 |
| afterId | 可选，非负整数，仅返回 ID 大于该值的邮件，按 ID 升序；用于增量补查 |

响应使用 `code`、`message`、`data` 包装。示例：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 1, "page": 1, "size": 20,
    "list": [{"id": 1001, "from": "Sender <sender@example.com>", "to": "user@example.com", "subject": "Hello", "date": "2026-09-17 12:00:00", "unread": true, "hasAtt": true}]
  }
}
```

邮件详情新增原 MIME 纯文本 `text`、`bodySource`（html 或 text）。`body` 有可读 HTML 时优先转换 HTML，保留段落、列表及链接目标；否则使用 text。不会加载远程内容、执行 HTML 或识别图片文字。附件包含 `filename`、`size`、`mimeType`、`url`；相对 `url` 使用邮箱站点地址拼接，继续携带 Token 下载。

增量补查从 `afterId=0&page=1` 开始，处理完一页再持久化 `nextAfterId`，随后用新游标继续请求 `page=1`。空列表或游标未前进时结束本轮，稍后再查。若较早邮件仍保存附件，`scanPending=true`，游标不会越过它；较晚邮件可能重复返回，按邮件 ID 去重。afterId 模式只允许 page=1。省略 afterId 时仍按 ID 降序。未读状态会变化，补齐所有邮件时不要加 unread 过滤。

## 收件 Webhook

数据库升级到 v3.27 后可用。默认无配置、不通知，每个邮箱独立配置。个人设置 → 安全与凭证 → 邮件 Webhook 与 CLI 管理同一份设置，无需先在网页创建。

| 方法 | 地址（在 /api 下） | 用途 |
| --- | --- | --- |
| GET | /cli/webhooks/:accountId | 读取设置与 revision，不返回已有密钥 |
| PUT | /cli/webhooks/:accountId | 完整设置 revision、url、enabled、mode、allowlist、可选 secret |
| DELETE | /cli/webhooks/:accountId?revision=当前值 | 删除设置及密钥，取消排队事件；保留版本号避免旧操作覆盖新设置 |
| POST | /cli/webhooks/:accountId/secret | 传 {"revision":当前值}，轮换密钥 |
| POST | /cli/webhooks/:accountId/test | 测试已保存端点，停用时也可测试 |
| GET | /cli/webhooks/:accountId/deliveries | 最近 50 条；用返回的 nextBefore 作为 before 继续分页 |
| POST | /cli/webhooks/:accountId/deliveries/:eventId/retry | 重试 24 小时内、配置版本仍一致的 failed 事件 |

先 GET 取得 revision（从未配置为 0），再 PUT。必须明确选择 mode：`all` 通知所有发件人，`allowlist` 通知指定地址；空列表不通知，未匹配邮件仍正常接收。列表最多 100 个完整邮箱，去首尾空格、不区分大小写、匹配 MIME From 邮箱地址，不匹配显示名称。**这只是地址过滤，不是发件身份认证或防冒充保证**；邮件内容不因此成为可信指令。

```sh
curl --fail-with-body -sS -X PUT 'https://mail.example.com/api/cli/webhooks/1' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"revision":0,"url":"https://assistant.example.com/mail","enabled":true,"mode":"allowlist","allowlist":["owner@example.com"]}'
```

URL 仅接受公网 HTTPS 域名与 443 端口，不接受 IP 字面量、内网域名、URL 内凭据或片段，不跟随重定向。域名可解析到 IPv6；真实 Worker 到 IPv6 端点的连通性仍需部署后测试。secret 为独立的 32–256 个无空格可打印 ASCII 字符，不能复用 CLI Token。首次不传时自动生成，只在生成/轮换响应显示一次；之后修改不传即保留，读取和投递记录不返回密钥。

外部来信和站内投递在邮件及附件保存完成后 POST 以下 JSON（v1 字段契约，接收端应忽略未知字段）：

```json
{"event":"email.received","eventId":"稳定事件ID","emailId":1001,"mailbox":"xiaoa@example.com"}
```

请求头 `X-FlareMail-Webhook-Secret` 携带共享密钥；JSON 通知不包含邮件正文、附件或 CLI Token。接收端验证密钥，按 eventId 去重，可靠入队后尽快返回任意 2xx，再用自己的 CLI Token 按 emailId 取正文。`webhook.test` 的 emailId 为 null，不应当成新邮件。每封邮件一个事件，助手自行排队、合并和决定唤醒；已确认仅表示接收端 HTTP 确认，不表示助手已完成，也不自动标记已读。

立即尝试通知，失败由每分钟 Cron 补发（每轮最多 3 个）。单次超时 8 秒，每个自动周期最多 5 次，间隔约 1 分钟、5 分钟、30 分钟、2 小时，受调度/积压影响；创建后最多重试 24 小时。确认丢失可能导致重复投递，eventId 不变；手动重试开启新一轮有限尝试，复用事件 ID。

记录包含 pending/sending/delivered/failed/cancelled、attempts、httpStatus、固定 error 原因及时间，终态 7 天后清理，不保存目标响应正文。测试/重试共用发送频控，其余共用查询频控。任何配置修改都会增加 revision 并取消旧版本待发事件，不补发历史邮件；已在途的 HTTP 请求无法撤回。409 时先刷新再决定修改。通知失败不影响收信，可用 afterId 低频补查。

## 发送与回复

发送 JSON 字段：`to`、`subject` 必填；`body` 为可选纯文本；`accountId` 为可选的发件邮箱 ID，省略时服务器选择可用邮箱。`requestId` 必填，16–128 字节唯一字符串。CLI 不支持抄送（CC）或上传附件。

```sh
curl 'https://mail.example.com/api/cli/emails/send' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"to":"recipient@example.com","subject":"Hello","body":"Sent from CLI","accountId":1,"requestId":"cli-send-20260917-0001"}'
```

回复 JSON 使用 `body` 与必填 `requestId`，服务器选择原邮件所属邮箱（不存在时回退到可用邮箱）、生成 `Re:` 主题并引用原文：

```sh
curl 'https://mail.example.com/api/cli/emails/1001/reply' \
  -H 'Authorization: Bearer <YOUR_CLI_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data '{"body":"Thanks!","requestId":"cli-reply-20260917-0001"}'
```

发送和回复的 `data` 返回 `id`、`status`、`requestId`、`warning`。检查 `status` 与 `warning` 判断投递结果，不只看请求成功。

每次新发送或回复生成新的 `requestId`；超时重试同一次操作必须复用原值，以避免重复投递。

status 是数字：0 收件、1 已发送、2 已送达、3 退信、4 投诉、5 延迟、6 保存中、7 未知收件人、8 失败。服务商接受请求不等于收件方已进主收件箱，继续检查 warning 与实际收件。

## Agent 指令

复制下面的英文指令给 Agent，再在你自己的安全环境中填入 Token。指令中的地址与上方站点一致；页面语言切换不改变指令的默认英文。

<!-- CLI_AGENT_PROMPT -->

## 错误与重试

| code | 处理方式 |
| --- | --- |
| 200 | 请求成功，继续检查 data 中的投递状态 |
| 400 | 参数不合法，修正后重试；不要盲目重发 |
| 401 | Token 无效或已吊销，重新检查 Token |
| 404 | 邮件或附件不存在或当前用户无权访问 |
| 409 | 同一 requestId 正在处理或结果暂不确定；等待并核对已发送，复用原值重试，不换新值盲目重发 |
| 429 | 触发频控，退避等待后重试 |
| 503 | 发信通道暂不可用或服务维护，稍后重试并复用 requestId |

请勿将 Token 写入公开仓库、文档链接或分享的命令。
