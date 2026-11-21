[← 回到中文安装指南](INSTALL.zh-CN.md)

# 账号、密钥与配置

每名学生独立建立私有仓库和密钥。模板不附带真实账号，也不会在缺少配置时退回任何已有生产账号。

## GitHub Secrets

位置：自己的仓库 **Settings → Secrets and variables → Actions → Secrets → New repository secret**。界面步骤已对照 [GitHub 官方 Secrets 指南](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。

| Secret | 如何填写 | 是否可以提交到代码 |
| --- | --- | --- |
| `JUPITER_USERNAME` | 自己有权使用的 Jupiter 登录名或 ID | 不可以 |
| `JUPITER_PASSWORD` | 自己的 Jupiter 密码 | 不可以 |
| `JUPITER_EXPECTED_NAME` | Jupiter 登录后显示的完整学生姓名 | 不可以 |
| `JUPITER_CONFIG` | 下方结构的 JSON，替换为自己的实际信息 | 不可以 |
| `JUPITER_STATE_KEY` | 独立生成的随机 32 字节 Base64 密钥 | 不可以 |

在自己电脑的终端执行以下命令可生成密钥。它只输出随机密钥，不访问任何服务；复制到 GitHub Secret 后，另外存入自己的密码管理器，不要发到聊天、日志或 Issue：

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

不要复用同学的密钥。无法从 GitHub Secret 页面取回明文；丢失密钥后，旧密文无法解密。

## `JUPITER_CONFIG` 的结构

仓库附有可复制的[完整 JSON 示例](../config.example.json)。下面的学校、课程和地区值也都是虚构配置，实际填写时要换成自己学校的数据。

```json
{
  "school": "Fictional Academy",
  "city": "Example City",
  "state": "Other",
  "expected_school_year": "2026-2027",
  "expected_term": "Q1",
  "expected_courses": ["Example Course One", "Example Course Two"],
  "timezone": "Asia/Shanghai",
  "schedule": {
    "weekdays": ["11:45", "17:20", "20:50"],
    "weekends": ["11:30", "20:50"]
  }
}
```

- `school` 和 `city` 填官方登录页要求的学校名称和城市。
- `state` 必须与地区选项的内部值完全一致，含大小写。显示文字与内部值可能不同。若不确定，可在本人 Jupiter 官方登录页手动选好地区，再用浏览器开发者工具的 **Elements / 元素** 面板查找 `input[name="region1"]`，核对它的值。只需该地区值，无需复制整张表单或提交登录。
- `expected_school_year`、`expected_term`：与已登录页面显示值一致，不从当前日期猜学年。
- `expected_courses`：完整、精确的课程名称列表，不依赖固定课程数量。
- `timezone`：IANA 时区名称，例如 `Asia/Shanghai`；不是 `UTC+8`。
- `schedule`：24 小时制业务时区目标窗口；避免密集轮询。
- 可选 `school_id`：只有已确认时才填写数字字符串。即使不填写，也必须从官方已认证的页面路由证明真实学校 ID；只有输入的学校名称不够。无法证明就停止保存。
- 学生预期姓名单独放入 `JUPITER_EXPECTED_NAME`，不用写在此 JSON 中。

账号、学校、学年、学期与仓库共同绑定加密状态。改变这些范围可能拒绝恢复，不能用重新初始化覆盖旧资料。需要更换学年或账号时，保留原私有仓库和密钥，另行规划迁移。

## 运行时变量

| 名称 | 来源 |
| --- | --- |
| `GITHUB_REPOSITORY` | GitHub Runner 自动提供当前 `owner/repository`，不用填其他人的仓库名 |
| `GITHUB_TOKEN` | GitHub 为当前运行自动提供，只用于此私有仓库的状态读写 |
| `SYNC_ENABLED` | Repository Variable，默认不启用；首次验证成功后设为 `true` |
| `CALENDAR_READ_ENABLED` | 可选 Repository Variable。设为 `true` 后，实际采集时也尝试读取 Calendar。留空或设为 `false` 可关闭校历读取 |

不要把密码放入 Variables；Variables 不是 Secrets。工作流所需的仓库内容写权限仅用于加密状态，不代表允许修改 Jupiter 或 TickTick。

## 本地导出

`npm run export` 读取当前终端环境中的 `JUPITER_CONFIG`、`JUPITER_USERNAME`、`JUPITER_EXPECTED_NAME`、`JUPITER_STATE_KEY`、`GITHUB_REPOSITORY`。在线读取加密分支时还需要只允许读取自己仓库内容的 `GITHUB_TOKEN`。可通过自己的密码管理器或系统安全环境工具注入这些变量；不要把明文写进命令历史或受 Git 跟踪的文件。

**用下载的密文在本地导出（Bash 示例）**。这条路线只需自己的配置和密钥，无需 Jupiter 密码或 GitHub Token。

1. 在电脑上进入项目目录。运行 `mkdir -p .private`，用文本编辑器将填入 Secret 的同一份配置 JSON 保存为 `.private/config.json`。将自己私有仓库 `sync-state` 分支中的 `state.enc.json` 下载到 `.private/state.enc.json`。
2. 在 **Bash** 中逐行执行下列命令。macOS 和 Linux 可以先运行 `bash`，Windows 可使用 Git Bash。先输入你自己的仓库全名，例如 `my-account/my-private-reader`。账号、姓名和密钥的输入会隐藏，按回车确认；密钥请从密码管理器取出。
3. 打开生成的 `.private/export.json`。每次导出用新文件名，避免覆盖上次保留的结果。

```bash
(
  read -r -p 'Your GitHub owner/repository: ' GITHUB_REPOSITORY
  read -r -s -p 'Jupiter login: ' JUPITER_USERNAME; echo
  read -r -s -p 'Student display name: ' JUPITER_EXPECTED_NAME; echo
  read -r -s -p 'State key: ' JUPITER_STATE_KEY; echo
  JUPITER_CONFIG="$(cat .private/config.json)"
  export GITHUB_REPOSITORY JUPITER_USERNAME JUPITER_EXPECTED_NAME JUPITER_STATE_KEY JUPITER_CONFIG
  npm run export -- --encrypted-file .private/state.enc.json --output .private/export.json
)
```

括号内运行结束后，这组环境值随子进程退出。`.private/` 中的配置和导出只供本人使用，不要上传或分享。

## 可选 Cloudflare

每人独立部署。只将自己仓库所需的最小 GitHub 调度凭证放入 Cloudflare Secret：Actions 读写用于检查/触发原读取器，Contents 只读用于读取脱敏健康状态。权限用途可对照 [GitHub 工作流 API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event) 和[内容读取 API](https://docs.github.com/en/rest/repos/contents#get-repository-content)。Cloudflare 不需要 Jupiter 密码、加密密钥、学生姓名或明文作业。不要授予所有仓库权限；不要将 Token 放到普通变量或分享截图中。

模板不会代替你创建账号、批准权限、启用 Worker 或购买服务。初次部署可以完全不使用 Cloudflare。
