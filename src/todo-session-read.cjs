'use strict';
// Reuses the diagnostic probe's DOM extraction on the reader's existing page.
// No credentials, browser creation, login, persistence or writeback lives here.
const {fingerprint,buildState}=require('./state.cjs');
const {parseCards,buildEvidence}=require('./todo-evidence.cjs');
const norm=x=>String(x||'').replace(/\s+/g,' ').trim();
const copy=x=>JSON.parse(JSON.stringify(x));
function fail(code){const error=new Error(code);error.code=code;throw error;}

function verifiedSchoolIdentity(authenticatedUrl,config,{scope_hash,observed_at}){
 let url;try{url=new URL(authenticatedUrl);}catch{fail('school_identity_url_invalid');}
 const route=url.searchParams.getAll('w');
 const expected=String(config.school_id||'');
 if(url.origin!=='https://login.jupitered.com'||url.username||url.password)fail('school_identity_origin_invalid');
 if(route.length>1||(route.length===1&&!/^\d+(?:,\d+){1,}$/.test(route[0])))fail('school_identity_route_ambiguous');
 const actual=route.length?route[0].split(',')[0]:null;
 // A positively observed mismatch is never softened into missing evidence.
 if(actual&&/^\d+$/.test(expected)&&actual!==expected)fail('school_identity_mismatch');
 if(!/^\/(?:[A-Za-z0-9_-]+\/)*student\.php$/.test(url.pathname))fail('school_identity_student_route_unexposed');
 if(!route.length)fail('school_identity_route_missing');
 if(!/^[a-f0-9]{64}$/.test(scope_hash||'')||!Number.isFinite(Date.parse(observed_at)))fail('school_identity_context_invalid');
 return {schema:'jupiter-school-identity.v1',verified:true,school_id:actual,...(expected?{expected_school_id:expected}:{}),
  school_year:norm(config.expected_school_year),scope_hash,observed_at,
  origin:'https://login.jupitered.com/',method:'authenticated_official_student_route'};
}

function visibleSession(){
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 return visible(document.querySelector('#mainpage'))&&!!document.querySelector('#schoolyeartab')&&!visible(document.querySelector('#text_password1'));
}
function navigationWitness(route){
 const label=route==='todo'?'To Do':'Calendar';
 const actions=[...document.querySelectorAll('#sidebar .navrow,#sidebar .navlit')];
 const current=actions.some(e=>(e.textContent||'').trim()===label&&e.classList.contains('navlit'));
 const allowed=new RegExp('^go\\(\\x27'+route+'\\x27\\);?$');
 const direct=actions.some(e=>(e.textContent||'').trim()===label&&allowed.test(e.getAttribute('click')||e.getAttribute('onclick')||''));
 const rendered=[...document.querySelectorAll('#mainpage [click],#mainpage [onclick]')]
  .some(e=>allowed.test(e.getAttribute('click')||e.getAttribute('onclick')||''));
 // The existing Jupiter page also renders buttons through its own script helper.
 const script=new RegExp('btn\\("'+label+'","go\\(\\x27'+route+'\\x27\\)"');
 const scripted=[...document.querySelectorAll('#mainpage script')].some(e=>script.test(e.textContent||''));
 return {current,available:current||direct||rendered||scripted};
}
async function readNavigation(page,nav,route,{optional=false}={}){
 if(!['todo','calendar'].includes(route))fail('todo_navigation_not_allowed');
 const witness=await page.evaluate(navigationWitness,route);
 if(!witness.available){if(optional)return false;fail('todo_navigation_unverified');}
 if(!witness.current)await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.evaluate(target=>window.go(target),route)]);
 await nav.assertPageAvailable();
 await page.waitForFunction(visibleSession,{timeout:25000});
 if(!(await nav.isAuthenticated()))fail('todo_session_expired');
 return true;
}
async function collectTodoFromAuthenticatedPage(page,nav,courses,{isolateCalendarFailure=false}={}){
 const authenticated_route_candidates=[page.url()];
 await readNavigation(page,nav,'todo');
 authenticated_route_candidates.push(page.url());
 await page.evaluate(()=>{for(const e of document.querySelectorAll('#mainpage [click]')){
  const match=(e.getAttribute('click')||'').match(/^toggleupcoming\((\d+),1\)$/);
  if(match&&typeof window.toggleupcoming==='function')window.toggleupcoming(Number(match[1]),1);
 }});
 const view=await page.evaluate(expected=>{
  const root=document.querySelector('#mainpage');if(!root)throw new Error('todo_main_missing');
  return {headings:[...root.querySelectorAll('h1,h2,h3,.big,.bigger')].map(e=>e.innerText),
   cards:[...root.querySelectorAll('[click],[onclick]')].filter(e=>/goassign\(/.test(e.getAttribute('click')||e.getAttribute('onclick')||'')).map(e=>{
    const box=e.closest('.classbox'),boxText=box?.textContent||'';
    return {handler:e.getAttribute('click')||e.getAttribute('onclick'),visible:e.getClientRects().length>0,
     course_candidates:expected.filter(c=>boxText.includes(c)),course_container:box?{tag:box.tagName,id:box.id,cls:box.className}:null,
     cells:[...e.children].map(c=>({text:c.textContent,cls:c.className,title:c.getAttribute('title')}))};})};
 },courses);
 let calendar=null,calendar_error=null;
 try {
   if(await readNavigation(page,nav,'calendar',{optional:true})){
     authenticated_route_candidates.push(page.url());
     calendar=await page.evaluate(()=>({
       actions:[...document.querySelectorAll('#mainpage [click],#mainpage [onclick]')].map(e=>{
         const ancestors=[];let p=e;for(let i=0;p&&i<6;i++,p=p.parentElement)ancestors.push({tag:p.tagName,id:p.id,cls:p.className});
         return {handler:e.getAttribute('click')||e.getAttribute('onclick'),ancestors};}),months:[]}));
   }
 } catch (error) {
   if (!isolateCalendarFailure) throw error;
   calendar_error = 'calendar_navigation_failed';
 }
 // URLs stay in memory only; enrichment stores the proven school ID, never the
 // full student route. Later read navigation can expose an ID absent at login.
 return {view,calendar,calendar_error,authenticated_route_candidates};
}

function enrichSourceWithTodo(payload,captured,config,authenticatedUrl,scope){
 const result=copy(payload),context={expectedCourses:config.expected_courses,expectedName:config.expected_name,
  expectedSchoolYear:config.expected_school_year,expectedTerm:config.expected_term,timezone:config.timezone,scope};
 // Validate the untouched grade table before combining independently witnessed rows.
 const initial=buildState(result,null,{...context,allowUnverifiedSchool:true}).state;
 let school=null,schoolReason=null;
 const unavailable=new Set();
 for(const candidate of [authenticatedUrl,...(captured.authenticated_route_candidates||[])]){
  try{
   const observed=verifiedSchoolIdentity(candidate,config,{scope_hash:initial.scope_hash,observed_at:result.observed_at});
   if(school&&school.school_id!==observed.school_id)fail('school_identity_mismatch');
   school=observed;
  }
  catch(error){
   // Read-only navigation may expose the numeric school route later.
   // Mismatches still stop immediately; no candidate proof means failure below.
   if(!['school_identity_student_route_unexposed','school_identity_route_missing'].includes(error.code))throw error;
   unavailable.add(error.code);
  }
 }
 if(!school)fail('school_identity_unproven');
 const courses=config.expected_courses.map(norm),headings=(captured.view?.headings||[]).map(norm);
 if(courses.some(c=>!headings.includes(c)))fail('todo_course_coverage_unproven');
 const probe={view:copy(captured.view),calendar:captured.calendar?copy(captured.calendar):null,observed_at:result.observed_at,timezone:config.timezone,identity_verified:true,
  scope_hash:initial.scope_hash,courses};
 const parsed=parseCards(probe,courses);
 if(parsed.unresolved.length)fail('todo_identity_or_content_unresolved');
 if([...parsed.records.values()].some(r=>!r.title))fail('todo_assignment_title_missing');
 const rawCards=new Map(probe.view.cards.filter(c=>c.visible===true).map(c=>{
  const match=norm(c.handler).match(/^goassign\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)\s*;?$/);
  return [JSON.stringify([norm(c.course_candidates[0]),match[1]]),c];
 }));
 let added=0;
 for(const course of result.student.courses){
  const known=new Set(course.assignments.map(a=>String(a.id)));let courseAdded=0;
  for(const [key,row] of parsed.records){
   if(row.course!==norm(course.name)||known.has(row.jupiter_assignment_id))continue;
   const card=rawCards.get(key),due=row.explicit_due?norm(row.raw_date_text).replace(/^Due\s+/i,''):null;
   course.assignments.push({id:row.jupiter_assignment_id,jupiter_task_id:row.jupiter_assignment_id,
    name:row.title,name_raw:card.cells[2].text,due,due_raw:due,category:null,category_raw:null,
    score:null,score_raw:null,percent:null,percent_raw:null,letter_grade_raw:null,worth_raw:null,
    status_raw:null,graded:null,personal_done:null,submission_status:null,source_kind:'todo_assignment_observation',
    raw:{origin:'todo',handler:card.handler,cells:copy(card.cells),source_date_text:row.raw_date_text,
     deadline_semantics:row.deadline_semantics,identity_method:row.identity_method}});
   known.add(row.jupiter_assignment_id);courseAdded++;added++;
  }
  if(courseAdded){
   course.coverage={...course.coverage,grade_table_coverage:copy(course.coverage),todo_only_count:courseAdded,
    assignment_owner_count:known.size,parsed_assignment_count:known.size,
    combined_scope:'complete_grade_table_plus_verified_rendered_todo'};
  }
 }
 result.provenance={...result.provenance,school_identity:school,
  school_identity_status:{verified:!!school,reason:schoolReason}};
 const combined=buildState(result,null,context).state;
 const conversion=buildEvidence(probe,combined);
 result.deadline_evidence=conversion.evidence;
 result.provenance.todo_coverage={scope:'current_semester_expanded_rendered_rows_only',complete:false,
  verified_course_headers:courses.length,matched_records:parsed.records.size,todo_only_merged:added,
  hidden_rows:parsed.hidden,identical_duplicates:parsed.duplicates,
  absence_policy:'not_observed_is_not_absent_or_complete'};
 return result;
}
module.exports={verifiedSchoolIdentity,collectTodoFromAuthenticatedPage,enrichSourceWithTodo,readNavigation};
