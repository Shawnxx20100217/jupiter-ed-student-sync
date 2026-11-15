'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const modulePromise=import(pathToFileURL(path.join(__dirname,'../optional/cloudflare/worker.mjs')).href);
const NOW='2026-11-16T06:00:00.000Z';
const ENV={WATCHDOG_ENABLED:'true',GITHUB_REPOSITORY:'example-student/private-reader',GITHUB_WATCHDOG_TOKEN:'synthetic-test-only',
  BUSINESS_TIMEZONE:'Asia/Shanghai',WATCHDOG_SCHEDULE:JSON.stringify({weekdays:['11:45','17:20','20:50'],weekends:['11:30','20:50']})};
function fixture({lastSuccess='2026-11-16T02:00:00.000Z',runs=[],health,permissionFailure=false,unknownDispatch=false,publicRepository=false}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method,body:options.body});
    assert.ok(url.startsWith('https://api.github.com/repos/example-student/private-reader'));
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer synthetic-test-only');
    if(permissionFailure)return {ok:false,status:403};
    if(options.method==='POST'){
      if(unknownDispatch)throw Error('synthetic lost acknowledgement');
      return {ok:true,status:204};
    }
    let value;
    if(url.endsWith('/private-reader'))value={private:!publicRepository,full_name:ENV.GITHUB_REPOSITORY,default_branch:'main'};
    else if(url.includes('/contents/health.json'))value={type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(health||{
      schema:'jupiter-student-health.v1',last_success_at:lastSuccess,sequence:3,verified:true
    })).toString('base64')};
    else if(url.includes('/actions/workflows/student-read.yml/runs'))value={workflow_runs:runs};
    else throw Error('unexpected synthetic route');
    return {ok:true,status:200,json:async()=>value};
  };
  return {fetchImpl,calls};
}
async function run(options={},env=ENV,now=NOW){
  const f=fixture(options);const {check}=await modulePromise;
  return {result:await check(env,{fetchImpl:f.fetchImpl,now}),calls:f.calls};
}
const dispatch=(at,id=1)=>({id,event:'workflow_dispatch',status:'completed',created_at:at});

test('optional watchdog is disabled by default and makes no requests',async()=>{
  const {result,calls}=await run({},{});
  assert.deepEqual(result,{action:'disabled'});assert.equal(calls.length,0);
});
test('fresh snapshots and two-hour grace avoid dispatch and run-history requests',async()=>{
  for(const [options,now] of [[{lastSuccess:'2026-11-16T03:50:00.000Z'},NOW],[{},'2026-11-16T04:00:00.000Z']]){
    const {result,calls}=await run(options,ENV,now);
    assert.equal(result.action,'fresh_or_within_grace');
    assert.equal(calls.length,2);assert.ok(calls.every(c=>c.method==='GET'));
  }
});
test('queued reader prevents a second dispatch',async()=>{
  const {result,calls}=await run({runs:[{id:1,event:'schedule',status:'queued',created_at:'2026-11-16T05:50:00.000Z'}]});
  assert.equal(result.action,'reader_pending');assert.ok(calls.every(c=>c.method==='GET'));
});
test('one-hour cooldown, per-window limit and daily limit block repeated dispatch',async()=>{
  const lists=[
    [dispatch('2026-11-16T05:30:00.000Z')],
    [dispatch('2026-11-16T04:10:00.000Z'),dispatch('2026-11-16T03:50:00.000Z',2)],
    ['10','09','08','07'].map((hour,i)=>dispatch(`2026-11-15T${hour}:00:00.000Z`,i+1)),
  ];
  for(const runs of lists){const {result,calls}=await run({runs});assert.equal(result.action,'dispatch_budget_limited');assert.ok(calls.every(c=>c.method==='GET'));}
});
test('permitted compensation dispatches only the existing read workflow once',async()=>{
  const {result,calls}=await run();
  assert.deepEqual(result,{action:'dispatch_accepted_not_collection_success',sequence:3});
  const posts=calls.filter(c=>c.method==='POST');assert.equal(posts.length,1);
  assert.equal(posts[0].url,'https://api.github.com/repos/example-student/private-reader/actions/workflows/student-read.yml/dispatches');
  assert.deepEqual(JSON.parse(posts[0].body),{ref:'main',inputs:{mode:'read',confirm_initialization:false,trigger:'watchdog'}});
});
test('insufficient permission, public repository and malformed health fail without dispatch',async()=>{
  const {check}=await modulePromise;
  for(const options of [{permissionFailure:true},{publicRepository:true},{health:{schema:'wrong',verified:true}}]){
    const f=fixture(options);await assert.rejects(()=>check(ENV,{fetchImpl:f.fetchImpl,now:NOW}));
    assert.ok(f.calls.every(c=>c.method==='GET'));
  }
});
test('unknown dispatch result never retries POST within the invocation',async()=>{
  const {check}=await modulePromise;const f=fixture({unknownDispatch:true});
  await assert.rejects(()=>check(ENV,{fetchImpl:f.fetchImpl,now:NOW}));
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('invalid or incomplete attempt history refuses compensation',async()=>{
  const {check}=await modulePromise;
  for(const runs of [[dispatch('invalid-clock')],Array.from({length:100},(_,i)=>dispatch('2026-11-16T00:00:00.000Z',i+1))]){
    const f=fixture({runs});await assert.rejects(()=>check(ENV,{fetchImpl:f.fetchImpl,now:NOW}));
    assert.ok(f.calls.every(c=>c.method==='GET'));
  }
});
test('recovered snapshot suppresses later compensation',async()=>{
  const first=await run();assert.equal(first.result.action,'dispatch_accepted_not_collection_success');
  const second=await run({lastSuccess:'2026-11-16T06:05:00.000Z'},ENV,'2026-11-16T06:15:00.000Z');
  assert.equal(second.result.action,'fresh_or_within_grace');assert.ok(second.calls.every(c=>c.method==='GET'));
});
