import { build } from 'esbuild';
import { readFile,writeFile,mkdir,copyFile,access } from 'node:fs/promises';
import {resolve,sep} from 'node:path';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/plugin.ts'],outfile:'dist/code.js',bundle:true,target:'es2017',format:'iife',define:{NATIVE_TEST_BUILD:process.argv.includes('--native-test')?'true':'false'}});
const ui=await build({entryPoints:['src/ui.ts'],bundle:true,target:'es2020',format:'iife',write:false});
let html=await readFile('src/ui.html','utf8');
html=html.replace('/* INJECT_CSS */',await readFile('src/ui.css','utf8')).replace('/* INJECT_JS */',()=>ui.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
await writeFile('dist/ui.html',html);
let registration='figma-registration/registered-plugin';
try{registration=JSON.parse(await readFile('.figma-registration.json','utf8')).directory;}catch(error){if(error.code!=='ENOENT')throw error;}
if(!resolve(registration).startsWith(process.cwd()+sep))throw new Error('Папка регистрации должна находиться внутри проекта.');
try{
  await access(`${registration}/manifest.json`);
  const m=JSON.parse(await readFile(`${registration}/manifest.json`,'utf8'));
  if(m.main==='dist/code.js'){
    const current=JSON.parse(await readFile('manifest.json','utf8'));m.networkAccess=current.networkAccess;
    await writeFile(`${registration}/manifest.json`,JSON.stringify(m,null,2)+'\n');
    await mkdir(`${registration}/dist`,{recursive:true});
    await copyFile('dist/code.js',`${registration}/dist/code.js`);await copyFile('dist/ui.html',`${registration}/dist/ui.html`);
  }
}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Built dist/code.js and dist/ui.html');
