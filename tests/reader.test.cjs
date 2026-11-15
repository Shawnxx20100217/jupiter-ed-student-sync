'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {validateConfig,checkIdentity,browserEnvironment,classifyError,readJupiter}=require('../src/reader.cjs');
const {loginPageState}=require('../dist/scraper/navigator.js');
const config=()=>({school:'Fictional Academy',city:'Example City',state:'other',expected_name:'Example Student',expected_school_year:'2026-2027',expected_term:'Q1',expected_courses:['Example Course One','Example Course Two'],timezone:'America/New_York'});
test('arbitrary IANA timezone and course count are accepted, incomplete config is rejected',()=>{
 for(const timezone of ['UTC','Asia/Shanghai','Europe/London','America/New_York'])assert.equal(validateConfig({...config(),timezone}).timezone,timezone);
 for(const expected_courses of [[],['Example Course One',' Example Course One ']])assert.throws(()=>validateConfig({...config(),expected_courses}),/config_invalid/);
 for(const timezone of ['Mars/Unknown','+08:00',''])assert.throws(()=>validateConfig({...config(),timezone}),/config_invalid/);
 assert.equal(validateConfig({...config(),expected_courses:['Example Course One']}).expected_courses.length,1);
 assert.throws(()=>validateConfig({...config(),school_id:10001}),/config_invalid/);
});
test('student, school year and entire course set are exact mandatory identity checks',()=>{
 const identity={name:'Example Student',school_year:'2026-2027',courses:['Example Course Two','Example Course One']};
 checkIdentity(identity,config());
 for(const patch of [{name:'Another Student'},{school_year:'2025-2026'},{courses:['Example Course One']},{courses:null}])assert.throws(()=>checkIdentity({...identity,...patch},config()),/identity_mismatch/);
});
test('browser environment never inherits application secrets',()=>{
 process.env.JUPITER_PASSWORD='synthetic-not-a-real-secret';process.env.GITHUB_TOKEN='synthetic-not-a-token';
 try{const env=browserEnvironment('Europe/London');assert.equal(env.TZ,'Europe/London');assert.equal(env.JUPITER_PASSWORD,undefined);assert.equal(env.GITHUB_TOKEN,undefined);assert.equal(env.BROWSER_USE_ACCESS_PIPE_PATH,undefined);}finally{delete process.env.JUPITER_PASSWORD;delete process.env.GITHUB_TOKEN;}
});
test('missing account credentials fail before launching a browser',async()=>{
 await assert.rejects(readJupiter({config:config(),scope:{},credentials:{}}),e=>e.code==='credentials_missing');
 await assert.rejects(readJupiter({config:config(),credentials:{username:'Example',password:'synthetic'}}),e=>e.code==='scope_required');
});
function classifyDOM(text,title='',fields=[]){
 const document={title,body:{innerText:text},querySelector:selector=>fields.includes(selector)?{getClientRects:()=>[{}],textContent:'',value:''}:null};
 return vm.runInNewContext('('+loginPageState.toString()+')', {document})('Fictional Academy');
}
test('all observed outage layouts are identified without requiring exact HTML or retry minutes',()=>{
 assert.equal(classifyDOM('We are currently performing maintenance of our servers. Please try again later.','Site Maintenance'),'upstream_maintenance');
 assert.equal(classifyDOM('Server Maintenance We are currently performing maintenance on our servers.'),'upstream_maintenance');
 assert.equal(classifyDOM('Sorry, Jupiter is offline while we perform maintenance on our servers. Please check back in 15 minutes.'),'upstream_maintenance');
 assert.equal(classifyDOM('Sorry, the server is not responding! We are working on it now. Please try again later.'),'upstream_unavailable');
 for(const code of ['upstream_maintenance','upstream_unavailable'])assert.equal(classifyError(new Error(code),{login_submissions:0}).code,code);
});
test('login readiness requires usable fields; generic maintenance words are insufficient',()=>{
 assert.equal(classifyDOM('HTTP 200'),false);
 assert.equal(classifyDOM('Fictional Academy'),false);
 assert.equal(classifyDOM('Maintenance is covered in Example Course One','',['#text_studid1','#text_password1','#text_city1']),true);
});
