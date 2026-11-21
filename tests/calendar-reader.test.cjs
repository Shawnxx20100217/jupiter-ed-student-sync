'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTodoRequest } = require('../src/todo-read-policy.cjs');
const {
  requestedCalendarRange, requestedMonths, parseCalendarMonth, monthDays,
  expectedAcademicFilter, collectCalendarFromAuthenticatedPage
} = require('../src/calendar-session-read.cjs');

const route = 'https://login.jupitered.com/student.php?w=990001,910001,0';
const context = {
  phase: 'todo', calendarMonth: '2030-10', calendarSchoolYear: '990001 20302031',
  calendarPageUrl: route, routeFields: {school:'990001',stud:'910001'}
};
const form = {from:'calendar',to:'',todo:'',mini:'0',calview:'2030-10',calschoolyear:context.calendarSchoolYear,
  showhw:'1',showannounce:'1',pagecomplete:'1',busymsg:'Loading',...context.routeFields};

function monthRequest(changes = {}, url = route, settings = context) {
  return evaluateTodoRequest({method:'POST',isNavigation:true,url,postData:new URLSearchParams({...form,...changes}).toString()},
    {},settings);
}

test('Calendar month navigation is limited to the witnessed route, selectors, month, and operation', () => {
  assert.equal(monthRequest().allow,true);
  for (const url of [route+'1',route+'&w=990001,910001,0',route+'&other=1',route.split('?')[0],route.replace('student.php','login/')]) {
    assert.equal(monthRequest({},url).allow,false);
  }
  for (const changes of [{w:'990001,910001,0'},{stud:'910002'},{school:'990002'},{year:'2031'},
    {calview:'2030-11'},{showannounce:'0'},{extra:'x'},{studflagdone:'1'},{submitwork:'1'},{upload:'1'}]) {
    assert.equal(monthRequest(changes).allow,false);
  }
  assert.equal(monthRequest({},route,{...context,used:true}).allow,false);
  assert.equal(monthRequest({},route,{...context,phase:'course'}).allow,false);
  const clock={capturedAtMs:Date.now(),serverSeconds:1900000000};
  assert.equal(monthRequest({pagereq:'1900000000'},route,{...context,calendarTiming:clock}).allow,true);
  assert.equal(monthRequest({pagereq:'1900000500'},route,{...context,calendarTiming:clock}).allow,false);
});

test('observations remain inside the witnessed full calendar date, independent of assignment deadlines', () => {
  const range = requestedCalendarRange('2030-10-01T04:00:00Z','Europe/London');
  assert.deepEqual(requestedMonths(range),['2030-09','2030-10','2030-11']);
  const date='2030-10-12', probe={schema:'jupiter-calendar-dom-probe.v1',calendar_visible:true,
    selected_months:['2030-10'],display_filters:{announcements:true,due_dates:true},
    date_cells:monthDays('2030-10').map(day=>({date_id:'c'+day,visible:true,children:day===date?[
      {attributes:{class:'annlabel'},raw_text:'School notices'},{attributes:{class:'announce'},raw_text:'Fictional studio day'}]:[]})),
    controls:[{attributes:{click:'goassign(0, 900003)'},text:'Unverified',ancestors:[{id:'show'+date}]}]};
  let month=parseCalendarMonth(probe,'2030-10',range,['Fictional geometry']);
  assert.equal(month.status,'complete');
  assert.equal(month.events[0].date,date);assert.equal(month.events[0].start_time,null);
  assert.equal(month.events[0].all_day,null);assert.equal(month.events[0].source_event_id,null);
  assert.equal(month.events[1].evidence.assignment.verified,false);
  probe.date_cells.pop();
  month=parseCalendarMonth(probe,'2030-10',range,['Fictional geometry']);
  assert.equal(month.status,'partial');
});

test('foreign school/year, a changed authenticated student route, and excessive page budgets fail closed', async () => {
  const identity = {verified:true,scope_hash:'c'.repeat(64),school_id:'990001',school_year:'2030-2031'};
  const config = {expected_school_year:'2030-2031',timezone:'UTC'};
  assert.throws(()=>expectedAcademicFilter(identity,'990002 20302031'),{code:'calendar_school_identity_mismatch'});
  const page={url:()=>route};
  await assert.rejects(collectCalendarFromAuthenticatedPage(page,{},config,identity,{witnessedRoutes:[route.replace('910001','910002')]}),
    {code:'calendar_identity_mismatch'});
  await assert.rejects(collectCalendarFromAuthenticatedPage({url:()=>route.split('?')[0]},{},config,identity),{code:'calendar_route_context_missing'});
  await assert.rejects(collectCalendarFromAuthenticatedPage(page,{},config,identity,{maxMonths:9}),{code:'calendar_read_budget_invalid'});
});
