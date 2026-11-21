[← 项目首页](../README.md) · [填写 Secrets](SECRETS.zh-CN.md) · [支持哪些数据](SUPPORT.zh-CN.md)

# 用自己的账号读取 Jupiter

安装完成后，你可以在自己的 GitHub 私有仓库里看到**上次读取时间、课程数和作业记录数**，并在自己的电脑上解密查看明细。运行定时读取时，电脑可以关机。

**想先看效果？** 在装有 Node.js 24 的电脑上，下载项目源码，在含 `package.json` 的目录打开终端。运行下面的演示，用虚构数据看一次作业变化。这个步骤无需 Jupiter 账号。

```sh
npm run demo
```

要读取自己的数据，请从下面第 1 步开始。你需要一个 GitHub 账号、自己有权使用的 Jupiter 学生账号，以及学校允许的自动读取方式。**目前独立学生账号的首次部署仍待真实验证**，不同学校的页面可能有差异。

## 1. 创建自己的私有仓库

在模板首页点 **Use this template → Create a new repository**。在 **Owner** 里选自己，填入自选仓库名，选择 **Private**，保留 **Include all branches** 为未勾选，然后点 **Create repository**。看到新仓库名称旁的 **Private** 标记后，后续操作都在这个副本里做。

想先检查 GitHub 环境，可以在副本的 **Actions → Synthetic safety checks → Run workflow** 运行一次自检。它使用合成页面和测试数据，无需填写 Secrets。

## 2. 填入 5 个 Secrets

先用浏览器正常登录 Jupiter，核对学生姓名、学校、学年、学期和**完整课程列表**。在自己的 GitHub 仓库打开 **Settings → Secrets and variables → Actions → Secrets → New repository secret**，每项单独保存。

| Name | Secret 应填什么 |
| --- | --- |
| `JUPITER_USERNAME` | 自己登录 Jupiter 用的账号或 ID |
| `JUPITER_PASSWORD` | 自己的密码 |
| `JUPITER_EXPECTED_NAME` | Jupiter 登录后显示的完整学生姓名 |
| `JUPITER_CONFIG` | 自己学校和课程的 JSON 配置 |
| `JUPITER_STATE_KEY` | 自己生成并备份的加密密钥 |

[配置指南](SECRETS.zh-CN.md)里有 JSON 示例和密钥生成命令。把真实配置填到 **Secret** 输入框里；仓库里的示例文件可保持原样。把密钥和填好的配置另存一份到自己的密码管理器，之后在电脑上查看明细时会用到。

## 3. 做第一次读取

1. 打开 **Actions**。若 GitHub 提示启用工作流，先在自己的私有仓库允许使用 Actions。
2. 左栏选 **Student read**，点 **Run workflow**。分支保持默认，模式选 **initialize**，勾选初始化确认框，触发方式保留 **manual**。
3. 提交后打开刚创建的运行。摘要中的 **Snapshot verified** 表示快照已通过验证。想核查具体结果，点 **read → Collect validated student data**，查看最后一条输出。

| 看到什么 | 该如何判断 |
| --- | --- |
| `"status":"verified"`、`"actual_read":true`、`"encrypted_readback_verified":true` | 本次确实读取了 Jupiter，也核验了从 GitHub 读回的加密结果 |
| `courses`、`current_assignments` | 核对课程数和本次读取的来源记录数。记录可能包含已经评分的历史项目 |
| `sequence`、`last_success_at` | 记录这次快照的序号和采集时间。时间末尾的 `Z` 表示 UTC |

初始化成功后，仓库的分支选择器中会出现 **sync-state**。里面的 `state.enc.json` 是密文，`health.json` 提供最近一次成功采集的概要。下次手动运行选择 **read**。

## 4. 查看自己的作业明细

这一步在自己的电脑上完成。在本地打开项目目录，使用 Node.js 24 执行 `npm ci` 和 `npm run build`。按[本地导出所需环境值](SECRETS.zh-CN.md#本地导出)填好与云端相同的配置。

最少权限的方式是打开私有仓库的 **sync-state** 分支，下载 `state.enc.json` 的原始文件。把命令中的路径替换成实际下载路径后运行。

```sh
npm run export -- --encrypted-file "/path/to/state.enc.json" --output .private/export.json
```

这个命令在本地解密，无需 Jupiter 密码或 GitHub Token。用文本编辑器打开生成的 `.private/export.json`，挑一门熟悉的课，对照 Jupiter 核对一项作业、原始成绩或日期。导出文件包含明文学业数据，请留在自己的设备上。再次导出时换一个新的文件名，程序会拒绝覆盖旧导出。

## 5. 核对通过后，开启定时读取

打开 **Settings → Secrets and variables → Actions → Variables → New repository variable**，名称填 `SYNC_ENABLED`，值填 `true`。以后将值改为 `false` 就可以暂停定时读取并保留已经保存的数据。

GitHub 每小时检查一次，由 `JUPITER_CONFIG` 中的时区、工作日和周末时段决定是否需要登录。例如设置目标时间 11:45，程序会在该时段之后的合适运行中读取；GitHub 可能延迟触发。需要确认更新时间时，看 `last_success_at`。

## 可选：读取学校日历

如果你的 Jupiter 账号有 **Calendar** 页面，可在同一处 **Variables** 添加 `CALENDAR_READ_ENABLED`，值填 `true`。默认关闭。下一次实际读取作业时，程序会在同一登录会话中尝试读取日历。已经初始化的仓库继续使用 **read**。

日历的目标范围从最近两周到未来八周，实际覆盖取决于你学校的页面。校历与作业共用加密快照和密钥。用第 4 步的方法打开导出文件后，可按以下顺序看：

| 在导出文件的 `state` 中查找 | 如何使用 |
| --- | --- |
| `calendar_collection_status.status` 和 `calendar_events.coverage` | 先确认这次校历状态，再核对每月覆盖。如果校历读取失败，已保存的公告只能用作历史参考。旧版作业快照可能没有这些字段 |
| `calendar_date_summaries.records` | 每条的 `observed.date` 是来源日期，`observed.items` 是当天公告。若标为 `stale: true`，说明这条是保留的历史观察 |
| `calendar_events.assignment_links` | 用于对照关联的 Jupiter 作业。日历上的日期本身不能证明作业的截止日期 |

只显示日期的公告只能说明当天有相关安排，不据此推断考试钟点或认定全天停课。独立学生账号的真实校历读取仍待验证。

## 遇到卡点

| 运行中看到 | 建议操作 |
| --- | --- |
| `required_configuration_missing` / `config_invalid` | 对照第 2 步检查 Secret 名称和内容。JSON 请用英文双引号，最后一个字段后不加逗号 |
| `initialization_required` / `state_already_initialized` | 前者表示第一次要选 **initialize** 并勾选确认框。后者表示已经初始化，请改选 **read** |
| 采集步骤显示 **Skipped** | 展开前面的 **Check initialization, snapshot freshness and login budget** 看原因。`window_already_covered` 表示该时段已有成功快照。`login_cooldown` / `daily_login_budget` 表示暂缓登录，等待下一次允许的时段 |
| `identity_mismatch` / `course_term_mismatch` | 对照在 Jupiter 看到的姓名、学年、学期和完整课程名称。如果仍不一致，暂停定时读取，保留旧快照 |
| `upstream_maintenance` / `interactive_verification_required` | 维护时等官网恢复；需要验证码或二次验证时，在 Jupiter 官方页面处理 |
| `rerun_requires_new_dispatch` | 修正配置后用 **Run workflow** 开始一次新的运行。旧运行页的 **Re-run jobs** 会被拒绝 |

需要求助时，可以提供错误代码和失败步骤名称。请勿在公开 Issue 中附上姓名、账号、配置、成绩、课程截图或完整日志。

第一版支持读取和加密保存。对 TickTick 的支持限于本地 JSON 预览，AI 规划、作业提交、Done 回写和成绩修改均不在功能范围内。[功能边界](SUPPORT.zh-CN.md) · [可选的 Cloudflare 调度](../optional/cloudflare/README.md)

## 已经用过旧版模板？

GitHub 从模板创建的私有仓库有独立历史。要在原来的副本试用校历，先下载新版模板源码，在自己副本的代码分支比较并合入新版程序与工作流（包括 `.github/workflows/student-read.yml`）。保留自己的配置改动、仓库名称、Secrets 和 `sync-state` 分支，合入前可以先在私有分支检查差异。请勿把自己的仓库或状态发回公开模板。

已初始化的副本直接选 **read**。旧加密快照可以继续使用，下一次有效读取时才会增加校历数据。要试读校历，在自己的副本设置 `CALENDAR_READ_ENABLED=true`。
