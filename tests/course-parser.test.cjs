'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseCourseView}=require('../dist/scraper/course-parser.js');
const Student=require('../dist/models/student.js').default;
const cells=xs=>xs.map(text=>({text}));
const assignment=(id='10001',raw={})=>({id,cells:cells(['','11/20','  Example assignment  ','9.5 / 10','95 %','A','','10','','','', 'Practice',''].map((x,i)=>raw[i]??x))});
const view=()=>({headerText:'Example Course One\nExample Teacher\nPeriod 1',term:'Q1',ownerIds:['10001'],rows:[{id:null,cells:cells(['Q1','A','95 %','','','',''])},{id:null,cells:cells(['Practice','A','95 %','','','100% of grade',''])},{id:null,cells:cells(['','Due','Assignment','Score'])},assignment()]});
test('raw grades, percentages and ambiguous month/day dates survive verbatim',()=>{
 const raw=view(),course=parseCourseView(raw,'Example Course One','Q1'),a=course.assignments[0];
 assert.equal(a.score_raw,'9.5 / 10');assert.equal(a.score,9.5);assert.equal(a.points,10);assert.equal(a.percent_raw,'95 %');assert.equal(a.percent,95);assert.equal(a.due_raw,'11/20');assert.equal(a.name_raw,'  Example assignment  ');assert.equal(a.graded,null);assert.equal(a.submission_status,null);
 assert.deepEqual(a.raw.cells,raw.rows[3].cells.map(c=>c.text));assert.equal(course.grade_raw,'95 %');
 const student=new Student('Example Student',[course]);assert.equal(student.official_gpa,null);assert.equal(student.estimated_gpa,null);assert.equal(student.estimated_gpa_reason,'no_school_formula');
});
test('identical numeric-ID rows deduplicate; changed same-ID rows stop',()=>{
 const raw=view();raw.rows.push(assignment());assert.equal(parseCourseView(raw,'Example Course One','Q1').assignments.length,1);
 raw.rows.push(assignment('10001',{2:'Different assignment'}));assert.throws(()=>parseCourseView(raw,'Example Course One','Q1'),/assignment_id_conflict/);
});
test('partial extraction and wrong term cannot silently succeed',()=>{
 const raw=view();raw.ownerIds.push('10002');assert.throws(()=>parseCourseView(raw,'Example Course One','Q1'),/assignment_owner_coverage_mismatch/);
 assert.throws(()=>parseCourseView(view(),'Example Course One','Q2'),/course_term_mismatch/);
});
test('non-numeric grade text remains unmodified and is not converted into GPA or submission',()=>{
 const raw=view();raw.rows[3]=assignment('10001',{3:'Excused / 10',4:'—'});const a=parseCourseView(raw,'Example Course One','Q1').assignments[0];
 assert.equal(a.score,null);assert.equal(a.score_raw,'Excused / 10');assert.equal(a.percent,null);assert.equal(a.percent_raw,'—');assert.equal(a.submission_status,null);assert.equal(a.personal_done,null);
});
