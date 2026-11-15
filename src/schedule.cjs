'use strict';
// Pure clock policy, shared by GitHub and the optional watchdog. No student data.
function validateSchedule(schedule, timezone) {
  try { if (!timezone || typeof timezone !== 'string') throw Error(); new Intl.DateTimeFormat('en', {timeZone:timezone}); }
  catch { throw Object.assign(Error('timezone_invalid'), {code:'timezone_invalid'}); }
  if (!schedule || ['weekdays','weekends'].some(k => !Array.isArray(schedule[k]) || !schedule[k].length || schedule[k].length > 4 ||
      new Set(schedule[k]).size !== schedule[k].length || schedule[k].some(t => typeof t !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))))
    throw Object.assign(Error('schedule_invalid'), {code:'schedule_invalid'});
  return schedule;
}
function latestWindow(now, schedule, timezone) {
  validateSchedule(schedule, timezone);
  if (!Number.isFinite(Date.parse(now))) throw Object.assign(Error('clock_invalid'), {code:'clock_invalid'});
  const format = new Intl.DateTimeFormat('en-US', {timeZone:timezone, weekday:'short', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  // Bounded minute search handles IANA offsets, DST gaps and weekend boundaries.
  let cursor = Math.floor(Date.parse(now) / 60000) * 60000;
  for (let n=0;n<60*72;n++,cursor-=60000) {
    const p=Object.fromEntries(format.formatToParts(cursor).map(x=>[x.type,x.value]));
    const times=schedule[['Sat','Sun'].includes(p.weekday)?'weekends':'weekdays'];
    if(times.includes(`${p.hour}:${p.minute}`)) return new Date(cursor).toISOString();
  }
  throw Object.assign(Error('schedule_window_unavailable'), {code:'schedule_window_unavailable'});
}
function freshness(lastSuccess, now, schedule, timezone) {
  const window=latestWindow(now,schedule,timezone);
  const last=lastSuccess===null?NaN:Date.parse(lastSuccess);
  if(lastSuccess!==null && (!Number.isFinite(last)||last>Date.parse(now)+60000)) throw Object.assign(Error('snapshot_time_invalid'),{code:'snapshot_time_invalid'});
  return {window,covered:Number.isFinite(last)&&last>=Date.parse(window),late_ms:Date.parse(now)-Date.parse(window)};
}
function budget(attempts, now) {
  const time=Date.parse(now);
  if(!Number.isFinite(time)||!Array.isArray(attempts)||attempts.some(x=>!Number.isFinite(Date.parse(x))||Date.parse(x)>time+60000))
    throw Object.assign(Error('attempt_history_invalid'), {code:'attempt_history_invalid'});
  const recent=attempts.map(Date.parse).filter(x=>x>time-86400000);
  if(recent.some(x=>time-x<3600000))return {allowed:false,reason:'login_cooldown'};
  if(recent.length>=6)return {allowed:false,reason:'daily_login_budget'};
  return {allowed:true,reason:'within_budget'};
}
module.exports={validateSchedule,latestWindow,freshness,budget};
