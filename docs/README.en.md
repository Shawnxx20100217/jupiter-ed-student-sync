[中文首页](../README.md) · [Configuration examples](../config.example.json)

# Jupiter Ed Student Sync

Keep a private, encrypted history of your Jupiter courses, assignments and optional school calendar. Each read compares the school’s records with your previous snapshot. You can see a changed assignment date, keep a displayed grade exactly as written, and read a school announcement in its original wording.

**Try it offline.** Download the source, open its folder in a terminal and run `npm run demo` with Node.js 24. It works without installing dependencies. Two fictional assignments appear on the first scan. One changes date on the second. Reading them again reports zero changes. The demo also shows two school notices whose dates are known and times are unknown.

## Set up your own private copy

1. On the template page choose **Use this template → Create a new repository**. Select **Private** and leave **Include all branches** unchecked.
2. Open **Settings → Secrets and variables → Actions** in your copy. Add these **repository secrets** individually.

   | Secret | Value |
   | --- | --- |
   | `JUPITER_USERNAME` | Your own authorized Jupiter login name or ID |
   | `JUPITER_PASSWORD` | Your password |
   | `JUPITER_EXPECTED_NAME` | The exact student name displayed after login |
   | `JUPITER_CONFIG` | A JSON object based on [config.example.json](../config.example.json). Use your school, region, exact school year, term, full course list, IANA timezone and preferred reading windows. |
   | `JUPITER_STATE_KEY` | A unique 32-byte Base64 key. Generate one locally with `openssl rand -base64 32` and back it up in your password manager. |

3. To include calendar notices, add a repository **variable** named `CALENDAR_READ_ENABLED` with value `true`. It is off by default.
4. Choose **Actions → Student read → Run workflow**, choose `initialize`, check the initialization confirmation, and leave the trigger on `manual`. This requires an empty state. Use `read` for later runs.
5. On the run’s **Summary**, look for **Snapshot verified**. Check the course and record counts. When calendar reading is enabled, check its own status and month coverage. **Read skipped** means a new collection did not take place. For a failure, inspect the error code in the failed step. After a cooldown, start a new dispatch instead of re-running the old job.
6. After checking your first snapshot against Jupiter, set the repository variable `SYNC_ENABLED=true` to enable scheduled reads. GitHub checks hourly against your local time windows and delivery may be delayed. Set it to `false` to pause. An [optional Cloudflare watchdog](../optional/cloudflare/README.md) can request the same reader.

## Read your data

The private `sync-state` branch contains an AES-256-GCM encrypted `state.enc.json` and a small `health.json` with the time, sequence and verification flag. Detailed records are for local viewing. Download your own encrypted file and provide the same `GITHUB_REPOSITORY`, `JUPITER_CONFIG`, `JUPITER_USERNAME`, `JUPITER_EXPECTED_NAME` and `JUPITER_STATE_KEY` in your local environment. Use a new filename directly under `.private/` for each export.

```sh
npm run export -- --encrypted-file .private/state.enc.json --output .private/export.json
```

For an online export, omit `--encrypted-file` and supply a GitHub token with read access to your own repository contents. Downloading the ciphertext lets you export without that token. Keep plaintext exports, personal configuration and credentials out of public repositories, Issues and workflow artifacts. Restrict access to edit workflows in your private copy.

**Calendar.** The reader attempts a bounded range around today. Check actual month coverage in the snapshot. Notices with a verified date can share a daily summary. A calendar date alone supplies neither a submission deadline nor a time of day. A missing record is retained as history. Assignment dates and displayed grades keep their source evidence.

**Optional local TickTick preview.** Use `npm run ticktick:preview -- --input .private/export.json --output .private/proposal.json --project-id your-own-project-id` to inspect a proposal locally. The public edition does not publish tasks to TickTick or run an AI planner.

## Development and support

With Node.js 24, run `npm ci --ignore-scripts`, `npm run build`, `npm test` and `npm run audit:shareable`. GitHub’s **Synthetic safety checks** also runs a headless browser against fictional pages. A first real deployment with an independently authorized student account is still unverified. Page layouts and login requirements can differ by school.

This unofficial project is unaffiliated with Jupiter Ed. Use only your own authorized account and follow school rules and applicable terms. Respect login limits and interactive security checks. Upstream `jupiter-api` is copyright © 2022 Taj Jethwani-Keyser. Upstream and new code are MIT licensed. [License](../LICENSE) · [Attribution](../NOTICE.md) · [Security audit](SECURITY-AUDIT.md)
