'use strict';
// Local JSON preview only. No HTTP client, token, remote project listing or task writes.
const fs=require('node:fs/promises');
const {SCHEMA}=require('../src/state.cjs');
const {writePrivate,argument}=require('./private-file.cjs');
function preview(input,project){
  if(input?.schema!=='jupiter-student-export.v1'||input.state?.schema!==SCHEMA||!Array.isArray(input.state.tasks)||typeof project!=='string'||!project.trim())throw Error('preview_input_invalid');
  return {schema:'jupiter-student-ticktick-preview.v1',write_enabled:false,network_requests:0,project_id:project,
    warning:'Source evidence preview only. No task creation or completion is inferred from grades, To Do, or dates.',
    records:input.state.tasks.map(t=>({source_id:t.id,presence:t.presence,title:t.observed.title,course:t.observed.course,
      source_evidence:{teacher:t.observed.teacher,due_raw:t.observed.due_text,date_evidence:t.inferred.deadline,category:t.observed.category,status:t.observed.status},
      task_action:'none',personal_due_date:null,personal_completion:null}))};
}
async function main(){const value=preview(JSON.parse(await fs.readFile(argument('--input'),'utf8')),argument('--project-id'));await writePrivate(argument('--output'),value);console.log('Local preview saved; zero remote reads or writes.');}
if(require.main===module)main().catch(()=>{console.error('Preview refused or failed. Use your own export and an unused .private output path.');process.exitCode=1;});
module.exports={preview};
