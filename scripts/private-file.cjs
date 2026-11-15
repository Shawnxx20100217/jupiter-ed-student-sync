'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
async function writePrivate(file,value){
  if(process.env.GITHUB_ACTIONS==='true')throw Error('local_export_only');
  const root=path.resolve('.private'),target=path.resolve(file||'');
  if(!target.startsWith(root+path.sep)||path.dirname(target)!==root)throw Error('output_must_be_private_directory');
  await fs.mkdir(root,{recursive:true,mode:0o700});
  if((await fs.lstat(root)).isSymbolicLink())throw Error('private_directory_symlink_rejected');
  await fs.chmod(root,0o700);
  await fs.writeFile(target,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
}
function argument(name){const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];}
module.exports={writePrivate,argument};
