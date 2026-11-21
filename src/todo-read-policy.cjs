'use strict';
// Pure network guard for official login and verified read-only navigation. No network I/O.
const HOSTS=new Set(['login.jupitered.com','jupitered.com','www.jupitered.com']);
const LOGIN=/^\/login\/(?:index\.php)?$/;
const STUDENT=/^\/(?:[a-zA-Z0-9_-]+\/)*student\.php$/;
const NAV_FIELDS=new Set(['to','page','page1']);
const TODO_ROUTES=new Set(['home','todo','calendar']);
const COURSE_ROUTES=new Set(['home','grades','todo']);
const CREDENTIAL=/^(?:text_)?(?:password\d*|passwd|pwd|username|user_name|studid\d*|credential(?:s)?|secret|token|access_token|refresh_token|authorization|cookie(?:s)?)$/i;
const PASSWORD=/^(?:text_)?(?:password\d*|passwd|pwd)$/i;
const DIRTY=/^(?:do|action|action\d*|command|cmd|operation|op|doit|change|changed|changes|dirty|save|saving|update|updating|flag|studflagdone|upload|submitwork|sendmessage|savegrade|delete|checkoff|setdone|markdone)(?:\d*|\[.*\])?$/i;
const MUTATING_VALUE=/(?:^|[\s,;])(?:studflagdone|submitwork|sendmessage|savegrade|delete|checkoff|setdone|markdone)(?:$|[\s,;])/i;
// Observed authenticated Calendar form. Its rendered month menu calls go()
// without a destination: from=calendar, to='', todo='', calview=YYYY-MM.
// This exception is available only while the collector clicks an exact menu
// option witnessed on that same page. No arbitrary blank-route POST is allowed.
const CALENDAR_FIELDS=new Set(['from','to','todo','mini','session','server','district','school','year','stud','contact',
  'datemenu','class1','gterm','ass','autologin','calschoolyear','showhw','showannounce','showbreakfast','showlunch','calview','pagecomplete']);
// Official /js/2.js go() appends these immediately before submitting: the
// page's server-adjusted request clock and the read-navigation busy label.
// They are not unrestricted fields: validate their values below, only here.
const CALENDAR_RUNTIME_FIELDS=new Set(['pagereq','busymsg']);
function calendarMonthError({formEntries,queryEntries,context,url}){
  if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(context?.calendarMonth||''))return 'calendar_month_context_missing';
  if(!/^\d+ \d{8}$/.test(context?.calendarSchoolYear||''))return 'calendar_school_year_context_missing';
  // Jupiter's real form action retains the authenticated page's w route.
  // This is URL-only routing evidence, not an extra form/write capability.
  // Bind it to the exact already identity-checked page; never infer a student
  // route or allow arbitrary query fields/duplicates/another school's route.
  if(!context.calendarPageUrl || !queryEntries.length)return 'calendar_route_context_missing';
  if(queryEntries.length!==1||queryEntries[0][0]!=='w')return 'calendar_route_query_unverified';
  let witnessed;try{witnessed=new URL(context.calendarPageUrl);}catch{return 'calendar_route_context_missing';}
  const observed=[...witnessed.searchParams];
  if(witnessed.origin!=='https://login.jupitered.com'||witnessed.pathname!==url.pathname||
    observed.length!==1||observed[0][0]!=='w'||queryEntries[0][1]!==observed[0][1]||
    !/^\d+(?:,\d+)+$/.test(queryEntries[0][1])||queryEntries[0][1].split(',')[0]!==context.calendarSchoolYear.split(' ')[0])
    return 'calendar_route_mismatch';
  const names=formEntries.map(([key])=>key);
  if(names.some(key=>!CALENDAR_FIELDS.has(key)&&!CALENDAR_RUNTIME_FIELDS.has(key)))return 'calendar_month_field_unverified';
  if(new Set(names).size!==names.length)return 'calendar_month_duplicate_field';
  const values=new Map(formEntries);
  if(context.used) return 'calendar_month_request_already_used';
  if(!context.routeFields || typeof context.routeFields!=='object') return 'calendar_form_scope_unproven';
  for(const field of ['school','stud','year','district','contact']){
    if(values.has(field)!==Object.hasOwn(context.routeFields,field) ||
       values.has(field)&&values.get(field)!==context.routeFields[field]) return 'calendar_form_scope_mismatch';
  }
  if(values.has('busymsg')&&values.get('busymsg')!=='Loading')return 'calendar_busy_state_unverified';
  if(values.has('pagereq')){
    const clock=context.calendarTiming,elapsed=Date.now()-clock?.capturedAtMs;
    if(!Number.isSafeInteger(clock?.capturedAtMs)||!Number.isFinite(clock?.serverSeconds)||clock.serverSeconds<=0||
      !Number.isFinite(elapsed)||elapsed<0||elapsed>15000)return 'calendar_request_time_unproven';
    const raw=values.get('pagereq'),actual=Number(raw),expected=clock.serverSeconds+elapsed/1000;
    // now(true) is floor(Date.now()/1000); allow only that rounding boundary
    // plus a small event-loop tolerance, not an arbitrary replayed timestamp.
    if(!/^[1-9]\d{8,10}(?:\.\d{1,9})?$/.test(raw)||!Number.isFinite(actual)||Math.abs(actual-expected)>2)
      return 'calendar_request_time_mismatch';
  }
  if(values.get('from')!=='calendar'||values.get('to')!==''||values.get('todo')!==''||
    values.get('calview')!==context.calendarMonth||values.get('showhw')!=='1'||values.get('showannounce')!=='1'||
    values.get('mini')!=='0'||values.get('pagecomplete')!=='1'||values.get('calschoolyear')!==context.calendarSchoolYear)return 'calendar_month_navigation_mismatch';
  return null;
}
function routeError(entries,allowedRoutes){
  const routes=entries.filter(([key])=>NAV_FIELDS.has(key.toLowerCase()));
  if(!routes.length)return 'navigation_destination_missing';
  const names=routes.map(([key])=>key.toLowerCase());
  if(new Set(names).size!==names.length)return 'duplicate_navigation_parameter';
  const values=routes.map(([,value])=>value).filter(value=>value!=='');
  if(!values.length||values.some(value=>!allowedRoutes.has(value))||new Set(values).size!==1)return 'conflicting_or_disallowed_navigation';
  return null;
}
function evaluateTodoRequest(request,counters={},options={}){
  const allowedRoutes=options.phase==='course'?COURSE_ROUTES:TODO_ROUTES;
  const bump=key=>{counters[key]=(Number.isSafeInteger(counters[key])?counters[key]:0)+1;};
  const deny=reason=>{bump('blocked_requests');return {allow:false,reason};};
  let url;try{url=new URL(request.url);}catch{return deny('invalid_url');}
  const method=String(request.method||'').toUpperCase();
  if(!['GET','HEAD','POST'].includes(method))return deny('method_not_read_or_login');
  if(['data:','about:'].includes(url.protocol))return method==='GET'?{allow:true,reason:'local_browser_resource'}:deny('local_resource_method');
  if(url.protocol!=='https:'||!HOSTS.has(url.hostname)||url.port&&url.port!=='443')return deny('outside_official_origin');
  if(url.username||url.password)return deny('credentials_in_url');
  if([...url.searchParams.keys()].some(key=>CREDENTIAL.test(key)))return deny('credentials_in_url');
  if([...url.searchParams].some(([key,value])=>DIRTY.test(key)&&value.trim()||MUTATING_VALUE.test(value)))return deny('mutation_in_url');
  if(method!=='POST'){
    const query=[...url.searchParams];
    if(STUDENT.test(url.pathname)&&query.some(([key])=>NAV_FIELDS.has(key.toLowerCase()))){
      const error=routeError(query,allowedRoutes);if(error)return deny(error);
      bump('read_navigations');return {allow:true,reason:'verified_read_navigation'};
    }
    return {allow:true,reason:'official_read_resource'};
  }
  if(url.hostname!=='login.jupitered.com'||request.isNavigation!==true)return deny('post_not_official_navigation');
  if(!LOGIN.test(url.pathname)&&!STUDENT.test(url.pathname))return deny('post_endpoint_not_allowed');
  if(options.calendarMonth!==undefined&&!STUDENT.test(url.pathname))return deny('calendar_route_mismatch');
  if(typeof request.postData!=='string'||!request.postData||/^\s*[\[{]/.test(request.postData))return deny('post_body_not_form');
  const form=new URLSearchParams(request.postData);
  if([...form.keys()].some(key=>!key||/[\r\n\0]/.test(key)))return deny('form_key_invalid');
  const passwordKeys=[...form.keys()].filter(key=>PASSWORD.test(key));
  const credentials=[...form.keys()].filter(key=>CREDENTIAL.test(key));
  if(credentials.length&&!LOGIN.test(url.pathname))return deny('credentials_outside_login_endpoint');
  if(passwordKeys.length){
    if(new Set(passwordKeys.map(key=>key.toLowerCase())).size!==passwordKeys.length||passwordKeys.some(key=>form.getAll(key).length!==1))return deny('duplicate_login_credentials');
    if((counters.login_submissions||0)>=1){bump('blocked_login_submissions');return deny('login_already_submitted');}
  }
  if(LOGIN.test(url.pathname)){
    // Preserve normal school/city/region/account form fields at the official
    // login endpoint. The caller validates the school and selected region.
    if([...form].some(([,value])=>MUTATING_VALUE.test(value)))return deny('mutation_in_login_form');
    if(passwordKeys.length)bump('login_submissions');
    return {allow:true,reason:passwordKeys.length?'single_official_login':'official_login_form'};
  }
  const combined=[...url.searchParams,...form];
  if(combined.some(([key,value])=>DIRTY.test(key)&&value.trim()||MUTATING_VALUE.test(value)))return deny('dirty_navigation_form');
  if(options.calendarMonth!==undefined&&options.phase==='todo'){
    const error=calendarMonthError({formEntries:[...form],queryEntries:[...url.searchParams],context:options,url});
    if(error)return deny(error);
    bump('read_navigations');bump('calendar_month_navigations');return {allow:true,reason:'witnessed_calendar_month_navigation'};
  }
  const error=routeError(combined,allowedRoutes);if(error)return deny(error);
  bump('read_navigations');return {allow:true,reason:'verified_read_navigation'};
}
module.exports={evaluateTodoRequest};
