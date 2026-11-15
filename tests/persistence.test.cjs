'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {loadState,saveState,encodeState,decodeState,BRANCH,FILE,HEALTH_FILE}=require('../src/persistence.cjs');
const {buildState,scopeFromConfig}=require('../src/state.cjs');
const {fixture}=require('./helpers/synthetic-state.cjs');
const repo='example-student/example-reader';
const key=Buffer.alloc(32,17).toString('base64'); // Synthetic encryption material only.
const gitBlob=text=>crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const sha=n=>n.toString(16).padStart(40,'0');
function mockGitHub({privateRepo=true}={}){
  const store={blobs:new Map(),trees:new Map(),commits:new Map(),head:null,counter:100,
    calls:[],failRef:false,commitUnknown:false,missingFile:false,missingHealth:false,forceConflict:false};
  Object.defineProperty(store,'file',{get(){if(!store.head)return null;const tree=store.trees.get(store.commits.get(store.head).tree);return store.blobs.get(tree.find(x=>x.path===FILE).sha);}});
  Object.defineProperty(store,'health',{get(){if(!store.head)return null;const tree=store.trees.get(store.commits.get(store.head).tree);return store.blobs.get(tree.find(x=>x.path===HEALTH_FILE).sha);}});
  const response=(code,data)=>new Response(JSON.stringify(data),{status:code,headers:{'content-type':'application/json'}});
  async function fetchImpl(url,options){
    const parsed=new URL(url),path=parsed.pathname.replace('/repos/'+repo,''),method=options.method;
    store.calls.push({method,path});
    const data=options.body?JSON.parse(options.body):null;
    if(method==='GET'&&path==='')return response(200,{private:privateRepo,visibility:privateRepo?'private':'public',full_name:repo,owner:{login:'example-student'}});
    if(method==='GET'&&path===`/git/ref/heads/${BRANCH}`)return store.head?response(200,{ref:`refs/heads/${BRANCH}`,object:{sha:store.head}}):response(404,{});
    if(method==='GET'&&path.startsWith('/contents/')){
      const name=path.slice('/contents/'.length),head=parsed.searchParams.get('ref');
      assert.match(head,/^[a-f0-9]{40}$/); // exact commit, never a moving branch
      if((name===FILE&&store.missingFile)||(name===HEALTH_FILE&&store.missingHealth))return response(404,{});
      const commit=store.commits.get(head),tree=commit&&store.trees.get(commit.tree),entry=tree?.find(x=>x.path===name);
      if(!entry)return response(404,{});
      const content=store.blobs.get(entry.sha);
      return response(200,{type:'file',path:name,encoding:'base64',sha:gitBlob(content),content:Buffer.from(content).toString('base64')});
    }
    if(method==='GET'&&path.startsWith('/git/blobs/')){
      const content=store.blobs.get(path.slice('/git/blobs/'.length));
      return content===undefined?response(404,{}):response(200,{encoding:'base64',content:Buffer.from(content).toString('base64')});
    }
    if(method==='POST'&&path==='/git/blobs'){
      const id=gitBlob(data.content);store.blobs.set(id,data.content);return response(201,{sha:id});
    }
    if(method==='POST'&&path==='/git/trees'){
      assert.deepEqual(data.tree.map(x=>x.path).sort(),[FILE,HEALTH_FILE].sort());
      const id=sha(++store.counter);store.trees.set(id,data.tree);return response(201,{sha:id});
    }
    if(method==='POST'&&path==='/git/commits'){
      const id=sha(++store.counter);store.commits.set(id,data);return response(201,{sha:id});
    }
    if(method==='POST'&&path==='/git/refs'){
      assert.equal(data.ref,`refs/heads/${BRANCH}`);assert.deepEqual(store.commits.get(data.sha).parents,[]);
      if(store.head)return response(422,{});store.head=data.sha;return response(201,{});
    }
    if(method==='PATCH'&&path===`/git/refs/heads/${BRANCH}`){
      assert.equal(data.force,false);
      if(store.failRef)throw new Error('synthetic transport failure');
      if(store.forceConflict||store.commits.get(data.sha).parents[0]!==store.head)return response(422,{});
      store.head=data.sha;
      if(store.commitUnknown)throw new Error('synthetic response loss after commit');
      return response(200,{});
    }
    throw new Error('unexpected mock path '+method+' '+path);
  }
  return {store,fetchImpl};
}

function options(f,mock){return {repo,key,scope:f.scope,token:'synthetic-github-token',fetchImpl:mock.fetchImpl,sleep:async()=>{}};}
async function initialized(){const f=fixture(),m=mockGitHub(),opts=options(f,m);const state=f.state();const saved=await saveState({...opts,state,revision:null,initialize:true});return {f,m,opts,state,saved};}
function next(f,state){f.payload.observed_at='2030-10-01T13:00:00Z';return buildState(f.payload,state,f.context).state;}

test('authenticated ciphertext binds repo and student scope even if a key is reused',()=>{
  const f=fixture(),state=f.state(),a=encodeState(state,key,repo,f.scope),b=encodeState(state,key,repo,f.scope);
  assert.notEqual(a,b);assert.deepEqual(decodeState(a,key,repo,f.scope),state);
  assert.equal(a.includes('Example Student'),false);assert.equal(a.includes('80.00 %'),false);
  assert.throws(()=>decodeState(a,key,'another-student/example-reader',f.scope),{code:'state_decryption_failed'});
  const other=scopeFromConfig(f.config,'another-synthetic-login');
  assert.throws(()=>decodeState(a,key,repo,other),{code:'state_decryption_failed'});
  assert.throws(()=>decodeState(a,Buffer.alloc(32,18).toString('base64'),repo,f.scope),{code:'state_decryption_failed'});
  const bad=JSON.parse(a);bad.tag=Buffer.alloc(16).toString('base64');
  assert.throws(()=>decodeState(JSON.stringify(bad),key,repo,f.scope),{code:'state_decryption_failed'});
});
test('blank private repository initializes only explicitly, then restores and advances across independent calls',async()=>{
  const f=fixture(),m=mockGitHub(),opts=options(f,m);
  assert.deepEqual(await loadState(opts),{state:null,revision:null,initial:true,branchExists:false});
  await assert.rejects(saveState({...opts,state:f.state(),revision:null}),{code:'explicit_initialization_required'});
  assert.equal(m.store.calls.filter(x=>x.method!=='GET').length,0);
  const initial=f.state(),saved=await saveState({...opts,state:initial,revision:null,initialize:true});
  assert.equal(saved.verified,true);assert.equal(saved.health_path,HEALTH_FILE);
  const health=JSON.parse(m.store.health);assert.deepEqual(Object.keys(health).sort(),['last_success_at','schema','sequence','verified']);
  assert.equal(health.sequence,1);assert.equal(health.verified,true);
  const restored=await loadState(opts);assert.deepEqual(restored.state,initial);
  const second=next(f,restored.state);await saveState({...opts,state:second,revision:restored.revision});
  const final=await loadState(opts);assert.equal(final.state.sequence,2);assert.equal(final.state.changes.added.length,0);
  assert.equal(final.state.semantic_fingerprint,initial.semantic_fingerprint);
});
test('public repositories and unverified transient snapshots fail before writing',async()=>{
  const f=fixture(),m=mockGitHub({privateRepo:false}),opts=options(f,m);
  await assert.rejects(loadState(opts),{code:'private_repository_required'});
  await assert.rejects(saveState({...opts,state:f.state(),revision:null,initialize:true}),{code:'private_repository_required'});
  assert.equal(m.store.calls.filter(x=>x.method!=='GET').length,0);
  delete f.payload.provenance.school_identity;
  const transient=buildState(f.payload,null,{...f.context,allowUnverifiedSchool:true}).state;
  assert.throws(()=>encodeState(transient,key,repo,f.scope),{code:'state_scope_or_verification_invalid'});
});
test('wrong account/key, missing state and revision conflicts never initialize or overwrite existing state',async()=>{
  const {f,m,opts,state,saved}=await initialized();const before=m.store.file;
  const writes=()=>m.store.calls.filter(x=>x.method!=='GET').length,oldWrites=writes();
  const otherScope=scopeFromConfig(f.config,'another-synthetic-login');
  await assert.rejects(loadState({...opts,scope:otherScope}),{code:'state_decryption_failed'});
  await assert.rejects(saveState({...opts,key:Buffer.alloc(32,19).toString('base64'),state:next(f,state),revision:saved.revision}),{code:'state_decryption_failed'});
  await assert.rejects(saveState({...opts,state:next(f,state),revision:sha(99)}),{code:'state_conflict'});
  m.store.missingFile=true;await assert.rejects(loadState(opts),{code:'state_file_missing'});
  assert.equal(writes(),oldWrites);assert.equal(m.store.file,before);
});
test('failed and unknown writes are attempted once; no automatic retry or destructive reset',async()=>{
  const {f,m,opts,state,saved}=await initialized();const original=m.store.file;
  m.store.failRef=true;
  await assert.rejects(saveState({...opts,state:next(f,state),revision:saved.revision}),{code:'github_network_failed'});
  assert.equal(m.store.calls.filter(x=>x.method==='PATCH').length,1);assert.equal(m.store.file,original);
  m.store.failRef=false;m.store.commitUnknown=true;
  await assert.rejects(saveState({...opts,state:next(f,state),revision:saved.revision}),{code:'github_network_failed'});
  assert.equal(m.store.calls.filter(x=>x.method==='PATCH').length,2);
  const recovered=await loadState(opts);assert.equal(recovered.state.sequence,2);
  await assert.rejects(saveState({...opts,state:next(f,state),revision:saved.revision}),{code:'state_conflict'});
  assert.equal(m.store.calls.filter(x=>x.method==='PATCH').length,2);
});
test('partial payload failure leaves durable snapshot unchanged and sequence cannot regress',async()=>{
  const {f,m,opts,state,saved}=await initialized();const before=m.store.file;
  f.payload.coverage.complete=false;assert.throws(()=>buildState(f.payload,state,f.context),{code:'incomplete_scan'});
  assert.equal((await loadState(opts)).state.sequence,1);assert.equal(m.store.file,before);
  await assert.rejects(saveState({...opts,state,revision:saved.revision}),{code:'state_sequence_regression'});
  assert.equal(m.store.file,before);
});

test('concurrent non-fast-forward save cannot overwrite snapshot or health',async()=>{
  const {f,m,opts,state,saved}=await initialized();const before={head:m.store.head,file:m.store.file,health:m.store.health};
  m.store.forceConflict=true;
  await assert.rejects(saveState({...opts,state:next(f,state),revision:saved.revision}),{code:'state_conflict'});
  assert.equal(m.store.head,before.head);assert.equal(m.store.file,before.file);assert.equal(m.store.health,before.health);
  assert.equal(m.store.calls.filter(x=>x.method==='PATCH').length,1);
});
test('existing branch missing health is corruption and mismatch cannot be silently reset',async()=>{
  const {m,opts}=await initialized();
  m.store.missingHealth=true;
  await assert.rejects(loadState(opts),{code:'state_file_missing'});
  m.store.missingHealth=false;
  const tree=m.store.trees.get(m.store.commits.get(m.store.head).tree);
  const entry=tree.find(x=>x.path===HEALTH_FILE),old=m.store.blobs.get(entry.sha);
  m.store.blobs.set(entry.sha,JSON.stringify({...JSON.parse(old),sequence:999}));
  await assert.rejects(loadState(opts),{code:'state_health_mismatch'});
});
test('uploaded ciphertext readback failure never exposes a new branch or verified health',async()=>{
  const f=fixture(),m=mockGitHub(),opts=options(f,m),baseFetch=m.fetchImpl;
  opts.fetchImpl=async(url,options)=>new URL(url).pathname.includes('/git/blobs/')&&options.method==='GET'
    ?new Response(JSON.stringify({encoding:'base64',content:Buffer.from('synthetic corrupted bytes').toString('base64')}),{status:200})
    :baseFetch(url,options);
  await assert.rejects(saveState({...opts,state:f.state(),revision:null,initialize:true}),{code:'state_blob_integrity_failed'});
  assert.equal(m.store.head,null);assert.equal(m.store.health,null);
  assert.equal(m.store.calls.some(x=>x.path==='/git/refs'),false);
});

test('malformed restored task state cannot be encrypted as a valid checkpoint',()=>{
  const f=fixture(),state=f.state();
  state.tasks[0].raw.percent_raw='fabricated value';
  assert.throws(()=>encodeState(state,key,repo,f.scope),{code:'state_structure_invalid'});
  const incomplete=f.state();incomplete.tasks.pop();
  assert.throws(()=>encodeState(incomplete,key,repo,f.scope),{code:'state_structure_invalid'});
  const foreign=f.state();foreign.tasks[0].identity.school_id='990002';
  assert.throws(()=>encodeState(foreign,key,repo,f.scope),{code:'state_structure_invalid'});
});
