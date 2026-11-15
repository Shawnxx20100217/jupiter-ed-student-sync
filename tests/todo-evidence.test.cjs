'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {enrichSourceWithTodo,verifiedSchoolIdentity}=require('../src/todo-session-read.cjs');
const {buildState,scopeFromConfig,fingerprint}=require('../src/state.cjs');
const {dateText,assessFresh}=require('../src/deadline-evidence.cjs');
const {parseCards}=require('../src/todo-evidence.cjs');
const config={school:'Fictional Academy',school_id:'10001',city:'Example City',state:'other',expected_name:'Example Student',expected_school_year:'2026-2027',expected_term:'Q1',expected_courses:['Example Course One'],timezone:'Europe/London'};
const scope=scopeFromConfig(config,'example-student');
const context={scope,expectedCourses:config.expected_courses,expectedName:config.expected_name,expectedSchoolYear:config.expected_school_year,expectedTerm:config.expected_term,timezone:config.timezone};
const time='2026-12-01T08:00:00.000Z';
const payload=()=>({observed_at:time,timezone:config.timezone,school_year:config.expected_school_year,term:config.expected_term,coverage:{complete:true,courses:config.expected_courses},student:{name:config.expected_name,courses:[{name:'Example Course One',term:'Q1',assignments:[{id:'10010',name:'Synthetic scored row',due:'12/01',score_raw:'9 / 10',percent_raw:'90 %'}],coverage:{complete:true,assignment_owner_count:1,parsed_assignment_count:1,assignment_header_verified:true}}]}});
const card=(id,date,title)=>({handler:`goassign(${id})`,visible:true,course_candidates:['Example Course One'],course_container:{tag:'DIV',id:'',cls:'classbox'},cells:[{text:'',cls:''},{text:date,cls:''},{text:title,cls:''}]});
const captured=()=>({view:{headings:['Example Course One'],cards:[card('10011','Due 1/5','Synthetic future assignment'),card('10012','1/6','Synthetic classroom record')]},calendar:{actions:[{handler:'goassign(10011)',ancestors:[{id:'show2027-01-05'}]},{handler:'goassign(10012)',ancestors:[{id:'show2027-01-06'}]}]}});
test('To Do-only numeric identities join original grade rows without changing grades or inventing homework',()=>{
 const result=enrichSourceWithTodo(payload(),captured(),config,'https://login.jupitered.com/0/student.php?w=10001,10002,0',scope);
 const course=result.student.courses[0];assert.equal(course.assignments.length,3);assert.equal(course.assignments[0].score_raw,'9 / 10');
 assert.equal(course.assignments[1].personal_done,null);assert.equal(course.assignments[1].submission_status,null);assert.equal(course.assignments[2].due,null);
 const [due,record]=result.deadline_evidence.records;assert.equal(due.year_evidence.raw,'2027-01-05');assert.equal(record.year_evidence,undefined);assert.equal(record.deadline_semantics,'no_due_label');
 const state=buildState(result,null,context).state;assert.equal(state.tasks.length,3);assert.equal(state.school_id,'10001');assert.equal(state.coverage.complete,true);assert.equal(result.provenance.todo_coverage.complete,false);
});
test('missing school identity, mismatched school and incomplete To Do course inventory stop',()=>{
 assert.throws(()=>enrichSourceWithTodo(payload(),captured(),config,'https://login.jupitered.com/login/',scope),/school_identity_unproven/);
 assert.throws(()=>enrichSourceWithTodo(payload(),captured(),config,'https://login.jupitered.com/0/student.php?w=10003,10002,0',scope),/school_identity_mismatch/);
 const c=captured();c.view.headings=[];assert.throws(()=>enrichSourceWithTodo(payload(),c,config,'https://login.jupitered.com/0/student.php?w=10001,10002,0',scope),/todo_course_coverage_unproven/);
});
test('duplicate numeric identity with different content is a conflict, hidden rows do not imply deletion',()=>{
 const rows=[card('10011','Due 1/5','Synthetic assignment'),card('10011','Due 1/5','Synthetic assignment')];
 let result=parseCards({view:{cards:rows}},config.expected_courses);assert.equal(result.records.size,1);assert.equal(result.duplicates,1);assert.equal(result.unresolved.length,0);
 rows.push(card('10011','Due 1/6','Synthetic assignment'));result=parseCards({view:{cards:rows}},config.expected_courses);assert.equal(result.unresolved.length,1);
});
test('dates never acquire an inferred year or 23:59; title-only calendar links are rejected',()=>{
 assert.equal(dateText('Due 1/5').year,null);assert.equal(dateText('2027-01-05').time,null);assert.equal(dateText('2/30'),null);
 const r={origin:'todo',label:'Due',due_text:'1/5',deadline_semantics:'explicit_due_label'};
 assert.equal(assessFresh(r).kind,'fresh_month_day_only');
 assert.equal(assessFresh({...r,year_evidence:{kind:'calendar_date_attribute',raw:'2027-01-05',identity_method:'unique_exact_course_title'}}).conflict,true);
 assert.equal(assessFresh({...r,year_evidence:{kind:'calendar_date_attribute',raw:'2027-01-06',identity_method:'exact_course_and_numeric_id'}}).conflict,true);
 const checked=assessFresh({...r,year_evidence:{kind:'calendar_date_attribute',raw:'2027-01-05',identity_method:'exact_course_and_numeric_id'}});assert.equal(checked.conflict,false);assert.equal(checked.day.time,null);
});
