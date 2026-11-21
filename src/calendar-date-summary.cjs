'use strict';

// Pure date-level source aggregation. Its date key is NOT a school event ID.
// Stable Calendar events, assignment relations, persistence and APIs are untouched.
const {fingerprint}=require('./state.cjs');
const {validateCalendarState,identityScope,validDate}=require('./calendar-state.cjs');
const {assertAcademicFilter}=require('./calendar-session-read.cjs');
const SCHEMA='jupiter-calendar-date-summaries.v1';
const RECORD_SCHEMA='jupiter-calendar-date-summary.v1';
const POLICY=Object.freeze({source_only:true,learning_task:false,school_submission:false,
  event_identity_claimed:false,date_key_is_aggregation_only:true,date_only_not_full_day_busy:true,
  specific_class_periods:'unknown',no_automatic_completion:true,no_deletion:true});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const text=x=>typeof x==='string'&&x.trim().length>0;
const timestamp=x=>typeof x==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sensitive=/^(?:(?:text_)?password\d*|passwd|pwd|cookie|cookies|token|access_token|refresh_token|authorization|credentials?|session|session_state|storage_state|browser_profile|localStorage|sessionStorage|login_state)$/i;
function copy(value,key='',depth=0){
  if(depth>50||sensitive.test(key))fail('calendar_summary_sensitive_or_invalid_data');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(x=>copy(x,'',depth+1));
  if(plain(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v,k,depth+1)]));
  fail('calendar_summary_sensitive_or_invalid_data');
}
function dateSummaryId(scope,date){return `jupiter-calendar-day:${fingerprint([scope.scope_hash,scope.school_id,scope.school_year]).slice(0,24)}:${date}`;}
function itemSemantics(item){return {title:item.title,display_text:item.display_text,category_label:item.category_label,course:item.course};}
function dateSummaryFingerprint(record){return fingerprint({identity:record.identity,date:record.observed.date,
  items:record.observed.items.map(itemSemantics),start_time:null,end_time:null,all_day:null,precision:'date'});}
function evidenceFingerprint(record){return fingerprint(record.observed.items.map(item=>({raw:item.raw,evidence:item.evidence})));}
function checkRange(range){
  if(!plain(range)||!validDate(range.start_date)||!validDate(range.end_date)||range.start_date>range.end_date||Date.parse(range.end_date)-Date.parse(range.start_date)>100*86400000)fail('calendar_summary_range_invalid');
  const months=new Set();for(let day=Date.parse(range.start_date);day<=Date.parse(range.end_date);day+=86400000)months.add(new Date(day).toISOString().slice(0,7));
  if(months.size>4)fail('calendar_summary_month_budget_invalid');
  return months;
}
function inRange(date,range){return date>=range.start_date&&date<=range.end_date;}
function checkItem(item,date,scope){
  const raw=item?.raw,e=item?.evidence,node=raw?.node;
  if(!plain(item)||!text(item.title)||item.display_text!==item.title||!plain(raw)||!plain(e)||
    raw.date_cell_id!==`c${date}`||node?.visible!==true||!String(node?.attributes?.class||'').split(/\s+/).includes('announce')||
    node.raw_text!==item.title||e.identity?.verified!==false||e.identity.reason!=='rendered_announcement_has_no_verified_event_id'||
    e.date?.verified!==true||e.date.method!=='exact_calendar_date_cell_id'||e.date.raw_text!==date||e.date.dom_value!==`c${date}`)
    fail('calendar_summary_announcement_evidence_unproven');
  const rawWithoutHash=copy(raw);delete rawWithoutHash.observation_hash;
  if(raw.observation_hash!==fingerprint(rawWithoutHash))fail('calendar_summary_raw_fingerprint_mismatch');
  const scopeEvidence=e.calendar_scope;
  if(scopeEvidence?.verified!==true||scopeEvidence.field!=='calschoolyear'||scopeEvidence.method!=='rendered_calendar_filter_matches_verified_school_and_academic_year')fail('calendar_summary_scope_evidence_unproven');
  assertAcademicFilter({academic_filter:{field:scopeEvidence.field,raw_value:scopeEvidence.raw_text}},scope);
  if(item.category_label!==raw.category_label||item.category_label!==null&&typeof item.category_label!=='string')fail('calendar_summary_category_evidence_unproven');
  if(item.course!==null&&(!text(item.course)||e.course?.verified!==true||e.course.method!=='exact_configured_course_label'||
    !text(e.course.raw_text)||e.course.raw_text.replace(/\s+/g,' ').trim()!==item.course))fail('calendar_summary_course_evidence_unproven');
  // No handler-derived row or assignment relationship is promoted to an announcement.
  const assignmentAction=value=>typeof value==='string'?/\bgoassign\s*\(/i.test(value):Array.isArray(value)?value.some(assignmentAction):plain(value)?Object.values(value).some(assignmentAction):false;
  if(node.contains_assignment_action === true || assignmentAction(raw))fail('calendar_summary_assignment_action_rejected');
  return item;
}
function validateCalendarDateSummaries(state,context){
  copy(state);
  if(!plain(state)||state.schema!==SCHEMA||!Array.isArray(state.records)||state.records.length>10000||!Array.isArray(state.coverage)||state.coverage.length>4||!timestamp(state.last_observed_at))fail('calendar_summary_state_invalid');
  const scope=identityScope(state.identity_scope),months=checkRange(state.requested_range);
  if(context&&fingerprint(scope)!==fingerprint(identityScope(context)))fail('calendar_summary_scope_mismatch');
  try{if(typeof state.timezone!=='string')throw Error();new Intl.DateTimeFormat('en',{timeZone:state.timezone});}catch{fail('calendar_summary_timezone_invalid');}
  if(context&&state.timezone!==context.timezone)fail('calendar_summary_timezone_mismatch');
  const covered=new Set();
  for(const month of state.coverage){
    if(!plain(month)||!months.has(month.month)||covered.has(month.month)||!['complete','partial','failed'].includes(month.status)||month.observed_at!==state.last_observed_at)fail('calendar_summary_coverage_invalid');
    covered.add(month.month);
  }
  const ids=new Set();
  for(const record of state.records){
    const date=record?.identity?.date,o=record?.observed,c=record?.coverage;
    if(!plain(record)||record.schema!==RECORD_SCHEMA||record.record_kind!=='calendar_date_summary'||!validDate(date)||
      ['scope_hash','school_id','school_year'].some(k=>record.identity[k]!==scope[k])||record.id!==dateSummaryId(scope,date)||ids.has(record.id)||
      record.source_event_id!==null||record.assignment_id!==null||record.presence!=='present'||typeof record.stale!=='boolean'||
      !plain(o)||o.date!==date||!Array.isArray(o.items)||o.items.length>1000||o.start_time!==null||o.end_time!==null||o.all_day!==null||o.precision!=='date'||o.specific_class_periods!=='unknown'||
      !timestamp(record.first_seen_at)||!timestamp(record.last_seen_at)||!timestamp(record.fetched_at)||!timestamp(record.last_checked_at)||
      Date.parse(record.first_seen_at)>Date.parse(record.last_seen_at)||Date.parse(record.last_seen_at)>Date.parse(state.last_observed_at)||record.last_seen_at!==record.fetched_at||record.last_checked_at!==state.last_observed_at||
      !plain(c)||c.month!==date.slice(0,7)||c.status!=='complete'||c.observed_at!==record.fetched_at||fingerprint(record.policy)!==fingerprint(POLICY))fail('calendar_summary_record_invalid');
    checkRange(c.range);if(!inRange(date,c.range))fail('calendar_summary_record_invalid');
    for(const item of o.items)checkItem(item,date,scope);
    if(record.semantic_fingerprint!==dateSummaryFingerprint(record)||record.evidence_fingerprint!==evidenceFingerprint(record))fail('calendar_summary_record_fingerprint_invalid');
    if(!record.stale&&(!inRange(date,state.requested_range)||record.fetched_at!==state.last_observed_at||!state.coverage.some(m=>m.month===c.month&&m.status==='complete')))fail('calendar_summary_freshness_invalid');
    ids.add(record.id);
  }
  if(state.semantic_fingerprint!==fingerprint(state.records.map(r=>[r.id,r.semantic_fingerprint]).sort((a,b)=>a[0].localeCompare(b[0]))))fail('calendar_summary_fingerprint_invalid');
  return state;
}
function mergeCalendarDateSummaries(calendar,previous=null,context){
  validateCalendarState(calendar,context);const scope=identityScope(calendar.identity_scope),range=copy(calendar.requested_range),months=checkRange(range);
  const at=calendar.last_observed_at,coverage=copy(calendar.coverage);
  if(coverage.length>4||coverage.some(m=>!months.has(m.month)||m.observed_at!==at))fail('calendar_summary_coverage_invalid');
  if(previous){validateCalendarDateSummaries(previous,{...scope,timezone:calendar.timezone});if(Date.parse(at)<Date.parse(previous.last_observed_at))fail('calendar_summary_observation_out_of_order');}
  const grouped=new Map(),blockedDates=new Set(),blockedMonths=new Set(),holds=[];
  let excluded=0;
  for(const row of calendar.pending){
    if(row.reason!=='calendar_event_identity_unproven'||row.source_event_id!==null||row.assignment_id!==null){excluded++;continue;}
    const date=row.date,month=row.source_month;
    if(!coverage.some(m=>m.month===month&&m.status==='complete'))continue;
    try{
      if(!validDate(date)||date.slice(0,7)!==month||!inRange(date,range)||row.observed_at!==at||row.retained_from_previous_read===true)fail('calendar_summary_date_or_observation_unproven');
      if(row.start_time!==null||row.end_time!==null||row.all_day!==null)fail('calendar_summary_date_only_semantics_required');
      const item=copy({title:row.title,display_text:row.display_text,category_label:row.raw?.category_label??null,
        course:row.evidence?.course?.verified===true?row.course:null,raw:row.raw,evidence:row.evidence});
      checkItem(item,date,scope);if(!grouped.has(date))grouped.set(date,[]);grouped.get(date).push(item);
    }catch(error){
      // Contradictory school/year evidence is a scope failure, not an ordinary
      // anonymous-row hold. Callers retain the prior whole summary state.
      if(error.code==='calendar_school_identity_mismatch')throw error;
      holds.push({date:validDate(date)?date:null,month,reason:typeof error.code==='string'?error.code:'calendar_summary_evidence_unproven'});
      if(validDate(date)&&date.slice(0,7)===month)blockedDates.add(date);else blockedMonths.add(month);
    }
  }
  const oldByDate=new Map((previous?.records||[]).map(r=>[r.observed.date,r]));
  const dates=new Set([...grouped.keys(),...oldByDate.keys()]),records=[],changes={added:[],changed:[],unchanged:[],retained:[]};
  for(const date of [...dates].sort()){
    const old=oldByDate.get(date),month=coverage.find(m=>m.month===date.slice(0,7));
    const complete=inRange(date,range)&&month?.status==='complete'&&!blockedDates.has(date)&&!blockedMonths.has(date.slice(0,7));
    if(!complete){if(old){records.push({...copy(old),stale:true,last_checked_at:at});changes.retained.push(old.id);}continue;}
    const items=(grouped.get(date)||[]).sort((a,b)=>fingerprint(itemSemantics(a)).localeCompare(fingerprint(itemSemantics(b)))||fingerprint(a).localeCompare(fingerprint(b)));
    if(!old&&!items.length)continue; // Do not create records for every empty date.
    const record={schema:RECORD_SCHEMA,id:dateSummaryId(scope,date),record_kind:'calendar_date_summary',identity:{...scope,date},source_event_id:null,assignment_id:null,
      observed:{date,items,start_time:null,end_time:null,all_day:null,precision:'date',specific_class_periods:'unknown'},policy:copy(POLICY),presence:'present',stale:false,
      coverage:{month:date.slice(0,7),status:'complete',observed_at:at,range},first_seen_at:old?.first_seen_at||at,last_seen_at:at,fetched_at:at,last_checked_at:at};
    record.semantic_fingerprint=dateSummaryFingerprint(record);record.evidence_fingerprint=evidenceFingerprint(record);records.push(record);
    changes[!old?'added':old.semantic_fingerprint!==record.semantic_fingerprint?'changed':'unchanged'].push(record.id);
  }
  const state={schema:SCHEMA,identity_scope:scope,timezone:calendar.timezone,requested_range:range,coverage,last_observed_at:at,records,
    semantic_fingerprint:fingerprint(records.map(r=>[r.id,r.semantic_fingerprint]).sort((a,b)=>a[0].localeCompare(b[0])))};
  validateCalendarDateSummaries(state,context);
  return {state,summary:{schema:'jupiter-calendar-date-summary-report.v1',records:records.length,announcements:records.filter(r=>!r.stale).reduce((n,r)=>n+r.observed.items.length,0),
    added:changes.added.length,changed:changes.changed.length,unchanged:changes.unchanged.length,retained:changes.retained.length,
    empty_summaries:records.filter(r=>!r.stale&&r.observed.items.length===0).length,held:holds.length,excluded_pending:excluded,assignment_links_untouched:calendar.assignment_links.length,
    remote_writes:0,changes,holds}};
}
module.exports={SCHEMA,RECORD_SCHEMA,mergeCalendarDateSummaries,validateCalendarDateSummaries,dateSummaryFingerprint};
