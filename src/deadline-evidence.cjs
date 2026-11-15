'use strict';
// Pure source-date evidence only: no guessed year, invented time or title match.
const {parseDeadline}=require('./state.cjs');
const norm=x=>typeof x==='string'?x.replace(/\s+/g,' ').trim():'';
const known=x=>x!==null&&x!==undefined&&norm(String(x))!==''&&norm(String(x)).toLowerCase()!=='unknown';
const validDate=(year,month,day)=>{const d=new Date(Date.UTC(year||2000,month-1,day));return d.getUTCMonth()+1===month&&d.getUTCDate()===day&&(!year||d.getUTCFullYear()===year);};
function dateText(raw,timezone='UTC'){
  let value=norm(raw).replace(/^Due(?:\s+date)?\s*:?\s*/i,'').replace(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)(?:day)?[, ]+/i,'');
  const parsed=parseDeadline(value,timezone);
  if(parsed.precision!=='unknown')return {month:Number(parsed.due_date.slice(5,7)),day:Number(parsed.due_date.slice(8,10)),year:Number(parsed.due_date.slice(0,4)),date:parsed.due_date,time:parsed.due_at,precision:parsed.precision};
  const m=value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if(!m)return null;const month=Number(m[1]),day=Number(m[2]),year=m[3]?Number(m[3]):null;
  if(!validDate(year,month,day))return null;
  return {month,day,year,date:year?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null,time:null,precision:year?'date':'month_day'};
}
function weekdayText(raw){
  const value=norm(raw).replace(/^Due(?:\s+date)?\s*:?\s*/i,'').toLowerCase();
  const names=[['sun','sunday'],['mon','monday'],['tue','tuesday'],['wed','wednesday'],['thu','thursday'],['fri','friday'],['sat','saturday']];
  return names.findIndex(xs=>xs.includes(value));
}
function assessFresh(record,timezone='UTC'){
  if(!['todo','calendar','assignment_detail'].includes(record.origin))return {kind:'fresh_deadline_semantics_unverified',conflict:true};
  if(record.deadline_semantics==='no_due_label'&&!known(record.label))return {kind:'fresh_no_due_label',conflict:false,no_deadline:true};
  if(record.year_evidence_hold)return {kind:record.year_evidence_hold,conflict:true};
  if(!/^Due(?:\s+date)?$/i.test(norm(record.label)))return {kind:'fresh_deadline_semantics_unverified',conflict:true};
  if(record.year_evidence?.kind==='calendar_date_attribute'&&!['exact_course_and_numeric_id','exact_numeric_id_globally_unique_and_verified_todo_course'].includes(record.year_evidence.identity_method))return {kind:'fresh_calendar_identity_unverified',conflict:true};
  const shown=dateText(record.due_text,timezone),weekday=weekdayText(record.due_text);
  if(!shown&&weekday<0)return {kind:'fresh_date_unrecognized',conflict:true};
  let resolved=shown;
  if((!shown||!shown.year)&&record.year_evidence){
    const proof=record.year_evidence;
    if(!['explicit_source_year','calendar_date_attribute'].includes(proof.kind))return {kind:'fresh_year_evidence_unverified',conflict:true};
    const fromProof=dateText(proof.raw,timezone);
    if(!fromProof?.year||(shown&&(fromProof.month!==shown.month||fromProof.day!==shown.day))||(weekday>=0&&new Date(fromProof.date+'T00:00:00Z').getUTCDay()!==weekday))return {kind:'fresh_year_evidence_conflict',conflict:true};
    resolved=fromProof;
  }
  if(!resolved)return {kind:'fresh_weekday_only',conflict:false,weekday,origin:record.origin};
  if(record.due_date&&(!resolved.year||record.due_date!==resolved.date))return {kind:'fresh_normalized_date_unproven',conflict:true};
  if(record.due_at&&(!resolved.time||Date.parse(record.due_at)!==Date.parse(resolved.time)))return {kind:'fresh_exact_time_unproven',conflict:true};
  return {kind:resolved.year?'fresh_explicit_calendar_date':'fresh_month_day_only',conflict:false,day:resolved,origin:record.origin};
}

module.exports={dateText,assessFresh,weekdayText};
