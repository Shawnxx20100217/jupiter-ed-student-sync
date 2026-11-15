'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {preview}=require('../scripts/ticktick-preview.cjs');
const {writePrivate}=require('../scripts/private-file.cjs');
const {fixture}=require('./helpers/synthetic-state.cjs');
test('optional adapter is a local source preview, without creating tasks or inferring completion and dates',()=>{
 const state=fixture().state();state.tasks[0].presence='not_observed';const before=JSON.stringify(state);
 const result=preview({schema:'jupiter-student-export.v1',state},'synthetic-project-id');
 assert.equal(result.write_enabled,false);assert.equal(result.network_requests,0);assert.equal(result.records.length,2);assert.equal(JSON.stringify(state),before);
 for(const row of result.records){assert.equal(row.task_action,'none');assert.equal(row.personal_due_date,null);assert.equal(row.personal_completion,null);assert.equal(row.source_evidence.date_evidence.precision,'unknown');}
 assert.throws(()=>preview({schema:'unrecognized',state},'synthetic-project-id'),/preview_input_invalid/);
});
test('private local exports enforce location, file exclusivity, permissions and no Actions plaintext export',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-private-export-')),previous=process.cwd(),actions=process.env.GITHUB_ACTIONS;
 t.after(async()=>{process.chdir(previous);if(actions===undefined)delete process.env.GITHUB_ACTIONS;else process.env.GITHUB_ACTIONS=actions;await fs.rm(root,{recursive:true,force:true});});
 process.chdir(root);delete process.env.GITHUB_ACTIONS;
 await assert.rejects(writePrivate('outside.json',{}),/output_must_be_private_directory/);
 await writePrivate('.private/export.json',{example:true});
 assert.equal((await fs.stat('.private')).mode&0o777,0o700);assert.equal((await fs.stat('.private/export.json')).mode&0o777,0o600);
 await assert.rejects(writePrivate('.private/export.json',{changed:true}),{code:'EEXIST'});
 await fs.symlink(path.join(root,'outside.json'),'.private/symlink.json');await assert.rejects(writePrivate('.private/symlink.json',{}),{code:'EEXIST'});
 process.env.GITHUB_ACTIONS='true';await assert.rejects(writePrivate('.private/new.json',{}),/local_export_only/);
 delete process.env.GITHUB_ACTIONS;await fs.rename('.private','protected');await fs.symlink(path.join(root,'protected'),'.private');await assert.rejects(writePrivate('.private/new.json',{}),/private_directory_symlink_rejected/);
});
