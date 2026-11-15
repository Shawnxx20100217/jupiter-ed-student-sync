#!/usr/bin/env node
'use strict';
// Audits the shareable tree and every local Git blob/commit, including unreachable
// objects. It prints rule names and relative locations, never matching values.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const LIMIT = 2 * 1024 * 1024;
const IGNORED = new Set(['.git', 'node_modules', 'dist', '.private', '.cache']);
const forbiddenPath = name => /(^|\/)(?:\.env(?!\.example$)|[^/]*\.(?:pem|key|p12|pfx|enc|sqlite|db|zip|png|jpe?g|pdf)|[^/]*\.enc\.json|(?:cookies?|credentials?|session|storage-state|snapshot|checkpoint|mapping|source-state|publication-state|health)\.json)$/i.test(name) ||
  /(^|\/)(?:reports|receipts|browser-profile|canary|private-data)(\/|$)/i.test(name) ||
  /(^|\/)(?:publish-ticktick-source|ticktick-publisher|sync-personal-completion|done-bridge|ticktick-canary|local-source-handoff)\.(?:cjs|mjs|py|json)$/i.test(name);
const rules = [
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['jwt_token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['credential_literal', /\b(?:JUPITER_(?:USERNAME|PASSWORD|EXPECTED_NAME|STATE_KEY)|TICKTICK_TOKEN|CLOUDFLARE_API_TOKEN|GITHUB_TOKEN)\s*[:=]\s*["'](?!\$\{|YOUR_|REPLACE_|EXAMPLE_|synthetic|test-|<)([^\r\n"']{3,})["']/],
  ['browser_session_dump', /["'](?:cookies|origins)["']\s*:\s*\[\s*\{[\s\S]{0,300}["'](?:domain|expires|localStorage|httpOnly)["']\s*:/],
  ['local_user_path', /\/(?:Users|home)\/(?!runner(?:\/|\b)|example(?:\/|\b)|student(?:\/|\b))[A-Za-z0-9_.-]+\//],
];
function decode(buffer) { try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return null; } }
function privateLocation(location, deny) {
  return deny.some(value => location.toLocaleLowerCase().includes(value.toLocaleLowerCase())) || rules.some(([, expression]) => expression.test(location));
}
function safeLocation(location, deny) {
  return privateLocation(location, deny) ? `redacted-path:${createHash('sha256').update(location).digest('hex').slice(0, 12)}` : location;
}
function inspect(buffer, location, deny = []) {
  const hits = [], originalLocation = location;
  location = safeLocation(location, deny);
  if (privateLocation(originalLocation, deny)) hits.push({location, rule:'sensitive_filename'});
  if (buffer.length > LIMIT) return [{ location, rule: 'oversized_shareable_file' }];
  const text = decode(buffer);
  if (text === null || buffer.includes(0)) return [{ location, rule: 'binary_not_allowed' }];
  for (const [name, expression] of rules) if (expression.test(text)) hits.push({ location, rule: name });
  for (const value of deny) if (text.toLocaleLowerCase().includes(value.toLocaleLowerCase())) {
    hits.push({ location, rule: 'private_denylist_match' }); break;
  }
  if (/(?:^|:)\.github\/workflows\/[^/]+\.ya?ml$/.test(originalLocation)) {
    for (const [name, pattern] of [
      ['unsafe_workflow_event', /\bpull_request_target\s*:/],
      ['unsafe_workflow_permissions', /\bpermissions\s*:\s*write-all\b/],
      ['unsafe_workflow_secret_inheritance', /\bsecrets\s*:\s*inherit\b/],
      ['unsafe_workflow_runner', /\bruns-on\s*:[^\n]*\bself-hosted\b/],
      ['plaintext_artifact_upload_not_allowed', /\buses\s*:\s*actions\/upload-artifact@/],
    ]) if (pattern.test(text)) hits.push({location, rule:name});
  }
  return hits;
}
function collectFiles(root, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const name = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) { result.push({ name, symlink: true }); continue; }
    if (entry.isDirectory()) result.push(...collectFiles(root, name));
    else if (entry.isFile()) result.push({ name });
  }
  return result;
}
function git(root, args) { return cp.execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }); }
function audit(root, { sourceOnly = false, deny = [] } = {}) {
  root = fs.realpathSync(root);
  const findings = [], files = collectFiles(root);
  for (const file of files) {
    if (file.symlink) { findings.push({ location: file.name, rule: 'symlink_not_allowed' }); continue; }
    if (forbiddenPath(file.name)) findings.push({ location: file.name, rule: 'private_or_write_only_path' });
    findings.push(...inspect(fs.readFileSync(path.join(root, file.name)), file.name, deny));
  }
  let objects = 0, commits = 0;
  if (!sourceOnly) {
    let rows;
    try { rows = git(root, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype) %(objectsize)']).toString().trim().split('\n').filter(Boolean); }
    catch { throw new Error('git_history_required'); }
    const names = new Map();
    for (const line of git(root, ['rev-list', '--objects', '--all']).toString().split('\n')) {
      const m = line.match(/^([a-f0-9]{40,64}) (.+)$/); if (m) names.set(m[1], m[2]);
    }
    for (const row of rows) {
      const [oid, type, bytes] = row.split(' ');
      if (!/^[a-f0-9]{40,64}$/.test(oid)) throw new Error('git_object_invalid');
      if (!['blob', 'commit'].includes(type)) continue;
      objects++; if (type === 'commit') commits++;
      const name = names.get(oid), location = `git:${oid.slice(0, 12)}${name ? ':' + name : ''}`;
      if (name && forbiddenPath(name)) findings.push({ location, rule: 'private_or_write_only_history_path' });
      if (Number(bytes) > LIMIT) { findings.push({ location, rule: 'oversized_git_object' }); continue; }
      findings.push(...inspect(git(root, ['cat-file', '-p', oid]), location, deny));
    }
    if (!commits) findings.push({ location: 'git', rule: 'no_auditable_commits' });
  }
  return { ok: findings.length === 0, source_files: files.length, git_objects: objects, commits,
    history_scanned: !sourceOnly, external_private_denylist_loaded: deny.length > 0,
    excluded_runtime_directories: [...IGNORED].filter(x => x !== '.git'),
    findings: findings.map(finding => ({...finding,location:safeLocation(finding.location,deny)})) };
}
function main(argv = process.argv.slice(2)) {
  let sourceOnly = false, denyFile = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source-only') sourceOnly = true;
    else if (argv[i] === '--deny-file' && argv[i + 1]) denyFile = argv[++i];
    else throw new Error('invalid_audit_option');
  }
  const root = fs.realpathSync(path.resolve(__dirname, '..')); let deny = [];
  if (denyFile) {
    const file = fs.realpathSync(denyFile);
    if (file === root || file.startsWith(root + path.sep)) throw new Error('denylist_must_be_outside_template');
    deny = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(deny) || deny.some(x => typeof x !== 'string' || x.trim().length < 4) || deny.length > 10000) throw new Error('denylist_invalid');
  }
  const result = audit(root, { sourceOnly, deny });
  console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
}
module.exports = { inspect, forbiddenPath, audit };
if (require.main === module) { try { main(); } catch { console.error('shareable_audit_failed'); process.exitCode = 1; } }
