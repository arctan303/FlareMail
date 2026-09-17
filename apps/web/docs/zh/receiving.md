# 收信配置

收信由 Cloudflare Email Routing 将来信交给 FlareMail Worker，再按收件地址保存到对应用户。应用内添加域名和邮箱，不会自动创建公网邮件路由。

## 启用域名路由

1. 在 Cloudflare Email Service → Email Routing 中选择你的邮箱域名并启用路由，按平台要求添加 DNS 记录。
2. 查看域名的 Routing Rules，创建地址规则，将操作设为发送到 Worker，并选择已部署的 FlareMail Worker。
3. 如果需要所有别名都交给应用处理，可将 Catch-all 规则指向同一个 Worker；已有单独规则也应核对目标，避免绕过它。
4. 在 FlareMail 的系统设置 → 邮箱域名登记该域名，并在个人设置或用户列表创建实际使用的邮箱地址。

DNS 传播需要时间。不要直接照抄他人的 MX/SPF 值，以控制台生成的记录为准。如果该域名已有其他邮件服务，先核对原有 MX 和用途，再调整路由。[Cloudflare 路由指南](https://developers.cloudflare.com/email-service/get-started/route-emails/)

## 已有地址与未知地址

已创建的主邮箱和别名会收到对应地址的来信。Catch-all 只决定邮件是否交给 Worker，不意味着应用自动创建账号。

系统设置 → 邮箱域名可选择未知收件地址的处理方式：拒收、丢弃或进入未匹配邮件区。暂存处理还受接收未知地址的开关控制；正常收件箱不会汇总其他成员或未匹配邮件。按需要配置，默认不要把未知地址当成新成员。

## 转发到外部邮箱（可选）

1. 先在 Cloudflare Email Routing 的 Destination Addresses 添加并验证目标邮箱。
2. 在 FlareMail 个人设置填写目标，保存后开启转发，并核对各邮箱地址的转发开关。
3. 用外部邮箱发一封测试邮件，检查 FlareMail 收件箱和转发目标。

目标不能是当前实例管理的邮箱域名。转发失败不等于原来信未保存；先检查目标验证、开关与 Worker 日志。

## 检查与排错

- 从外部邮箱发送到已创建地址，确认收件箱出现新信件；子邮箱可用顶部邮箱选择框筛选。
- 完全没有 Worker 收信记录：检查 DNS、地址规则/Catch-all 目标及路由状态。
- Worker 已收到但应用没有显示：检查收件地址、邮箱是否已删除、收信开关、过滤规则与未知地址策略。
- 复杂邮件处理受 Workers CPU/内存及平台邮件大小限制影响，失败时检查 Worker 日志；不要假定免费计划能处理任意邮件。[平台限制](https://developers.cloudflare.com/email-service/platform/limits/)

日志可能包含私人信息，求助时只分享脱敏错误与配置名称。
