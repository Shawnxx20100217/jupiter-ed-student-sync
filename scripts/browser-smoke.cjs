'use strict';
// Ubuntu compatibility smoke test: synthetic HTML only, all page requests blocked.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const puppeteer=require('puppeteer-core').default;
const {loginPageState}=require('../dist/scraper/navigator.js');
const {browserEnvironment}=require('../src/reader.cjs');
async function main(){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'student-synthetic-'));
  let browser;
  try{
    await fs.chmod(directory,0o700);
    browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,userDataDir:directory,timeout:30000,
      env:browserEnvironment('UTC'),args:['--disable-background-networking','--no-first-run','--disable-dev-shm-usage']});
    const page=await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request',r=>r.abort().catch(()=>{}));
    await page.setContent('<html><body><h1>Server Maintenance</h1><p>We are currently performing maintenance of our servers.</p></body></html>');
    assert.equal(await page.evaluate(loginPageState,'Fictional Academy'),'upstream_maintenance');
    await page.setContent('<html><body><input id="text_studid1"><input id="text_password1" type="password"><input id="text_city1"><input id="text_school1"></body></html>');
    assert.equal(await page.evaluate(loginPageState,'Fictional Academy'),true);
    const calendar=await require('../tests/helpers/calendar-browser.cjs').smokeCalendar(browser);
    console.log(JSON.stringify({synthetic_browser_verified:true,synthetic_calendar:calendar,real_account_tested:false,credential_submissions:0}));
  }finally{await browser?.close();await fs.rm(directory,{recursive:true,force:true});}
}
main().catch(()=>{console.error('synthetic_browser_test_failed');process.exitCode=1;});
