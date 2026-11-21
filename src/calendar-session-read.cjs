'use strict';
// Reads only Calendar UI already exposed by the authenticated Jupiter page.
// No login, browser creation, guessed API, persistence, or school mutations.
const {fingerprint}=require('./state.cjs');
const {captureCalendarDom}=require('./calendar-dom.cjs');
const {identityScope,validDate}=require('./calendar-state.cjs');
const norm=value=>String(value||'').replace(/\s+/g,' ').trim();
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(code){throw Object.assign(new Error(code),{code});}

function requestedCalendarRange(now,timezone){
  if(!Number.isFinite(Date.parse(now)))fail('calendar_clock_invalid');
  let fields;try{fields=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));}catch{fail('calendar_timezone_invalid');}
  const day=`${fields.year}-${fields.month}-${fields.day}`,anchor=Date.parse(day+'T00:00:00Z');
  const date=offset=>new Date(anchor+offset*86400000).toISOString().slice(0,10);
  return {start_date:date(-14),end_date:date(56)};
}
function requestedMonths(range){
  if(!validDate(range?.start_date)||!validDate(range?.end_date)||range.start_date>range.end_date||Date.parse(range.end_date)-Date.parse(range.start_date)>70*86400000)fail('calendar_range_invalid');
  const result=[];
  for(let month=range.start_date.slice(0,7);month<=range.end_date.slice(0,7);){
    result.push(month);const [year,number]=month.split('-').map(Number);month=number===12?`${year+1}-01`:`${year}-${String(number+1).padStart(2,'0')}`;
  }
  if(result.length>4)fail('calendar_month_budget_exceeded');
  return result;
}
function selectedMonth(probe){
  if (!Array.isArray(probe?.selected_months) || probe.selected_months.length !== 1) return null;
  const month = probe.selected_months[0];
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) ? month : null;
}
function monthDays(month){
  if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))fail('calendar_month_invalid');
  const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate();
  return Array.from({length:days},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
}
function expectedAcademicFilter(identity,observedValue){
  // The already-exact-matched Jupiter school-year tab can include its school
  // name before the explicit year suffix. Do not interpret other numbers.
  const configured=String(identity.school_year||'').match(/(?:^|\s)(\d{4})\s*[-–/]\s*(\d{2}|\d{4})$/);
  const displayed=String(observedValue||'').match(/^(\d+) (\d{4})(\d{4})$/);
  if(!/^\d+$/.test(identity.school_id||'')||!configured||!displayed||Number(displayed[3])!==Number(displayed[2])+1)fail('calendar_academic_filter_unproven');
  // Compare the full years actually supplied by Jupiter. A short end-year in
  // its academic-year label is checked against the explicit source year; it
  // is never expanded into a guessed assignment/event date.
  if(displayed[1]!==identity.school_id||displayed[2]!==configured[1]||
    (configured[2].length===4?displayed[3]!==configured[2]:displayed[3].slice(-2)!==configured[2]))fail('calendar_school_identity_mismatch');
  return observedValue;
}
function assertAcademicFilter(probe,identity){
  if(probe.academic_filter?.field!=='calschoolyear'||typeof probe.academic_filter.raw_value!=='string')fail('calendar_academic_filter_unproven');
  return expectedAcademicFilter(identity,probe.academic_filter.raw_value);
}
function parseCalendarMonth(probe,month,range,courses){
  if(probe?.schema!=='jupiter-calendar-dom-probe.v1'||!Array.isArray(probe.date_cells)||!Array.isArray(probe.controls)||!Array.isArray(courses))fail('calendar_probe_invalid');
  if(selectedMonth(probe)!==month)fail('calendar_selected_month_unproven');
  const events=[],seenDays=new Set(),expected=monthDays(month),dates=new Set();
  let structural=true;
  for(const cell of probe.date_cells){
    const date=typeof cell.date_id==='string'?cell.date_id.slice(1):'';
    if(!/^c\d{4}-\d{2}-\d{2}$/.test(cell.date_id||'')||!validDate(date))fail('calendar_date_cell_invalid');
    if(date.slice(0,7)!==month)continue; // Never double-count adjacent-month grid spillover.
    if(seenDays.has(date))fail('calendar_duplicate_date_cell');seenDays.add(date);
    if(cell.visible!==true)structural=false;
    dates.add(date);
    if(date<range.start_date||date>range.end_date)continue;
    let label=null;
    for(const child of cell.children||[]){
      const classes=(child.attributes?.class||'').split(/\s+/);
      if(classes.includes('annlabel')){label=child.raw_text??null;continue;}
      if(!classes.includes('announce'))continue;
      const title=typeof child.raw_text==='string'?child.raw_text:null;
      const raw={date_cell_id:cell.date_id,node:clone(child),category_label:label};
      raw.observation_hash=fingerprint(raw); // Evidence fingerprint, NEVER a stable event ID.
      const evidence={identity:{verified:false,reason:'rendered_announcement_has_no_verified_event_id'},
        date:{verified:true,raw_text:date,method:'exact_calendar_date_cell_id',dom_value:cell.date_id}};
      const course=courses.includes(norm(label))?norm(label):null;
      if(course)evidence.course={verified:true,raw_text:label,method:'exact_configured_course_label'};
      if(label)evidence.event_type={verified:true,raw_text:label,method:'rendered_announcement_category_label'};
      events.push({source_event_id:null,assignment_id:null,title,display_text:title,date,
        start_time:null,end_time:null,all_day:null,course,location:null,event_type:label?norm(label):null,raw,evidence});
    }
  }
  const links=new Set();
  for(const control of probe.controls){
    const handler=control.attributes?.click||control.attributes?.onclick||'';
    const match=handler.match(/^goassign\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)\s*;?$/);
    if(!match)continue;
    const ancestors=(control.ancestors||[]).map(x=>x.id).filter(x=>/^show\d{4}-\d{2}-\d{2}$/.test(x||''));
    const unique=[...new Set(ancestors.map(x=>x.slice(4)))];
    if(unique.length!==1||!validDate(unique[0]))continue;
    const date=unique[0];
    if(date.slice(0,7)!==month||date<range.start_date||date>range.end_date||!dates.has(date))continue;
    const assignmentVerified=/^[1-9]\d*$/.test(match[1]);
    // goassign(0, ...) is observed on real Calendar rows, but its second
    // argument has no verified identity semantics. Preserve each such row;
    // neither merge it with other zero-ID rows nor promote that argument.
    if(assignmentVerified){const identity=JSON.stringify([match[1],date]);if(links.has(identity))continue;links.add(identity);}
    events.push({source_event_id:null,assignment_id:match[1],title:typeof control.text==='string'?control.text:null,
      display_text:typeof control.text==='string'?control.text:null,date,start_time:null,end_time:null,all_day:null,
      course:null,location:null,event_type:null,
      raw:{handler,date_container:`show${date}`,attributes:clone(control.attributes||{})},
      evidence:{assignment:{verified:assignmentVerified,raw_id:match[1],method:'exact_rendered_goassign_handler',
        ...(assignmentVerified?{}:{reason:'observed_primary_assignment_id_unproven'})},
        date:{verified:true,raw_text:date,method:'exact_day_panel_id_and_calendar_cell',dom_value:`show${date}`}}});
  }
  const filters=probe.display_filters;
  const filterVerified=filters?.announcements===true&&filters?.due_dates===true;
  const dateComplete=expected.every(date=>seenDays.has(date))&&structural&&probe.calendar_visible===true;
  return {month,status:dateComplete&&filterVerified?'complete':'partial',
    error_code:!dateComplete?'calendar_month_days_incomplete':!filterVerified?'calendar_display_filters_unproven':null,events,
    coverage:{expected_days:expected.length,observed_days:seenDays.size,selected_month_verified:true,
      date_grid_complete:dateComplete,display_filters:filters?clone(filters):{announcements:null,due_dates:null},
      identity_unproven_announcements:events.filter(e=>e.assignment_id===null).length,
      assignment_links:events.filter(e=>e.evidence.assignment?.verified===true).length,
      unproven_assignment_observations:events.filter(e=>e.assignment_id!==null&&e.evidence.assignment?.verified!==true).length},
    evidence_fingerprint:fingerprint({month,dates:[...seenDays].sort(),events})};
}

function menuWitness(month){
  const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';
  const container=document.querySelector('#menulist_calview');
  if(!visible(container)||(container.getAttribute('click')||container.getAttribute('onclick'))!=="clickmenu('calview')")return false;
  const options=[...container.querySelectorAll('[val]')].filter(e=>e.getAttribute('val')===month&&visible(e));
  return options.length===1;
}
function renderedMonthReady(month){
  const scripts=[...document.querySelectorAll('#mainpage script')].map(e=>e.textContent||'');
  const regex=new RegExp('^\\s*menu\\(\\s*[\x27\x22]calview[\x27\x22]\\s*,\\s*[\x27\x22]'+month+'[\x27\x22]\\s*,','m');
  const selected=document.querySelector('#menulit_calview')?.getAttribute('val');
  if(selected!==month&&!scripts.some(line=>regex.test(line)))return false;
  const [year,number]=month.split('-').map(Number),days=new Date(Date.UTC(year,number,0)).getUTCDate();
  const observed=new Set([...document.querySelectorAll('#mainpage td[id^="c20"]')].map(e=>e.id.slice(1)).filter(date=>date.startsWith(month+'-')));
  return Array.from({length:days},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`).every(date=>observed.has(date));
}
// Bind account selectors in an official form to what the authenticated page
// actually rendered. These transient values never enter the observation.
function routeFieldWitness(){
  const fields = {};
  for (const key of ['school','stud','year','district','contact']) {
    const inputs = document.querySelectorAll('input[name="'+key+'"]');
    if (inputs.length > 1) return null;
    if (inputs.length === 1) fields[key] = inputs[0].value;
  }
  return fields;
}
function calendarTimingWitness(){
  // Keep this existing official-page clock only in the navigation context.
  // No session value, student identifier, clock value or form is logged.
  const capturedAtMs=Date.now(),offset=globalThis.timedif;
  if(typeof offset!=='number'||!Number.isFinite(offset))return null;
  const serverSeconds=Math.floor(capturedAtMs/1000)-offset;
  return Number.isFinite(serverSeconds)&&serverSeconds>0?{capturedAtMs,serverSeconds}:null;
}
async function assertSameSession(page,nav,config,identity,run=async operation=>operation()){
  const url=new URL(page.url());if(url.origin!=='https://login.jupitered.com')fail('calendar_origin_invalid');
  await run(()=>nav.assertPageAvailable());if(!(await run(()=>nav.isAuthenticated())))fail('calendar_session_expired');
  const actual=await run(()=>page.evaluate(()=>({name:document.querySelector('#leftmast .toptabnull')?.textContent,
    school_year:document.querySelector('#schoolyeartab')?.textContent,
    courses:[...document.querySelectorAll('#sidebar .classnav')].map(e=>e.textContent)})));
  if(norm(actual.name)!==norm(config.expected_name)||norm(actual.school_year)!==norm(config.expected_school_year)||
    JSON.stringify(actual.courses.map(norm).sort())!==JSON.stringify(config.expected_courses.map(norm).sort()))fail('calendar_identity_mismatch');
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*student\.php$/.test(url.pathname) || url.username || url.password) fail('calendar_origin_invalid');
  const routes=url.searchParams.getAll('w');
  if(routes.length>1||routes.length===1&&!/^\d+(?:,\d+)+$/.test(routes[0]))fail('calendar_school_route_ambiguous');
  if(routes.length&&routes[0].split(',')[0]!==identity.school_id)fail('calendar_school_identity_mismatch');
}
async function collectCalendarFromAuthenticatedPage(page,nav,config,identity,options={}){
  const scope=identityScope(identity);if(identity.verified!==true)fail('calendar_identity_unproven');
  if(scope.school_year!==norm(config.expected_school_year)||config.school_id&&String(config.school_id)!==scope.school_id)fail('calendar_identity_context_invalid');
  const authenticatedPage = new URL(page.url());
  const boundRoute = authenticatedPage.searchParams.getAll('w');
  if (authenticatedPage.origin !== 'https://login.jupitered.com' || authenticatedPage.username || authenticatedPage.password)
    fail('calendar_origin_invalid');
  if (!boundRoute.length || [...authenticatedPage.searchParams].some(([key]) => key !== 'w'))
    fail('calendar_route_context_missing');
  if (boundRoute.length !== 1 || !/^\d+(?:,\d+)+$/.test(boundRoute[0])) fail('calendar_school_route_ambiguous');
  if (boundRoute[0].split(',')[0] !== scope.school_id) fail('calendar_school_identity_mismatch');
  for (const previous of options.witnessedRoutes || []) {
    const url = new URL(previous);
    if (url.origin !== authenticatedPage.origin) fail('calendar_origin_invalid');
    const seen = url.searchParams.getAll('w');
    if (url.pathname === authenticatedPage.pathname && seen.length && (seen.length !== 1 || seen[0] !== boundRoute[0])) {
      fail('calendar_identity_mismatch');
    }
  }
  const assertBoundRoute = () => {
    const current = new URL(page.url());
    if (current.origin !== authenticatedPage.origin || current.pathname !== authenticatedPage.pathname ||
        current.searchParams.size !== 1 || current.searchParams.get('w') !== boundRoute[0]) fail('calendar_school_route_ambiguous');
  };
  const at=options.now||new Date().toISOString(),range=requestedCalendarRange(at,config.timezone),months=requestedMonths(range);
  const maxMonths=options.maxMonths??4,deadlineMs=options.deadlineMs??60000;
  if(!Number.isInteger(maxMonths)||maxMonths<1||maxMonths>4||months.length>maxMonths||!Number.isFinite(deadlineMs)||deadlineMs<1000||deadlineMs>60000)fail('calendar_read_budget_invalid');
  const start=Date.now(),capture=options.capture||captureCalendarDom,result=[];
  let stopped=false;
  const remaining=()=>{const left=deadlineMs-(Date.now()-start);if(left<=0)fail('calendar_read_budget_exhausted');return Math.min(10000,left);};
  const bounded=async operation=>{
    remaining();let timer;
    try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(new Error('calendar_read_budget_exhausted'),{code:'calendar_read_budget_exhausted'})),deadlineMs-(Date.now()-start));
    })]);}finally{clearTimeout(timer);}
  };
  for(const month of months){
    if(stopped){result.push({month,status:'failed',events:[],error_code:'calendar_previous_month_failed'});continue;}
    try{
      remaining();assertBoundRoute();await assertSameSession(page,nav,config,scope,bounded);
      const current=await bounded(()=>capture(page));
      const academicFilter=assertAcademicFilter(current,scope);
      if(selectedMonth(current)!==month){
        if(!(await bounded(()=>page.evaluate(menuWitness,month)))){
          const opener=await bounded(()=>page.$('#mainpage [click="popmenu(\'calview\')"]'));
          if(!opener)fail('calendar_month_menu_unavailable');
          const witness=await bounded(()=>opener.evaluate(e=>e.getClientRects().length>0&&(e.getAttribute('click')||e.getAttribute('onclick'))==="popmenu('calview')"));
          if(!witness)fail('calendar_month_menu_unavailable');
          await bounded(()=>opener.click());
          await bounded(()=>page.waitForFunction(menuWitness,{timeout:remaining()},month));
        }
        if(!(await bounded(()=>page.evaluate(menuWitness,month))))fail('calendar_month_not_offered');
        // Narrow request-policy context exists only for this already-witnessed
        // UI month selection; caller clears it after navigation/failure.
        const calendarTiming=await bounded(()=>page.evaluate(calendarTimingWitness));
        const routeFields = await bounded(()=>page.evaluate(routeFieldWitness));
        if(!routeFields)fail('calendar_academic_filter_unproven');
        options.onMonthSelect?.(month,academicFilter,page.url(),calendarTiming,routeFields);
        await bounded(()=>page.click(`#menulist_calview [val="${month}"]`));
        await bounded(()=>page.waitForFunction(renderedMonthReady,{timeout:remaining()},month));
      }
      assertBoundRoute();await assertSameSession(page,nav,config,scope,bounded);remaining();
      const captured=await bounded(()=>capture(page));assertAcademicFilter(captured,scope);
      const parsed=parseCalendarMonth(captured,month,range,config.expected_courses);
      const scopeEvidence={verified:true,raw_text:captured.academic_filter.raw_value,field:'calschoolyear',method:'rendered_calendar_filter_matches_verified_school_and_academic_year'};
      for(const event of parsed.events)event.evidence.calendar_scope=clone(scopeEvidence);
      parsed.evidence_fingerprint=fingerprint({month:parsed.month,events:parsed.events,coverage:parsed.coverage});
      result.push(parsed);
      if(parsed.status!=='complete')stopped=true;
    }catch(error){
      const code=typeof error.code==='string'?error.code:typeof error.message==='string'?error.message:'';
      if(['calendar_origin_invalid','calendar_identity_mismatch','calendar_school_route_ambiguous','calendar_school_identity_mismatch'].includes(code))throw error;
      const allowed=new Set(['calendar_origin_invalid','calendar_session_expired','calendar_identity_mismatch','calendar_school_route_ambiguous','calendar_school_identity_mismatch',
        'calendar_read_budget_exhausted','calendar_month_menu_unavailable','calendar_month_not_offered','calendar_selected_month_unproven','calendar_date_cell_invalid',
        'calendar_duplicate_date_cell','calendar_probe_invalid','calendar_probe_origin_invalid','calendar_probe_budget_exceeded','calendar_academic_filter_unproven','upstream_maintenance','upstream_unavailable']);
      result.push({month,status:'failed',events:[],error_code:options.monthNavigationBlocked?.()===true?'calendar_navigation_blocked':allowed.has(code)?code:error.name==='TimeoutError'?'calendar_page_timeout':'calendar_read_failed'});
      stopped=true;
    }finally{options.onMonthSelect?.(null);}
  }
  return {schema:'jupiter-calendar-observation.v1',observed_at:at,timezone:config.timezone,
    identity:{verified:true,...scope},range,months:result,
    limits:{max_months:maxMonths,max_duration_ms:deadlineMs,months_attempted:result.filter(x=>x.error_code!=='calendar_previous_month_failed').length},
    policy:{same_authenticated_session:true,no_new_login:true,ui_witnessed_months_only:true,date_only_not_full_day_busy:true}};
}
module.exports={collectCalendarFromAuthenticatedPage,parseCalendarMonth,requestedCalendarRange,requestedMonths,selectedMonth,monthDays,expectedAcademicFilter,assertAcademicFilter};
