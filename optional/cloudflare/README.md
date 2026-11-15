# Optional watchdog / 可选补采

This is an opt-in template, not a deployed service. It never logs into Jupiter or writes TickTick.

首次 GitHub 只读初始化成功且本人核对内容后，才考虑使用。每位学生用自己的 Cloudflare 账户；不要复制他人的 Worker 或访问凭证。

1. 复制 `wrangler.example.toml` 为本目录的 `wrangler.toml`（勿提交真实配置），填自己的私有仓库、与 `JUPITER_CONFIG` 完全相同的时区和时段。Worker 名称自行选择。
2. 在 GitHub 创建仅限自己的目标仓库的 fine-grained token：Contents 只读、Actions 读写、Metadata 只读，选较短有效期。先在本目录通过官方 Wrangler 登录自己的 Cloudflare 账户，保持 `WATCHDOG_ENABLED=false` 和空 Cron，部署代码。
3. 使用 `npx wrangler secret put GITHUB_WATCHDOG_TOKEN`，按提示私下粘贴 Token；或在自己的 Worker **Settings → Variables and Secrets → Add** 中选择 **Secret**，填写名称和值后点击 **Deploy**。保存 Secret 也会部署新版本，所以仍须保持关闭开关和空 Cron。不要写入普通变量或发到聊天。步骤参照 [Cloudflare Secrets 官方说明](https://developers.cloudflare.com/workers/configuration/secrets/)。
4. 本人确认后设置 `WATCHDOG_ENABLED=true`，Cron 改为唯一的 `*/15 * * * *` 并部署；GitHub 的 `SYNC_ENABLED` 也须为 `true`。
5. 查看真实 Cron 日志。`dispatch_accepted_not_collection_success` 只表示 GitHub 接受补采请求，成功以 GitHub 读取器的新加密快照和回读为准。

Cron 表达式使用 UTC；`*/15 * * * *` 只是每 15 分钟检查一次，实际目标时段由 `BUSINESS_TIMEZONE` 和 `WATCHDOG_SCHEDULE` 判断。使用 Wrangler 管理此 Worker 时，也通过配置文件管理 Cron，不与控制台反复交替修改。[Cloudflare Cron 官方说明](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

超出最近目标窗口两小时且未覆盖时才补采；GitHub 有排队/执行中的读取器时跳过。每小时最多一次调度请求、每目标窗口最多两次、滚动一天最多四次；读取器另有一小时登录冷却和每日六次预算。同一 GitHub 工作流的排他执行和状态 CAS 保留。缺少或损坏健康数据时安全失败，不自动初始化、不绕过限制。

多 Worker 实例可能在 GitHub 尚未展示新运行的短暂间隙发出重复 dispatch；现有 GitHub 排他执行、完成快照检查及登录预算阻止重复登录/状态覆盖。这里不承诺恰好一次的调度请求，也不新增锁数据库。只部署一个 Worker 和一个 Cron。

暂停时将 Worker 开关设为 false 并取消 Cron；同时 `SYNC_ENABLED=false` 会让 watchdog 请求在读取器中跳过。此模板不附带个人生产系统的 Issue/邮件规则，不宣称通知已启用。Worker 权限不足、过期或 GitHub 不可用时会记录脱敏失败，需要自己检查平台日志。

[Cloudflare Cron 文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [GitHub fine-grained token 文档](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
