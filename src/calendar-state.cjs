'use strict';

// Independent calendar source state. No assignment mutation, persistence, API or
// learning planner is reachable from this module. Unknown identity stays pending.
const {fingerprint}=require('./state.cjs');
const SCHEMA='jupiter-calendar-state.v1';
const OBSERVATION_SCHEMA='jupiter-calendar-observation.v1';
const SENSITIVE=/^(?:(?:text_)?password\d*|passwd|pwd|cookie|cookies|token|access_token|refresh_token|authorization|credentials?|session|session_state|storage_state|browser_profile|localStorage|sessionStorage|login_state)$/i;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const text=x=>typeof x==='string'?x.replace(/\s+/g,' ').trim():'';
function fail(code){throw Object.assign(new Error(code),{code});}
function clone(x,key='',depth=0){
  if(depth>50)fail('calendar_invalid_json');
  if(SENSITIVE.test(key))fail('calendar_credential_field_rejected');
  if(x===null||typeof x==='string'||typeof x==='boolean')return x;
  if(typeof x==='number'&&Number.isFinite(x))return x;
  if(Array.isArray(x))return x.map(v=>clone(v,'',depth+1));
  if(plain(x))return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,clone(v,k,depth+1)]));
  fail('calendar_invalid_json');
}
function validTime(value){return typeof value==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));}
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
}
const validClock=x=>typeof x==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
const validSourceId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
function identityScope(context){
  const value={scope_hash:context?.scopeHash??context?.scope_hash,school_id:context?.schoolId??context?.school_id,school_year:context?.schoolYear??context?.school_year};
  if(!/^[a-f0-9]{64}$/.test(value.scope_hash||'')||!/^\d+$/.test(value.school_id||'')||!text(value.school_year)||value.school_year==='unknown')fail('calendar_identity_context_invalid');
  return value;
}
function sourceId(scope,id){return `jupiter-calendar:${fingerprint([scope.scope_hash,scope.school_id,scope.school_year]).slice(0,24)}:${id}`;}
function sourceSemanticFingerprint(record){return fingerprint({identity:record.identity,observed:record.observed});}
function observationFingerprint(value){
  const volatile=new Set(['observed_at','fetched_at','first_seen_at','last_seen_at','last_checked_at','retained_from_previous_read']);
  const strip=x=>Array.isArray(x)?x.map(strip):plain(x)?Object.fromEntries(Object.entries(x).filter(([key])=>!volatile.has(key)).map(([key,v])=>[key,strip(v)])):x;
  return fingerprint(strip(value));
}
function retainUnreadObservations(current,previous,coverage,at){
  const occurrences=new Map();
  for(const row of current){const key=observationFingerprint(row);occurrences.set(key,(occurrences.get(key)||0)+1);}
  for(const row of previous){
    if(coverage.some(m=>m.month===row.source_month&&m.status==='complete'))continue;
    const key=observationFingerprint(row),count=occurrences.get(key)||0;
    if(count){occurrences.set(key,count-1);continue;}
    current.push({...clone(row),retained_from_previous_read:true,last_checked_at:at});
  }
}
function archivePending(current,previous,at){
  // Fingerprints group identical archived evidence, not events. A title/date
  // change cannot be called a rename, deletion, or stable-ID match here.
  const currentFingerprints=new Set(current.map(observationFingerprint));
  const archive=new Map((previous?.pending_history||[]).map(item=>[item.observation_fingerprint,clone(item)]));
  for(const old of previous?.pending||[]){
    const key=observationFingerprint(old);
    if(currentFingerprints.has(key))continue;
    if(!archive.has(key))archive.set(key,{observation_fingerprint:key,observation:clone(old),archived_at:at,
      status:'not_observed_evidence_retained_not_event_deletion',event_identity_claimed:false,publication_allowed:false});
  }
  if(archive.size>10000)fail('calendar_pending_history_limit');
  return [...archive.values()].sort((a,b)=>a.observation_fingerprint.localeCompare(b.observation_fingerprint));
}
function hasTextProof(evidence,field){return plain(evidence?.[field])&&evidence[field].verified===true&&!!text(evidence[field].raw_text);}
function boundedRange(value){
  if(!plain(value)||!validDate(value.start_date)||!validDate(value.end_date)||value.start_date>value.end_date||
    Date.parse(value.end_date)-Date.parse(value.start_date)>100*86400000)fail('calendar_range_invalid');
  return {start_date:value.start_date,end_date:value.end_date};
}
function normalizedRow(input,scope,month,at){
  if(!plain(input))fail('calendar_event_shape_invalid');
  const raw=clone(input.raw||{}),evidence=clone(input.evidence||{}),title=typeof input.title==='string'?input.title:null;
  const sourceEventId=input.source_event_id??null,assignment=input.assignment_id??null;
  const base={source_event_id:sourceEventId,assignment_id:assignment,title,display_text:typeof input.display_text==='string'?input.display_text:null,
    date:input.date??null,start_time:input.start_time??null,end_time:input.end_time??null,all_day:input.all_day??null,
    course:input.course??null,location:input.location??null,event_type:input.event_type??null,raw,evidence,source_month:month,observed_at:at};
  // Assignment presentation is a relationship, never an independent calendar task.
  if(assignment!==null){
    const handlerId = typeof raw.handler === 'string' &&
      raw.handler.match(/^goassign\(\s*([1-9]\d*)\s*(?:,\s*\d+\s*)?\)\s*;?$/)?.[1];
    if(handlerId !== String(assignment) || evidence.assignment?.method !== 'exact_rendered_goassign_handler' ||
      evidence.assignment.verified !== true || String(evidence.assignment.raw_id) !== handlerId ||
      !validDate(input.date) || input.date.slice(0,7) !== month || raw.date_container !== 'show'+input.date ||
      evidence.date?.verified !== true || evidence.date.method !== 'exact_day_panel_id_and_calendar_cell' ||
      evidence.date.raw_text !== input.date || evidence.date.dom_value !== raw.date_container)
      return {pending:{...base,reason:'calendar_assignment_link_unproven'}};
    return {link:{...base,assignment_id:String(assignment),record_kind:'assignment_calendar_link',independent_event:false}};
  }
  if(!validSourceId(sourceEventId)||evidence.identity?.verified!==true||evidence.identity.raw_id!==sourceEventId)
    return {pending:{...base,reason:'calendar_event_identity_unproven'}};
  if(!text(title))return {pending:{...base,reason:'calendar_event_title_missing'}};
  if(!validDate(input.date)||!hasTextProof(evidence,'date'))return {pending:{...base,reason:'calendar_event_date_unproven'}};
  const timeProven=hasTextProof(evidence,'time');
  if(timeProven&&((input.start_time!=null&&!validClock(input.start_time))||(input.end_time!=null&&!validClock(input.end_time))))
    return {pending:{...base,reason:'calendar_event_time_invalid'}};
  const start=timeProven&&validClock(input.start_time)?input.start_time:null;
  const end=timeProven&&validClock(input.end_time)?input.end_time:null;
  if(start&&end&&end<start)return {pending:{...base,reason:'calendar_event_overnight_range_unproven'}};
  const allDay=hasTextProof(evidence,'all_day')&&typeof input.all_day==='boolean'?input.all_day:null;
  if(allDay===true&&(start||end))return {pending:{...base,reason:'calendar_event_time_conflict'}};
  const observed={title,display_text:base.display_text,date:input.date,start_time:start,end_time:end,
    all_day:allDay,precision:start||end?'time':'date',
    course:hasTextProof(evidence,'course')&&text(input.course)?input.course:null,
    location:hasTextProof(evidence,'location')&&text(input.location)?input.location:null,
    event_type:hasTextProof(evidence,'event_type')&&text(input.event_type)?input.event_type:null,assignment_id:null};
  const record={id:sourceId(scope,sourceEventId),record_kind:'calendar_event_source',identity:{...scope,source_event_id:sourceEventId},
    identity_verified:true,date_verified:true,observed,raw,evidence,evidence_fingerprint:fingerprint(evidence),
    source:{system:'Jupiter Ed',origin:'https://login.jupitered.com/',scope:'authenticated_calendar_page',month},
    policy:{school_submission:false,learning_task:false,full_day_occupation_inferred:false,specific_class_periods:'unknown'},
    presence:'present',first_seen_at:at,last_seen_at:at,fetched_at:at};
  record.semantic_fingerprint=sourceSemanticFingerprint(record);
  return {record};
}
function validateCalendarState(calendar,context){
  if(!plain(calendar)||calendar.schema!==SCHEMA||!plain(calendar.identity_scope)||!Array.isArray(calendar.events)||!Array.isArray(calendar.pending)||!Array.isArray(calendar.pending_history)||!Array.isArray(calendar.assignment_links)||!Array.isArray(calendar.coverage))fail('calendar_previous_state_invalid');
  const scope=identityScope(calendar.identity_scope);
  if(context&&fingerprint(scope)!==fingerprint(identityScope(context)))fail('calendar_previous_scope_mismatch');
  clone(calendar);
  boundedRange(calendar.requested_range);
  if(!validTime(calendar.last_observed_at)||calendar.last_success_at!==null&&!validTime(calendar.last_success_at))fail('calendar_previous_state_invalid');
  try{if(typeof calendar.timezone!=='string')throw Error();new Intl.DateTimeFormat('en',{timeZone:calendar.timezone});}catch{fail('calendar_timezone_invalid');}
  if(context&&calendar.timezone!==context.timezone)fail('calendar_previous_timezone_mismatch');
  if(calendar.last_read_at!==null&&!validTime(calendar.last_read_at))fail('calendar_previous_state_invalid');
  const monthNames=new Set();
  for(const month of calendar.coverage){
    if(!plain(month)||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.month||'')||monthNames.has(month.month)||!['complete','partial','failed'].includes(month.status)||!validTime(month.observed_at))fail('calendar_previous_coverage_invalid');
    monthNames.add(month.month);
  }
  for (const link of calendar.assignment_links) {
    if (!plain(link) || !validTime(link.observed_at) || !normalizedRow(link,scope,link.source_month,link.observed_at).link)
      fail('calendar_previous_assignment_link_invalid');
  }
  const seen=new Set();
  for(const record of calendar.events){
    if(!plain(record)||!plain(record.identity)||!validSourceId(record.identity.source_event_id)||record.id!==sourceId(scope,record.identity.source_event_id)||seen.has(record.id)||
      ['scope_hash','school_id','school_year'].some(k=>record.identity[k]!==scope[k])||record.identity_verified!==true||record.date_verified!==true||
      !plain(record.observed)||!validDate(record.observed.date)||!text(record.observed.title)||!plain(record.evidence)||
      record.evidence.identity?.verified!==true||record.evidence.identity.raw_id!==record.identity.source_event_id||!hasTextProof(record.evidence,'date')||
      fingerprint(record.evidence)!==record.evidence_fingerprint||sourceSemanticFingerprint(record)!==record.semantic_fingerprint||
      !['present','not_observed','unverified'].includes(record.presence)||!validTime(record.last_seen_at)||!validTime(record.fetched_at))fail('calendar_previous_record_invalid');
    const rebuilt=normalizedRow({...record.observed,source_event_id:record.identity.source_event_id,raw:record.raw,evidence:record.evidence},scope,record.source?.month,record.last_seen_at);
    if(!rebuilt.record||fingerprint(rebuilt.record.observed)!==fingerprint(record.observed))fail('calendar_previous_record_invalid');
    seen.add(record.id);
  }
  if(calendar.semantic_fingerprint!==fingerprint(calendar.events.map(r=>[r.id,r.semantic_fingerprint]).sort((a,b)=>a[0].localeCompare(b[0]))))fail('calendar_previous_fingerprint_invalid');
  if(calendar.pending_observation_fingerprint!==fingerprint(calendar.pending.map(observationFingerprint).sort()))fail('calendar_pending_fingerprint_invalid');
  if(calendar.pending_history.length>10000)fail('calendar_pending_history_limit');
  const archived=new Set();
  for(const item of calendar.pending_history){
    if(!plain(item)||!plain(item.observation)||item.observation_fingerprint!==observationFingerprint(item.observation)||archived.has(item.observation_fingerprint)||
      !validTime(item.archived_at)||item.event_identity_claimed!==false||item.publication_allowed!==false||item.status!=='not_observed_evidence_retained_not_event_deletion')fail('calendar_pending_history_invalid');
    archived.add(item.observation_fingerprint);
  }
  const requestedMonths=monthsInRange(calendar.requested_range);
  const retrievalComplete=requestedMonths.every(m=>calendar.coverage.some(c=>c.month===m&&c.status==='complete'));
  if(calendar.retrieval_complete!==retrievalComplete||calendar.identity_complete!==(calendar.pending.length===0)||
    calendar.coverage_complete!==(retrievalComplete&&calendar.identity_complete)||calendar.publication_ready!==calendar.coverage_complete)fail('calendar_previous_coverage_invalid');
  return calendar;
}
function monthsInRange(range){
  const months=[];
  for(let month=range.start_date.slice(0,7);month<=range.end_date.slice(0,7);){
    months.push(month);const [y,m]=month.split('-').map(Number);month=m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`;
  }
  return months;
}
function mergeCalendarState(input,previous=null,context){
  const scope=identityScope(context),observation=clone(input);
  try{if(typeof context.timezone!=='string')throw Error();new Intl.DateTimeFormat('en',{timeZone:context.timezone});}catch{fail('calendar_timezone_invalid');}
  if(previous)validateCalendarState(previous,context);
  if(!plain(observation)||observation.schema!==OBSERVATION_SCHEMA||!validTime(observation.observed_at)||observation.timezone!==context.timezone||
    !plain(observation.identity)||observation.identity.verified!==true||['scope_hash','school_id','school_year'].some(k=>observation.identity[k]!==scope[k]))fail('calendar_observation_identity_invalid');
  if(previous?.last_observed_at&&Date.parse(observation.observed_at)<Date.parse(previous.last_observed_at))fail('calendar_observation_out_of_order');
  const range=boundedRange(observation.range),months=observation.months;
  if(!Array.isArray(months)||months.length>4)fail('calendar_month_budget_invalid');
  const covered=new Set(),records=new Map(),conflicted=new Set(),pending=[],links=[],coverage=[],at=observation.observed_at;
  const changes={added:[],changed:[],date_changed:[],time_changed:[],title_changed:[],not_observed:[],reappeared:[]};
  let duplicates=0;
  for(const month of months){
    if(!plain(month)||typeof month.month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.month)||covered.has(month.month)||!monthsInRange(range).includes(month.month)||!['complete','partial','failed'].includes(month.status)||!Array.isArray(month.events)||month.events.length>1000)fail('calendar_month_shape_invalid');
    covered.add(month.month);
    coverage.push({month:month.month,status:month.status,observed_at:at,error_code:typeof month.error_code==='string'&&/^[a-z][a-z0-9_]{1,70}$/.test(month.error_code)?month.error_code:null,rows:month.events.length});
    if(month.status==='failed'&&month.events.length)fail('calendar_failed_month_contains_events');
    for(const input of month.events){
      const row=normalizedRow(input,scope,month.month,at);
      if(row.pending){pending.push(row.pending);continue;}
      if(row.link){links.push(row.link);continue;}
      const record=row.record;
      if(record.observed.date<range.start_date||record.observed.date>range.end_date){pending.push({...clone(input),source_month:month.month,observed_at:at,reason:'calendar_event_outside_requested_range'});continue;}
      if(conflicted.has(record.id)){pending.push({...clone(input),source_month:month.month,observed_at:at,reason:'calendar_conflicting_duplicate_identity'});continue;}
      const other=records.get(record.id);
      if(other){
        if(other.semantic_fingerprint===record.semantic_fingerprint){duplicates++;continue;}
        records.delete(record.id);conflicted.add(record.id);
        pending.push({source_event_id:record.identity.source_event_id,source_month:month.month,observed_at:at,reason:'calendar_conflicting_duplicate_identity',observations:[other,record]});continue;
      }
      records.set(record.id,record);
    }
  }
  const oldById=new Map((previous?.events||[]).map(r=>[r.id,r]));
  for(const [id,record] of records){
    const old=oldById.get(id);
    if(!old)changes.added.push(id);
    else {
      record.first_seen_at=old.first_seen_at;
      if(old.semantic_fingerprint!==record.semantic_fingerprint){
        changes.changed.push(id);
        if(old.observed.date!==record.observed.date)changes.date_changed.push(id);
        if(old.observed.start_time!==record.observed.start_time||old.observed.end_time!==record.observed.end_time||old.observed.all_day!==record.observed.all_day)changes.time_changed.push(id);
        if(old.observed.title!==record.observed.title)changes.title_changed.push(id);
      }
      if(old.presence!=='present')changes.reappeared.push(id);
    }
  }
  for(const [id,old] of oldById){
    if(records.has(id))continue;
    const month=coverage.find(x=>x.month===old.observed.date.slice(0,7));
    const checked=old.observed.date>=range.start_date&&old.observed.date<=range.end_date&&month?.status==='complete'&&!conflicted.has(id);
    const presence=checked?'not_observed':'unverified';
    if(checked&&old.presence==='present')changes.not_observed.push(id);
    records.set(id,{...clone(old),presence,last_checked_at:at,absence_reason:checked?'not_observed_not_deleted':'source_coverage_incomplete_previous_record_retained'});
  }
  const events=[...records.values()].sort((a,b)=>a.id.localeCompare(b.id));
  // Unresolved observations from a failed/unread month remain inspectable. They
  // are not assigned guessed event IDs or promoted by title matching.
  retainUnreadObservations(pending,previous?.pending||[],coverage,at);
  retainUnreadObservations(links,previous?.assignment_links||[],coverage,at);
  const pendingHistory=archivePending(pending,previous,at);
  const requestedMonths=monthsInRange(range);
  const retrievalComplete=requestedMonths.every(m=>coverage.some(x=>x.month===m&&x.status==='complete'));
  const identityComplete=pending.length===0,complete=retrievalComplete&&identityComplete;
  // This digest detects a changed set of anonymous observations, not identity or
  // an event-level addition/deletion. It is never eligible as an event source ID.
  const pendingObservationFingerprint=fingerprint(pending.map(observationFingerprint).sort());
  const calendar={schema:SCHEMA,identity_scope:scope,timezone:context.timezone,requested_range:range,coverage,
    last_observed_at:at,last_success_at:complete?at:previous?.last_success_at||null,
    last_read_at:retrievalComplete?at:previous?.last_read_at||null,
    retrieval_complete:retrievalComplete,identity_complete:identityComplete,publication_ready:complete,
    coverage_complete:complete,events,pending,pending_history:pendingHistory,assignment_links:links,changes,pending_observation_fingerprint:pendingObservationFingerprint,
    semantic_fingerprint:fingerprint(events.map(r=>[r.id,r.semantic_fingerprint])),
    policy:{separate_from_assignments:true,no_deletion:true,no_automatic_completion:true,date_only_not_full_day_busy:true,unknown_identity_not_published:true}};
  validateCalendarState(calendar,context);
  return {calendar,summary:{calendar_status:complete?'complete':retrievalComplete?'read_with_unresolved_evidence':'partial',
    retrieval_complete:retrievalComplete,identity_complete:identityComplete,publication_ready:complete,last_read_at:calendar.last_read_at,
    pending_observation_set_changed:previous?previous.pending_observation_fingerprint!==pendingObservationFingerprint:null,
    months_requested:requestedMonths.length,months_read:coverage.filter(x=>x.status!=='failed').length,
    complete_months:coverage.filter(x=>x.status==='complete').length,failed_months:coverage.filter(x=>x.status==='failed').length,
    current_independent_events:events.filter(r=>r.presence==='present').length,retained_independent_events:events.length,pending:pending.length,pending_history:pendingHistory.length,
    pending_independent:pending.filter(row=>row.assignment_id===null||row.assignment_id===undefined).length,
    pending_assignment_links:pending.filter(row=>row.assignment_id!==null&&row.assignment_id!==undefined).length,
    assignment_links:links.length,added:changes.added.length,changed:changes.changed.length,date_changed:changes.date_changed.length,time_changed:changes.time_changed.length,
    unchanged:events.filter(r=>r.presence==='present').length-changes.added.length-changes.changed.length,identical_duplicates_merged:duplicates,remote_writes:0}};
}
module.exports={SCHEMA,OBSERVATION_SCHEMA,mergeCalendarState,validateCalendarState,sourceSemanticFingerprint,identityScope,validDate};
