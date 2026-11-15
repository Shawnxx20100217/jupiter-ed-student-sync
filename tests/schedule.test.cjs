'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {latestWindow,freshness,budget,validateSchedule}=require('../src/schedule.cjs');
const schedule={weekdays:['11:45','17:20','20:50'],weekends:['11:30','20:50']};
test('business timezone converts weekday, weekend and previous-day windows correctly',()=>{
 assert.equal(latestWindow('2030-10-01T03:50:00Z',schedule,'Asia/Shanghai'),'2030-10-01T03:45:00.000Z');
 assert.equal(latestWindow('2030-10-05T03:40:00Z',schedule,'Asia/Shanghai'),'2030-10-05T03:30:00.000Z');
 assert.equal(latestWindow('2030-10-07T00:00:00Z',schedule,'Asia/Shanghai'),'2030-10-06T12:50:00.000Z');
});
test('DST skipped local minute chooses previous real window rather than inventing an instant',()=>{
 const s={weekdays:['02:30'],weekends:['02:30']};
 assert.equal(latestWindow('2030-03-10T08:00:00Z',s,'America/New_York'),'2030-03-09T07:30:00.000Z');
});
test('freshness requires actual collection after the latest scheduled window',()=>{
 const now='2030-10-01T12:55:00Z';
 assert.equal(freshness('2030-10-01T12:49:00Z',now,schedule,'Asia/Shanghai').covered,false);
 assert.equal(freshness('2030-10-01T12:51:00Z',now,schedule,'Asia/Shanghai').covered,true);
 assert.equal(freshness(null,now,schedule,'Asia/Shanghai').covered,false);
 assert.throws(()=>freshness('2030-10-02T12:00:00Z',now,schedule,'Asia/Shanghai'),{code:'snapshot_time_invalid'});
});
test('login budget is bounded by one-hour cooldown and six attempts per rolling day',()=>{
 const now='2030-10-01T12:00:00Z';assert.equal(budget(['2030-10-01T11:30:00Z'],now).reason,'login_cooldown');
 assert.equal(budget(['01','03','05','07','09','11'].map(h=>`2030-10-01T${h}:00:00Z`),now).reason,'daily_login_budget');
 assert.equal(budget(['2030-09-30T11:59:00Z'],now).allowed,true);
 assert.throws(()=>budget(['invalid'],now),{code:'attempt_history_invalid'});
});
test('invalid timezones, duplicate times and excessive frequencies are rejected',()=>{
 assert.throws(()=>validateSchedule(schedule,'Mars/Unknown'),{code:'timezone_invalid'});
 assert.throws(()=>validateSchedule({...schedule,weekdays:['11:45','11:45']},'UTC'),{code:'schedule_invalid'});
 assert.throws(()=>validateSchedule({...schedule,weekdays:['01:00','02:00','03:00','04:00','05:00']},'UTC'),{code:'schedule_invalid'});
});
