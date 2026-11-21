'use strict';
// Requests to the synthetic student route are fulfilled in-process. Nothing
// leaves the browser, including requests from the Calendar month picker.
const assert = require('node:assert/strict');
const {monthDays,collectCalendarFromAuthenticatedPage} = require('../../src/calendar-session-read.cjs');
const {mergeCalendarState} = require('../../src/calendar-state.cjs');
const {mergeCalendarDateSummaries} = require('../../src/calendar-date-summary.cjs');
const {evaluateTodoRequest} = require('../../src/todo-read-policy.cjs');

const route = 'https://login.jupitered.com/student.php?w=990001,910001,0';
const months = ['2030-09','2030-10','2030-11'];

function html(month) {
  const selected = '<span id="menulit_calview" val="'+month+'">'+month+'</span>';
  const options = months.map(m=>'<button val="'+m+'" onclick="pickMonth(this)">'+m+'</button>').join('');
  const grid = monthDays(month).map(day=>{
    let item='';
    if(day==='2030-10-12') item='<div class="annlabel">School activities</div><div class="announce">Studio open house</div>';
    if(day==='2030-10-13') item='<div class="announce">Linked row <span click="goassign(910001)">Worksheet</span></div>';
    return '<tr><td id="c'+day+'">'+day+item+'</td></tr>';
  }).join('');
  const fields={from:'calendar',to:'',todo:'',mini:'0',calview:month,calschoolyear:'990001 20302031',
    showhw:'1',showannounce:'1',pagecomplete:'1',busymsg:'Loading',school:'990001',stud:'910001'};
  const inputs=Object.entries(fields).map(([name,value])=>'<input type="hidden" name="'+name+'" value="'+value+'"/>').join('');
  return `<main id="mainpage"><div id="leftmast"><span class="toptabnull">Example Student</span></div>
    <div id="schoolyeartab">2030-2031</div><div id="sidebar"><span class="classnav">Example Art</span></div>
    <div id="showcalendar">${selected}<div id="menulist_calview" click="clickmenu('calview')">${options}</div>
    <span id="showannounce_check">✓</span><span id="showhw_check">✓</span>
    <form method="post">${inputs}</form><table>${grid}</table></div>
    <script>function pickMonth(el){const f=document.forms[0];f.elements.calview.value=el.getAttribute('val');f.submit();}</script>
    </main>`;
}

async function smokeCalendar(browser) {
  const page=await browser.newPage();
  let context=null, reads=0;
  const denied=[];
  await page.setRequestInterception(true);
  page.on('request', async request=>{
    if(request.url()!==route||!request.isNavigationRequest())return request.abort();
    if(request.method()==='GET')return request.respond({contentType:'text/html',body:html(months[0])});
    const verdict=evaluateTodoRequest({url:route,method:request.method(),isNavigation:true,postData:request.postData()},{},{phase:'todo',...context});
    if(!verdict.allow){denied.push(verdict.reason);return request.abort();}
    context.used=true;
    reads++;
    return request.respond({contentType:'text/html',body:html(context.calendarMonth)});
  });
  try {
    await page.goto(route);
    const identity={verified:true,school_year:'2030-2031',school_id:'990001',scope_hash:'c'.repeat(64)};
    const observation=await collectCalendarFromAuthenticatedPage(page,{assertPageAvailable:async()=>{},isAuthenticated:async()=>true},{
      timezone:'UTC',expected_name:'Example Student',expected_school_year:'2030-2031',expected_courses:['Example Art']
    },identity,{
      now:'2030-10-01T04:00:00.000Z',
      onMonthSelect:(month,schoolYear,pageUrl,timing,routeFields)=>{
        context=month?{calendarMonth:month,calendarSchoolYear:schoolYear,calendarPageUrl:pageUrl,calendarTiming:timing,routeFields}:null;
      },
      monthNavigationBlocked:()=>denied.length>0
    });
    assert.deepEqual(denied,[]);
    assert.deepEqual(observation.months.map(m=>[m.month,m.status,m.error_code]),months.map(m=>[m,'complete',null]));
    assert.equal(reads,2);
    const scope={...identity,timezone:'UTC'};
    const {calendar}=mergeCalendarState(observation,null,scope);
    const result=mergeCalendarDateSummaries(calendar,null,scope);
    assert.deepEqual(result.state.records.map(r=>r.observed.date),['2030-10-12']);
    assert.equal(result.state.records[0].observed.items[0].title,'Studio open house');
    assert.equal(result.summary.holds[0].reason,'calendar_summary_assignment_action_rejected');
    return {complete_months:3,verified_date_summaries:1,held_assignment_rows:1};
  } finally {await page.close();}
}

module.exports={smokeCalendar};
