'use strict';
const fs=require('node:fs/promises');
const {configuration}=require('../src/config.cjs');
const {decodeState,loadState}=require('../src/persistence.cjs');
const {writePrivate,argument}=require('./private-file.cjs');
async function main(){
  const input=argument('--encrypted-file'),output=argument('--output');
  if(!output)throw Error();
  const {storage}=configuration(process.env,{github:!input});
  const state=input?decodeState(await fs.readFile(input,'utf8'),storage.key,storage.repo,storage.scope):(await loadState(storage)).state;
  if(!state)throw Error();
  await writePrivate(output,{schema:'jupiter-student-export.v1',warning:'Private student source data; not a learning task list.',state});
  console.log('Private export saved locally. No plaintext was uploaded.');
}
if(require.main===module)main().catch(()=>{console.error('Export refused or failed. Check your own configuration, encrypted file, and unused .private output path.');process.exitCode=1;});
