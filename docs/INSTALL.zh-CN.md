# 中文安装指南

这是非官方、只读工具。你需要自己的 Jupiter 学生账号、自己的 GitHub 私有仓库以及学校允许的使用方式。它不会替你提交作业，也不会勾选 Done 或修改 TickTick。

当前版本已准备独立部署流程，但**独立测试账号的首次真实登录尚未验证**。合成测试通过不能证明所有学校都可用；在完成自己的首次人工核验前，不要依赖它判断作业是否全部完成。

## 1. 建立自己的私有仓库

在可访问的模板页选择 **Use this template → Create a new repository**，选择自己的账号，并务必选择 **Private**；不要勾选 **Include all branches**。模板创建方式会建立新的历史，步骤可对照 [GitHub 官方指南](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)。不要 Fork 他人的私人生产仓库，不要复制其历史状态、密钥或任务映射。

如果模板仍处于私有测试阶段且你看不到按钮，等待维护者完成审核并提供访问方式；不需要索取其生产仓库权限。

## 2. 准备自己的配置

先在 Jupiter 中确认这几项文字：学生姓名、学校与地区、当前学年、学期名称、完整课程列表。课程名称和学期要与页面一致；不能只填其中一两门。

在 GitHub 仓库进入 **Settings → Secrets and variables → Actions → Secrets → New repository secret**，按[Secrets 指南](SECRETS.zh-CN.md)逐项添加五个 Secret。每位同学使用自己的加密密钥。不要把密码、密钥或填好后的配置发给维护者，也不要写入仓库文件。

## 3. 手动首次读取

1. 打开 **Actions**，在 GitHub 提示时允许该仓库使用 Actions。
2. 选择 **Student read → Run workflow**。
3. 保持默认分支，`mode` 选择 `initialize`，勾选 `confirm_initialization`，`trigger` 保持 `manual`。
4. 点击 **Run workflow**，等待该次运行结束。

首次初始化会登录自己的账号，核对身份与完整课程范围，再加密保存结果。它不能使用别人的快照，也不能覆盖已有状态。之后的手动运行使用 `read`，不要反复初始化。需要重新尝试时，等待冷却后使用新的 **Run workflow**，不要点击旧运行的 **Re-run jobs**；读取器拒绝重跑同一运行，以免绕过尝试次数保护。界面入口可对照 [GitHub 手动运行工作流指南](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。

查看运行摘要时，分别确认课程数、记录数、采集结果和加密保存回读结果；绿色运行图标本身不等于完整采集。日志只展示脱敏状态，课程、作业和成绩保存在加密状态内。

遇到 `required_configuration_missing` 请检查 Secret 名称；身份或课程不匹配时，先对照 Jupiter 界面检查配置。遇到维护、验证码、双因素或访问限制，请停止反复尝试；本工具不绕过这些限制。不要在 Issue 中粘贴完整日志、页面截图或账号配置。

## 4. 私下核对自己的内容

如需看作业明细，在自己的电脑安装项目要求的 Node.js，下载**自己的**仓库，执行 `npm ci` 和 `npm run build`。按[Secrets 指南](SECRETS.zh-CN.md)把所需环境值仅在本地安全设置，然后运行：

```sh
npm run export -- --output .private/export.json
```

这个文件含个人学业数据，只在自己的设备上打开。对照 Jupiter 检查课程、未评分作业、近期新增、真实日期证据和 To Do 覆盖情况。不要上传到仓库、公开网页或 Actions 附件。`.private` 被 Git 忽略不代表可以任意分享里面的文件。

已经私下下载 `sync-state` 分支的 `state.enc.json` 时，也可使用：

```sh
npm run export -- --encrypted-file /path/to/envelope.json --output .private/export.json
```

此方式不需要 GitHub Token，但仍需要自己的仓库名、账号范围配置和密钥。密钥丢失无法解密；更换账号、学年、学期或仓库不能通过删除状态来偷偷重置。

## 5. 开启定时读取

首次读取和内容核对成功后，进入 **Settings → Secrets and variables → Actions → Variables → New repository variable**，添加：

| Name | Value |
| --- | --- |
| `SYNC_ENABLED` | `true` |

示例业务时区是 `Asia/Shanghai`，周一至周五 11:45、17:20、20:50，周末 11:30、20:50；这些是示例使用时段，不是教师发布时间规律。你可以在自己的 `JUPITER_CONFIG` 中修改。

GitHub 每小时检查一次是否需要采集，因此这些时间是目标窗口，**不是分钟级执行承诺**。自然 schedule 可能延迟或漏触发。查看真正的采集时间，不要将运行创建时间当成数据更新时间。将 `SYNC_ENABLED` 设为 `false` 可暂停定时读取，已保存的数据仍保留。

## 6. 可选功能

**TickTick**：第一版只生成本地 JSON 建议文件，不连接账号、不创建或修改任务，也没有他人的任务映射。参见[支持与限制](SUPPORT.zh-CN.md)。

**Cloudflare**：属于可选高级配置，不是首次安装要求。每位同学需在自己的账户中部署提供的补采模板，使用只针对自己私有仓库的 GitHub 最小权限凭证，检查状态后触发同一个读取工作流。不要复制别人的 Worker、部署标识或凭证，也不要先启用高频定时再调试。具体步骤见[补采模板说明](../optional/cloudflare/README.md)。它使用已有运行历史保守协调，不使用额外数据库；不能保证调度请求恰好一次，读取器会继续核对排他执行、快照与登录预算。

**通知**：本模板未预启用自定义邮件或 GitHub Issue 告警。GitHub 自身的运行失败通知取决于你的通知设置；不能把配置完成或日志输出当作提醒实际送达。

## 使用边界

学校提交状态和成绩始终以 Jupiter 为准。已评分不代表已正式提交；来源记录不等于待执行学习任务；没有明确日期时保持未知。不要把导出的数据交给未经授权的第三方服务。工具不隶属于 Jupiter Ed，不保证适配所有学校；使用前确认学校规则和适用服务条款允许。
