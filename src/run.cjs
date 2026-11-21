'use strict';
const fs=require('node:fs/promises');
const {configuration,fail}=require('./config.cjs');
const {runSummary}=require('./run-summary.cjs');
const {buildState}=require('./state.cjs');
const persistence=require('./persistence.cjs');
const {freshness,budget}=require('./schedule.cjs');

async function attemptHistory(storage, env, now) {
  const api=persistence.client(storage);
  const runs=await api.request('GET','/actions/workflows/student-read.yml/runs?per_page=100');
  if(!Array.isArray(runs.workflow_runs)||runs.workflow_runs.some(r=>!Number.isFinite(Date.parse(r.created_at))||Date.parse(r.created_at)>Date.parse(now)+60000))fail('attempt_history_invalid');
  const cutoff=Date.parse(now)-86400000;
  const recent=runs.workflow_runs.filter(r=>String(r.id)!==env.GITHUB_RUN_ID && Date.parse(r.created_at)>cutoff);
  if(runs.workflow_runs.length===100 && runs.workflow_runs.every(r=>Date.parse(r.created_at)>cutoff))fail('attempt_history_truncated');
  const attempts=[];
  for(const run of recent){
    if(!Number.isSafeInteger(run.id))fail('attempt_history_invalid');
    if(['in_progress','queued','waiting','pending','requested'].includes(run.status))fail('another_reader_running');
    const jobs=await api.request('GET',`/actions/runs/${run.id}/jobs?per_page=100&filter=all`);
    if(!Array.isArray(jobs.jobs)||jobs.total_count>100)fail('attempt_history_invalid');
    for(const job of jobs.jobs)for(const step of job.steps||[]){
      if(step.name==='Collect validated student data' && step.started_at && step.conclusion!=='skipped')attempts.push(step.started_at);
    }
  }
  return attempts;
}
async function preflight(env, deps={}) {
  if(Number(env.GITHUB_RUN_ATTEMPT||1)!==1)fail('rerun_requires_new_dispatch');
  if(env.READ_TRIGGER==='watchdog' && env.SYNC_ENABLED!=='true')return {allowed:false,reason:'scheduled_reads_disabled'};
  const mode=env.SYNC_MODE||'read';
  if(!['read','initialize'].includes(mode))fail('mode_invalid');
  if(mode==='initialize' && (env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.CONFIRM_INITIALIZATION!=='true'))fail('explicit_initialization_required');
  const ctx=configuration(env);
  const restored=await (deps.loadState||persistence.loadState)(ctx.storage);
  if(restored.initial && mode!=='initialize')fail('initialization_required');
  if(!restored.initial && mode==='initialize')fail('state_already_initialized');
  const now=(deps.now||(()=>new Date().toISOString()))();
  const coverage=freshness(restored.state?.last_success_at||null,now,ctx.config.schedule,ctx.config.timezone);
  if(!restored.initial && coverage.covered)return {...ctx,restored,allowed:false,reason:'window_already_covered'};
  const attempts=await (deps.attemptHistory||attemptHistory)(ctx.storage,env,now);
  const limit=budget(attempts,now);
  return {...ctx,restored,...limit};
}
async function collect(env,deps={}){
  const gate=await preflight(env,deps);
  if(!gate.allowed)return {status:'skipped',reason:gate.reason,actual_read:false};
  configuration(env,{password:true});
  const read=deps.readJupiter||require('./reader.cjs').readJupiter;
  const config = {...gate.config, include_calendar: env.CALENDAR_READ_ENABLED === 'true'};
  const result=await read({config,scope:gate.scope,credentials:{username:env.JUPITER_USERNAME,password:env.JUPITER_PASSWORD},executablePath:env.CHROME_PATH});
  const {state,summary}=buildState(result.payload,gate.restored.state,{scope:gate.scope,expectedCourses:gate.config.expected_courses,
    expectedName:gate.config.expected_name,expectedSchoolYear:gate.config.expected_school_year,expectedTerm:gate.config.expected_term,timezone:gate.config.timezone});
  const saved=await (deps.saveState||persistence.saveState)({...gate.storage,state,revision:gate.restored.revision,initialize:env.SYNC_MODE==='initialize'});
  if(saved.verified!==true)fail('state_readback_unverified');
  // Explicit allowlist: neither source names, raw records, fingerprints nor credentials enter logs.
  return {status:'verified',actual_read:true,last_success_at:state.last_success_at,sequence:state.sequence,
    ...(config.include_calendar ? {calendar: summary.calendar} : {}),
    courses:summary.courses,current_assignments:summary.current_assignments,retained_assignments:summary.retained_assignments,
    added_count:summary.added_count,changed_count:summary.changed_count,date_changed_count:summary.date_changed_count,
    not_observed_count:summary.not_observed_count,encrypted_readback_verified:true,remote_task_writes:0};
}
async function writeSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    const summary = runSummary(result);
    if (summary) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch {
    console.warn('Run summary unavailable. See the step result.');
  }
}
async function main(){
  if(process.env.GITHUB_ACTIONS!=='true'||!/^\d+$/.test(process.env.GITHUB_RUN_ID||''))fail('github_runner_required');
  if(process.argv.includes('--preflight')){
    const result=await preflight(process.env);
    if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`allowed=${result.allowed}\n`);
    const report={status:result.allowed?'ready':'skipped',reason:result.reason,actual_read:false};
    console.log(JSON.stringify(report));await writeSummary(report);return;
  }
  const report=await collect(process.env);
  console.log(JSON.stringify(report));await writeSummary(report);
}
if(require.main===module)main().catch(async e=>{
  // Error messages and browser errors can contain account values; never echo them.
  const safe=new Set(['required_configuration_missing','config_invalid','expected_courses_required','unexpected_config_field','timezone_invalid','schedule_invalid',
    'explicit_initialization_required','initialization_required','state_already_initialized','state_decryption_failed','private_repository_required',
    'state_conflict','state_readback_unverified','state_readback_stale','state_readback_conflict','state_scope_or_verification_invalid','github_request_failed',
    'github_network_failed','another_reader_running','attempt_history_invalid','attempt_history_truncated','github_runner_required','mode_invalid','rerun_requires_new_dispatch',
    'upstream_maintenance','upstream_unavailable','network_failure','login_required','interactive_verification_required','login_access_denied',
    'identity_mismatch','school_identity_mismatch','school_identity_unproven','incomplete_scan','incomplete_course','course_term_mismatch','reader_failed','read_timeout']);
  console.error(JSON.stringify({status:'failed',error_code:safe.has(e.code)?e.code:'unclassified_failure',actual_read:null,recovery:'Inspect the next readback before retrying; failed writes are not replayed.'}));process.exitCode=1;
  await writeSummary({status:'failed'});
});
module.exports={attemptHistory,preflight,collect};
