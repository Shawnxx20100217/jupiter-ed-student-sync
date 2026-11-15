'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { inspect, forbiddenPath, audit } = require('../scripts/audit-shareable.cjs');

test('sensitive findings identify rules without exposing the matched value', () => {
  const secret = 'ghp_' + 'Q'.repeat(36);
  const result = inspect(Buffer.from(secret), 'fixture.txt');
  assert.equal(result[0].rule, 'github_token'); assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(inspect(Buffer.from('student-specific private marker'), 'fixture.txt', ['private marker'])[0].rule, 'private_denylist_match');
  assert.equal(inspect(Buffer.from('safe synthetic example'), 'example.txt').length, 0);
  assert.equal(inspect(Buffer.from([0, 8, 2]), 'fixture.dat')[0].rule, 'binary_not_allowed');
  const named = inspect(Buffer.from('safe content'), 'private marker.txt', ['private marker']);
  assert.equal(named[0].rule,'sensitive_filename');
  assert.equal(JSON.stringify(named).includes('private marker'),false);
});
test('state, credentials and production writers cannot enter the shareable tree', () => {
  for (const name of ['.env', 'credentials.json', 'snapshot.json', 'backup.enc', 'state.enc.json', 'health.json', 'reports/result.json', 'src/done-bridge.cjs', 'scripts/publish-ticktick-source.cjs']) assert.equal(forbiddenPath(name), true);
  for (const name of ['.env.example', 'config.example.json', 'src/state.cjs', 'src/persistence.cjs', 'LICENSE']) assert.equal(forbiddenPath(name), false);
});
test('deleted sensitive commits and unreachable blobs are still audited', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'student-sync-synthetic-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = args => cp.execFileSync('git', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-q']); git(['config', 'user.name', 'Synthetic Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  fs.writeFileSync(path.join(dir, 'file.txt'), 'removed private marker'); git(['add', '.']); git(['commit', '-qm', 'Synthetic fixture']);
  const secret = 'ghp_' + 'R'.repeat(36);
  cp.execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: secret });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'safe current content'); git(['add', '.']); git(['commit', '-qm', 'Synthetic replacement']);
  const result = audit(dir,{deny:['removed private marker']});
  assert.equal(result.commits, 2); assert.equal(result.ok, false);
  assert.ok(result.findings.some(x => x.rule === 'github_token'));
  assert.ok(result.findings.some(x => x.rule === 'private_denylist_match'));
  assert.equal(JSON.stringify(result).includes(secret), false);
});
test('credential-bearing or unsafe workflow patterns fail closed', () => {
  const filename='.github/workflows/fixture.yml';
  for(const value of ['pull_request_target:', 'permissions: write-all','secrets: inherit','runs-on: [self-hosted, linux]','uses: actions/upload-artifact@v4'])
    assert.equal(inspect(Buffer.from(value),filename).length,1);
  assert.equal(inspect(Buffer.from('permissions:\n  contents: write\nruns-on: ubuntu-latest'),filename).length,0);
});
