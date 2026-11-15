import clocks from '../../src/schedule.cjs';

const WORKFLOW='student-read.yml';
function invalid(){throw new Error('watchdog_configuration_or_response_invalid');}
export async function check(env,{fetchImpl=fetch,now=new Date().toISOString()}={}){
  if(env.WATCHDOG_ENABLED!=='true')return {action:'disabled'};
  const repo=env.GITHUB_REPOSITORY;
  if(typeof repo!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo)||!env.GITHUB_WATCHDOG_TOKEN)invalid();
  const schedule=JSON.parse(env.WATCHDOG_SCHEDULE);
  clocks.validateSchedule(schedule,env.BUSINESS_TIMEZONE);
  const prefix=`https://api.github.com/repos/${repo}`;
  async function request(path,method='GET',body){
    const response=await fetchImpl(prefix+path,{method,redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/vnd.github+json',
      Authorization:`Bearer ${env.GITHUB_WATCHDOG_TOKEN}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'jupiter-ed-student-sync-watchdog',
      ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw new Error('github_watchdog_request_failed');
    return response.status===204?null:response.json();
  }
  const repository=await request('');
  if(repository.private!==true||repository.full_name?.toLowerCase()!==repo.toLowerCase())invalid();
  const ref=repository.default_branch;
  if(typeof ref!=='string'||!ref||ref.includes('..'))invalid();
  const file=await request('/contents/health.json?ref=sync-state');
  if(file.type!=='file'||file.encoding!=='base64'||typeof file.content!=='string'||file.content.length>4096)invalid();
  const health=JSON.parse(atob(file.content.replace(/\n/g,'')));
  if(Object.keys(health).sort().join(',')!=='last_success_at,schema,sequence,verified'||health.schema!=='jupiter-student-health.v1'||health.verified!==true||!Number.isSafeInteger(health.sequence)||health.sequence<1)invalid();
  const coverage=clocks.freshness(health.last_success_at,now,schedule,env.BUSINESS_TIMEZONE);
  if(coverage.covered||coverage.late_ms<7200000)return {action:'fresh_or_within_grace',sequence:health.sequence};
  const runs=await request(`/actions/workflows/${WORKFLOW}/runs?per_page=100`);
  if(!Array.isArray(runs.workflow_runs)||runs.workflow_runs.some(r=>!Number.isFinite(Date.parse(r.created_at))||Date.parse(r.created_at)>Date.parse(now)+60000))invalid();
  if(runs.workflow_runs.some(r=>['queued','in_progress','waiting','pending','requested'].includes(r.status)))return {action:'reader_pending'};
  const dispatches=runs.workflow_runs.filter(r=>r.event==='workflow_dispatch'&&Date.parse(r.created_at)>Date.parse(now)-86400000);
  if(runs.workflow_runs.length===100&&runs.workflow_runs.every(r=>Date.parse(r.created_at)>Date.parse(now)-86400000))invalid();
  if(dispatches.some(r=>Date.parse(now)-Date.parse(r.created_at)<3600000)||dispatches.length>=4||dispatches.filter(r=>Date.parse(r.created_at)>=Date.parse(coverage.window)).length>=2)return {action:'dispatch_budget_limited'};
  // No POST replay. A lost acknowledgement is reported as unknown; the next cron
  // checks GitHub run history before considering another dispatch.
  await request(`/actions/workflows/${WORKFLOW}/dispatches`,'POST',{ref,inputs:{mode:'read',confirm_initialization:false,trigger:'watchdog'}});
  return {action:'dispatch_accepted_not_collection_success',sequence:health.sequence};
}
let pending=false;
export default {
  async scheduled(_event,env){
    if(pending)return;
    pending=true;
    try{console.log(JSON.stringify(await check(env)));}
    catch{console.error(JSON.stringify({action:'watchdog_failed_or_dispatch_unknown'}));}
    finally{pending=false;}
  },
  fetch(){return new Response('Not found',{status:404});}
};
