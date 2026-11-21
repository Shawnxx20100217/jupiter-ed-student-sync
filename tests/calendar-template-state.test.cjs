'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./helpers/synthetic-state.cjs');
const {buildState, fingerprint, validateStoredState} = require('../src/state.cjs');
const {encodeState, decodeState} = require('../src/persistence.cjs');

const {attachObservation, notice} = require('./helpers/synthetic-calendar.cjs');

test('a legacy encrypted snapshot acquires private date summaries and exact assignment links on opt in', () => {
  const f = fixture(), key = Buffer.alloc(32, 17).toString('base64'), repo = 'example-owner/private-source';
  const before = f.state();
  assert.equal(before.calendar_events, undefined);
  const legacy = decodeState(encodeState(before,key,repo,f.scope),key,repo,f.scope);
  attachObservation(f);
  const {state,summary} = buildState(f.payload,legacy,f.context);
  assert.equal(state.sequence, 2);
  assert.deepEqual(state.tasks, legacy.tasks);
  assert.equal(state.source_snapshot.calendar_observation, undefined);
  assert.equal(summary.calendar.complete_months, 2);
  assert.equal(summary.calendar.independent_events, 0);
  assert.equal(summary.calendar.pending, 3); // includes both anonymous notices
  assert.equal(summary.calendar.summary_added, 2);
  assert.equal(state.calendar_events.assignment_references.length, 1);
  assert.equal(state.calendar_events.assignment_references[0].source_id, state.tasks.find(x=>x.identity.jupiter_assignment_id==='910001').id);
  assert.equal(state.calendar_events.pending.find(x=>x.assignment_id==='0').reason,'calendar_assignment_link_unproven');
  assert.equal(state.calendar_date_summaries.records[0].observed.start_time, null);
  assert.equal(state.calendar_date_summaries.records[0].observed.all_day, null);
  assert.equal(state.calendar_date_summaries.records[0].source_event_id, null);
  assert.deepEqual(decodeState(encodeState(state,key,repo,f.scope),key,repo,f.scope),state);
});

test('repeat scans leave date content unchanged and partial coverage retains the previous month', () => {
  const f = fixture(), o = attachObservation(f);
  const first = f.state();
  const next = buildState(f.payload,first,f.context);
  assert.equal(next.summary.calendar.summary_unchanged, 2);
  assert.equal(next.summary.calendar.summary_changed, 0);
  assert.equal(next.summary.calendar.summary_added, 0);
  o.months[0].events[0] = notice('2030-10-03','Revised synthetic notice');
  o.months[1] = {month: '2030-11', status: 'failed', error_code: 'calendar_page_timeout', events: []};
  const partial = buildState(f.payload,next.state,f.context);
  assert.equal(partial.summary.calendar.status,'partial');
  assert.equal(partial.summary.calendar.summary_changed, 1);
  assert.equal(partial.summary.calendar.date_summaries, 1);
  const old = next.state.calendar_date_summaries.records[1], held = partial.state.calendar_date_summaries.records[1];
  assert.equal(held.stale, true);
  assert.equal(held.semantic_fingerprint,old.semantic_fingerprint);
  assert.deepEqual(held.observed,old.observed);
  validateStoredState(partial.state, f.scope);
});

test('failed and disabled Calendar reads retain their last observations while assignments refresh', () => {
  const f = fixture(); attachObservation(f); const before = f.state();
  delete f.payload.calendar_observation;
  f.payload.calendar_collection_status = {status: 'failed', attempted_at:f.payload.observed_at, error_code:'calendar_navigation_blocked'};
  f.payload.student.courses[0].assignments[0].name='Synthetic revised exercise';
  const after=buildState(f.payload,before,f.context);
  assert.equal(after.summary.changed_count,1);
  assert.equal(after.summary.calendar.status,'failed');
  assert.equal(after.summary.calendar.date_summaries,0);
  assert.deepEqual(after.state.calendar_date_summaries,before.calendar_date_summaries);
  delete f.payload.calendar_collection_status;
  const off=buildState(f.payload,after.state,f.context);
  assert.equal(off.summary.calendar.status,'off');
  assert.deepEqual(off.state.calendar_events,before.calendar_events);
  validateStoredState(off.state,f.scope);
});

test('an observation, encrypted calendar or date record from another student is rejected', () => {
  const f = fixture(); const o=attachObservation(f); const state=f.state();
  const foreign=fixture({expected_name:'Another Example Student'}); attachObservation(foreign);
  o.identity.scope_hash=fingerprint(foreign.scope);
  assert.throws(()=>f.state(),{code:'calendar_observation_identity_invalid'});
  o.identity.scope_hash=fingerprint(f.scope);
  o.months[0].events[0].evidence.calendar_scope.raw_text='990002 20302031';
  assert.throws(()=>f.state(),{code:'calendar_school_identity_mismatch'});
  const mixed={...state,calendar_date_summaries:foreign.state().calendar_date_summaries};
  assert.throws(()=>validateStoredState(mixed,f.scope),{code:'calendar_summary_scope_mismatch'});
  const altered=structuredClone(state);altered.calendar_date_summaries.records[0].observed.items[0].title='tampered';
  assert.throws(()=>validateStoredState(altered,f.scope));
  const key=Buffer.alloc(32,17).toString('base64');
  assert.throws(()=>encodeState(altered,key,'example-owner/private-source',f.scope),{code:'state_structure_invalid'});
});

test('assignment-bearing announcement or mismatched handler ID cannot become a date notice or task link', () => {
  const f = fixture();
  const o = attachObservation(f), events = o.months[0].events;
  events[0].raw.node.contains_assignment_action = true;
  delete events[0].raw.observation_hash;
  events[0].raw.observation_hash = fingerprint(events[0].raw);
  events[1].raw.handler = 'goassign(910009,910001)';
  const result = buildState(f.payload,null,f.context);
  assert.equal(result.summary.calendar.summary_held,1);
  assert.equal(result.summary.calendar.date_summaries,1);
  assert.deepEqual(result.state.calendar_events.assignment_references,[]);
  assert.equal(result.state.tasks.length,2);
});

test('verified independent source events retain identity across month navigation and title/date edits', () => {
  const f = fixture(), o = attachObservation(f);
  const row = {source_event_id:'synthetic-stable-event', title:'Synthetic rehearsal',date:'2030-10-11',
    evidence:{identity:{verified:true,raw_id:'synthetic-stable-event'},date:{verified:true,raw_text:'2030-10-11'}}};
  o.months[0].events.push(row,structuredClone(row));
  const old=f.state();
  assert.equal(old.calendar_events.events.length,1);
  o.months[0].events.pop();
  row.title='Synthetic revised rehearsal';row.date='2030-10-12';row.evidence.date.raw_text=row.date;
  const {state} = buildState(f.payload,old,f.context);
  assert.equal(state.calendar_events.events[0].id,old.calendar_events.events[0].id);
  assert.equal(state.calendar_events.changes.title_changed.length,1);
  assert.equal(state.calendar_events.changes.date_changed.length,1);
  assert.equal(state.calendar_events.events[0].observed.all_day,null);
});
