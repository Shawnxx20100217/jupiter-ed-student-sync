'use strict';
// Artificial school, student, IDs, grades and dates; not captured from any account.
const {scopeFromConfig,fingerprint,buildState}=require('../../src/state.cjs');
const config={school:'Example Academy',city:'Example City',state:'Other',expected_name:'Example Student',expected_school_year:'2030-2031',expected_term:'Term A',expected_courses:['Example Mathematics','Example Art'],timezone:'Europe/London'};
function fixture(overrides={}) {
  const settings={...config,...overrides};
  const scope=scopeFromConfig(settings,'synthetic-student-login');
  const context={scope,expectedCourses:settings.expected_courses,expectedName:settings.expected_name,expectedSchoolYear:settings.expected_school_year,expectedTerm:settings.expected_term,timezone:settings.timezone};
  const assignment=(id,name)=>({id,name,name_raw:name,due_raw:'10/12',category_raw:'Practice',score_raw:'8 / 10',percent_raw:'80.00 %',letter_grade_raw:'B',graded:true});
  const course=(name,id)=>({name,teacher:'Example Teacher',term:settings.expected_term,assignments:[assignment(id,'Synthetic exercise')],coverage:{complete:true,assignment_owner_count:1,parsed_assignment_count:1,assignment_header_verified:true}});
  const payload={observed_at:'2030-10-01T12:00:00.000Z',timezone:settings.timezone,school_year:settings.expected_school_year,term:settings.expected_term,coverage:{complete:true,courses:settings.expected_courses},student:{name:settings.expected_name,courses:settings.expected_courses.map((name,i)=>course(name,String(910001+i)))},provenance:{school_identity:{schema:'jupiter-school-identity.v1',verified:true,school_id:'990001',expected_school_id:null,school_year:settings.expected_school_year,scope_hash:fingerprint(scope),observed_at:'2030-10-01T12:00:00.000Z',origin:'https://login.jupitered.com/',method:'authenticated_official_student_route'},school_identity_status:{verified:true,reason:null}}};
  return {config:settings,scope,context,payload,state:()=>buildState(payload,null,context).state};
}
module.exports={fixture};
