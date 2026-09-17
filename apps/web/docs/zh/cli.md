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
| q | 可选，搜索主题、发件人、收件人或发件人名称；最多 48 字节 UTF-8 |

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

邮件详情 `data` 包含 `id`、`from`、`to`、`cc`、`subject`、`date`、纯文本 `body` 及 `attachments`。每个附件包含 `filename`、`size`、`mimeType`、`url`；相对 `url` 使用你的邮箱站点地址拼接，继续携带相同 Token 下载。

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
