'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildState,parseDeadline,scopeFromConfig}=require('../src/state.cjs');
const {fixture}=require('./helpers/synthetic-state.cjs');

test('synthetic first observation preserves raw grades, unknown date and source-only policy',()=>{
  const f=fixture(),{state,summary}=buildState(f.payload,null,f.context);
  assert.equal(summary.current_assignments,2); assert.equal(state.sequence,1);
  const task=state.tasks[0]; assert.equal(task.raw.percent_raw,'80.00 %'); assert.equal(task.observed.grading.score_text,'8 / 10');
  assert.equal(task.inferred.deadline.due_at,null); assert.equal(task.inferred.deadline.due_date,null);
  assert.equal(task.identity.school_id,'990001'); assert.equal(state.timezone,'Europe/London');
  assert.equal(task.inferred.planning_task_created,false); assert.equal(state.student.estimated_gpa,null);
});
test('same synthetic observation has stable IDs and zero semantic changes across runs',()=>{
  const f=fixture(),old=f.state(); f.payload.observed_at='2030-10-01T13:00:00Z';
  const {state,summary}=buildState(f.payload,old,f.context);
  assert.equal(state.sequence,2); assert.equal(summary.added_count,0); assert.equal(summary.changed_count,0);
  assert.equal(summary.unchanged_count,2); assert.equal(state.semantic_fingerprint,old.semantic_fingerprint);
});
test('numeric IDs distinguish synthetic same titles; renames and explicit due changes retain IDs',()=>{
  const f=fixture(),old=f.state(),course=f.payload.student.courses[0];
  course.assignments[0].name='Synthetic revised exercise'; course.assignments[0].due_raw='2030-10-12';
  const {state,summary}=buildState(f.payload,old,f.context);
  assert.equal(summary.changed_count,1); assert.equal(summary.date_changed_count,1);
  assert.deepEqual(state.tasks.map(x=>x.id),old.tasks.map(x=>x.id));
  const changed=state.tasks.find(x=>x.observed.course==='Example Mathematics');
  assert.equal(changed.inferred.deadline.due_date,'2030-10-12'); assert.equal(changed.inferred.deadline.due_at,null);
});
test('temporarily missing synthetic record is retained without deletion',()=>{
  const f=fixture(),course=f.payload.student.courses[0];
  course.assignments.push({...course.assignments[0],id:'910099',name:'Another synthetic exercise'});
  course.coverage.assignment_owner_count=2; course.coverage.parsed_assignment_count=2;
  const old=f.state(); course.assignments.pop(); course.coverage.assignment_owner_count=1; course.coverage.parsed_assignment_count=1;
  const {state,summary}=buildState(f.payload,old,f.context);
  assert.equal(summary.not_observed_count,1); assert.equal(state.tasks.length,3);
  assert.equal(state.tasks.find(x=>x.observed.jupiter_assignment_id==='910099').presence,'not_observed');
});
test('different login, school, year or term cannot reset an existing account scope',()=>{
  const f=fixture(),old=f.state();
  const alternate=scopeFromConfig(f.config,'another-synthetic-login');
  assert.throws(()=>buildState(f.payload,old,{...f.context,scope:alternate}),{code:'school_identity_unproven'});
  for(const overrides of [{school:'Other Example Academy'},{expected_school_year:'2031-2032'},{expected_term:'Term B'}]){
    const other=fixture(overrides); assert.throws(()=>buildState(other.payload,old,other.context),{code:'previous_state_scope_or_schema_mismatch'});
  }
  f.payload.provenance.school_identity.school_id='990002';
  assert.throws(()=>buildState(f.payload,old,f.context),{code:'school_identity_mismatch'});
});
test('incomplete, wrong identity and unverified numeric school all fail without altering last valid snapshot',()=>{
  const f=fixture(),old=f.state(),snapshot=JSON.stringify(old);
  f.payload.coverage.complete=false;
  assert.throws(()=>buildState(f.payload,old,f.context),{code:'incomplete_scan'});
  f.payload.coverage.complete=true;f.payload.student.name='Different Example Student';
  assert.throws(()=>buildState(f.payload,old,f.context),{code:'student_mismatch'});
  f.payload.student.name=f.config.expected_name;delete f.payload.provenance.school_identity;
  assert.throws(()=>buildState(f.payload,old,f.context),{code:'school_identity_unproven'});
  assert.equal(JSON.stringify(old),snapshot);
});
test('date evidence never guesses missing year/time and rejects invalid explicit calendar dates',()=>{
  for(const raw of ['10/12','next week','2030-02-30'])assert.equal(parseDeadline(raw,'Europe/London').due_date,null);
  assert.equal(parseDeadline('2030-10-12','Europe/London').precision,'date');
  assert.equal(parseDeadline('2030-10-12T12:30:00+01:00','Europe/London').due_at,'2030-10-12T11:30:00.000Z');
});
