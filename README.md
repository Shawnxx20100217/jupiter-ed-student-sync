# Jupiter Ed Student Sync

An **unofficial, read-only** Jupiter Ed student data reader for an independently owned **private** GitHub repository. Each student supplies their own account, expected identity, school configuration, and encryption key. No account, sample student record, or production state is included.

This repository is a **source-only GitHub Template** for independently owned private deployments. Synthetic tests do not establish that a new school or account works: first deployment with a separately authorized test account is **not yet verified**. Do not publish student repositories or use another student's credentials.

**[中文安装指南](docs/INSTALL.zh-CN.md)** · [Secrets 设置](docs/SECRETS.zh-CN.md) · [支持与限制](docs/SUPPORT.zh-CN.md) · [安全审核](docs/SECURITY-AUDIT.md)

## What it does

- Reads supported student course, assignment, category, displayed grade, and To Do views using the existing TypeScript/Puppeteer reader.
- Checks the authenticated student, school, year, term, and exact configured course set before accepting a complete scan.
- Preserves raw grades and raw date text. An uncertain year, due time, or completion status remains uncertain.
- Uses numeric Jupiter assignment IDs within the account/school/year/term/course scope; detects source additions and changes without title matching.
- Stores an authenticated encrypted snapshot in the private repository's `sync-state` branch, with conflict checks and encrypted readback.
- Retains previously seen records that disappear from a scan; it does not interpret absence as deletion.
- Exports decrypted JSON only to a private local output path. An optional local TickTick proposal command produces JSON without calling TickTick.

It does **not** change Jupiter Done, grades, uploads, or submissions; write to TickTick; generate a study plan; send student records to an AI provider; or calculate an official GPA. A gradebook entry is not automatically a homework task.

## First deployment

1. Sign in to GitHub, then choose **Use this template → Create a new repository → Private**. Use your own account, not somebody else's production repository. Do not include all branches.
2. Add the five repository Secrets listed below. Create a unique encryption key for this repository. Do not commit filled-in configuration.
3. Open **Actions → Student read → Run workflow**. Choose `initialize`, check `confirm_initialization`, then run once. Initialization requires an empty state; it cannot reset existing data.
4. Check the successful read and encrypted-save summary. Logs show counts and error codes, not assignments or grades. Follow the Chinese guide to export your own data privately if you need to verify details.
5. Only after verifying the first read, add repository variable `SYNC_ENABLED=true`. Until then, scheduled reads are disabled.

Required Secrets:

| Name | Your value |
| --- | --- |
| `JUPITER_USERNAME` | Your authorized Jupiter login name or ID |
| `JUPITER_PASSWORD` | Your password |
| `JUPITER_EXPECTED_NAME` | Exact student name displayed by Jupiter |
| `JUPITER_CONFIG` | Your school, year, term, course list, timezone, and schedule JSON |
| `JUPITER_STATE_KEY` | A unique random 32-byte key encoded as Base64 |

`GITHUB_REPOSITORY` comes from your runner. `GITHUB_TOKEN` is supplied by GitHub for that run. No copied account or repository fallback is used. Missing credentials fail safely before login. See [the configuration guide](docs/SECRETS.zh-CN.md) for exact fields.

Never put passwords, filled-in configuration, decrypted exports, grades, or assignments in a public repository. This template contains no student Secrets or data, and its own scheduled collection is disabled. Real collection also refuses a public deployment repository. The first version provides read-only collection and encrypted storage, **not a complete TickTick synchronization service or an AI study planner**.

## Schedule and privacy

The GitHub schedule checks hourly; configured business-timezone windows determine whether a new read is due. GitHub scheduling can be late or missed and is not a guarantee of exact delivery. Overlapping runs use the existing concurrency and state checks. An [optional Cloudflare watchdog](optional/cloudflare/README.md) can dispatch the **same** reader; it is not required for first deployment and must be separately configured by each student. It receives only private health metadata and a repository-scoped GitHub token, never a Jupiter password or decrypted student data. It uses conservative GitHub run-history checks, not a database-backed exactly-once dispatch guarantee; the reader still checks its lock, freshness, and login budget. No custom email or Issue alert channel is pre-enabled.

The state file is `sync-state:state.enc.json`, encrypted with AES-256-GCM and bound to your repository and account configuration. The same private branch has a `health.json` containing only its schema, last successful collection time, sequence, and verification flag. Encryption does not hide ciphertext size, repository commit metadata, or update times from repository readers. Anyone who can alter your workflow code may attempt to obtain its Secrets: restrict collaborators and review changes before running them. Do not upload decrypted exports as Actions artifacts, commit them, or share workflow logs containing personal information.

## Local commands

Use Node.js 24 and the pinned dependencies:

```sh
npm ci
npm run build
npm test
npm run audit:shareable
```

Export your own encrypted state with the necessary environment values set locally, without printing them:

```sh
npm run export -- --output .private/export.json
```

For an already downloaded encrypted envelope, add `--encrypted-file /path/to/envelope.json`. This avoids the GitHub API but still requires the correct encryption key, repository, and account scope. The resulting JSON contains personal academic information.

Optional **local-only** TickTick proposal:

```sh
npm run ticktick:preview -- --input .private/export.json --output .private/ticktick-proposal.json --project-id your-own-project-id
```

This writes a proposal file, not a TickTick task. No TickTick credentials or network client are included.

## Responsible use and license

This project is not affiliated with Jupiter Ed. Use only accounts and data you are authorized to access. Follow your school's rules and applicable service terms; do not bypass CAPTCHA, multifactor authentication, access controls, or rate limits. Avoid frequent polling. Different schools and Jupiter configurations may require changes, and support is not guaranteed.

Upstream `jupiter-api` is MIT licensed, copyright © 2022 Taj Jethwani-Keyser. New code is MIT licensed, copyright © 2026 Jupiter Ed Student Sync contributors. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
