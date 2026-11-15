'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {inspect}=require('../scripts/audit-shareable.cjs');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'.github/workflows',name),'utf8');
test('synthetic CI has no account secrets or school collection entrypoint',()=>{
  const ci=read('ci.yml');
  assert.doesNotMatch(ci,/\$\{\{\s*secrets\.|JUPITER_PASSWORD|node src\/run\.cjs\s*$/m);
  assert.match(ci,/permissions:\s*\n\s+contents: read/);
  assert.match(ci,/npm test/);assert.match(ci,/required_configuration_missing/);
});
test('reader deploy requires explicit initialization and opt-in schedule with no writable task adapter',()=>{
  const workflow=read('student-read.yml');
  assert.match(workflow,/options: \[read, initialize\]/);
  assert.match(workflow,/confirm_initialization:[\s\S]*?default: false/);
  assert.match(workflow,/vars\.SYNC_ENABLED == 'true'/);
  assert.match(workflow,/concurrency:[\s\S]*?group: student-source-state[\s\S]*?cancel-in-progress: false/);
  assert.match(workflow,/permissions:\s*\{\}/);
  assert.match(workflow,/actions: read/);
  assert.match(workflow,/steps\.gate\.outputs\.allowed == 'true'/);
  assert.doesNotMatch(workflow,/ticktick|done-bridge|publish-ticktick|upload-artifact/i);
  const secretAssignments=[...workflow.matchAll(/JUPITER_PASSWORD:/g)];assert.equal(secretAssignments.length,1);
  assert.ok(workflow.indexOf('JUPITER_'+'PASSWORD:')>workflow.indexOf('name: Collect validated student data'));
});
test('all workflow actions are immutable pins and sharing audit rejects unsafe policies',()=>{
  for(const name of fs.readdirSync(path.join(root,'.github/workflows')).filter(n=>/\.ya?ml$/.test(n))){
    const workflow=read(name);
    assert.deepEqual(inspect(Buffer.from(workflow),`.github/workflows/${name}`),[]);
    for(const match of workflow.matchAll(/uses:\s*([^\s#]+)/g))assert.match(match[1],/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
    assert.match(workflow,/persist-credentials: false/);
    assert.match(workflow,/npm ci --ignore-scripts/);
  }
});
