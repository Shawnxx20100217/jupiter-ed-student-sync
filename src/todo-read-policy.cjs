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
  const error=routeError(combined,allowedRoutes);if(error)return deny(error);
  bump('read_navigations');return {allow:true,reason:'verified_read_navigation'};
}
module.exports={evaluateTodoRequest};
