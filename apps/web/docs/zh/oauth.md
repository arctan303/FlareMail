# OAuth 授权接入

FlareMail 可作为部署者自己的网站的授权服务。此能力默认关闭，与邮箱密码登录、Google 登录绑定及 CLI / Agent 个人令牌独立。

这里沿用第一方网站共享 Secret 的模式。接入方需要能安全保存 Secret 的服务端；不适用于把 Secret 放入浏览器、移动应用包或公开仓库的客户端。现有协议提供授权码、短期 Access Token 与 userinfo，没有 OIDC ID Token、刷新令牌、独立客户端 Secret 或新的授权同意页。

## 管理员配置

1. 打开 Web 后台授权设置，填写固定的邮箱服务 HTTPS origin（issuer），例如 `https://mail.example.com`；输入或生成共享 Secret 并保存。
2. 添加接入网站：客户端标识、显示名称、启用状态及一个或多个完整回调 URL。邮箱域名列表不会自动授权这些网站。
3. 确认 issuer、共享 Secret 和网站配置就绪，再打开 **启用授权**。配置修改与开关沿用近期密码认证。
4. 需要再次查看、复制共享 Secret 时，使用单独的查看操作并重新验证管理员密码。普通设置查询不返回明文，关闭查看窗口后清除页面中的明文。
5. 接入网站服务端保存同一个共享 Secret。它与管理员密码、安装凭据、CLI 令牌和 Google Secret 分开，不能放入浏览器代码。

issuer 保存后不随请求 Host 或访问地址变化，生产须是没有路径、查询或片段的 HTTPS origin。本地调试可使用 `http://127.0.0.1:8787`（单 Worker）或 `http://127.0.0.1:3001`（Vite）；issuer 与回调均不接受 HTTP `localhost`，请统一使用 `127.0.0.1`。Vite 已代理下表全部公开端点；选择哪个 origin，就从该地址登录和发起授权。
修改访问域名时明确更新 issuer；查看/复制密钥不会轮换它。替换 Secret 是独立保存动作，接入方需同步更新，未兑换的旧码仍要求当前密钥。

例如：客户端标识 `personal-site`，回调 `https://site.example.com/auth/callback`。完整 URL 精确匹配；域名、路径、查询参数和端口均属于配置。禁止通配符、前缀匹配、fragment 和 URL 内的用户名/密码。生产回调须使用 HTTPS；开发仅允许 `http://127.0.0.1[:port]`。

每个客户端标识为 1～128 个字母、数字或 `._~-`，显示名 1～80 字符；最多 32 个客户端，每个最多 16 个回调。需要新标识时创建新客户端。

关闭期间仍可编辑和保存网站。总开关与网站列表分别提交；开关不改写、重排或清空网站、回调、issuer 及共享密钥。多人或多个标签页同时修改时，过期的 revision 返回 409，需要重新加载后核对修改。

## 授权流程

| 步骤 | 端点 | 调用方 |
| --- | --- | --- |
| 元数据 | `GET /.well-known/oauth-authorization-server` | 接入方 |
| 发起授权 | `GET /oauth/authorize` | 用户浏览器 |
| 兑换授权码 | `POST /oauth/token` | 接入方服务端 |
| 读取身份 | `GET /oauth/userinfo` | 接入方服务端 |

以上路径相对邮箱服务 origin，使用不带 `/api` 前缀的公开端点。

接入网站为每次登录产生随机 `state` 和 PKCE `code_verifier`，只在自己的短期登录流程中保存。verifier 使用 43～128 个 Base64URL 字符；`code_challenge` 为 verifier 的 SHA-256 摘要经无填充 Base64URL 编码，方法固定 `S256`。

授权请求包含：

| 参数 | 值 |
| --- | --- |
| `response_type` | `code` |
| `client_id` | 后台登记的客户端标识 |
| `redirect_uri` | 后台登记的完整回调 |
| `state` | 每次登录独立、非空、最长 512 字符 |
| `code_challenge` | 本次 PKCE challenge |
| `code_challenge_method` | `S256` |
| `scope` | `email`，也可省略 |
| `prompt` | 普通登录省略；静默尝试使用 `none` |

未登录的用户会进入 FlareMail 登录页，然后回到原授权请求。成功后，浏览器前往已登记的回调，带上 `code` 和原 `state`。接入方先校验 state，再从服务端兑换；不能把任意收到的 state 直接当作可信登录状态。

兑换示例（占位值由接入方服务端填入）：

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=personal-site&client_secret=SERVER_SIDE_SECRET&redirect_uri=https%3A%2F%2Fsite.example.com%2Fauth%2Fcallback&code=RETURNED_CODE&code_verifier=SAVED_VERIFIER
```

成功响应：

```json
{
  "access_token": "opaque-access-token",
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "email"
}
```

授权码有效期为 90 秒，一次使用。Access Token 是有效期 5 分钟的不透明令牌；接入方不能当作 JWT 自行解码或延长有效期。

随后调用：

```http
GET /oauth/userinfo
Authorization: Bearer RETURNED_ACCESS_TOKEN
```

成功响应包含 `sub`（持久化用户 ID 字符串）、`email`、`email_verified`、`name`、`role`（`admin` 或 `member`）。这些角色描述该 FlareMail 实例中的身份；接入网站按自己的规则建立本地会话和分配权限。

## 关闭授权及存量凭据

| 操作 | 新授权 | 未兑换授权码 | 已签发 Access Token |
| --- | --- | --- | --- |
| 关闭“启用授权” | 本地拒绝 | 客户端/回调仍有效时，可在原 90 秒内兑换 | 继续按原有效期与用户校验处理 |
| 重新打开开关 | 沿用保存的网站配置 | 原规则不变 | 原规则不变 |
| 停用或删除客户端 | 此客户端拒绝 | 当前客户端复核失败，不能兑换 | 原规则不变 |
| 删除或更换某条回调 | 原回调拒绝 | 绑定旧回调的码不能用旧地址或新地址兑换 | 原规则不变 |
| 修改显示名称 | 不变 | 不变 | 不变 |

关闭开关不会清理网站配置、授权码或 Token，也不会主动退出其他网站的本地会话。用户停用、删除、密码凭据变化等原有失效规则继续生效。需要更改接入网站的本地会话时，由该网站处理。

总开关和信任名单每次从 D1 读取；关闭后的请求不会因为通用设置 KV 缓存滞后而继续签发。

## 静默授权

`prompt=none` 不进入交互登录：没有可用邮箱会话时，返回已登记回调并携带 `error=login_required` 和 state。

确实使用 iframe 的网站，可为对应回调明确设置“静默授权父页面来源”，例如 `https://site.example.com`。必须是完整 origin，不能有路径、查询参数、fragment 或用户信息。该来源仅适用于已校验的客户端与对应回调，不等于开放整个邮箱页面的嵌入，也不改变邮箱 API 的 CORS 白名单。

浏览器第三方 Cookie 策略可能使静默登录不可用；接入方应保留顶层页面登录路径。

## 失败处理

OAuth 端点返回原始错误 JSON 或向已信任回调附加 `error`，不使用邮箱内部的 `code/message/data` 包装。接入方应检查 HTTP 状态和 `error`，不要只判断是否收到 JSON。

- `authorization_disabled`：管理员关闭新授权。留在邮箱本地响应，不向任意回调跳转。
- `provider_not_ready`：后台运行配置尚未就绪。
- `invalid_client_or_redirect` / `invalid_client`：客户端、回调或共享 Secret 校验失败。
- `invalid_request`：参数不满足约束。
- `invalid_grant`：授权码过期、已使用、PKCE 不符或用户状态不允许。
- `invalid_token`：令牌不存在、过期或既有用户/凭据校验失败。
- `login_required`：静默授权没有可用会话。

元数据端点在关闭时仍可读，并提供 `provider_enabled/issuer_ready/secret_ready/configuration_ready`。issuer 未配置或非法时不返回 issuer 及派生端点，也不会从请求 origin 推断。配置就绪与显式启用是两个状态；客户端清单和 Secret 不公开。

授权与令牌响应带 `Cache-Control: no-store`。回调服务避免记录 code、verifier、Secret 和 Token。
