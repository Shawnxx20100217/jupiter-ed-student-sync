'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateTodoRequest}=require('../src/todo-read-policy.cjs');
const post=(postData,path='/student.php')=>({url:'https://login.jupitered.com'+path,method:'POST',isNavigation:true,postData});
test('one official login and verified course navigation are allowed',()=>{
 const counters={};assert.equal(evaluateTodoRequest(post('text_password1=synthetic&school1=10001','/login/'),counters,{phase:'course'}).allow,true);
 assert.equal(evaluateTodoRequest(post('text_password1=synthetic','/login/'),counters).reason,'login_already_submitted');
 assert.equal(counters.login_submissions,1);
 assert.equal(evaluateTodoRequest(post('to=grades&class1=10001'),{}, {phase:'course'}).allow,true);
 assert.equal(evaluateTodoRequest(post('to=grades&class1=10001')).allow,false);
 assert.equal(evaluateTodoRequest(post('to=todo')).allow,true);
});
test('Done, uploads, grade writes and dirty navigation are blocked in every reading phase',()=>{
 for(const phase of ['course','todo'])for(const postData of ['to=todo&studflagdone=1','to=grades&savegrade=1','to=todo&submitwork=1','to=todo&upload=file','to=todo&delete=1','to=todo&setdone=1','to=todo&text_password1=synthetic','to=todo&to=grades'])assert.equal(evaluateTodoRequest(post(postData),{},{phase}).allow,false,postData);
});
test('credentials cannot reach another host, URL, or third-party POST',()=>{
 for(const request of [{...post('text_password1=synthetic','/login/'),url:'https://example.invalid/login/'},{...post('to=todo'),url:'https://login.jupitered.com/student.php?password=synthetic'},{...post('to=todo'),isNavigation:false},{...post('to=todo'),method:'DELETE'}])assert.equal(evaluateTodoRequest(request).allow,false);
});
