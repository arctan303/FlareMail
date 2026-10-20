# 收信配置

这一步让外部发往你域名的邮件真正到达 FlareMail 邮箱：通过 Cloudflare Email Routing（电子邮件路由）将公网来信转交给已部署的 Worker 处理。

路由到 Worker 后，发往已创建且启用的邮箱地址、并通过收信检查的邮件才会进入收件箱；未知地址按你设置的策略处理。

> [!NOTE] 费用与额度说明
> Email Routing 入站收信在 Workers Free 和 Paid 计划均可使用。入站单封邮件上限为 **25 MiB**；Worker 处理仍受请求、CPU 与内存额度限制，复杂邮件可能超过免费计划限制。FlareMail 另校验附件数量和总大小。详见[费用与准备](/docs/zh/costs)及[平台限制](https://developers.cloudflare.com/email-service/platform/limits/)。

## 前置准备

- 域名已经在 Cloudflare 托管且状态为「有效 (Active)」。
- FlareMail Worker 已成功部署（参考[部署邮箱](/docs/zh/deployment)）。
- 准备一个外部邮箱（如个人 Gmail / QQ 邮箱 / 163 邮箱）用于后续发信测试。

---

## 第一步：进入 Cloudflare 邮件路由控制台

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 选择域名所在账号，进入 **「计算 (Compute) → 电子邮件服务 (Email Service) → 电子邮件路由 (Email Routing)」**，选择要作为邮箱后缀的域名（例如 `example.com`）。
3. 部分控制台仍可从域名的「电子邮件 → 电子邮件路由」进入，以当前账号显示为准。[官方设置入口](https://developers.cloudflare.com/email-service/get-started/route-emails/)

---

## 第二步：启用邮件路由与配置 DNS

如果是该域名首次使用 Email Routing：

1. 点击 **「接入域名 (Onboard Domain)」** 或旧版 **「启用电子邮件路由 (Enable Email Routing)」**。
2. 检查控制台为该域名列出的 MX、SPF 和 DKIM 等 DNS 记录。MX 目标常见为 `route1.mx.cloudflare.net` 等；记录数量、优先级和值以你的控制台为准，不要照抄其他域名的示例。
3. 按提示添加记录并等待状态生效。若已有 SPF，合并所需授权，避免同一主机名发布多条 SPF 记录；保留发信服务商需要的授权。

> [!WARNING] 冲突 MX 记录处理
> 改 MX 会改变整个域名的收信去向。若原来使用其他邮箱服务，先备份并安排切换时间，准备好 Worker、地址和路由后，再按 Cloudflare 提示替换冲突 MX。混用服务商可能导致投递到错误的服务；不要为试用而直接删除正在使用的邮件配置。

---

## 第三步：配置路由规则指向 FlareMail Worker

DNS 记录就绪后，切换到 **「路由规则 (Routing Rules)」** 标签页。这里决定邮件到达 Cloudflare 后该交给谁处理。

### 推荐方案：配置 Catch-all 规则（强烈推荐）

Catch-all（捕获所有邮件）规则会接收所有发往该域名但未单独配置特定规则的邮件。配置后，无论后续在 FlareMail 界面添加多少个邮箱别名或成员，都**无需再次回到 Cloudflare 控制台添加规则**。

1. 在「路由规则」页面下方找到 **「Catch-all 规则 (Catch-all rule)」**。
2. 点击右侧的 **「编辑 (Edit)」**。
3. **操作 (Action)**：在下拉菜单中选择 **「发送到 Worker (Send to a Worker)」**。
4. **目标 Worker (Destination Worker)**：选择你部署的 FlareMail Worker（例如 `flaremail`）。
5. 保存并确保 Catch-all 状态开关为 **已启用 (Enabled)**。

### 备选方案：配置自定义地址规则（可选）

如果你不想接管整域，只想把指定的一个或几个固定邮箱（例如仅 `me@example.com`）交给 Worker：

1. 在「自定义地址 (Custom addresses)」区域点击 **「创建规则 (Create rule)」**。
2. **自定义地址**：输入具体前缀，如 `me`。
3. **操作 (Action)**：选择 **「发送到 Worker (Send to a Worker)」**。
4. **目标 Worker**：选择已部署的 FlareMail Worker。
5. 保存并启用规则。

---

## 第四步：在 FlareMail 系统中完成联动

Cloudflare 负责在公网边缘接信并派发给 Worker，FlareMail 负责验证收件人合法性并入库：

1. **登记邮箱域名**：
   - 登录 FlareMail 管理员后台。
   - 前往 **「系统设置」→「邮箱域名」**，点击添加，填入你的域名（例如 `example.com`）。
   - 在同一分区的独立策略卡片选择**未知收件地址策略**，该设置作用于全实例：
     - *拒收 (Reject)*：非系统内注册的邮箱地址将直接拒绝；
     - *丢弃 (Drop)*：默默丢弃未在系统内创建的前缀邮件；
     - *未匹配邮件区 (Unmatched)*：暂存到未匹配邮件区，可在系统设置中集中查阅。
2. **创建你的邮箱地址**：
   - 在 **「个人设置 → 邮箱与别名」** 添加自己的地址；为新成员创建主邮箱则到管理员 **「用户列表」**。确认前缀已存在（例如 `owner@example.com`）。

---

## 第五步：验证与排错

### 1. 发送测试邮件

- 使用你的**第三方外部邮箱**（例如个人 Gmail、QQ 邮箱等），向刚配置的邮箱地址发送一封测试邮件（主题如 `Test Mail`）。
- **请勿**从同域名下的其他 FlareMail 地址发信测试，避免内部投递逻辑跳过公网路由链路。
- 刷新 FlareMail 收件箱，或到「系统设置 → 邮件收发」使用带唯一主题的收信测试，验证外部来信是否入站。到达时间取决于外部服务和路由；网页可打开不代表收信已验证。

### 2. 收不到信时的排查流程（Stream Logs 实时日志）

如果外部邮箱已显示发送成功，但 FlareMail 收件箱迟迟未见新信，请按以下步骤快速定位：

1. **查看 Worker 实时流式日志 (Stream Logs)**：
   - 进入 Cloudflare 控制台 → **「Workers & Pages」**。
   - 点击你的 `flaremail` Worker，进入 **「Observability（可观察性）→ Logs」**；旧版控制台可能直接显示「日志」。
   - 打开实时日志流（如 **Live / Begin real-time stream**），确认日志已启用，并取消不相关过滤条件。
   - 保持日志窗口开启，再次从外部邮箱发一封测试邮件。
   - 观察控制台输出：
     - 若看到 `email` 事件输出，说明 Cloudflare Email Routing 已经成功将信件传递给 Worker。根据控制台报错（如 D1 写入异常、域名未在系统设置中添加、或被未知地址策略拦截）进行针对性排查。
     - 若**完全没有日志输出**，先核对日志开关、时间范围与过滤条件；日志缺失本身不能证明 Worker 没收到邮件。继续检查：
       - Cloudflare 的 Catch-all 规则是否已开启并正确绑定该 Worker；
       - DNS 记录中的 MX 记录是否已生效（可用终端命令 `nslookup -type=mx yourdomain.com` 检查）；
       - 域名在 Cloudflare 上的状态是否仍处于 Pending 或已被暂停。
2. **检查未匹配邮件**：
   - 如果发送到了未在 FlareMail 账号中创建的前缀，检查「系统设置」中的「未匹配邮件」列表。
3. **附件与大小限制**：
   - 单封邮件（包括正文和所有附件）总大小不得超过 25 MiB，超出会被 Cloudflare 边缘节点直接拦截退信。[平台限制](https://developers.cloudflare.com/email-service/platform/limits/)

---

## 转发到外部邮箱（可选）

如果你希望将收到的邮件同步自动抄送或转发到其他邮箱（如个人 Gmail）：

1. 先在 Cloudflare Email Routing 的 **「目标地址 (Destination Addresses)」** 添加并完成邮箱验证。
2. 在 FlareMail「个人设置 → 邮箱与别名」填写该目标地址，保存后开启转发，并核对主邮箱或别名自己的转发开关。
3. 用外部第三方邮箱发信测试，确认 FlareMail 收件箱与转发目标邮箱均能收到。

纯站内邮件也会按收件方设置转发：使用收件方已配置的发信通道及额度，以收件邮箱为发件人，Reply-To 指向原发件人，保留正文和附件、不带出密送名单。转发失败时原邮件保留在站内，并显示失败提示；外部来信沿用 Cloudflare Email Routing 转发路径。

> [!CAUTION] 转发循环保护
> 转发目标不能是当前实例管理的邮箱域名。FlareMail 内置了转发标记与循环检测保护，以防止邮件在多服务之间死循环。
