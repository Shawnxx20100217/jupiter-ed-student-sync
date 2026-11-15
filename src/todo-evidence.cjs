'use strict';
// Pure reuse of the audited numeric-ID To Do / calendar evidence conversion.
// No browser, credentials, network calls or persistence.
const {fingerprint}=require('./state.cjs');
const {dateText,assessFresh}=require('./deadline-evidence.cjs');
const norm=x=>typeof x==='string'?x.replace(/\s+/g,' ').trim():'';
const key=(course,id)=>JSON.stringify([norm(course),String(id)]);
const identity=key;
function fail(code){const error=new Error(code);error.code=code;throw error;}
function parseCards(probe, courses) {
  const records = new Map(), unresolved = [];
  let hidden = 0, duplicates = 0;
  for (const [index, card] of probe.view.cards.entries()) {
    if (card.visible !== true) { hidden++; continue; }
    const match = norm(card.handler).match(/^goassign\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)\s*;?$/);
    const candidates = card.course_candidates?.map(norm);
    if (!match || !Array.isArray(candidates) || candidates.length !== 1 || !courses.includes(candidates[0]) ||
        card.cells?.length !== 3 || typeof card.cells[1]?.text !== 'string') {
      unresolved.push({ node: index, reason: 'numeric_identity_or_course_or_cells_unresolved' }); continue;
    }
    const course = candidates[0], id = match[1], key = identity(course, id);
    const rawDate = card.cells[1].text, explicit = /^Due\s+/i.test(norm(rawDate));
    const row = { course, jupiter_assignment_id: id, title: norm(card.cells[2].text),
      raw_date_text: rawDate, explicit_due: explicit, identity_method: 'exact_course_and_numeric_id',
      deadline_semantics: explicit ? 'explicit_due_label' : 'date_without_due_is_not_a_deadline' };
    if (records.has(key)) {
      duplicates++;
      if (JSON.stringify(records.get(key)) !== JSON.stringify(row)) unresolved.push({ node: index, reason: 'duplicate_identity_conflicting_content' });
    } else records.set(key, row);
  }
  return { records, unresolved, hidden, duplicates };
}
function buildEvidence(probe,cloud){
 if(probe?.identity_verified!==true||probe.timezone!==cloud?.timezone||!Number.isFinite(Date.parse(probe.observed_at))||!Array.isArray(probe.courses)||!Array.isArray(probe.view?.cards)||cloud?.schema!=='jupiter-student-source.v1')fail('probe_contract_invalid');
 const courses=cloud.courses.map(c=>norm(c.name)),actual=probe.courses.map(norm);
 if(courses.length!==actual.length||new Set(actual).size!==actual.length||courses.some(c=>!actual.includes(c)))fail('probe_course_inventory_mismatch');
 if(!/^[a-f0-9]{64}$/.test(probe.scope_hash||'')||probe.scope_hash!==cloud.scope_hash)fail('probe_scope_mismatch');
 const index=new Map(),globalIds=new Map(),calendarIds=new Map(),records=[],seen=new Map();
 for(const t of cloud.tasks.filter(t=>t.presence==='present')){const k=key(t.observed.course,t.observed.jupiter_assignment_id);if(index.has(k))fail('cloud_identity_ambiguous');index.set(k,t);const id=String(t.observed.jupiter_assignment_id);if(!globalIds.has(id))globalIds.set(id,[]);globalIds.get(id).push(t);}
 for(const action of probe.calendar?.actions||[]){
  const m=norm(action.handler).match(/^goassign\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)\s*;?$/);if(!m)continue;
  const dates=[...new Set((action.ancestors||[]).map(a=>String(a.id||'')).filter(id=>/^show\d{4}-\d{2}-\d{2}$/.test(id)).map(id=>id.slice(4)))].filter(d=>dateText(d)?.date===d);
  if(!calendarIds.has(m[1]))calendarIds.set(m[1],new Set());for(const d of dates)calendarIds.get(m[1]).add(d);
 }
 const report={schema:'jupiter-live-deadline-conversion.v1',mode:'offline_conversion_only',observed_at:probe.observed_at,fresh_observed_at:probe.observed_at,counts:{nodes:probe.view.cards.length,hidden_skipped:0,records:0,explicit_due:0,no_due_label:0,month_day_only:0,weekday_only:0,duplicate_identical:0,calendar_numeric_ids:calendarIds.size,calendar_dates_attached:0,calendar_no_due_excluded:0,calendar_evidence_held:0},safety:{network_requests:0,state_changes:0,year_inference:false,title_matching:false}};
 for(const card of probe.view.cards){
  if(card.visible!==true){report.counts.hidden_skipped++;continue;}
  const m=norm(card.handler).match(/^goassign\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)\s*;?$/);if(!m)fail('probe_assignment_handler_invalid');
  if(!Array.isArray(card.course_candidates)||card.course_candidates.length!==1||!courses.includes(norm(card.course_candidates[0])))fail('probe_assignment_course_ambiguous');
  const course=norm(card.course_candidates[0]),id=m[1],k=key(course,id),task=index.get(k);if(!task)fail('probe_assignment_not_in_cloud_scope');
  if(!Array.isArray(card.cells)||card.cells.length!==3||typeof card.cells[1]?.text!=='string')fail('probe_assignment_cells_invalid');
  const raw=card.cells[1].text,value=norm(raw),due=value.match(/^Due\s+(.+)$/i);
  const record={course,jupiter_assignment_id:id,origin:'todo',label:due?'Due':null,due_text:due?due[1]:raw,
    deadline_semantics:due?'explicit_due_label':'no_due_label',source_date_text:raw,
    identity_evidence:{method:'exact_course_dom_container_and_numeric_handler',handler:card.handler,course_dom:copy(card.course_container||{}),selector:'#mainpage [click*="goassign"],[onclick*="goassign"]'},
    source_evidence_fingerprint:fingerprint({handler:card.handler,course,cells:card.cells})};
  const calendarDates=calendarIds.get(id);
  if(calendarDates?.size){
   if(!due)report.counts.calendar_no_due_excluded++;
   else if(globalIds.get(id)?.length!==1){record.year_evidence_hold='calendar_numeric_id_not_globally_unique';report.counts.calendar_evidence_held++;}
   else if(calendarDates.size!==1){record.year_evidence_hold='calendar_numeric_id_multiple_dates';report.counts.calendar_evidence_held++;}
   else {const date=[...calendarDates][0];record.year_evidence={kind:'calendar_date_attribute',raw:date,identity_method:'exact_numeric_id_globally_unique_and_verified_todo_course',dom_attribute:'id',dom_value:'show'+date};
    const check=assessFresh(record,probe.timezone);if(check.conflict){record.year_evidence_hold=check.kind;report.counts.calendar_evidence_held++;}else report.counts.calendar_dates_attached++;}
  }
  if(seen.has(k)){if(fingerprint(seen.get(k))!==fingerprint(record))fail('probe_duplicate_identity_conflict');report.counts.duplicate_identical++;continue;}
  seen.set(k,record);records.push(record);report.counts.records++;
  if(due){report.counts.explicit_due++;if(/^\d{1,2}\/\d{1,2}$/.test(due[1]))report.counts.month_day_only++;else if(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(day)?$/i.test(due[1]))report.counts.weekday_only++;}
  else report.counts.no_due_label++;
 }
 return {evidence:{schema:'jupiter-deadline-evidence.v1',scope_hash:cloud.scope_hash,observed_at:probe.observed_at,timezone:probe.timezone,
  coverage:{complete:false,scope:'todo_visible_rows_only',courses:actual,absence_policy:'not_observed_is_not_absent_or_complete'},records},report};
}
const copy=x=>JSON.parse(JSON.stringify(x));
module.exports={parseCards,buildEvidence};
