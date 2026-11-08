import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {zipSync} from 'fflate';
import './build-site.mjs';
const names=['index.html','.nojekyll','web-dist/app.js','web-dist/app.css'];
for(const number of ['01','02','03'])for(const extension of ['svg','preview.png'])names.push(`examples/v3/${number}.${extension}`);
const entries=Object.fromEntries(await Promise.all(names.map(async name=>[name,new Uint8Array(await readFile(name))])));
await mkdir('delivery',{recursive:true});await writeFile('delivery/website.zip',zipSync(entries,{level:6}));
console.log('Created delivery/website.zip for static hosting.');
