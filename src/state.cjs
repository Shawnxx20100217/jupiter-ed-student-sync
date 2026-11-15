'use strict';

// Pure source-state transform. No network, file writes, scheduling or task execution.
const {createHash} = require('node:crypto');
const SCHEMA = 'jupiter-student-source.v1';
const SOURCE = 'https://login.jupitered.com/';

class StateError extends Error {
  constructor(code) { super(code); this.name = 'StateError'; this.code = code; }
}
const fail = code => { throw new StateError(code); };
const text = x => typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '';
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);

function copyJSON(value, key = '') {
  if (/^(?:password|password1|cookie|cookies|token|access_token|refresh_token|credentials|authorization|session|session_state|storage_state)$/i.test(key))
    fail('credential_field_in_source');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(v => copyJSON(v));
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,copyJSON(v,k)]));
  fail('invalid_source_json');
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');

// Account binding is derived before credentials are discarded. The clear login is
// never stored; these configured attributes and its digest stay inside ciphertext.
function scopeFromConfig(config, username) {
  if (!plain(config) || !text(username)) fail('account_scope_required');
  const required=['school','city','state','expected_name','expected_school_year','expected_term'];
  if (required.some(k=>!text(config[k]))) fail('account_scope_required');
  const scope={schema:'jupiter-student-scope.v1',school:text(config.school),city:text(config.city),region:text(config.state),
    student_name:text(config.expected_name),school_year:text(config.expected_school_year),term:text(config.expected_term),
    configured_school_id:config.school_id===undefined?null:String(config.school_id),
    account_id_hash:fingerprint({login:text(username)})};
  validateScope(scope);
  return Object.freeze(scope);
}
function validateScope(scope) {
  const keys=['schema','school','city','region','student_name','school_year','term','configured_school_id','account_id_hash'];
  if(!plain(scope)||Object.keys(scope).sort().join(',')!==keys.sort().join(',')||scope.schema!=='jupiter-student-scope.v1'||
    ['school','city','region','student_name','school_year','term'].some(k=>!text(scope[k])||scope[k]!==text(scope[k]))||
    !/^[a-f0-9]{64}$/.test(scope.account_id_hash||'')||
    !(scope.configured_school_id===null||/^\d+$/.test(scope.configured_school_id))) fail('account_scope_invalid');
  return scope;
}
function validateSchool(payload,scopeHash,scope,allowTransient) {
  const proof=payload.provenance?.school_identity;
  if(allowTransient===true&&!proof) return null; // To Do joins only; never persistable.
  if(!plain(proof)||proof.verified!==true||!/^\d+$/.test(proof.school_id||'')||
    proof.origin!==SOURCE||proof.method!=='authenticated_official_student_route'||proof.scope_hash!==scopeHash||
    text(proof.school_year)!==scope.school_year||payload.provenance?.school_identity_status?.verified!==true)
    fail('school_identity_unproven');
  if(scope.configured_school_id!==null&&scope.configured_school_id!==proof.school_id)fail('school_identity_mismatch');
  return proof.school_id;
}

function requireTime(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    fail('invalid_observed_at');
  return value;
}
function verifySet(actual, expected, code) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.some(x => typeof x !== 'string' || !text(x))) fail(code);
  const a = actual.map(text), b = expected.map(text);
  if (new Set(a).size !== a.length || new Set(b).size !== b.length || a.length !== b.length || a.some(x => !b.includes(x))) fail(code);
}

/** Only an explicitly displayed ISO calendar date/time is normalized here.
 * A school year covering two years is not evidence for an individual M/D value.
 */
function parseDeadline(raw, timezone) {
  const base = {due_date:null, due_at:null, timezone, precision:'unknown',
    method:'none', reason:raw === null || raw === '' ? 'date_not_observed' : 'year_or_format_not_verified'};
  if (typeof raw !== 'string') return base;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year,month,day] = value.split('-').map(Number), d = new Date(Date.UTC(year,month-1,day));
    if (d.getUTCFullYear()===year && d.getUTCMonth()===month-1 && d.getUTCDate()===day)
      return {...base,due_date:value,precision:'date',method:'explicit_iso_source_date',reason:null};
  }
  const clock=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/);
  const clockValid=clock && Number(clock[2])<24 && Number(clock[3])<60 && (clock[4]===undefined || Number(clock[4])<60);
  const offsetValid=clock && (clock[5]==='Z' || (clock[5]!=='-00:00' && Number(clock[8])<60 &&
    (Number(clock[7])<14 || (Number(clock[7])===14 && Number(clock[8])===0))));
  if (clockValid && offsetValid && Number.isFinite(Date.parse(value)) && parseDeadline(clock[1],timezone).precision==='date') {
    const d = new Date(value), parts = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return {...base,due_date:`${p.year}-${p.month}-${p.day}`,due_at:d.toISOString(),precision:'time',method:'explicit_offset_source_datetime',reason:null};
  }
  return base;
}

function taskObserved(course, assignment) {
  const stringOrNull = value => typeof value === 'string' ? value : null;
  return {
    jupiter_assignment_id:String(assignment.id),
    course:text(course.name), title:text(assignment.name),
    title_raw:stringOrNull(assignment.name_raw) ?? assignment.name,
    teacher:stringOrNull(course.teacher), teacher_raw:stringOrNull(course.teacher_raw) ?? stringOrNull(course.teacher),
    due_text:stringOrNull(assignment.due_raw) ?? stringOrNull(assignment.due),
    category:stringOrNull(assignment.category_raw) ?? stringOrNull(assignment.category),
    status:{display_text:stringOrNull(assignment.status_raw) ?? stringOrNull(assignment.raw_status),
      graded:typeof assignment.graded==='boolean'?assignment.graded:null,
      personal_done:typeof assignment.personal_done==='boolean'?assignment.personal_done:null,
      submission_status:stringOrNull(assignment.submission_status)},
    grading:{score_text:stringOrNull(assignment.score_raw), percent_text:stringOrNull(assignment.percent_raw),
      letter_grade_text:stringOrNull(assignment.letter_grade_raw),worth_text:stringOrNull(assignment.worth_raw),
      impact_text:assignment.impact_raw===undefined?null:copyJSON(assignment.impact_raw)},
  };
}

function validatePayload(payload, context) {
  if (!plain(payload) || !plain(payload.student) || !plain(payload.coverage) || payload.coverage.complete!==true) fail('incomplete_scan');
  requireTime(payload.observed_at);
  if (!text(payload.student.name) || !text(payload.school_year) || !text(payload.term)) fail('identity_metadata_missing');
  if (context.expectedSchoolYear && text(context.expectedSchoolYear)!==text(payload.school_year)) fail('school_year_mismatch');
  if (context.expectedTerm && text(context.expectedTerm)!==text(payload.term)) fail('term_mismatch');
  if (context.expectedName && text(context.expectedName)!==text(payload.student.name)) fail('student_mismatch');
  try { if(typeof payload.timezone!=='string'||!payload.timezone)throw new Error(); new Intl.DateTimeFormat('en',{timeZone:payload.timezone}); } catch { fail('timezone_invalid'); }
  if(context.timezone && context.timezone!==payload.timezone) fail('timezone_mismatch');
  if (!Array.isArray(payload.student.courses) || payload.student.courses.length===0) fail('courses_missing');
  const expected=context.expectedCourses;
  if (!Array.isArray(expected) || !expected.length) fail('expected_courses_required');
  verifySet(payload.coverage.courses, expected, 'coverage_course_mismatch');
  verifySet(payload.student.courses.map(c=>c?.name), expected, 'course_inventory_mismatch');
  for (const course of payload.student.courses) {
    if (!plain(course) || !Array.isArray(course.assignments) || !plain(course.coverage) || course.coverage.complete!==true) fail('incomplete_course');
    if (text(course.term)!==text(payload.term)) fail('course_term_mismatch');
    const unique = new Set(course.assignments.map(a=>String(a?.id)));
    if (course.coverage.assignment_owner_count!==unique.size || course.coverage.parsed_assignment_count!==unique.size || course.coverage.assignment_header_verified!==true)
      fail('course_assignment_coverage_mismatch');
    for (const assignment of course.assignments) {
      if (!plain(assignment) || !/^\d+$/.test(String(assignment.id)) || !text(assignment.name)) fail('assignment_identity_missing');
      if (assignment.jupiter_task_id!==undefined && String(assignment.jupiter_task_id)!==String(assignment.id)) fail('assignment_id_conflict');
    }
  }
  if (!payload.student.courses.some(c=>c.assignments.length>0)) fail('empty_complete_scan');
  // Current reader has no trustworthy official GPA source and does no GPA estimation.
  for (const field of ['gpa','official_gpa','estimated_gpa']) {
    if (payload.student[field]!==null && payload.student[field]!==undefined) fail('unverified_gpa_in_source');
  }
}

function validatePrevious(previous, scopeHash, schoolId) {
  if (previous===null || previous===undefined) return null;
  if (!plain(previous) || previous.schema!==SCHEMA || previous.scope_hash!==scopeHash || !plain(previous.scope) || fingerprint(previous.scope)!==scopeHash || !Array.isArray(previous.tasks) || !Array.isArray(previous.courses)) fail('previous_state_scope_or_schema_mismatch');
  if(previous.school_id!==schoolId||!/^\d+$/.test(previous.school_id||''))fail('school_identity_mismatch');
  requireTime(previous.last_success_at);
  if (!Number.isSafeInteger(previous.sequence) || previous.sequence<1) fail('previous_state_invalid');
  const ids=new Set();
  for (const item of previous.tasks) {
    if (!plain(item) || typeof item.id!=='string' || ids.has(item.id) || !plain(item.observed) || !plain(item.raw) || !/^[a-f0-9]{64}$/.test(item.semantic_fingerprint||'')) fail('previous_state_invalid');
    if (!plain(item.identity) || item.identity.school_id!==schoolId || item.identity.school_year!==previous.scope.school_year || item.identity.term!==previous.scope.term || item.identity.course!==item.observed.course || String(item.raw.id)!==item.observed.jupiter_assignment_id ||
      item.id!==`jupiter:${fingerprint([scopeHash,schoolId,item.observed.course]).slice(0,24)}:${item.observed.jupiter_assignment_id}`) fail('previous_state_invalid');
    if (!['present','not_observed'].includes(item.presence)) fail('previous_state_invalid');
    if (fingerprint({raw:item.raw,observed:item.observed})!==item.semantic_fingerprint) fail('previous_task_fingerprint_mismatch');
    ids.add(item.id);
  }
  return previous;
}

/** Return a candidate snapshot only after all source and previous-state validation.
 * Caller must persist it atomically only when this function returns successfully.
 */
function buildState(input, previous=null, context={}) {
  const payload=copyJSON(input);
  validatePayload(payload,context);
  const scope=copyJSON(validateScope(context.scope));
  if(scope.student_name!==text(payload.student.name)||scope.school_year!==text(payload.school_year)||scope.term!==text(payload.term))fail('source_scope_mismatch');
  const scopeHash=fingerprint(scope), observedAt=payload.observed_at;
  const schoolId=validateSchool(payload,scopeHash,scope,context.allowUnverifiedSchool);
  previous=validatePrevious(previous,scopeHash,schoolId);
  if (previous && Date.parse(observedAt)<Date.parse(previous.last_success_at)) fail('out_of_order_snapshot');
  const previousTasks=new Map((previous?.tasks||[]).map(t=>[t.id,t]));
  const previousCourses=new Map((previous?.courses||[]).map(c=>[c.name,c]));
  const current=new Map(),courses=[];
  const changes={added:[],changed:[],date_changed:[],not_observed:[],reappeared:[],course_changed:[]};
  let duplicates=0,unchanged=0;
  for (const course of payload.student.courses) {
    const courseName=text(course.name), rawCourse=copyJSON(Object.fromEntries(Object.entries(course).filter(([k])=>k!=='assignments')));
    const courseFingerprint=fingerprint(Object.fromEntries(Object.entries(rawCourse).filter(([k])=>k!=='coverage')));
    if (previousCourses.get(courseName)?.raw?.coverage?.parsed_assignment_count>0 && course.assignments.length===0)
      fail('empty_course_regression');
    courses.push({name:courseName,raw:rawCourse,semantic_fingerprint:courseFingerprint,fetched_at:observedAt});
    if (previousCourses.has(courseName) && previousCourses.get(courseName).semantic_fingerprint!==courseFingerprint) changes.course_changed.push(courseName);
    for (const assignment of course.assignments) {
      const sourceId=String(assignment.id);
      const id=`jupiter:${fingerprint([scopeHash,schoolId,courseName]).slice(0,24)}:${sourceId}`;
      const observed=taskObserved(course,assignment),raw=copyJSON(assignment);
      const semanticFingerprint=fingerprint({raw,observed});
      if (current.has(id)) {
        if (current.get(id).semantic_fingerprint!==semanticFingerprint) fail('conflicting_duplicate_assignment');
        duplicates++;continue;
      }
      const old=previousTasks.get(id);
      const record={id,record_kind:'source_observation',identity:{school_id:schoolId,school_year:scope.school_year,term:scope.term,course:courseName,jupiter_assignment_id:sourceId},
        source:{system:'Jupiter Ed',origin:SOURCE,reader:'patched jupiter-api',term:payload.term},
        raw,observed,inferred:{deadline:parseDeadline(observed.due_text,payload.timezone),
          planning_task_created:false,completion_inferred:false},
        semantic_fingerprint:semanticFingerprint,presence:'present',
        first_seen_at:old?.first_seen_at||observedAt,last_seen_at:observedAt,last_checked_at:observedAt,fetched_at:observedAt};
      current.set(id,record);
      if (!old) changes.added.push(id);
      else {
        if (old.semantic_fingerprint!==semanticFingerprint) {
          changes.changed.push(id);
          if (old.observed.due_text!==observed.due_text) changes.date_changed.push(id);
        } else unchanged++;
        if (old.presence==='not_observed') changes.reappeared.push(id);
      }
    }
  }
  for (const [id,old] of previousTasks) {
    if (current.has(id)) continue;
    if (old.presence==='present') changes.not_observed.push(id);
    current.set(id,{...copyJSON(old),presence:'not_observed',last_checked_at:observedAt,
      absence_reason:'not_observed_in_latest_complete_scan_not_deleted'});
  }
  const tasks=[...current.values()].sort((a,b)=>a.id.localeCompare(b.id));
  courses.sort((a,b)=>a.name.localeCompare(b.name));
  const currentCount=tasks.filter(t=>t.presence==='present').length;
  const state={schema:SCHEMA,scope,scope_hash:scopeHash,school_id:schoolId,timezone:payload.timezone,
    sequence:(previous?.sequence||0)+1,last_success_at:observedAt,
    previous_success_at:previous?.last_success_at||null,
    source:{system:'Jupiter Ed',origin:SOURCE,reader:'patched jupiter-api',term:payload.term,provenance:copyJSON(payload.provenance||{})},
    coverage:{complete:true,courses:courses.map(c=>c.name),current_assignments:currentCount},
    student:{name:payload.student.name,official_gpa:null,official_gpa_reason:'not_observed',estimated_gpa:null,estimated_gpa_reason:'not_calculated'},
    // Stored only inside the encrypted state envelope by the caller. This is
    // complete original source evidence, not an execution-task queue.
    source_snapshot:copyJSON(payload),courses,tasks,changes,
    semantic_fingerprint:fingerprint({courses:courses.map(c=>[c.name,c.semantic_fingerprint]),tasks:tasks.map(t=>[t.id,t.semantic_fingerprint,t.presence])}),
    policy:{source_only:true,no_automatic_learning_tasks:true,absent_records_retained:true,grades_preserved_verbatim:true}};
  const summary={ok:true,schema:SCHEMA,observed_at:observedAt,timezone:payload.timezone,sequence:state.sequence,
    previous_success_at:state.previous_success_at,previous_state_restored:!!previous,
    courses:courses.length,current_assignments:currentCount,retained_assignments:tasks.length,
    added_count:changes.added.length,changed_count:changes.changed.length,date_changed_count:changes.date_changed.length,
    unchanged_count:unchanged,not_observed_count:tasks.length-currentCount,newly_not_observed_count:changes.not_observed.length,
    reappeared_count:changes.reappeared.length,course_changed_count:changes.course_changed.length,
    identical_duplicates_merged:duplicates,semantic_fingerprint:state.semantic_fingerprint,
    official_gpa_observed:false,estimated_gpa_calculated:false};
  return {state,summary};
}

/** Validate restored state as data, not merely as authenticated bytes. */
function validateStoredState(state,scope) {
  validateScope(scope);
  validatePrevious(state,fingerprint(scope),state?.school_id);
  if(state?.coverage?.complete!==true||!Array.isArray(state.coverage.courses)||!plain(state.source_snapshot))fail('stored_state_invalid');
  const expected=buildState(state.source_snapshot,null,{scope,expectedName:scope.student_name,
    expectedSchoolYear:scope.school_year,expectedTerm:scope.term,expectedCourses:state.coverage.courses,timezone:state.timezone}).state;
  if(state.last_success_at!==expected.last_success_at||state.school_id!==expected.school_id||
    state.student?.name!==expected.student.name||fingerprint(state.source)!==fingerprint(expected.source)||
    fingerprint(state.coverage)!==fingerprint(expected.coverage)||fingerprint(state.courses)!==fingerprint(expected.courses))fail('stored_state_source_mismatch');
  const present=state.tasks.filter(t=>t.presence==='present');
  const expectedTasks=new Map(expected.tasks.map(t=>[t.id,t]));
  if(present.length!==expectedTasks.size||present.some(t=>expectedTasks.get(t.id)?.semantic_fingerprint!==t.semantic_fingerprint))fail('stored_state_task_mismatch');
  const overall=fingerprint({courses:state.courses.map(c=>[c.name,c.semantic_fingerprint]),tasks:state.tasks.map(t=>[t.id,t.semantic_fingerprint,t.presence])});
  if(state.semantic_fingerprint!==overall)fail('stored_state_fingerprint_mismatch');
  return state;
}

module.exports={SCHEMA,StateError,buildState,parseDeadline,fingerprint,scopeFromConfig,validateScope,validateStoredState};
