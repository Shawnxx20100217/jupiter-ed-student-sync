'use strict';
// Browser extraction reuses the audited jupiter-api fork in lib/. No writeback client.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer-core').default;
const {default:Jupiter, Navigator} = require('../dist/index.js');
const {evaluateTodoRequest}=require('./todo-read-policy.cjs');
const {collectTodoFromAuthenticatedPage,enrichSourceWithTodo}=require('./todo-session-read.cjs');

class ReadError extends Error {
  constructor(code) { super(code); this.code=code; }
}
const norm = x => String(x||'').replace(/\s+/g,' ').trim();
function validTimezone(value) {
  if(typeof value!=='string'||!value.trim()||/^[+-]/.test(value))return false;
  try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}
}
function validateConfig(c) {
  if(!c || !['school','city','state','expected_name','expected_school_year','expected_term'].every(k=>typeof c[k]==='string'&&c[k].trim())) throw new ReadError('config_invalid');
  if(!validTimezone(c.timezone) || !Array.isArray(c.expected_courses) || !c.expected_courses.length || c.expected_courses.some(x=>typeof x!=='string'||!x.trim()) || new Set(c.expected_courses.map(norm)).size!==c.expected_courses.length) throw new ReadError('config_invalid');
  if(c.school_id!==undefined&&(typeof c.school_id!=='string'||!/^\d+$/.test(c.school_id))) throw new ReadError('config_invalid');
  return c;
}
function checkIdentity(id,c) {
  const wanted=c.expected_courses.map(norm).sort();
  if(!id||!Array.isArray(id.courses)||id.courses.some(x=>typeof x!=='string')||norm(id.name)!==norm(c.expected_name)||norm(id.school_year)!==norm(c.expected_school_year)||JSON.stringify(id.courses.map(norm).sort())!==JSON.stringify(wanted)) throw new ReadError('identity_mismatch');
}
function browserEnvironment(timezone) {
  if(!validTimezone(timezone))throw new ReadError('config_invalid');
  const env={TZ:timezone};
  for(const k of ['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','XDG_RUNTIME_DIR']) if(process.env[k]) env[k]=process.env[k];
  return env;
}
function classifyError(e, counters) {
  if(e instanceof ReadError)return e;
  if(['upstream_maintenance','upstream_unavailable'].includes(e?.message))return new ReadError(e.message);
  if(e?.message==='login_network_failure')return new ReadError('network_failure');
  if(['login_access_denied','interactive_verification_required'].includes(e?.message))return new ReadError(e.message);
  const known=['course_term_mismatch','assignment_id_conflict','assignment_row_shape_changed','assignment_owner_not_covered','course_term_grade_row_missing_or_ambiguous','assignment_table_header_missing',
    'school_identity_unproven','school_identity_mismatch','school_identity_context_invalid','school_identity_url_invalid','school_identity_origin_invalid','school_identity_route_ambiguous','school_identity_config_missing','school_identity_student_route_unexposed','school_identity_route_missing','todo_navigation_not_allowed','todo_navigation_unverified','todo_session_expired','todo_course_coverage_unproven','todo_identity_or_content_unresolved','todo_assignment_title_missing','todo_main_missing',
    'probe_contract_invalid','probe_course_inventory_mismatch','probe_scope_mismatch','cloud_identity_ambiguous','probe_assignment_handler_invalid','probe_assignment_course_ambiguous','probe_assignment_not_in_cloud_scope','probe_assignment_cells_invalid','probe_duplicate_identity_conflict'];
  if(known.includes(e?.message))return new ReadError(e.message);
  if(counters.timed_out)return new ReadError('read_timeout');
  if(counters.navigation_network_failures)return new ReadError('network_failure');
  if(e?.name==='TimeoutError')return new ReadError(counters.login_submissions?'login_or_page_timeout':'page_timeout');
  return new ReadError('reader_failed');
}
async function collectOnce({config,credentials,scope,executablePath,onPhase=()=>{},counters}) {
  let browser,timer,close;
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'jupiter-student-read-'));
  try {
    await fs.chmod(profile,0o700);
    onPhase('browser_start');
    browser=await puppeteer.launch({executablePath,userDataDir:profile,headless:true,timeout:30000,
      defaultViewport:{width:1280,height:900},env:browserEnvironment(config.timezone),
      args:['--disable-background-networking','--no-first-run','--disable-dev-shm-usage']});
    close=()=>browser.close().catch(()=>{});
    process.once('SIGTERM',close);process.once('SIGINT',close);
    timer=setTimeout(()=>{counters.timed_out=true;close()},180000);timer.unref();
    const page=await browser.newPage();
    page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(25000);
    page.on('dialog',d=>d.dismiss());
    page.on('requestfailed',r=>{if(r.isNavigationRequest()&&r.failure()?.errorText!=='net::ERR_BLOCKED_BY_CLIENT') counters.navigation_network_failures++});
    await page.setRequestInterception(true);
    let todoReadPhase=false;
    page.on('request',r=>{
      const verdict=evaluateTodoRequest({url:r.url(),method:r.method(),isNavigation:r.isNavigationRequest(),postData:r.postData()},counters,{phase:todoReadPhase?'todo':'course'});
      if(!verdict.allow){
        if(verdict.reason==='outside_official_origin')counters.external_blocked++;
        else counters.write_attempts_blocked++;
      }
      return (verdict.allow?r.continue():r.abort()).catch(()=>{});
    });
    onPhase('login');
    const nav=new Navigator(page,onPhase);
    const ok=await nav.login({id:credentials.username,password:credentials.password,school:config.school,
      schoolId:config.school_id,city:config.city,state:config.state});
    if(!ok) {
      const challenge=await page.evaluate(()=>Boolean(document.querySelector('iframe[src*="captcha"],input[autocomplete="one-time-code"],input[name*="otp"]'))).catch(()=>false);
      throw new ReadError(challenge?'interactive_verification_required':'login_required');
    }
    onPhase('identity_check');
    const id=await page.evaluate(()=>({name:document.querySelector('#leftmast .toptabnull')?.textContent,
      school_year:document.querySelector('#schoolyeartab')?.textContent,
      courses:[...document.querySelectorAll('#sidebar .classnav')].map(x=>x.textContent)}));
    checkIdentity(id,config);
    const authenticatedUrl=page.url();
    onPhase('course_scan');
    const student=JSON.parse(JSON.stringify(await Jupiter.fromAuthenticatedPage(page).data(config.expected_term)));
    if(student.courses.length!==config.expected_courses.length)throw new ReadError('incomplete_courses');
    onPhase('todo_evidence_scan');
    todoReadPhase=true;
    const todo=await collectTodoFromAuthenticatedPage(page,nav,config.expected_courses);
    const at=new Date().toISOString();
    const payload={observed_at:at,timezone:config.timezone,school_year:config.expected_school_year,term:config.expected_term,
      coverage:{complete:true,courses:config.expected_courses},student,
      provenance:{reader:'audited jupiter-api cloud fork',source:'live authenticated Jupiter',upstream:'8fef207bf3bd59eb0075cf610de032c65c12ec89'}};
    const enriched=enrichSourceWithTodo(payload,todo,config,authenticatedUrl,scope);
    onPhase(enriched.provenance.school_identity_status.verified?'school_identity_verified':enriched.provenance.school_identity_status.reason);
    return enriched;
  } catch(e) { throw classifyError(e,counters) }
  finally {
    if(timer)clearTimeout(timer);
    if(close){process.off('SIGTERM',close);process.off('SIGINT',close);}
    if(browser)await browser.close().catch(()=>{});
    await fs.rm(profile,{recursive:true,force:true});
  }
}
async function readJupiter(options) {
  validateConfig(options.config);
  if(!options.scope||typeof options.scope!=='object')throw new ReadError('scope_required');
  if(!options.credentials?.username||!options.credentials?.password)throw new ReadError('credentials_missing');
  const counters={login_submissions:0,external_blocked:0,write_attempts_blocked:0,navigation_network_failures:0,timed_out:false,attempts:0};
  for(let attempt=0;attempt<2;attempt++) {
    counters.attempts++;
    try {return {payload:await collectOnce({...options,counters}),counters}}
    catch(e) {
      // Retry only a connection failure before ANY credential submission.
      if(attempt===0 && counters.login_submissions===0 && e.code==='network_failure') {
        options.onPhase?.('pre_login_network_retry');await new Promise(r=>setTimeout(r,3000));continue;
      }
      e.counters=counters;throw e;
    }
  }
}
module.exports={readJupiter,validateConfig,checkIdentity,browserEnvironment,validTimezone,classifyError,ReadError};
