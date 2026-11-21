'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configuration}=require('../src/config.cjs');
const {preflight,collect,attemptHistory}=require('../src/run.cjs');
const {fixture}=require('./helpers/synthetic-state.cjs');
const {encodeState,decodeState}=require('../src/persistence.cjs');
function example(){
 const f=fixture(),{expected_name,...config}=f.config;
 config.schedule={weekdays:['12:00','17:00'],weekends:['12:00','17:00']};
 const env={JUPITER_CONFIG:JSON.stringify(config),JUPITER_EXPECTED_NAME:expected_name,JUPITER_USERNAME:'synthetic-student-login',JUPITER_PASSWORD:'synthetic-password-not-an-account',JUPITER_STATE_KEY:Buffer.alloc(32,21).toString('base64'),GITHUB_REPOSITORY:'example-student/example-reader',GITHUB_TOKEN:'synthetic-github-token',GITHUB_RUN_ID:'10000',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_NAME:'workflow_dispatch',SYNC_MODE:'initialize',CONFIRM_INITIALIZATION:'true'};
 return {f,env};
}
const empty=async()=>({initial:true,state:null,revision:null});
const deps=()=>({loadState:empty,attemptHistory:async()=>[],now:()=> '2030-10-01T12:00:00.000Z'});
test('empty environment cannot reuse any locally available production configuration',()=>{
 assert.throws(()=>configuration({}),{code:'required_configuration_missing'});
 const {env}=example();delete env.JUPITER_USERNAME;assert.throws(()=>configuration(env),{code:'required_configuration_missing'});
});
test('initialization requires separate explicit manual confirmation and cannot replace existing state',async()=>{
 const {f,env}=example();assert.equal((await preflight(env,deps())).allowed,true);
 await assert.rejects(preflight({...env,CONFIRM_INITIALIZATION:'false'},deps()),{code:'explicit_initialization_required'});
 await assert.rejects(preflight({...env,GITHUB_EVENT_NAME:'schedule'},deps()),{code:'explicit_initialization_required'});
 await assert.rejects(preflight({...env,SYNC_MODE:'read'},deps()),{code:'initialization_required'});
 await assert.rejects(preflight(env,{...deps(),loadState:async()=>({initial:false,state:f.state(),revision:'synthetic-revision'})}),{code:'state_already_initialized'});
});
test('first simulated collection persists encrypted verified state and repeated covered window does not call reader',async()=>{
 const {f,env}=example();let reads=0,saves=0,stored=null;
 const d={...deps(),readJupiter:async options=>{reads++;assert.deepEqual(options.scope,f.scope);assert.equal(options.credentials.username,env.JUPITER_USERNAME);return {payload:f.payload,counters:{login_submissions:1}};},saveState:async options=>{saves++;assert.equal(options.initialize,true);const cipher=encodeState(options.state,options.key,options.repo,options.scope);assert.equal(cipher.includes('Example Student'),false);stored=decodeState(cipher,options.key,options.repo,options.scope);return {verified:true};}};
 const report=await collect(env,d);assert.equal(report.status,'verified');assert.equal(report.sequence,1);assert.equal(report.remote_task_writes,0);assert.equal(report.courses,2);assert.equal(reads,1);assert.equal(saves,1);
 const output=JSON.stringify(report);for(const secret of [env.JUPITER_PASSWORD,env.JUPITER_USERNAME,env.JUPITER_EXPECTED_NAME,'Synthetic exercise','80.00 %'])assert.equal(output.includes(secret),false);
 const repeated=await collect({...env,SYNC_MODE:'read'},{...d,loadState:async()=>({initial:false,state:stored,revision:'synthetic-revision'}),now:()=> '2030-10-01T12:15:00.000Z'});
 assert.equal(repeated.actual_read,false);assert.equal(repeated.reason,'window_already_covered');assert.equal(reads,1);assert.equal(saves,1);
});
test('missing login credentials, cooldown, incomplete source and failed readback never report verified success',async()=>{
 const {f,env}=example();let reads=0,saves=0;
 const d={...deps(),readJupiter:async()=>{reads++;return {payload:f.payload};},saveState:async()=>{saves++;return {verified:false};}};
 await assert.rejects(collect({...env,JUPITER_PASSWORD:''},d),{code:'required_configuration_missing'});assert.equal(reads,0);
 const skipped=await collect(env,{...d,attemptHistory:async()=>['2030-10-01T11:45:00Z']});assert.equal(skipped.reason,'login_cooldown');assert.equal(reads,0);
 f.payload.coverage.complete=false;await assert.rejects(collect(env,d),{code:'incomplete_scan'});assert.equal(saves,0);
 f.payload.coverage.complete=true;await assert.rejects(collect(env,d),{code:'state_readback_unverified'});assert.equal(saves,1);
});
test('same-run retries cannot evade persisted login cooldown',async()=>{
 const {env}=example();await assert.rejects(preflight({...env,GITHUB_RUN_ATTEMPT:'2'},deps()),{code:'rerun_requires_new_dispatch'});
});
test('real-run history requests all attempts, ignores skipped collectors and refuses active readers',async()=>{
 const response=value=>new Response(JSON.stringify(value),{status:200});
 let active=false,jobsURL='';
 const storage={repo:'example-student/example-reader',token:'synthetic-token',fetchImpl:async url=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/runs'))return response({workflow_runs:[{id:10000,created_at:'2030-10-01T11:59:00Z',status:'in_progress'},{id:9999,created_at:'2030-10-01T11:00:00Z',status:active?'in_progress':'completed'}]});
  jobsURL=url;return response({total_count:2,jobs:[{steps:[{name:'Collect validated student data',started_at:'2030-10-01T11:00:00Z',conclusion:'failure'}]},{steps:[{name:'Collect validated student data',started_at:'2030-10-01T11:30:00Z',conclusion:'skipped'}]}]});
 }};
 assert.deepEqual(await attemptHistory(storage,{GITHUB_RUN_ID:'10000'},'2030-10-01T12:00:00Z'),['2030-10-01T11:00:00Z']);assert.equal(new URL(jobsURL).searchParams.get('filter'),'all');
 active=true;await assert.rejects(attemptHistory(storage,{GITHUB_RUN_ID:'10000'},'2030-10-01T12:00:00Z'),{code:'another_reader_running'});
});

test('a full recent history page is refused even when it includes the current run',async()=>{
 const runs=[{id:10000,created_at:'2030-10-01T11:59:00Z',status:'in_progress'},...Array.from({length:99},(_,i)=>({id:5000+i,created_at:'2030-10-01T11:00:00Z',status:'completed'}))];
 const storage={repo:'example-student/example-reader',token:'synthetic-token',fetchImpl:async url=>new Response(JSON.stringify(new URL(url).pathname.endsWith('/runs')?{workflow_runs:runs}:{total_count:0,jobs:[]}),{status:200})};
 await assert.rejects(attemptHistory(storage,{GITHUB_RUN_ID:'10000'},'2030-10-01T12:00:00Z'),{code:'attempt_history_truncated'});
});

test('the optional calendar reaches the private reader, encrypted checkpoint and aggregate run report', async () => {
  const {attachObservation} = require('./helpers/synthetic-calendar.cjs');
  const {runSummary} = require('../src/run-summary.cjs');
  for (const enabled of [false, true]) {
    const {f, env} = example();
    env.CALENDAR_READ_ENABLED = String(enabled);
    let readback;
    const report = await collect(env, {
      ...deps(),
      readJupiter: async ({config}) => {
        assert.equal(config.include_calendar, enabled);
        if (enabled) attachObservation(f);
        return {payload: f.payload};
      },
      saveState: async ({state, key, repo}) => {
        readback = decodeState(encodeState(state, key, repo, f.scope), key, repo, f.scope);
        return {verified: true};
      },
    });
    assert.equal(report.encrypted_readback_verified, true);
    assert.equal(readback.tasks.length, 2);
    if (enabled) {
      assert.equal(report.calendar.complete_months, 2);
      assert.equal(report.calendar.date_summaries, 2);
      assert.equal(readback.calendar_date_summaries.records.length, 2);
      const summary = runSummary(report);
      assert.match(summary, /School calendar/);
      assert.match(summary, /2 \/ 2/);
      assert.doesNotMatch(summary + JSON.stringify(report), /Synthetic October assembly/);
    } else {
      assert.equal(readback.calendar_events, undefined);
      assert.equal(report.calendar, undefined);
      assert.doesNotMatch(runSummary(report), /School calendar/);
    }
  }
});
