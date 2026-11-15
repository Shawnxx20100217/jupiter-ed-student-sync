'use strict';
const {scopeFromConfig}=require('./state.cjs');
const {validateSchedule}=require('./schedule.cjs');
function fail(code){throw Object.assign(Error(code),{code});}
function configuration(env, {password=false, github=true}={}) {
  const required=['JUPITER_CONFIG','JUPITER_EXPECTED_NAME','JUPITER_USERNAME','JUPITER_STATE_KEY','GITHUB_REPOSITORY'];
  if(password)required.push('JUPITER_PASSWORD');
  if(github)required.push('GITHUB_TOKEN');
  if(required.some(k=>typeof env[k]!=='string'||!env[k].trim()))fail('required_configuration_missing');
  let config;try{config=JSON.parse(env.JUPITER_CONFIG);}catch{fail('config_invalid');}
  if(!config||Array.isArray(config)||typeof config!=='object')fail('config_invalid');
  const allowed=['school','city','state','school_id','expected_school_year','expected_term','expected_courses','timezone','schedule'];
  if(Object.keys(config).some(k=>!allowed.includes(k)))fail('unexpected_config_field');
  config={...config,expected_name:env.JUPITER_EXPECTED_NAME};
  if(!Array.isArray(config.expected_courses)||!config.expected_courses.length||config.expected_courses.some(x=>typeof x!=='string'||!x.trim())||new Set(config.expected_courses.map(x=>x.trim())).size!==config.expected_courses.length)fail('expected_courses_required');
  if(config.school_id!==undefined && (typeof config.school_id!=='string'||!/^\d+$/.test(config.school_id)))fail('config_invalid');
  validateSchedule(config.schedule,config.timezone);
  const scope=scopeFromConfig(config,env.JUPITER_USERNAME);
  return {config,scope,storage:{repo:env.GITHUB_REPOSITORY,token:env.GITHUB_TOKEN,key:env.JUPITER_STATE_KEY,scope}};
}
module.exports={configuration,fail};
