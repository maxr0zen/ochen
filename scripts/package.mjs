import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {zipSync, unzipSync} from 'fflate';

const root=process.cwd(), files={};
await import('./build-demo.mjs');
async function collect(path){
  const entries=await readdir(join(root,path),{withFileTypes:true});
  for(const entry of entries){
    const child=join(path,entry.name);
    if(entry.isDirectory())await collect(child);
    else if(entry.isFile())files[relative(root,join(root,child)).replaceAll('\\','/')]=new Uint8Array(await readFile(join(root,child)));
  }
}
for(const file of ['manifest.json','.env.example','package.json','package-lock.json','README.md','.gitignore','tsconfig.json','playwright.config.ts'])files[file]=new Uint8Array(await readFile(join(root,file)));
for(const directory of ['src','server','dist','scripts','docs','palettes','tests','library','source-library','examples/v3','demo'])await collect(directory);
for(const file of ['output/native-v2-acceptance.json','output/native-v2-roundtrip.txt','output/library/validation.json','output/exports/validation.json','output/composition-v3/geometry-validation.json','output/composition-v3/rules-validation.json'])files[file]=new Uint8Array(await readFile(join(root,file)));
const proof=JSON.parse(new TextDecoder().decode(files['output/native-v2-acceptance.json']));
if(proof.passed!==54||proof.variantsPassed!==40||!['colorGuard','relativeGuard','sceneScale','manualOperations','originalsUnchanged'].every(k=>proof[k]===true))throw new Error('Native acceptance evidence is incomplete.');
if(Object.keys(files).some(path=>/(^|\/)\.env(?!\.example$)/.test(path)))throw new Error('Private environment file in delivery.');
const archive=zipSync(files,{level:6});
const entries=unzipSync(archive);
for(const required of ['manifest.json','dist/code.js','dist/ui.html','src/plugin.ts','README.md','library/bundle.json','library/manifest.json','examples/v3/01.svg','examples/v3/02.svg','examples/v3/03.svg','demo/index.html','output/native-v2-acceptance.json'])if(!entries[required])throw new Error(`Missing ${required}`);
await mkdir(join(root,'delivery'),{recursive:true});
await writeFile(join(root,'delivery','illustration-composer.zip'),archive);
console.log(`delivery/illustration-composer.zip: ${Object.keys(entries).length} files, ${archive.length} bytes. Local Figma registration and node_modules excluded.`);
